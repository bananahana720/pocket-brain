import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { idempotencyKeys, noteChanges, notes, syncBootstrap } from '../db/schema.js';
import { env } from '../config/env.js';
import { publishSyncEvent } from '../realtime/hub.js';

export interface SyncNote {
  id: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  deletedAt?: number;
  title?: string;
  tags?: string[];
  type?: 'NOTE' | 'TASK' | 'IDEA';
  isProcessed?: boolean;
  isCompleted?: boolean;
  isArchived?: boolean;
  isPinned?: boolean;
  dueDate?: number;
  priority?: 'urgent' | 'normal' | 'low';
  analysisState?: 'pending' | 'complete' | 'failed';
  analysisVersion?: number;
  contentHash?: string;
  lastModifiedByDeviceId?: string;
}

export interface SyncOp {
  requestId: string;
  op: 'upsert' | 'delete';
  noteId: string;
  baseVersion: number;
  note?: SyncNote;
  clientChangedFields?: string[];
  baseNote?: Partial<SyncNote>;
  autoMergeAttempted?: boolean;
}

export interface SyncPushResult {
  applied: Array<{ requestId: string; note: SyncNote; cursor: number }>;
  conflicts: Array<{
    requestId: string;
    noteId: string;
    baseVersion: number;
    currentVersion: number;
    serverNote: SyncNote;
    changedFields: string[];
  }>;
  nextCursor: number;
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const SYNC_FIELD_KEYS: Array<keyof SyncNote> = [
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
const SYNC_FIELD_NAMES = new Set<string>(SYNC_FIELD_KEYS.map(field => String(field)));

function nowTs(): number {
  return Date.now();
}

function areValuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  return a === b;
}

function normalizeBaseNote(noteId: string, base: Partial<SyncNote> | undefined): Partial<SyncNote> | null {
  if (!base) return null;
  const normalized: Partial<SyncNote> = { id: noteId };
  const normalizedRecord = normalized as Record<string, unknown>;
  for (const field of SYNC_FIELD_KEYS) {
    if (typeof base[field] !== 'undefined') {
      normalizedRecord[String(field)] = base[field] as unknown;
    }
  }
  return normalized;
}

function computeServerChangedFields(op: SyncOp, serverNote: SyncNote): string[] {
  const changed = new Set<string>();
  const base = normalizeBaseNote(op.noteId, op.baseNote);
  if (base) {
    for (const field of SYNC_FIELD_KEYS) {
      const key = String(field);
      const baseValue = base[field];
      const serverValue = serverNote[field];
      if (!areValuesEqual(baseValue, serverValue)) {
        changed.add(key);
      }
    }
  } else {
    for (const field of op.clientChangedFields || []) {
      if (SYNC_FIELD_NAMES.has(field)) {
        changed.add(field);
      }
    }

    if (changed.size === 0) {
      changed.add('content');
    }
  }

  if (serverNote.deletedAt) {
    changed.add('deletedAt');
  }

  return Array.from(changed.values());
}

function toSyncNote(row: typeof notes.$inferSelect): SyncNote {
  return {
    id: row.id,
    content: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
    ...(row.deletedAt ? { deletedAt: row.deletedAt } : {}),
    ...(row.title ? { title: row.title } : {}),
    ...(row.tags?.length ? { tags: row.tags } : {}),
    ...(row.type ? { type: row.type } : {}),
    ...(typeof row.isProcessed === 'boolean' ? { isProcessed: row.isProcessed } : {}),
    ...(typeof row.isCompleted === 'boolean' ? { isCompleted: row.isCompleted } : {}),
    ...(typeof row.isArchived === 'boolean' ? { isArchived: row.isArchived } : {}),
    ...(typeof row.isPinned === 'boolean' ? { isPinned: row.isPinned } : {}),
    ...(typeof row.dueDate === 'number' ? { dueDate: row.dueDate } : {}),
    ...(row.priority ? { priority: row.priority } : {}),
    ...(row.analysisState ? { analysisState: row.analysisState } : {}),
    ...(typeof row.analysisVersion === 'number' ? { analysisVersion: row.analysisVersion } : {}),
    ...(row.contentHash ? { contentHash: row.contentHash } : {}),
    ...(row.lastModifiedByDeviceId ? { lastModifiedByDeviceId: row.lastModifiedByDeviceId } : {}),
  };
}

function normalizeNotePayload(input: SyncNote, deviceId: string): SyncNote {
  const now = nowTs();
  const createdAt = Number.isFinite(input.createdAt) ? input.createdAt : now;

  return {
    id: input.id,
    content: input.content,
    createdAt,
    updatedAt: now,
    version: Math.max(1, input.version || 1),
    title: input.title,
    tags: Array.isArray(input.tags) ? input.tags.slice(0, 20) : [],
    type: input.type || 'NOTE',
    isProcessed: typeof input.isProcessed === 'boolean' ? input.isProcessed : true,
    isCompleted: !!input.isCompleted,
    isArchived: !!input.isArchived,
    isPinned: !!input.isPinned,
    dueDate: typeof input.dueDate === 'number' ? input.dueDate : undefined,
    priority: input.priority,
    analysisState: input.analysisState,
    analysisVersion: input.analysisVersion || 0,
    contentHash: input.contentHash,
    lastModifiedByDeviceId: deviceId,
    ...(input.deletedAt ? { deletedAt: input.deletedAt } : {}),
  };
}

function responseFromIdempotency(value: string):
  | { kind: 'applied'; payload: { requestId: string; note: SyncNote; cursor: number } }
  | { kind: 'conflict'; payload: SyncPushResult['conflicts'][number] }
  | null {
  try {
    const parsed = JSON.parse(value) as { kind?: string; payload?: unknown };
    if (parsed.kind === 'applied' && parsed.payload) {
      return {
        kind: 'applied',
        payload: parsed.payload as { requestId: string; note: SyncNote; cursor: number },
      };
    }

    if (parsed.kind === 'conflict' && parsed.payload) {
      return {
        kind: 'conflict',
        payload: parsed.payload as SyncPushResult['conflicts'][number],
      };
    }

    return null;
  } catch {
    return null;
  }
}

async function writeIdempotency(userId: string, requestId: string, payload: unknown): Promise<void> {
  const createdAt = nowTs();
  await db
    .insert(idempotencyKeys)
    .values({
      userId,
      requestId,
      responseHash: JSON.stringify(payload),
      createdAt,
      expiresAt: createdAt + IDEMPOTENCY_TTL_MS,
    })
    .onConflictDoNothing();
}

async function loadIdempotency(userId: string, requestId: string): Promise<string | null> {
  const row = await db.query.idempotencyKeys.findFirst({
    where: and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.requestId, requestId)),
  });

  if (!row) return null;
  if (row.expiresAt < nowTs()) return null;
  return row.responseHash;
}

async function appendChange(args: {
  userId: string;
  noteId: string;
  opType: 'upsert' | 'delete';
  payload: Record<string, unknown>;
  baseVersion: number;
  newVersion: number;
  requestId: string;
  deviceId: string;
}): Promise<number> {
  const [inserted] = await db
    .insert(noteChanges)
    .values({
      userId: args.userId,
      noteId: args.noteId,
      opType: args.opType,
      payload: args.payload,
      baseVersion: args.baseVersion,
      newVersion: args.newVersion,
      requestId: args.requestId,
      deviceId: args.deviceId,
      createdAt: nowTs(),
    })
    .returning({ seq: noteChanges.seq });

  await publishSyncEvent({
    userId: args.userId,
    cursor: inserted.seq,
    type: 'sync',
    emittedAt: nowTs(),
  });

  return inserted.seq;
}

async function upsertNote(args: {
  userId: string;
  deviceId: string;
  op: SyncOp;
  current: typeof notes.$inferSelect | null;
}): Promise<{
  applied?: { requestId: string; note: SyncNote; cursor: number };
  conflict?: SyncPushResult['conflicts'][number];
}> {
  const { op, current, userId, deviceId } = args;
  const normalized = normalizeNotePayload(op.note as SyncNote, deviceId);
  const currentVersion = current?.version || 0;

  if (op.baseVersion !== currentVersion) {
    const serverNote = current
      ? toSyncNote(current)
      : ({
          id: op.noteId,
          content: '',
          createdAt: normalized.createdAt,
          updatedAt: normalized.updatedAt,
          version: currentVersion,
          deletedAt: nowTs(),
        } as SyncNote);

    const conflict = {
      requestId: op.requestId,
      noteId: op.noteId,
      baseVersion: op.baseVersion,
      currentVersion,
      serverNote,
      changedFields: computeServerChangedFields(op, serverNote),
    };

    return { conflict };
  }

  const nextVersion = currentVersion + 1;
  const now = nowTs();

  const [persisted] = await db
    .insert(notes)
    .values({
      userId,
      id: op.noteId,
      content: normalized.content,
      title: normalized.title,
      tags: normalized.tags || [],
      type: normalized.type || 'NOTE',
      isProcessed: normalized.isProcessed ?? true,
      isCompleted: normalized.isCompleted ?? false,
      isArchived: normalized.isArchived ?? false,
      isPinned: normalized.isPinned ?? false,
      dueDate: normalized.dueDate,
      priority: normalized.priority ?? null,
      analysisState: normalized.analysisState ?? null,
      analysisVersion: normalized.analysisVersion || 0,
      contentHash: normalized.contentHash ?? null,
      createdAt: current?.createdAt || normalized.createdAt,
      updatedAt: now,
      version: nextVersion,
      deletedAt: normalized.deletedAt,
      lastModifiedByDeviceId: deviceId,
    })
    .onConflictDoUpdate({
      target: [notes.userId, notes.id],
      set: {
        content: normalized.content,
        title: normalized.title,
        tags: normalized.tags || [],
        type: normalized.type || 'NOTE',
        isProcessed: normalized.isProcessed ?? true,
        isCompleted: normalized.isCompleted ?? false,
        isArchived: normalized.isArchived ?? false,
        isPinned: normalized.isPinned ?? false,
        dueDate: normalized.dueDate,
        priority: normalized.priority ?? null,
        analysisState: normalized.analysisState ?? null,
        analysisVersion: normalized.analysisVersion || 0,
        contentHash: normalized.contentHash ?? null,
        updatedAt: now,
        version: nextVersion,
        deletedAt: normalized.deletedAt,
        lastModifiedByDeviceId: deviceId,
      },
    })
    .returning();

  const cursor = await appendChange({
    userId,
    noteId: op.noteId,
    opType: 'upsert',
    payload: {
      note: toSyncNote(persisted),
    },
    baseVersion: op.baseVersion,
    newVersion: nextVersion,
    requestId: op.requestId,
    deviceId,
  });

  return {
    applied: {
      requestId: op.requestId,
      note: toSyncNote(persisted),
      cursor,
    },
  };
}

async function deleteNote(args: {
  userId: string;
  deviceId: string;
  op: SyncOp;
  current: typeof notes.$inferSelect | null;
}): Promise<{
  applied?: { requestId: string; note: SyncNote; cursor: number };
  conflict?: SyncPushResult['conflicts'][number];
}> {
  const { op, current, userId, deviceId } = args;

  if (!current) {
    const tombstone: SyncNote = {
      id: op.noteId,
      content: '',
      createdAt: nowTs(),
      updatedAt: nowTs(),
      version: 1,
      deletedAt: nowTs(),
      lastModifiedByDeviceId: deviceId,
    };

    const cursor = await appendChange({
      userId,
      noteId: op.noteId,
      opType: 'delete',
      payload: { note: tombstone },
      baseVersion: op.baseVersion,
      newVersion: tombstone.version,
      requestId: op.requestId,
      deviceId,
    });

    return { applied: { requestId: op.requestId, note: tombstone, cursor } };
  }

  const currentVersion = current.version;
  if (op.baseVersion !== currentVersion) {
    const serverNote = toSyncNote(current);
    return {
      conflict: {
        requestId: op.requestId,
        noteId: op.noteId,
        baseVersion: op.baseVersion,
        currentVersion,
        serverNote,
        changedFields: computeServerChangedFields(op, serverNote),
      },
    };
  }

  const nextVersion = currentVersion + 1;
  const deletedAt = nowTs();

  const [persisted] = await db
    .update(notes)
    .set({
      deletedAt,
      updatedAt: deletedAt,
      version: nextVersion,
      lastModifiedByDeviceId: deviceId,
    })
    .where(and(eq(notes.userId, userId), eq(notes.id, op.noteId)))
    .returning();

  const cursor = await appendChange({
    userId,
    noteId: op.noteId,
    opType: 'delete',
    payload: { note: toSyncNote(persisted) },
    baseVersion: op.baseVersion,
    newVersion: nextVersion,
    requestId: op.requestId,
    deviceId,
  });

  return {
    applied: {
      requestId: op.requestId,
      note: toSyncNote(persisted),
      cursor,
    },
  };
}

async function getCurrentCursor(userId: string): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`coalesce(max(${noteChanges.seq}), 0)` })
    .from(noteChanges)
    .where(eq(noteChanges.userId, userId));

  return row?.value || 0;
}

export async function getNotesSnapshot(userId: string, includeDeleted = true): Promise<{ notes: SyncNote[]; cursor: number }> {
  const rows = await db.query.notes.findMany({
    where: includeDeleted ? eq(notes.userId, userId) : and(eq(notes.userId, userId), isNull(notes.deletedAt)),
    orderBy: (table, helpers) => [helpers.desc(table.updatedAt)],
  });

  const cursor = await getCurrentCursor(userId);
  return {
    notes: rows.map(toSyncNote),
    cursor,
  };
}

export async function pullSync(userId: string, cursor: number): Promise<{
  changes: Array<{ cursor: number; op: 'upsert' | 'delete'; note: SyncNote; requestId: string }>;
  nextCursor: number;
}> {
  const rows = await db.query.noteChanges.findMany({
    where: and(eq(noteChanges.userId, userId), gt(noteChanges.seq, cursor)),
    orderBy: (table, helpers) => [helpers.asc(table.seq)],
    limit: env.SYNC_PULL_LIMIT,
  });

  let nextCursor = cursor;
  const changes = rows.map(row => {
    nextCursor = Math.max(nextCursor, row.seq);

    const payloadNote = row.payload?.note as SyncNote | undefined;
    const note: SyncNote = payloadNote || {
      id: row.noteId,
      content: '',
      createdAt: row.createdAt,
      updatedAt: row.createdAt,
      version: row.newVersion,
      ...(row.opType === 'delete' ? { deletedAt: row.createdAt } : {}),
    };

    return {
      cursor: row.seq,
      op: row.opType,
      note,
      requestId: row.requestId,
    };
  });

  return {
    changes,
    nextCursor,
  };
}

export async function pushSync(args: {
  userId: string;
  deviceId: string;
  operations: SyncOp[];
}): Promise<SyncPushResult> {
  const applied: SyncPushResult['applied'] = [];
  const conflicts: SyncPushResult['conflicts'] = [];
  let nextCursor = await getCurrentCursor(args.userId);

  const operations = args.operations.slice(0, env.SYNC_BATCH_LIMIT);

  for (const op of operations) {
    const existingIdempotency = await loadIdempotency(args.userId, op.requestId);
    if (existingIdempotency) {
      const parsed = responseFromIdempotency(existingIdempotency);
      if (parsed?.kind === 'applied') {
        applied.push(parsed.payload);
        nextCursor = Math.max(nextCursor, parsed.payload.cursor);
        continue;
      }
      if (parsed?.kind === 'conflict') {
        conflicts.push(parsed.payload);
        continue;
      }
    }

    const current = await db.query.notes.findFirst({
      where: and(eq(notes.userId, args.userId), eq(notes.id, op.noteId)),
    });

    if (op.op === 'upsert' && op.note) {
      const result = await upsertNote({
        userId: args.userId,
        deviceId: args.deviceId,
        op,
        current: current || null,
      });

      if (result.applied) {
        applied.push(result.applied);
        nextCursor = Math.max(nextCursor, result.applied.cursor);
        await writeIdempotency(args.userId, op.requestId, { kind: 'applied', payload: result.applied });
      }

      if (result.conflict) {
        conflicts.push(result.conflict);
        await writeIdempotency(args.userId, op.requestId, { kind: 'conflict', payload: result.conflict });
      }
      continue;
    }

    if (op.op === 'delete') {
      const result = await deleteNote({
        userId: args.userId,
        deviceId: args.deviceId,
        op,
        current: current || null,
      });

      if (result.applied) {
        applied.push(result.applied);
        nextCursor = Math.max(nextCursor, result.applied.cursor);
        await writeIdempotency(args.userId, op.requestId, { kind: 'applied', payload: result.applied });
      }

      if (result.conflict) {
        conflicts.push(result.conflict);
        await writeIdempotency(args.userId, op.requestId, { kind: 'conflict', payload: result.conflict });
      }
    }
  }

  await db
    .delete(idempotencyKeys)
    .where(and(eq(idempotencyKeys.userId, args.userId), sql`${idempotencyKeys.expiresAt} < ${nowTs()}`));

  return { applied, conflicts, nextCursor };
}

export async function bootstrapSync(args: {
  userId: string;
  deviceId: string;
  notesToImport: SyncNote[];
  sourceFingerprint: string;
}): Promise<{ imported: number; alreadyBootstrapped: boolean; cursor: number }> {
  const existing = await db.query.syncBootstrap.findFirst({
    where: eq(syncBootstrap.userId, args.userId),
  });

  if (existing) {
    return {
      imported: existing.importedCount,
      alreadyBootstrapped: true,
      cursor: existing.cursorAfterImport,
    };
  }

  let imported = 0;
  let lastCursor = await getCurrentCursor(args.userId);

  const sorted = [...args.notesToImport].sort((a, b) => a.createdAt - b.createdAt);

  for (const note of sorted) {
    const id = note.id;
    const exists = await db.query.notes.findFirst({ where: and(eq(notes.userId, args.userId), eq(notes.id, id)) });
    if (exists) continue;

    const now = nowTs();
    const baseVersion = 0;
    const version = Math.max(1, note.version || 1);

    const [persisted] = await db
      .insert(notes)
      .values({
        userId: args.userId,
        id,
        content: note.content,
        title: note.title,
        tags: note.tags || [],
        type: note.type || 'NOTE',
        isProcessed: note.isProcessed ?? true,
        isCompleted: note.isCompleted ?? false,
        isArchived: note.isArchived ?? false,
        isPinned: note.isPinned ?? false,
        dueDate: note.dueDate,
        priority: note.priority ?? null,
        analysisState: note.analysisState ?? null,
        analysisVersion: note.analysisVersion || 0,
        contentHash: note.contentHash ?? null,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt || now,
        version,
        deletedAt: note.deletedAt,
        lastModifiedByDeviceId: args.deviceId,
      })
      .returning();

    lastCursor = await appendChange({
      userId: args.userId,
      noteId: id,
      opType: note.deletedAt ? 'delete' : 'upsert',
      payload: { note: toSyncNote(persisted) },
      baseVersion,
      newVersion: version,
      requestId: `bootstrap:${id}:${note.updatedAt || now}`,
      deviceId: args.deviceId,
    });

    imported += 1;
  }

  await db.insert(syncBootstrap).values({
    userId: args.userId,
    importedAt: nowTs(),
    sourceFingerprint: args.sourceFingerprint,
    importedCount: imported,
    cursorAfterImport: lastCursor,
  });

  return {
    imported,
    alreadyBootstrapped: false,
    cursor: lastCursor,
  };
}

export async function pruneTombstones(retentionMs = 30 * 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = nowTs() - retentionMs;
  const rows = await db
    .delete(notes)
    .where(and(sql`${notes.deletedAt} is not null`, sql`${notes.deletedAt} < ${cutoff}`))
    .returning({ id: notes.id });

  return rows.length;
}

export async function getRequestedNotes(userId: string, noteIds: string[]): Promise<Map<string, SyncNote>> {
  if (noteIds.length === 0) return new Map();
  const rows = await db.query.notes.findMany({
    where: and(eq(notes.userId, userId), inArray(notes.id, noteIds)),
  });
  return new Map(rows.map(row => [row.id, toSyncNote(row)]));
}
