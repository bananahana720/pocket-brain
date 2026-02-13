import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DeviceSession,
  Note,
  SyncBackpressure,
  SyncConflict,
  SyncOp,
  SyncPushResponse,
} from '../types';
import {
  bootstrapSync,
  createSyncDelete,
  createSyncUpsert,
  fetchNotesSnapshot,
  listDevices,
  openSyncEventStream,
  pullSyncChanges,
  pushSyncOps,
  revokeDevice,
} from '../services/syncService';
import {
  type EnqueueSyncOpsResult,
  enqueueSyncOps,
  getSyncQueueHardCap,
  loadSyncState,
  markSyncBootstrapped,
  removeQueuedSyncOps,
  setSyncCursor,
} from '../storage/notesStore';
import { incrementMetric } from '../utils/telemetry';

export type SyncStatus =
  | 'disabled'
  | 'syncing'
  | 'synced'
  | 'offline'
  | 'conflict'
  | 'blocked'
  | 'degraded'
  | 'polling';

const SYNC_FIELD_KEYS: Array<keyof Note> = [
  'content',
  'title',
  'tags',
  'type',
  'isProcessed',
  'isCompleted',
  'isArchived',
  'isPinned',
  'dueDate',
  'priority',
  'analysisState',
  'analysisVersion',
  'contentHash',
  'deletedAt',
];

const AUTO_MERGE_ALLOWED_FIELDS = new Set<string>(
  SYNC_FIELD_KEYS.filter(field => field !== 'deletedAt').map(field => String(field))
);
const CONFLICT_LOOP_WINDOW_MS = 5 * 60 * 1000;
const CONFLICT_LOOP_THRESHOLD = 2;
const SYNC_QUEUE_WARNING_THROTTLE_MS = 60_000;
const SYNC_RETRY_BASE_MS = 1_000;
const SYNC_RETRY_MAX_MS = 30_000;
const SYNC_STREAM_FAILURE_THRESHOLD = 3;
const SYNC_STREAM_CONTINUOUS_FAILURE_MS = 90_000;
const SYNC_REGULAR_INTERVAL_MS = 30_000;
const SYNC_POLLING_INTERVAL_MS = 15_000;

function formatDurationMs(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms));
  if (clamped < 1_000) return '<1s';
  const totalSeconds = Math.round(clamped / 1_000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

function isArrayEqual(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function areFieldValuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return isArrayEqual(a, b);
  }
  return a === b;
}

function computeChangedFields(previous: Partial<Note> | undefined, next: Partial<Note>): string[] {
  const changed = new Set<string>();
  for (const field of SYNC_FIELD_KEYS) {
    const key = String(field);
    const prevValue = previous?.[field];
    const nextValue = next[field];
    if (!areFieldValuesEqual(prevValue, nextValue)) {
      changed.add(key);
    }
  }
  return Array.from(changed.values());
}

function buildBaseNoteSnapshot(note: Note | undefined): Partial<Note> | undefined {
  if (!note) return undefined;
  const snapshot: Partial<Note> = {};
  for (const field of SYNC_FIELD_KEYS) {
    if (typeof note[field] !== 'undefined') {
      snapshot[field] = note[field];
    }
  }
  return snapshot;
}

function setMergedField(note: Note, field: keyof Note, value: unknown): void {
  if (typeof value === 'undefined') {
    delete (note as Record<string, unknown>)[field];
    return;
  }
  (note as Record<string, unknown>)[field] = value;
}

function buildSafeAutoMergeRetryOp(conflict: SyncConflict, sourceOp: SyncOp): SyncOp | null {
  if (sourceOp.op !== 'upsert' || !sourceOp.note || sourceOp.autoMergeAttempted) {
    return null;
  }

  const localChangedFields = (sourceOp.clientChangedFields || []).filter(field => AUTO_MERGE_ALLOWED_FIELDS.has(field));
  if (localChangedFields.length === 0) {
    return null;
  }

  const serverChangedFields = new Set(
    (conflict.changedFields || []).filter(field => AUTO_MERGE_ALLOWED_FIELDS.has(field))
  );
  for (const field of localChangedFields) {
    if (serverChangedFields.has(field)) {
      return null;
    }
  }

  if (conflict.serverNote.deletedAt) {
    return null;
  }

  const merged: Note = {
    ...conflict.serverNote,
  };

  for (const fieldName of localChangedFields) {
    const field = fieldName as keyof Note;
    const localValue = sourceOp.note[field];
    setMergedField(merged, field, localValue);
  }

  merged.updatedAt = Date.now();
  merged.version = Math.max(1, conflict.currentVersion + 1);

  const retry = createSyncUpsert(merged);
  return {
    ...retry,
    baseVersion: conflict.currentVersion,
    clientChangedFields: localChangedFields,
    baseNote: buildBaseNoteSnapshot(conflict.serverNote),
    autoMergeAttempted: true,
  };
}

function areNotesEqual(a: Note, b: Note): boolean {
  if (a === b) return true;
  if (a.id !== b.id) return false;
  if (a.createdAt !== b.createdAt) return false;
  if (a.updatedAt !== b.updatedAt) return false;
  if (a.version !== b.version) return false;

  for (const field of SYNC_FIELD_KEYS) {
    if (!areFieldValuesEqual(a[field], b[field])) {
      return false;
    }
  }

  return true;
}

function applyRemoteChanges(prev: Note[], changes: Array<{ op: 'upsert' | 'delete'; note: Note }>): Note[] {
  const byId = new Map(prev.map(note => [note.id, note]));
  let requiresSort = false;

  for (const change of changes) {
    if (change.op === 'delete' || change.note.deletedAt) {
      byId.delete(change.note.id);
      continue;
    }
    const existing = byId.get(change.note.id);
    if (!existing || existing.createdAt !== change.note.createdAt) {
      requiresSort = true;
    }
    byId.set(change.note.id, change.note);
  }

  const merged = Array.from(byId.values());
  if (!requiresSort) {
    return merged;
  }
  return merged.sort((a, b) => b.createdAt - a.createdAt);
}

function applyPendingQueue(base: Note[], pendingQueue: SyncOp[]): Note[] {
  if (pendingQueue.length === 0) {
    return base;
  }

  const byId = new Map(base.map(note => [note.id, note]));
  for (const op of pendingQueue) {
    if (op.op === 'delete') {
      byId.delete(op.noteId);
      continue;
    }

    if (op.note) {
      byId.set(op.noteId, op.note);
    }
  }

  return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function useSyncEngine(args: {
  enabled: boolean;
  userId: string | null;
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  onQueueWarning?: (message: string) => void;
  onQueueRecovery?: (message: string) => void;
  onResetRecovery?: (message: string) => void;
}) {
  const { enabled, userId, notes, setNotes, onQueueWarning, onQueueRecovery, onResetRecovery } = args;
  const syncQueueCap = getSyncQueueHardCap();

  const [syncStatus, setSyncStatus] = useState<SyncStatus>(enabled ? 'syncing' : 'disabled');
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [devices, setDevices] = useState<DeviceSession[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [isStreamFallbackActive, setIsStreamFallbackActive] = useState(false);
  const [syncBackpressure, setSyncBackpressure] = useState<SyncBackpressure>({
    blocked: false,
    pendingOps: 0,
    cap: syncQueueCap,
    overflowBy: 0,
  });

  const queueRef = useRef<SyncOp[]>([]);
  const cursorRef = useRef(0);
  const processingRef = useRef(false);
  const suppressDiffRef = useRef(false);
  const initializedUserRef = useRef<string | null>(null);
  const prevNotesRef = useRef<Note[]>(notes);
  const notesRef = useRef<Note[]>(notes);
  const conflictsRef = useRef<SyncConflict[]>([]);
  const backpressureRef = useRef<SyncBackpressure>({
    blocked: false,
    pendingOps: 0,
    cap: syncQueueCap,
    overflowBy: 0,
  });
  const conflictLoopRef = useRef<Map<string, number[]>>(new Map());
  const queueWarningTsRef = useRef(0);
  const retryAttemptRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const pullLatestRef = useRef<() => Promise<void>>(async () => {});
  const flushPushQueueRef = useRef<() => Promise<void>>(async () => {});
  const streamFailureCountRef = useRef(0);
  const streamFailureSinceRef = useRef<number | null>(null);
  const streamFallbackActiveRef = useRef(false);
  const blockedSinceRef = useRef<number | null>(null);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  useEffect(() => {
    conflictsRef.current = conflicts;
  }, [conflicts]);

  const setBackpressureState = useCallback((next: SyncBackpressure) => {
    backpressureRef.current = next;
    setSyncBackpressure(next);
  }, []);

  const refreshBackpressureFromQueue = useCallback((queue: SyncOp[], cap = syncQueueCap): SyncBackpressure => {
    const normalizedCap = Math.max(1, cap);
    const pendingOps = queue.length;
    const overflowBy = Math.max(0, pendingOps - normalizedCap);
    const previous = backpressureRef.current;
    const next: SyncBackpressure = {
      blocked: pendingOps >= normalizedCap,
      pendingOps,
      cap: normalizedCap,
      overflowBy,
    };

    if (next.blocked && !previous.blocked) {
      incrementMetric('sync_queue_block_events');
      blockedSinceRef.current = Date.now();
    } else if (!next.blocked && previous.blocked) {
      incrementMetric('sync_queue_recovery_events');
      const blockedSince = blockedSinceRef.current;
      blockedSinceRef.current = null;
      if (onQueueRecovery) {
        const durationSuffix =
          blockedSince === null ? '' : ` after ${formatDurationMs(Math.max(0, Date.now() - blockedSince))}`;
        onQueueRecovery(`Sync queue recovered${durationSuffix}. Pending ops now ${next.pendingOps}/${next.cap}.`);
      }
    } else if (next.blocked && blockedSinceRef.current === null) {
      blockedSinceRef.current = Date.now();
    } else if (!next.blocked) {
      blockedSinceRef.current = null;
    }

    setBackpressureState(next);
    return next;
  }, [onQueueRecovery, setBackpressureState, syncQueueCap]);

  const setSyncStatusSafe = useCallback((next: SyncStatus) => {
    if (next === 'disabled') {
      setSyncStatus('disabled');
      return;
    }
    if (conflictsRef.current.length > 0) {
      setSyncStatus('conflict');
      return;
    }
    if (next === 'offline') {
      setSyncStatus('offline');
      return;
    }
    if (backpressureRef.current.blocked) {
      setSyncStatus('blocked');
      return;
    }
    setSyncStatus(next);
  }, []);

  const resetStreamFailureTracking = useCallback(() => {
    streamFailureCountRef.current = 0;
    streamFailureSinceRef.current = null;
  }, []);

  const setStreamFallbackMode = useCallback((active: boolean) => {
    if (streamFallbackActiveRef.current === active) {
      return;
    }

    streamFallbackActiveRef.current = active;
    setIsStreamFallbackActive(active);
    incrementMetric(active ? 'sync_sse_fallback_activations' : 'sync_sse_fallback_recoveries');
  }, []);

  const activateStreamFallback = useCallback(() => {
    setStreamFallbackMode(true);
    setSyncStatusSafe('polling');
  }, [setStreamFallbackMode, setSyncStatusSafe]);

  const recoverStreamFallback = useCallback(() => {
    resetStreamFailureTracking();
    if (!streamFallbackActiveRef.current) return;
    setStreamFallbackMode(false);
    setSyncStatusSafe(navigator.onLine ? 'syncing' : 'offline');
  }, [resetStreamFailureTracking, setStreamFallbackMode, setSyncStatusSafe]);

  const recordStreamFailure = useCallback((): boolean => {
    const now = Date.now();
    streamFailureCountRef.current += 1;
    if (streamFailureSinceRef.current === null) {
      streamFailureSinceRef.current = now;
    }

    const firstFailureTs = streamFailureSinceRef.current;
    const continuousFailureMs = firstFailureTs === null ? 0 : now - firstFailureTs;
    if (
      streamFailureCountRef.current >= SYNC_STREAM_FAILURE_THRESHOLD ||
      continuousFailureMs >= SYNC_STREAM_CONTINUOUS_FAILURE_MS
    ) {
      activateStreamFallback();
      return true;
    }
    return false;
  }, [activateStreamFallback]);

  const resetRetryBackoff = useCallback(() => {
    retryAttemptRef.current = 0;
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const scheduleRetry = useCallback(() => {
    if (retryTimerRef.current !== null || !enabled || !navigator.onLine) return;
    const baseDelay = Math.min(SYNC_RETRY_MAX_MS, SYNC_RETRY_BASE_MS * Math.pow(2, retryAttemptRef.current));
    const delay = Math.min(SYNC_RETRY_MAX_MS, baseDelay + Math.floor(Math.random() * 250));
    retryAttemptRef.current += 1;
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      void pullLatestRef.current();
      void flushPushQueueRef.current();
    }, delay);
  }, [enabled]);

  const applyEnqueueResult = useCallback((result: EnqueueSyncOpsResult, source: string) => {
    queueRef.current = result.queue;
    const policy = result.queuePolicy;
    const wasBlocked = backpressureRef.current.blocked;
    const nextBackpressure = refreshBackpressureFromQueue(result.queue, policy.cap);
    const hasCompactionDrops = policy.compactionDrops > 0;

    if (hasCompactionDrops) {
      incrementMetric('sync_queue_compaction_drops', policy.compactionDrops);
      console.warn('sync queue compacted pending operations', {
        source,
        before: policy.before,
        after: policy.after,
        cap: policy.cap,
        compactionDrops: policy.compactionDrops,
      });
    }

    if (nextBackpressure.blocked && onQueueWarning) {
      const now = Date.now();
      if (now - queueWarningTsRef.current >= SYNC_QUEUE_WARNING_THROTTLE_MS) {
        queueWarningTsRef.current = now;
        onQueueWarning(
          `Sync queue is at capacity (${nextBackpressure.pendingOps}/${nextBackpressure.cap}). Reconnect and let sync drain before editing more notes.`
        );
      }
    }

    if (nextBackpressure.blocked && navigator.onLine && conflictsRef.current.length === 0) {
      setSyncStatus('blocked');
    } else if (!nextBackpressure.blocked && wasBlocked && conflictsRef.current.length === 0) {
      setSyncStatusSafe(navigator.onLine ? (streamFallbackActiveRef.current ? 'polling' : 'syncing') : 'offline');
    }
  }, [onQueueWarning, refreshBackpressureFromQueue, setSyncStatusSafe]);

  const refreshDevices = useCallback(async () => {
    if (!enabled) {
      setDevices([]);
      setCurrentDeviceId(null);
      return;
    }

    try {
      const payload = await listDevices();
      setDevices(payload.devices);
      setCurrentDeviceId(payload.currentDeviceId);
    } catch {
      // Device list is best-effort.
    }
  }, [enabled]);

  const flushPushQueue = useCallback(async () => {
    if (!enabled || processingRef.current) return;
    if (!navigator.onLine) {
      setSyncStatusSafe('offline');
      return;
    }

    if (queueRef.current.length === 0) {
      refreshBackpressureFromQueue(queueRef.current);
      if (conflictsRef.current.length === 0) {
        setSyncStatusSafe(streamFallbackActiveRef.current ? 'polling' : 'synced');
      }
      return;
    }

    processingRef.current = true;
    setSyncStatusSafe(streamFallbackActiveRef.current ? 'polling' : 'syncing');

    try {
      while (queueRef.current.length > 0) {
        const batch = queueRef.current.slice(0, 100);
        let response: SyncPushResponse;

        try {
          response = await pushSyncOps(batch);
          resetRetryBackoff();
        } catch (error) {
          const status = (error as Error & { status?: number }).status;
          if (status === 401 || status === 403) {
            setSyncStatusSafe('degraded');
            return;
          }
          if (!navigator.onLine) {
            setSyncStatusSafe('offline');
            return;
          }
          setSyncStatusSafe('degraded');
          scheduleRetry();
          return;
        }

        if (response.applied.length > 0) {
          const appliedIds = response.applied.map(item => item.requestId);
          for (const applied of response.applied) {
            conflictLoopRef.current.delete(applied.note.id);
          }
          const state = await removeQueuedSyncOps(appliedIds);
          queueRef.current = state.queue;
          refreshBackpressureFromQueue(state.queue);
          cursorRef.current = Math.max(cursorRef.current, response.nextCursor);
          await setSyncCursor(cursorRef.current);

          suppressDiffRef.current = true;
          setNotes(prev => {
            const changes = response.applied.map(item => ({
              op: item.note.deletedAt ? ('delete' as const) : ('upsert' as const),
              note: item.note,
            }));
            return applyRemoteChanges(prev, changes);
          });
        }

        const manualConflicts: SyncConflict[] = [];
        const retryOps: SyncOp[] = [];

        if (response.conflicts.length > 0) {
          const conflictRequestIds = response.conflicts.map(conflict => conflict.requestId);
          const state = await removeQueuedSyncOps(conflictRequestIds);
          queueRef.current = state.queue;
          refreshBackpressureFromQueue(state.queue);

          for (const conflict of response.conflicts) {
            const now = Date.now();
            const history = conflictLoopRef.current.get(conflict.noteId) || [];
            const recent = history.filter(ts => now - ts <= CONFLICT_LOOP_WINDOW_MS);
            recent.push(now);
            conflictLoopRef.current.set(conflict.noteId, recent);
            const isConflictLoop = recent.length >= CONFLICT_LOOP_THRESHOLD;

            const sourceOp = batch.find(op => op.requestId === conflict.requestId);
            const retryOp = !isConflictLoop && sourceOp ? buildSafeAutoMergeRetryOp(conflict, sourceOp) : null;

            if (retryOp) {
              retryOps.push(retryOp);
            } else {
              if (isConflictLoop) {
                incrementMetric('sync_conflict_loop_blocks');
              }
              manualConflicts.push(conflict);
            }
          }

          if (retryOps.length > 0) {
            const retryState = await enqueueSyncOps(retryOps);
            applyEnqueueResult(retryState, 'conflict_retry');
          }

          if (manualConflicts.length > 0) {
            setConflicts(prev => {
              const existing = new Map(prev.map(item => [item.requestId, item]));
              for (const conflict of manualConflicts) {
                existing.set(conflict.requestId, conflict);
              }
              const next = Array.from(existing.values());
              conflictsRef.current = next;
              return next;
            });
            setSyncStatus('conflict');
          }
        }

        if (queueRef.current.length === 0) {
          const hasConflicts = manualConflicts.length > 0 || conflictsRef.current.length > 0;
          setSyncStatusSafe(hasConflicts ? 'conflict' : streamFallbackActiveRef.current ? 'polling' : 'synced');
        }
      }
    } finally {
      processingRef.current = false;
    }
  }, [
    applyEnqueueResult,
    enabled,
    refreshBackpressureFromQueue,
    resetRetryBackoff,
    resetStreamFailureTracking,
    scheduleRetry,
    setNotes,
    setSyncStatusSafe,
  ]);

  const pullLatest = useCallback(async () => {
    if (!enabled) return;
    if (!navigator.onLine) {
      setSyncStatusSafe('offline');
      return;
    }

    setSyncStatusSafe(streamFallbackActiveRef.current ? 'polling' : 'syncing');

    try {
      const result = await pullSyncChanges(cursorRef.current);
      resetRetryBackoff();
      if (result.resetRequired) {
        incrementMetric('sync_cursor_resets');
        const snapshot = await fetchNotesSnapshot(true);
        suppressDiffRef.current = true;
        const baseSnapshot = snapshot.notes
          .filter(note => !note.deletedAt)
          .sort((a, b) => b.createdAt - a.createdAt);
        setNotes(applyPendingQueue(baseSnapshot, queueRef.current));
        cursorRef.current = Math.max(snapshot.cursor, result.nextCursor || 0);
        await setSyncCursor(cursorRef.current);
        incrementMetric('sync_cursor_reset_recoveries');
        onResetRecovery?.('Recovered sync state after a stale cursor reset.');
        if (conflictsRef.current.length === 0) {
          setSyncStatusSafe(streamFallbackActiveRef.current ? 'polling' : 'synced');
        }
        return;
      }

      if (result.changes.length > 0) {
        suppressDiffRef.current = true;
        setNotes(prev => applyRemoteChanges(prev, result.changes));
      }
      cursorRef.current = Math.max(cursorRef.current, result.nextCursor);
      await setSyncCursor(cursorRef.current);
      if (conflictsRef.current.length === 0) {
        setSyncStatusSafe(streamFallbackActiveRef.current ? 'polling' : 'synced');
      }
    } catch {
      if (!navigator.onLine) {
        setSyncStatusSafe('offline');
      } else if (streamFallbackActiveRef.current) {
        setSyncStatusSafe('polling');
        scheduleRetry();
      } else {
        setSyncStatusSafe('degraded');
        scheduleRetry();
      }
    }
  }, [enabled, onResetRecovery, resetRetryBackoff, scheduleRetry, setNotes, setSyncStatusSafe]);

  useEffect(() => {
    if (!enabled || !userId) {
      initializedUserRef.current = null;
      queueRef.current = [];
      cursorRef.current = 0;
      conflictLoopRef.current.clear();
      streamFallbackActiveRef.current = false;
      setIsStreamFallbackActive(false);
      resetStreamFailureTracking();
      resetRetryBackoff();
      blockedSinceRef.current = null;
      setConflicts([]);
      setDevices([]);
      setCurrentDeviceId(null);
      setBackpressureState({
        blocked: false,
        pendingOps: 0,
        cap: syncQueueCap,
        overflowBy: 0,
      });
      setSyncStatus('disabled');
      prevNotesRef.current = notes;
      return;
    }

    if (initializedUserRef.current === userId) {
      return;
    }

    let cancelled = false;
    initializedUserRef.current = userId;

    const init = async () => {
      streamFallbackActiveRef.current = false;
      setIsStreamFallbackActive(false);
      resetStreamFailureTracking();
      setSyncStatusSafe('syncing');

      const persisted = await loadSyncState();
      queueRef.current = persisted.queue;
      refreshBackpressureFromQueue(queueRef.current);
      cursorRef.current = persisted.cursor;

      if (!persisted.bootstrappedUserId && notesRef.current.length > 0) {
        const bootstrap = await bootstrapSync(notesRef.current, 'local-automatic-migration-v1');
        cursorRef.current = Math.max(cursorRef.current, bootstrap.cursor);
        await markSyncBootstrapped(userId);
      }

      const snapshot = await fetchNotesSnapshot(true);
      if (!cancelled) {
        cursorRef.current = Math.max(cursorRef.current, snapshot.cursor);
        await setSyncCursor(cursorRef.current);

        suppressDiffRef.current = true;
        setNotes(
          snapshot.notes
            .filter(note => !note.deletedAt)
            .sort((a, b) => b.createdAt - a.createdAt)
        );
      }

      await refreshDevices();
      await pullLatest();
      await flushPushQueue();
      if (!cancelled && conflictsRef.current.length === 0) {
        setSyncStatusSafe(streamFallbackActiveRef.current ? 'polling' : 'synced');
      }
    };

    init().catch(() => {
      if (!cancelled) {
        setSyncStatusSafe('degraded');
        scheduleRetry();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    flushPushQueue,
    notes,
    pullLatest,
    refreshBackpressureFromQueue,
    refreshDevices,
    resetRetryBackoff,
    scheduleRetry,
    setBackpressureState,
    setNotes,
    setSyncStatusSafe,
    syncQueueCap,
    userId,
  ]);

  useEffect(() => {
    prevNotesRef.current = notes;
  }, []);

  useEffect(() => {
    if (!enabled || !userId || initializedUserRef.current !== userId) {
      prevNotesRef.current = notes;
      return;
    }

    if (suppressDiffRef.current) {
      suppressDiffRef.current = false;
      prevNotesRef.current = notes;
      return;
    }

    const previous = prevNotesRef.current;
    const next = notes;

    const prevById = new Map(previous.map(note => [note.id, note]));
    const nextById = new Map(next.map(note => [note.id, note]));
    const nextOps: SyncOp[] = [];

    for (const note of next) {
      const prev = prevById.get(note.id);
      if (!prev || !areNotesEqual(prev, note)) {
        const changedFields = computeChangedFields(prev, note);
        const upsert = createSyncUpsert({
          ...note,
          updatedAt: Date.now(),
          version: note.version || (prev?.version || 0) + 1,
        });
        nextOps.push({
          ...upsert,
          baseVersion: prev?.version || 0,
          clientChangedFields: changedFields,
          baseNote: buildBaseNoteSnapshot(prev),
        });
      }
    }

    for (const oldNote of previous) {
      if (!nextById.has(oldNote.id)) {
        nextOps.push({
          ...createSyncDelete(oldNote.id, oldNote.version || 1),
          clientChangedFields: ['deletedAt'],
          baseNote: buildBaseNoteSnapshot(oldNote),
        });
      }
    }

    prevNotesRef.current = next;
    if (nextOps.length === 0) return;

    enqueueSyncOps(nextOps)
      .then(state => {
        applyEnqueueResult(state, 'note_diff');
      })
      .then(() => flushPushQueue())
      .catch(() => {
        setSyncStatusSafe('degraded');
        scheduleRetry();
      });
  }, [applyEnqueueResult, enabled, flushPushQueue, notes, scheduleRetry, setSyncStatusSafe, userId]);

  useEffect(() => {
    if (!enabled) return;

    const disconnect = openSyncEventStream(
      cursor => {
        if (cursor > cursorRef.current) {
          void pullLatest();
        }
      },
      () => {
        if (navigator.onLine) {
          if (recordStreamFailure()) {
            setSyncStatusSafe('polling');
          } else {
            setSyncStatusSafe('degraded');
          }
          scheduleRetry();
        }
      },
      () => {
        recoverStreamFallback();
      }
    );

    return () => disconnect();
  }, [enabled, pullLatest, recordStreamFailure, recoverStreamFallback, scheduleRetry, setSyncStatusSafe]);

  useEffect(() => {
    if (!enabled) return;

    const intervalMs = isStreamFallbackActive ? SYNC_POLLING_INTERVAL_MS : SYNC_REGULAR_INTERVAL_MS;
    const interval = window.setInterval(() => {
      void pullLatest();
      void flushPushQueue();
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [enabled, flushPushQueue, isStreamFallbackActive, pullLatest]);

  useEffect(() => {
    const onOnline = () => {
      if (!enabled) return;
      setSyncStatusSafe(streamFallbackActiveRef.current ? 'polling' : 'syncing');
      void pullLatest();
      void flushPushQueue();
    };

    const onOffline = () => {
      if (!enabled) return;
      setSyncStatusSafe('offline');
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [enabled, flushPushQueue, pullLatest, setSyncStatusSafe]);

  const resolveConflictKeepServer = useCallback((requestId: string) => {
    setConflicts(prev => {
      const conflict = prev.find(item => item.requestId === requestId);
      if (!conflict) return prev;

      suppressDiffRef.current = true;
      setNotes(notesBefore => {
        const next = applyRemoteChanges(notesBefore, [
          {
            op: conflict.serverNote.deletedAt ? 'delete' : 'upsert',
            note: conflict.serverNote,
          },
        ]);
        return next;
      });

      const next = prev.filter(item => item.requestId !== requestId);
      conflictsRef.current = next;
      return next;
    });
  }, [setNotes]);

  const resolveConflictKeepLocal = useCallback(
    (requestId: string) => {
      const conflict = conflicts.find(item => item.requestId === requestId);
      if (!conflict) return;

      const local = notesRef.current.find(note => note.id === conflict.noteId);
      if (!local) {
        resolveConflictKeepServer(requestId);
        return;
      }

      const retryOp =
        local.deletedAt || local.content === ''
          ? {
              ...createSyncDelete(conflict.noteId, conflict.currentVersion),
              clientChangedFields: ['deletedAt'],
              baseNote: buildBaseNoteSnapshot(conflict.serverNote),
              autoMergeAttempted: true,
            }
          : {
              ...createSyncUpsert({
                ...local,
                version: conflict.currentVersion + 1,
                updatedAt: Date.now(),
              }),
              baseVersion: conflict.currentVersion,
              clientChangedFields: computeChangedFields(conflict.serverNote, local),
              baseNote: buildBaseNoteSnapshot(conflict.serverNote),
              autoMergeAttempted: true,
            };

      enqueueSyncOps([retryOp])
        .then(state => {
          applyEnqueueResult(state, 'manual_conflict_retry');
          setConflicts(prev => {
            const next = prev.filter(item => item.requestId !== requestId);
            conflictsRef.current = next;
            return next;
          });
        })
        .then(() => flushPushQueue())
        .catch(() => {
          setSyncStatusSafe('degraded');
          scheduleRetry();
        });
    },
    [applyEnqueueResult, conflicts, flushPushQueue, resolveConflictKeepServer, scheduleRetry, setSyncStatusSafe]
  );

  const dismissConflict = useCallback((requestId: string) => {
    setConflicts(prev => {
      const next = prev.filter(item => item.requestId !== requestId);
      conflictsRef.current = next;
      return next;
    });
  }, []);

  const revokeDeviceById = useCallback(async (deviceId: string) => {
    await revokeDevice(deviceId);
    await refreshDevices();
  }, [refreshDevices]);

  useEffect(() => {
    if (!enabled || !navigator.onLine) return;
    if (streamFallbackActiveRef.current && conflictsRef.current.length === 0 && !backpressureRef.current.blocked) {
      setSyncStatusSafe('polling');
    }
  }, [enabled, isStreamFallbackActive, setSyncStatusSafe]);

  useEffect(() => {
    if (conflicts.length > 0) {
      setSyncStatus('conflict');
      return;
    }
    if (!enabled) return;
    if (backpressureRef.current.blocked) {
      setSyncStatusSafe(navigator.onLine ? 'blocked' : 'offline');
    }
  }, [conflicts.length, enabled, setSyncStatusSafe]);

  useEffect(() => {
    pullLatestRef.current = pullLatest;
  }, [pullLatest]);

  useEffect(() => {
    flushPushQueueRef.current = flushPushQueue;
  }, [flushPushQueue]);

  useEffect(() => {
    return () => {
      resetRetryBackoff();
    };
  }, [resetRetryBackoff]);

  return useMemo(
    () => ({
      syncStatus,
      syncBackpressure,
      conflicts,
      devices,
      currentDeviceId,
      refreshDevices,
      revokeDevice: revokeDeviceById,
      resolveConflictKeepServer,
      resolveConflictKeepLocal,
      dismissConflict,
    }),
    [
      syncStatus,
      syncBackpressure,
      conflicts,
      devices,
      currentDeviceId,
      refreshDevices,
      revokeDeviceById,
      resolveConflictKeepServer,
      resolveConflictKeepLocal,
      dismissConflict,
    ]
  );
}
