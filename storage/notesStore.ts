import { Note, SyncBackpressureMode, SyncOp } from '../types';

const DB_NAME = 'pocketbrain_store';
const DB_VERSION = 3;
const SNAPSHOT_STORE = 'snapshots';
const OPS_STORE = 'ops';
const ANALYSIS_QUEUE_STORE = 'analysis_queue';
const SYNC_STATE_STORE = 'sync_state';
const SNAPSHOT_KEY = 'current';
const ANALYSIS_QUEUE_KEY = 'current';
const LEGACY_SYNC_STATE_KEY = 'current';
const SYNC_STATE_KEY_PREFIX = 'scope:';
const ANONYMOUS_SYNC_SCOPE = '__anon__';
const DEFAULT_SYNC_QUEUE_HARD_CAP = 500;
const DEFAULT_SYNC_QUEUE_OVERFLOW_CAP = DEFAULT_SYNC_QUEUE_HARD_CAP;

function resolveSyncQueueHardCap(): number {
  if (typeof window !== 'undefined') {
    const testOverride = Number((window as Window & { __PB_SYNC_QUEUE_HARD_CAP?: number }).__PB_SYNC_QUEUE_HARD_CAP);
    if (Number.isFinite(testOverride) && Math.floor(testOverride) >= 1) {
      return Math.floor(testOverride);
    }
  }

  const raw = import.meta.env?.VITE_SYNC_QUEUE_HARD_CAP;
  if (!raw) return DEFAULT_SYNC_QUEUE_HARD_CAP;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_SYNC_QUEUE_HARD_CAP;
  const normalized = Math.floor(parsed);
  if (normalized < 1) return DEFAULT_SYNC_QUEUE_HARD_CAP;
  return normalized;
}

const SYNC_QUEUE_HARD_CAP = resolveSyncQueueHardCap();

function resolveSyncQueueOverflowCap(queueCap: number): number {
  if (typeof window !== 'undefined') {
    const testOverride = Number(
      (window as Window & { __PB_SYNC_QUEUE_OVERFLOW_CAP?: number }).__PB_SYNC_QUEUE_OVERFLOW_CAP
    );
    if (Number.isFinite(testOverride) && Math.floor(testOverride) >= 1) {
      return Math.floor(testOverride);
    }
  }

  const raw = import.meta.env?.VITE_SYNC_QUEUE_OVERFLOW_CAP;
  if (!raw) return Math.max(1, Math.floor(queueCap || DEFAULT_SYNC_QUEUE_OVERFLOW_CAP));
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return Math.max(1, Math.floor(queueCap || DEFAULT_SYNC_QUEUE_OVERFLOW_CAP));
  const normalized = Math.floor(parsed);
  if (normalized < 1) return Math.max(1, Math.floor(queueCap || DEFAULT_SYNC_QUEUE_OVERFLOW_CAP));
  return normalized;
}

const SYNC_QUEUE_OVERFLOW_CAP = resolveSyncQueueOverflowCap(SYNC_QUEUE_HARD_CAP);

export function getSyncQueueHardCap(): number {
  return SYNC_QUEUE_HARD_CAP;
}

export function getSyncQueueOverflowCap(): number {
  return SYNC_QUEUE_OVERFLOW_CAP;
}

export type NoteOp =
  | { type: 'upsert'; note: Note }
  | { type: 'delete'; id: string };

export interface PersistedAnalysisJob {
  noteId: string;
  content: string;
  version: number;
  contentHash: string;
  attempts: number;
  enqueuedAt: number;
}

export interface AnalysisQueueState {
  pending: PersistedAnalysisJob[];
  deferred: PersistedAnalysisJob[];
  transient: PersistedAnalysisJob[];
  deadLetter: PersistedAnalysisJob[];
}

const EMPTY_ANALYSIS_QUEUE_STATE: AnalysisQueueState = {
  pending: [],
  deferred: [],
  transient: [],
  deadLetter: [],
};

interface SnapshotRecord {
  id: string;
  version: number;
  updatedAt: number;
  notes: Note[];
}

interface OpRecord {
  id?: number;
  createdAt: number;
  op: NoteOp;
}

interface AnalysisQueueRecord extends AnalysisQueueState {
  id: string;
  updatedAt: number;
}

interface SyncStateRecord {
  id: string;
  updatedAt: number;
  cursor: number;
  queue: SyncOp[];
  overflowQueue: SyncOp[];
  bootstrappedUserId: string | null;
  scopeUserId: string | null;
}

export interface PersistedSyncState {
  cursor: number;
  queue: SyncOp[];
  overflowQueue: SyncOp[];
  bootstrappedUserId: string | null;
  scopeUserId: string | null;
}

export interface SyncQueuePolicyStats {
  before: number;
  after: number;
  cap: number;
  compactionDrops: number;
  blocked: boolean;
  overflowBy: number;
  pendingOps: number;
}

export interface SyncQueueOverflowPolicyStats {
  mode: SyncBackpressureMode;
  queueCap: number;
  overflowCap: number;
  hardCap: number;
  activeOps: number;
  overflowOps: number;
  pendingOps: number;
  overflowBy: number;
}

export interface EnqueueSyncOpsResult extends PersistedSyncState {
  queuePolicy: SyncQueuePolicyStats;
  overflowPolicy: SyncQueueOverflowPolicyStats;
}

function normalizeSyncScopeUserId(userId: string | null | undefined): string | null {
  if (typeof userId !== 'string') return null;
  const trimmed = userId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveSyncStateScope(userId: string | null | undefined): string {
  return normalizeSyncScopeUserId(userId) || ANONYMOUS_SYNC_SCOPE;
}

function resolveSyncStateKey(userId: string | null | undefined): string {
  return `${SYNC_STATE_KEY_PREFIX}${resolveSyncStateScope(userId)}`;
}

function toPersistedSyncState(
  record: SyncStateRecord | undefined,
  requestedScopeUserId: string | null
): PersistedSyncState {
  if (!record) {
    return {
      cursor: 0,
      queue: [],
      overflowQueue: [],
      bootstrappedUserId: null,
      scopeUserId: requestedScopeUserId,
    };
  }

  return {
    cursor: typeof record.cursor === 'number' ? Math.max(0, Math.floor(record.cursor)) : 0,
    queue: sanitizeSyncQueue(record.queue),
    overflowQueue: sanitizeSyncQueue(record.overflowQueue),
    bootstrappedUserId: normalizeSyncScopeUserId(record.bootstrappedUserId),
    scopeUserId:
      normalizeSyncScopeUserId(record.scopeUserId) ??
      normalizeSyncScopeUserId(record.bootstrappedUserId) ??
      requestedScopeUserId,
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(OPS_STORE)) {
        const opsStore = db.createObjectStore(OPS_STORE, { keyPath: 'id', autoIncrement: true });
        opsStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(ANALYSIS_QUEUE_STORE)) {
        db.createObjectStore(ANALYSIS_QUEUE_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SYNC_STATE_STORE)) {
        db.createObjectStore(SYNC_STATE_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
  });
}

function sanitizeAnalysisJob(raw: unknown): PersistedAnalysisJob | null {
  if (!raw || typeof raw !== 'object') return null;

  const value = raw as Record<string, unknown>;
  const noteId = typeof value.noteId === 'string' ? value.noteId : '';
  const content = typeof value.content === 'string' ? value.content : '';
  const contentHash = typeof value.contentHash === 'string' ? value.contentHash : '';
  const version = typeof value.version === 'number' ? Math.max(0, Math.floor(value.version)) : 0;
  const attempts = typeof value.attempts === 'number' ? Math.max(0, Math.floor(value.attempts)) : 0;
  const enqueuedAt =
    typeof value.enqueuedAt === 'number' && Number.isFinite(value.enqueuedAt) && value.enqueuedAt > 0
      ? Math.floor(value.enqueuedAt)
      : Date.now();

  if (!noteId || !contentHash) return null;
  return {
    noteId,
    content,
    version,
    contentHash,
    attempts,
    enqueuedAt,
  };
}

function sanitizeAnalysisQueue(raw: unknown): PersistedAnalysisJob[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(sanitizeAnalysisJob)
    .filter((job): job is PersistedAnalysisJob => !!job);
}

function sanitizeSyncOp(raw: unknown): SyncOp | null {
  if (!raw || typeof raw !== 'object') return null;

  const value = raw as Record<string, unknown>;
  const requestId = typeof value.requestId === 'string' ? value.requestId : '';
  const op = value.op === 'upsert' || value.op === 'delete' ? value.op : null;
  const noteId = typeof value.noteId === 'string' ? value.noteId : '';
  const baseVersion = typeof value.baseVersion === 'number' ? Math.max(0, Math.floor(value.baseVersion)) : 0;
  const note = value.note && typeof value.note === 'object' ? (value.note as Note) : undefined;
  const clientChangedFields = Array.isArray(value.clientChangedFields)
    ? value.clientChangedFields.filter((field): field is string => typeof field === 'string' && field.length > 0)
    : undefined;
  const baseNote = value.baseNote && typeof value.baseNote === 'object' ? (value.baseNote as Partial<Note>) : undefined;
  const autoMergeAttempted = value.autoMergeAttempted === true;

  if (!requestId || !op || !noteId) return null;
  if (op === 'upsert' && !note) return null;

  return {
    requestId,
    op,
    noteId,
    baseVersion,
    ...(note ? { note } : {}),
    ...(clientChangedFields ? { clientChangedFields } : {}),
    ...(baseNote ? { baseNote } : {}),
    ...(autoMergeAttempted ? { autoMergeAttempted } : {}),
  };
}

function sanitizeSyncQueue(raw: unknown): SyncOp[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(sanitizeSyncOp)
    .filter((op): op is SyncOp => !!op);
}

function promisifyRequest<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function applyOps(baseNotes: Note[], opRecords: OpRecord[]): Note[] {
  const notesById = new Map(baseNotes.map(note => [note.id, note]));

  for (const record of opRecords) {
    const op = record.op;
    if (op.type === 'upsert') {
      notesById.set(op.note.id, op.note);
      continue;
    }
    notesById.delete(op.id);
  }

  return Array.from(notesById.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export async function loadNotes(): Promise<Note[]> {
  const db = await openDb();
  try {
    const tx = db.transaction([SNAPSHOT_STORE, OPS_STORE], 'readonly');
    const snapshotStore = tx.objectStore(SNAPSHOT_STORE);
    const opsStore = tx.objectStore(OPS_STORE);

    const snapshot = (await promisifyRequest(snapshotStore.get(SNAPSHOT_KEY))) as SnapshotRecord | undefined;
    const ops = (await promisifyRequest(opsStore.getAll())) as OpRecord[];

    return applyOps(snapshot?.notes || [], ops);
  } finally {
    db.close();
  }
}

export async function loadAnalysisQueueState(): Promise<AnalysisQueueState> {
  const db = await openDb();
  try {
    const tx = db.transaction(ANALYSIS_QUEUE_STORE, 'readonly');
    const store = tx.objectStore(ANALYSIS_QUEUE_STORE);
    const record = (await promisifyRequest(store.get(ANALYSIS_QUEUE_KEY))) as AnalysisQueueRecord | undefined;

    if (!record) {
      return { ...EMPTY_ANALYSIS_QUEUE_STATE };
    }

    return {
      pending: sanitizeAnalysisQueue(record.pending),
      deferred: sanitizeAnalysisQueue(record.deferred),
      transient: sanitizeAnalysisQueue(record.transient),
      deadLetter: sanitizeAnalysisQueue(record.deadLetter),
    };
  } finally {
    db.close();
  }
}

export async function loadSyncState(userId: string | null = null): Promise<PersistedSyncState> {
  const scopeUserId = normalizeSyncScopeUserId(userId);
  const scopedKey = resolveSyncStateKey(scopeUserId);

  const db = await openDb();
  try {
    const tx = db.transaction(SYNC_STATE_STORE, 'readonly');
    const store = tx.objectStore(SYNC_STATE_STORE);
    const record = (await promisifyRequest(store.get(scopedKey))) as SyncStateRecord | undefined;

    if (record) {
      return toPersistedSyncState(record, scopeUserId);
    }

    const legacyRecord = (await promisifyRequest(store.get(LEGACY_SYNC_STATE_KEY))) as SyncStateRecord | undefined;
    if (!legacyRecord) {
      return toPersistedSyncState(undefined, scopeUserId);
    }

    const legacyState = toPersistedSyncState(legacyRecord, null);
    const legacyScopeUserId = normalizeSyncScopeUserId(legacyState.scopeUserId);
    const scopeMatches = legacyScopeUserId === scopeUserId;
    if (!scopeMatches) {
      return toPersistedSyncState(undefined, scopeUserId);
    }

    return {
      ...legacyState,
      scopeUserId: scopeUserId,
    };
  } finally {
    db.close();
  }
}

export async function saveSyncState(state: PersistedSyncState, userId: string | null = null): Promise<void> {
  const scopeUserId = normalizeSyncScopeUserId(userId);
  const key = resolveSyncStateKey(scopeUserId);

  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SYNC_STATE_STORE, 'readwrite');
      tx.objectStore(SYNC_STATE_STORE).put({
        id: key,
        updatedAt: Date.now(),
        cursor: Math.max(0, Math.floor(state.cursor || 0)),
        queue: state.queue,
        overflowQueue: state.overflowQueue,
        bootstrappedUserId: normalizeSyncScopeUserId(state.bootstrappedUserId),
        scopeUserId,
      } satisfies SyncStateRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to save sync state'));
      tx.onabort = () => reject(tx.error || new Error('Sync state save aborted'));
    });
  } finally {
    db.close();
  }
}

function compactSyncQueue(queue: SyncOp[]): SyncOp[] {
  if (queue.length <= 1) return queue;

  // Keep the most recent pending operation per note to avoid unbounded queue growth while offline.
  const latestIndexByNoteId = new Map<string, number>();
  for (let i = 0; i < queue.length; i++) {
    latestIndexByNoteId.set(queue[i].noteId, i);
  }

  return queue.filter((op, index) => latestIndexByNoteId.get(op.noteId) === index);
}

export function applySyncQueuePolicies(queue: SyncOp[], hardCap = SYNC_QUEUE_HARD_CAP): {
  queue: SyncOp[];
  queuePolicy: SyncQueuePolicyStats;
} {
  const before = queue.length;
  const compacted = compactSyncQueue(queue);
  const compactionDrops = Math.max(0, before - compacted.length);
  const cap = Math.max(1, Math.floor(Number.isFinite(hardCap) ? hardCap : SYNC_QUEUE_HARD_CAP));
  const pendingOps = compacted.length;
  const overflowBy = Math.max(0, pendingOps - cap);
  const blocked = pendingOps >= cap;

  return {
    queue: compacted,
    queuePolicy: {
      before,
      after: compacted.length,
      cap,
      compactionDrops,
      blocked,
      overflowBy,
      pendingOps,
    },
  };
}

export function limitQueueToCapPreservingExisting(baseQueue: SyncOp[], candidateQueue: SyncOp[], cap: number): SyncOp[] {
  const normalizedCap = Math.max(1, Math.floor(Number.isFinite(cap) ? cap : SYNC_QUEUE_HARD_CAP));
  if (candidateQueue.length <= normalizedCap) {
    return candidateQueue;
  }

  const baseNoteIds = new Set(baseQueue.map(op => op.noteId));
  const acceptedNoteIds = new Set<string>();

  for (const op of candidateQueue) {
    if (baseNoteIds.has(op.noteId)) {
      acceptedNoteIds.add(op.noteId);
    }
  }

  let availableSlots = normalizedCap - acceptedNoteIds.size;
  if (availableSlots > 0) {
    for (const op of candidateQueue) {
      if (acceptedNoteIds.has(op.noteId)) continue;
      if (availableSlots <= 0) break;
      acceptedNoteIds.add(op.noteId);
      availableSlots -= 1;
    }
  }

  return candidateQueue.filter(op => acceptedNoteIds.has(op.noteId));
}

function normalizeCap(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return Math.max(1, Math.floor(fallback));
  return Math.max(1, Math.floor(value));
}

function buildOverflowPolicy(activeOps: number, overflowOps: number, queueCap: number, overflowCap: number): SyncQueueOverflowPolicyStats {
  const normalizedQueueCap = normalizeCap(queueCap, SYNC_QUEUE_HARD_CAP);
  const normalizedOverflowCap = normalizeCap(overflowCap, SYNC_QUEUE_OVERFLOW_CAP);
  const hardCap = normalizedQueueCap + normalizedOverflowCap;
  const pendingOps = activeOps + overflowOps;

  let mode: SyncBackpressureMode = 'normal';
  if (pendingOps >= hardCap) {
    mode = 'blocked';
  } else if (overflowOps > 0) {
    mode = 'backlog';
  }

  return {
    mode,
    queueCap: normalizedQueueCap,
    overflowCap: normalizedOverflowCap,
    hardCap,
    activeOps,
    overflowOps,
    pendingOps,
    overflowBy: Math.max(0, pendingOps - hardCap),
  };
}

function normalizeSyncStateQueues(
  state: PersistedSyncState,
  queueCap = SYNC_QUEUE_HARD_CAP,
  overflowCap = SYNC_QUEUE_OVERFLOW_CAP
): EnqueueSyncOpsResult {
  const normalizedQueueCap = normalizeCap(queueCap, SYNC_QUEUE_HARD_CAP);
  const normalizedOverflowCap = normalizeCap(overflowCap, SYNC_QUEUE_OVERFLOW_CAP);
  const combinedBefore = [...state.queue, ...state.overflowQueue];
  const compacted = compactSyncQueue(combinedBefore);
  const queue = compacted.slice(0, normalizedQueueCap);
  const overflowQueue = compacted.slice(normalizedQueueCap);
  const overflowPolicy = buildOverflowPolicy(queue.length, overflowQueue.length, normalizedQueueCap, normalizedOverflowCap);

  return {
    cursor: state.cursor,
    bootstrappedUserId: state.bootstrappedUserId,
    scopeUserId: state.scopeUserId,
    queue,
    overflowQueue,
    queuePolicy: {
      before: combinedBefore.length,
      after: compacted.length,
      cap: overflowPolicy.hardCap,
      compactionDrops: Math.max(0, combinedBefore.length - compacted.length),
      blocked: overflowPolicy.mode === 'blocked',
      overflowBy: overflowPolicy.overflowBy,
      pendingOps: overflowPolicy.pendingOps,
    },
    overflowPolicy,
  };
}

function hasSameQueueState(a: PersistedSyncState, b: PersistedSyncState): boolean {
  return (
    a.cursor === b.cursor &&
    a.bootstrappedUserId === b.bootstrappedUserId &&
    a.scopeUserId === b.scopeUserId &&
    isSameQueueByRequestId(a.queue, b.queue) &&
    isSameQueueByRequestId(a.overflowQueue, b.overflowQueue)
  );
}

function withNoQueueDrops(state: PersistedSyncState): EnqueueSyncOpsResult {
  return normalizeSyncStateQueues(state);
}

function isSameQueueByRequestId(a: SyncOp[], b: SyncOp[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].requestId !== b[i].requestId) return false;
  }
  return true;
}

export async function enqueueSyncOps(ops: SyncOp[], userId: string | null = null): Promise<EnqueueSyncOpsResult> {
  const current = await loadSyncState(userId);
  const normalizedCurrent = withNoQueueDrops(current);
  const baseState: PersistedSyncState = {
    ...current,
    queue: normalizedCurrent.queue,
    overflowQueue: normalizedCurrent.overflowQueue,
  };
  if (!hasSameQueueState(current, baseState)) {
    await saveSyncState(baseState, userId);
  }

  if (ops.length === 0) {
    return normalizeSyncStateQueues(baseState);
  }

  const nextQueue = [...baseState.queue, ...baseState.overflowQueue];

  for (const op of ops) {
    const existingIndex = nextQueue.findIndex(item => item.requestId === op.requestId);
    if (existingIndex >= 0) {
      nextQueue[existingIndex] = op;
    } else {
      nextQueue.push(op);
    }
  }

  const normalizedNext = normalizeSyncStateQueues({
    ...baseState,
    queue: nextQueue,
    overflowQueue: [],
  });

  const updated: PersistedSyncState = {
    ...baseState,
    queue: normalizedNext.queue,
    overflowQueue: normalizedNext.overflowQueue,
  };
  await saveSyncState(updated, userId);
  return {
    ...updated,
    queuePolicy: normalizedNext.queuePolicy,
    overflowPolicy: normalizedNext.overflowPolicy,
  };
}

export async function removeQueuedSyncOps(
  requestIds: string[],
  userId: string | null = null
): Promise<PersistedSyncState> {
  const current = await loadSyncState(userId);
  const idSet = new Set(requestIds);
  const filteredCombined =
    requestIds.length === 0
      ? [...current.queue, ...current.overflowQueue]
      : [...current.queue, ...current.overflowQueue].filter(item => !idSet.has(item.requestId));
  const normalized = normalizeSyncStateQueues({
    ...current,
    queue: filteredCombined,
    overflowQueue: [],
  });
  const updated: PersistedSyncState = {
    ...current,
    queue: normalized.queue,
    overflowQueue: normalized.overflowQueue,
  };
  if (!hasSameQueueState(current, updated)) {
    await saveSyncState(updated, userId);
  }
  return updated;
}

export async function setSyncCursor(cursor: number, userId: string | null = null): Promise<PersistedSyncState> {
  const current = await loadSyncState(userId);
  const updated: PersistedSyncState = {
    ...current,
    cursor: Math.max(current.cursor, Math.max(0, Math.floor(cursor || 0))),
  };
  await saveSyncState(updated, userId);
  return updated;
}

export async function markSyncBootstrapped(
  userId: string,
  scopeUserId: string | null = userId
): Promise<PersistedSyncState> {
  const current = await loadSyncState(scopeUserId);
  const updated: PersistedSyncState = {
    ...current,
    bootstrappedUserId: normalizeSyncScopeUserId(userId),
  };
  await saveSyncState(updated, scopeUserId);
  return updated;
}

export async function saveAnalysisQueueState(state: AnalysisQueueState): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ANALYSIS_QUEUE_STORE, 'readwrite');
      tx.objectStore(ANALYSIS_QUEUE_STORE).put({
        id: ANALYSIS_QUEUE_KEY,
        updatedAt: Date.now(),
        pending: state.pending,
        deferred: state.deferred,
        transient: state.transient,
        deadLetter: state.deadLetter,
      } satisfies AnalysisQueueRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to save analysis queue state'));
      tx.onabort = () => reject(tx.error || new Error('Analysis queue save aborted'));
    });
  } finally {
    db.close();
  }
}

export async function saveCapture(note: Note, analysisJob?: PersistedAnalysisJob): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const stores = analysisJob ? [OPS_STORE, ANALYSIS_QUEUE_STORE] : [OPS_STORE];
      const tx = db.transaction(stores, 'readwrite');
      const opsStore = tx.objectStore(OPS_STORE);
      const queueStore = analysisJob ? tx.objectStore(ANALYSIS_QUEUE_STORE) : null;

      opsStore.add({
        createdAt: Date.now(),
        op: { type: 'upsert', note } satisfies NoteOp,
      } satisfies OpRecord);

      if (analysisJob && queueStore) {
        const loadQueueRequest = queueStore.get(ANALYSIS_QUEUE_KEY);
        loadQueueRequest.onsuccess = () => {
          const record = loadQueueRequest.result as AnalysisQueueRecord | undefined;
          const pending = sanitizeAnalysisQueue(record?.pending);
          const deferred = sanitizeAnalysisQueue(record?.deferred);
          const transient = sanitizeAnalysisQueue(record?.transient);
          const deadLetter = sanitizeAnalysisQueue(record?.deadLetter);
          const removeByNoteId = (job: PersistedAnalysisJob) => job.noteId !== analysisJob.noteId;

          queueStore.put({
            id: ANALYSIS_QUEUE_KEY,
            updatedAt: Date.now(),
            pending: [...pending.filter(removeByNoteId), analysisJob],
            deferred: deferred.filter(removeByNoteId),
            transient: transient.filter(removeByNoteId),
            deadLetter: deadLetter.filter(removeByNoteId),
          } satisfies AnalysisQueueRecord);
        };
        loadQueueRequest.onerror = () => {
          reject(loadQueueRequest.error || new Error('Failed to load analysis queue state for capture save'));
        };
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to persist captured note'));
      tx.onabort = () => reject(tx.error || new Error('Captured note transaction aborted'));
    });
  } finally {
    db.close();
  }
}

export async function saveOps(ops: NoteOp[]): Promise<{ opCount: number }> {
  if (ops.length === 0) {
    return { opCount: await getOpCount() };
  }

  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(OPS_STORE, 'readwrite');
      const store = tx.objectStore(OPS_STORE);

      for (const op of ops) {
        const record: OpRecord = {
          createdAt: Date.now(),
          op,
        };
        store.add(record);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to append ops'));
      tx.onabort = () => reject(tx.error || new Error('Op write aborted'));
    });

    return { opCount: await getOpCount() };
  } finally {
    db.close();
  }
}

export async function getOpCount(): Promise<number> {
  const db = await openDb();
  try {
    const tx = db.transaction(OPS_STORE, 'readonly');
    const count = await promisifyRequest(tx.objectStore(OPS_STORE).count());
    return Number(count || 0);
  } finally {
    db.close();
  }
}

export async function compactSnapshot(notes: Note[]): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([SNAPSHOT_STORE, OPS_STORE], 'readwrite');
      tx.objectStore(SNAPSHOT_STORE).put({
        id: SNAPSHOT_KEY,
        version: DB_VERSION,
        updatedAt: Date.now(),
        notes,
      } satisfies SnapshotRecord);
      tx.objectStore(OPS_STORE).clear();

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Snapshot compaction failed'));
      tx.onabort = () => reject(tx.error || new Error('Snapshot compaction aborted'));
    });
  } finally {
    db.close();
  }
}

export async function migrateFromLocalStorage(storageKey: string): Promise<Note[]> {
  const existing = await loadNotes();
  if (existing.length > 0) return existing;

  let localNotes: Note[] = [];
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    localNotes = parsed as Note[];
  } catch {
    return [];
  }

  if (localNotes.length === 0) return [];
  await compactSnapshot(localNotes);
  return localNotes;
}

export async function resetNotesStore(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([SNAPSHOT_STORE, OPS_STORE, ANALYSIS_QUEUE_STORE, SYNC_STATE_STORE], 'readwrite');
      tx.objectStore(SNAPSHOT_STORE).clear();
      tx.objectStore(OPS_STORE).clear();
      tx.objectStore(ANALYSIS_QUEUE_STORE).clear();
      tx.objectStore(SYNC_STATE_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to clear IndexedDB store'));
      tx.onabort = () => reject(tx.error || new Error('Clear IndexedDB store aborted'));
    });
  } finally {
    db.close();
  }
}
