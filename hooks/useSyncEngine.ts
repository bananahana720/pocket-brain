import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DeviceSession,
  Note,
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
  enqueueSyncOps,
  loadSyncState,
  markSyncBootstrapped,
  removeQueuedSyncOps,
  setSyncCursor,
} from '../storage/notesStore';

export type SyncStatus = 'disabled' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'degraded';

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
  return JSON.stringify(a) === JSON.stringify(b);
}

function applyRemoteChanges(prev: Note[], changes: Array<{ op: 'upsert' | 'delete'; note: Note }>): Note[] {
  const byId = new Map(prev.map(note => [note.id, note]));

  for (const change of changes) {
    if (change.op === 'delete' || change.note.deletedAt) {
      byId.delete(change.note.id);
      continue;
    }
    byId.set(change.note.id, change.note);
  }

  return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function useSyncEngine(args: {
  enabled: boolean;
  userId: string | null;
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
}) {
  const { enabled, userId, notes, setNotes } = args;

  const [syncStatus, setSyncStatus] = useState<SyncStatus>(enabled ? 'syncing' : 'disabled');
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [devices, setDevices] = useState<DeviceSession[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);

  const queueRef = useRef<SyncOp[]>([]);
  const cursorRef = useRef(0);
  const processingRef = useRef(false);
  const suppressDiffRef = useRef(false);
  const initializedUserRef = useRef<string | null>(null);
  const prevNotesRef = useRef<Note[]>(notes);
  const notesRef = useRef<Note[]>(notes);
  const conflictsRef = useRef<SyncConflict[]>([]);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  useEffect(() => {
    conflictsRef.current = conflicts;
  }, [conflicts]);

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
      setSyncStatus('offline');
      return;
    }

    if (queueRef.current.length === 0) {
      if (conflictsRef.current.length === 0) {
        setSyncStatus('synced');
      }
      return;
    }

    processingRef.current = true;
    setSyncStatus(prev => (prev === 'conflict' ? prev : 'syncing'));

    try {
      while (queueRef.current.length > 0) {
        const batch = queueRef.current.slice(0, 100);
        let response: SyncPushResponse;

        try {
          response = await pushSyncOps(batch);
        } catch (error) {
          const status = (error as Error & { status?: number }).status;
          if (status === 401 || status === 403) {
            setSyncStatus('degraded');
            return;
          }
          if (!navigator.onLine) {
            setSyncStatus('offline');
            return;
          }
          setSyncStatus('degraded');
          return;
        }

        if (response.applied.length > 0) {
          const appliedIds = response.applied.map(item => item.requestId);
          const state = await removeQueuedSyncOps(appliedIds);
          queueRef.current = state.queue;
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

          for (const conflict of response.conflicts) {
            const sourceOp = batch.find(op => op.requestId === conflict.requestId);
            const retryOp = sourceOp ? buildSafeAutoMergeRetryOp(conflict, sourceOp) : null;

            if (retryOp) {
              retryOps.push(retryOp);
            } else {
              manualConflicts.push(conflict);
            }
          }

          if (retryOps.length > 0) {
            const retryState = await enqueueSyncOps(retryOps);
            queueRef.current = retryState.queue;
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
          setSyncStatus(hasConflicts ? 'conflict' : 'synced');
        }
      }
    } finally {
      processingRef.current = false;
    }
  }, [enabled, setNotes]);

  const pullLatest = useCallback(async () => {
    if (!enabled) return;
    if (!navigator.onLine) {
      setSyncStatus('offline');
      return;
    }

    setSyncStatus(prev => (prev === 'conflict' ? prev : 'syncing'));

    try {
      const result = await pullSyncChanges(cursorRef.current);
      if (result.changes.length > 0) {
        suppressDiffRef.current = true;
        setNotes(prev => applyRemoteChanges(prev, result.changes));
      }
      cursorRef.current = Math.max(cursorRef.current, result.nextCursor);
      await setSyncCursor(cursorRef.current);
      if (conflictsRef.current.length === 0) {
        setSyncStatus('synced');
      }
    } catch {
      if (!navigator.onLine) {
        setSyncStatus('offline');
      } else {
        setSyncStatus('degraded');
      }
    }
  }, [enabled, setNotes]);

  useEffect(() => {
    if (!enabled || !userId) {
      initializedUserRef.current = null;
      queueRef.current = [];
      cursorRef.current = 0;
      setConflicts([]);
      setDevices([]);
      setCurrentDeviceId(null);
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
      setSyncStatus('syncing');

      const persisted = await loadSyncState();
      queueRef.current = persisted.queue;
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
        setSyncStatus('synced');
      }
    };

    init().catch(() => {
      if (!cancelled) {
        setSyncStatus('degraded');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, flushPushQueue, notes, pullLatest, refreshDevices, setNotes, userId]);

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
        queueRef.current = state.queue;
      })
      .then(() => flushPushQueue())
      .catch(() => {
        setSyncStatus('degraded');
      });
  }, [enabled, flushPushQueue, notes, userId]);

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
          setSyncStatus(prev => (prev === 'conflict' ? prev : 'degraded'));
        }
      }
    );

    return () => disconnect();
  }, [enabled, pullLatest]);

  useEffect(() => {
    if (!enabled) return;

    const interval = window.setInterval(() => {
      void pullLatest();
      void flushPushQueue();
    }, 30_000);

    return () => window.clearInterval(interval);
  }, [enabled, flushPushQueue, pullLatest]);

  useEffect(() => {
    const onOnline = () => {
      if (!enabled) return;
      setSyncStatus(prev => (prev === 'conflict' ? prev : 'syncing'));
      void pullLatest();
      void flushPushQueue();
    };

    const onOffline = () => {
      if (!enabled) return;
      setSyncStatus('offline');
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [enabled, flushPushQueue, pullLatest]);

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
          queueRef.current = state.queue;
          setConflicts(prev => {
            const next = prev.filter(item => item.requestId !== requestId);
            conflictsRef.current = next;
            return next;
          });
        })
        .then(() => flushPushQueue())
        .catch(() => {
          setSyncStatus('degraded');
        });
    },
    [conflicts, flushPushQueue, resolveConflictKeepServer]
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
    if (conflicts.length > 0) {
      setSyncStatus('conflict');
    }
  }, [conflicts.length]);

  return useMemo(
    () => ({
      syncStatus,
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
