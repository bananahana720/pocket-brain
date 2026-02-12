import { Note } from '../types';

const DB_NAME = 'pocketbrain_store';
const DB_VERSION = 2;
const SNAPSHOT_STORE = 'snapshots';
const OPS_STORE = 'ops';
const ANALYSIS_QUEUE_STORE = 'analysis_queue';
const SNAPSHOT_KEY = 'current';
const ANALYSIS_QUEUE_KEY = 'current';

export type NoteOp =
  | { type: 'upsert'; note: Note }
  | { type: 'delete'; id: string };

export interface PersistedAnalysisJob {
  noteId: string;
  content: string;
  version: number;
  contentHash: string;
  attempts: number;
}

export interface AnalysisQueueState {
  pending: PersistedAnalysisJob[];
  deferred: PersistedAnalysisJob[];
  transient: PersistedAnalysisJob[];
}

const EMPTY_ANALYSIS_QUEUE_STATE: AnalysisQueueState = {
  pending: [],
  deferred: [],
  transient: [],
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

  if (!noteId || !contentHash) return null;
  return {
    noteId,
    content,
    version,
    contentHash,
    attempts,
  };
}

function sanitizeAnalysisQueue(raw: unknown): PersistedAnalysisJob[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(sanitizeAnalysisJob)
    .filter((job): job is PersistedAnalysisJob => !!job);
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
    };
  } finally {
    db.close();
  }
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
      } satisfies AnalysisQueueRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to save analysis queue state'));
      tx.onabort = () => reject(tx.error || new Error('Analysis queue save aborted'));
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
      const tx = db.transaction([SNAPSHOT_STORE, OPS_STORE, ANALYSIS_QUEUE_STORE], 'readwrite');
      tx.objectStore(SNAPSHOT_STORE).clear();
      tx.objectStore(OPS_STORE).clear();
      tx.objectStore(ANALYSIS_QUEUE_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Failed to clear IndexedDB store'));
      tx.onabort = () => reject(tx.error || new Error('Clear IndexedDB store aborted'));
    });
  } finally {
    db.close();
  }
}
