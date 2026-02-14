import { beforeEach, describe, expect, it, vi } from 'vitest';

type Expr =
  | { kind: 'eq'; column: any; value: any }
  | { kind: 'gt'; column: any; value: any }
  | { kind: 'in'; column: any; values: any[] }
  | { kind: 'isNull'; column: any }
  | { kind: 'and'; exprs: Expr[] }
  | { kind: 'sql'; text: string; values: any[] };

type RowRecord = Record<string, any>;

function col(table: string, key: string) {
  return { table, key };
}

function columnKey(column: any): string {
  if (column && typeof column === 'object' && typeof column.key === 'string') {
    return column.key;
  }
  return String(column);
}

function eqValue(expr: Expr | undefined, key: string): any {
  if (!expr) return undefined;
  if (expr.kind === 'eq' && columnKey(expr.column) === key) {
    return expr.value;
  }
  if (expr.kind === 'and') {
    for (const part of expr.exprs) {
      const value = eqValue(part, key);
      if (typeof value !== 'undefined') {
        return value;
      }
    }
  }
  return undefined;
}

function matchesExpr(row: RowRecord, expr: Expr | undefined): boolean {
  if (!expr) return true;
  if (expr.kind === 'eq') return row[columnKey(expr.column)] === expr.value;
  if (expr.kind === 'gt') return Number(row[columnKey(expr.column)]) > Number(expr.value);
  if (expr.kind === 'in') return expr.values.includes(row[columnKey(expr.column)]);
  if (expr.kind === 'isNull') return row[columnKey(expr.column)] == null;
  if (expr.kind === 'and') return expr.exprs.every(part => matchesExpr(row, part));
  if (expr.kind === 'sql') {
    const normalized = expr.text.toLowerCase();
    if (normalized.includes(' is not null')) {
      const value = row[columnKey(expr.values[0])];
      return value != null;
    }
    if (normalized.includes('<')) {
      const left = row[columnKey(expr.values[0])];
      const right = expr.values[1];
      return Number(left) < Number(right);
    }
  }
  return true;
}

function clone<T>(value: T): T {
  if (typeof value === 'undefined' || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

const mockContext = vi.hoisted(() => {
  const schema = {
    notes: {
      __name: 'notes',
      userId: col('notes', 'userId'),
      id: col('notes', 'id'),
      content: col('notes', 'content'),
      title: col('notes', 'title'),
      tags: col('notes', 'tags'),
      type: col('notes', 'type'),
      isProcessed: col('notes', 'isProcessed'),
      isCompleted: col('notes', 'isCompleted'),
      isArchived: col('notes', 'isArchived'),
      isPinned: col('notes', 'isPinned'),
      dueDate: col('notes', 'dueDate'),
      priority: col('notes', 'priority'),
      analysisState: col('notes', 'analysisState'),
      analysisVersion: col('notes', 'analysisVersion'),
      contentHash: col('notes', 'contentHash'),
      createdAt: col('notes', 'createdAt'),
      updatedAt: col('notes', 'updatedAt'),
      version: col('notes', 'version'),
      deletedAt: col('notes', 'deletedAt'),
      lastModifiedByDeviceId: col('notes', 'lastModifiedByDeviceId'),
    },
    noteChanges: {
      __name: 'note_changes',
      seq: col('note_changes', 'seq'),
      userId: col('note_changes', 'userId'),
      noteId: col('note_changes', 'noteId'),
      opType: col('note_changes', 'opType'),
      payload: col('note_changes', 'payload'),
      baseVersion: col('note_changes', 'baseVersion'),
      newVersion: col('note_changes', 'newVersion'),
      requestId: col('note_changes', 'requestId'),
      deviceId: col('note_changes', 'deviceId'),
      createdAt: col('note_changes', 'createdAt'),
    },
    idempotencyKeys: {
      __name: 'idempotency_keys',
      userId: col('idempotency_keys', 'userId'),
      requestId: col('idempotency_keys', 'requestId'),
      responseHash: col('idempotency_keys', 'responseHash'),
      createdAt: col('idempotency_keys', 'createdAt'),
      expiresAt: col('idempotency_keys', 'expiresAt'),
    },
    syncBootstrap: {
      __name: 'sync_bootstrap',
      userId: col('sync_bootstrap', 'userId'),
      importedAt: col('sync_bootstrap', 'importedAt'),
      sourceFingerprint: col('sync_bootstrap', 'sourceFingerprint'),
      importedCount: col('sync_bootstrap', 'importedCount'),
      cursorAfterImport: col('sync_bootstrap', 'cursorAfterImport'),
    },
  };

  const state = {
    notes: [] as RowRecord[],
    noteChanges: [] as RowRecord[],
    idempotencyKeys: [] as RowRecord[],
    syncBootstrap: [] as RowRecord[],
    seq: 0,
  };

  const reset = () => {
    state.notes = [];
    state.noteChanges = [];
    state.idempotencyKeys = [];
    state.syncBootstrap = [];
    state.seq = 0;
  };

  return {
    schema,
    state,
    reset,
    publishSyncEvent: vi.fn().mockResolvedValue(undefined),
    failNextNoteChangeInsert: false,
    forceIdempotencyMissOnceForRequestId: null as string | null,
  };
});

function createDbMock() {
  const { schema, state } = mockContext;
  const uniqueViolation = (constraint: string) =>
    Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
      code: '23505',
      constraint,
    });

  const dbMock: any = {
    query: {
      notes: {
        async findFirst(args: { where?: Expr }) {
          return clone(state.notes.find(row => matchesExpr(row, args.where)));
        },
        async findMany(args: { where?: Expr; limit?: number }) {
          let rows = state.notes.filter(row => matchesExpr(row, args.where));
          rows = rows.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
          if (typeof args.limit === 'number') {
            rows = rows.slice(0, args.limit);
          }
          return clone(rows);
        },
      },
      noteChanges: {
        async findMany(args: { where?: Expr; limit?: number }) {
          let rows = state.noteChanges.filter(row => matchesExpr(row, args.where));
          rows = rows.sort((a, b) => Number(a.seq) - Number(b.seq));
          if (typeof args.limit === 'number') {
            rows = rows.slice(0, args.limit);
          }
          return clone(rows);
        },
      },
      idempotencyKeys: {
        async findFirst(args: { where?: Expr }) {
          const requestId = eqValue(args.where, 'requestId');
          const row = state.idempotencyKeys.find(candidate => matchesExpr(candidate, args.where));
          if (
            row &&
            mockContext.forceIdempotencyMissOnceForRequestId &&
            requestId === mockContext.forceIdempotencyMissOnceForRequestId
          ) {
            mockContext.forceIdempotencyMissOnceForRequestId = null;
            return undefined;
          }
          return clone(row);
        },
      },
      syncBootstrap: {
        async findFirst(args: { where?: Expr }) {
          return clone(state.syncBootstrap.find(row => matchesExpr(row, args.where)));
        },
      },
    },
    select(selection?: Record<string, unknown>) {
      return {
        from(table: any) {
          return {
            async where(expr: Expr) {
              if (table !== schema.noteChanges) {
                if (!selection || Object.keys(selection).length === 0) {
                  return [{ value: 0 }];
                }
                const result: Record<string, number> = {};
                for (const key of Object.keys(selection)) {
                  result[key] = 0;
                }
                return [result];
              }
              const rows = state.noteChanges.filter(row => matchesExpr(row, expr));
              const minSeq =
                rows.length > 0
                  ? rows.reduce((min, row) => Math.min(min, Number(row.seq || 0)), Number.MAX_SAFE_INTEGER)
                  : 0;
              const maxSeq = rows.reduce((max, row) => Math.max(max, Number(row.seq || 0)), 0);
              if (!selection || Object.keys(selection).length === 0) {
                return [{ value: maxSeq }];
              }

              const result: Record<string, number> = {};
              for (const key of Object.keys(selection)) {
                if (key === 'oldest' || key.toLowerCase().includes('min')) {
                  result[key] = minSeq === Number.MAX_SAFE_INTEGER ? 0 : minSeq;
                } else {
                  result[key] = maxSeq;
                }
              }

              return [result];
            },
          };
        },
      };
    },
    insert(table: any) {
      return {
        values(value: any) {
          if (table === schema.idempotencyKeys) {
            return {
              async onConflictDoNothing() {
                const exists = state.idempotencyKeys.some(
                  row => row.userId === value.userId && row.requestId === value.requestId
                );
                if (!exists) {
                  state.idempotencyKeys.push(clone(value));
                }
              },
              async returning() {
                const exists = state.idempotencyKeys.some(
                  row => row.userId === value.userId && row.requestId === value.requestId
                );
                if (exists) {
                  throw uniqueViolation('idempotency_keys_pkey');
                }
                state.idempotencyKeys.push(clone(value));
                return [clone(value)];
              },
            };
          }

          if (table === schema.noteChanges) {
            if (mockContext.failNextNoteChangeInsert) {
              mockContext.failNextNoteChangeInsert = false;
              throw new Error('mock note_changes insert failure');
            }
            const duplicateRequest = state.noteChanges.some(
              row => row.userId === value.userId && row.requestId === value.requestId
            );
            if (duplicateRequest) {
              throw uniqueViolation('note_changes_user_request_idx');
            }
            const row = {
              ...clone(value),
              seq: ++state.seq,
            };
            state.noteChanges.push(row);
            return {
              async returning() {
                return [{ seq: row.seq }];
              },
            };
          }

          if (table === schema.notes) {
            const baseRow = clone(value);
            return {
              onConflictDoUpdate(args: { set: Record<string, unknown> }) {
                const existingIndex = state.notes.findIndex(
                  row => row.userId === baseRow.userId && row.id === baseRow.id
                );

                if (existingIndex >= 0) {
                  state.notes[existingIndex] = {
                    ...state.notes[existingIndex],
                    ...clone(args.set),
                  };
                  return {
                    async returning() {
                      return [clone(state.notes[existingIndex])];
                    },
                  };
                }

                state.notes.push(baseRow);
                return {
                  async returning() {
                    return [clone(baseRow)];
                  },
                };
              },
              async returning() {
                state.notes.push(baseRow);
                return [clone(baseRow)];
              },
            };
          }

          if (table === schema.syncBootstrap) {
            state.syncBootstrap.push(clone(value));
            return Promise.resolve();
          }

          return Promise.resolve();
        },
      };
    },
    update(table: any) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where(expr: Expr) {
              if (table !== schema.notes) {
                return {
                  async returning() {
                    return [];
                  },
                };
              }

              const updatedRows: RowRecord[] = [];
              state.notes = state.notes.map(row => {
                if (!matchesExpr(row, expr)) return row;
                const next = { ...row, ...clone(values) };
                updatedRows.push(next);
                return next;
              });

              return {
                async returning() {
                  return clone(updatedRows);
                },
              };
            },
          };
        },
      };
    },
    delete(table: any) {
      return {
        where(expr: Expr) {
          if (table === schema.idempotencyKeys) {
            state.idempotencyKeys = state.idempotencyKeys.filter(row => !matchesExpr(row, expr));
            return Promise.resolve();
          }

          if (table === schema.notes) {
            const deleted = state.notes.filter(row => matchesExpr(row, expr));
            state.notes = state.notes.filter(row => !matchesExpr(row, expr));
            return {
              async returning() {
                return deleted.map(row => ({ id: row.id }));
              },
            };
          }

          if (table === schema.noteChanges) {
            const deleted = state.noteChanges.filter(row => matchesExpr(row, expr));
            state.noteChanges = state.noteChanges.filter(row => !matchesExpr(row, expr));
            return {
              async returning() {
                return deleted.map(row => ({ seq: row.seq }));
              },
            };
          }

          return Promise.resolve();
        },
      };
    },
    async transaction(callback: (tx: any) => Promise<unknown>) {
      const snapshot = clone({
        notes: state.notes,
        noteChanges: state.noteChanges,
        idempotencyKeys: state.idempotencyKeys,
        syncBootstrap: state.syncBootstrap,
        seq: state.seq,
      });
      try {
        return await callback(dbMock);
      } catch (error) {
        state.notes = snapshot.notes;
        state.noteChanges = snapshot.noteChanges;
        state.idempotencyKeys = snapshot.idempotencyKeys;
        state.syncBootstrap = snapshot.syncBootstrap;
        state.seq = snapshot.seq;
        throw error;
      }
    },
  };

  return dbMock;
}

vi.mock('drizzle-orm', () => ({
  and: (...exprs: Expr[]) => ({ kind: 'and', exprs }),
  eq: (column: any, value: any) => ({ kind: 'eq', column, value }),
  gt: (column: any, value: any) => ({ kind: 'gt', column, value }),
  inArray: (column: any, values: any[]) => ({ kind: 'in', column, values }),
  isNull: (column: any) => ({ kind: 'isNull', column }),
  sql: (strings: TemplateStringsArray, ...values: any[]) => ({
    kind: 'sql',
    text: strings.join('?'),
    values,
  }),
}));

vi.mock('../src/config/env.js', () => ({
  env: {
    SYNC_PULL_LIMIT: 500,
    SYNC_BATCH_LIMIT: 100,
  },
}));

vi.mock('../src/realtime/hub.js', () => ({
  publishSyncEvent: mockContext.publishSyncEvent,
}));

vi.mock('../src/db/schema.js', () => ({
  notes: mockContext.schema.notes,
  noteChanges: mockContext.schema.noteChanges,
  idempotencyKeys: mockContext.schema.idempotencyKeys,
  syncBootstrap: mockContext.schema.syncBootstrap,
}));

vi.mock('../src/db/client.js', () => ({
  db: createDbMock(),
}));

import {
  bootstrapSync,
  getNotesSnapshot,
  getSyncHealthMetrics,
  pullSync,
  pruneNoteChanges,
  pruneTombstones,
  pushSync,
} from '../src/services/sync.js';

function makeNote(id: string, version = 1) {
  const now = Date.now();
  return {
    id,
    content: `content-${id}-v${version}`,
    createdAt: now,
    updatedAt: now,
    version,
    title: `title-${id}-v${version}`,
    tags: ['sync'],
    type: 'NOTE' as const,
    isProcessed: true,
    isCompleted: false,
    isArchived: false,
    isPinned: false,
  };
}

describe('sync service', () => {
  const userId = 'user-service-test';
  const deviceId = 'device-service-test';

  beforeEach(() => {
    mockContext.reset();
    mockContext.publishSyncEvent.mockClear();
    mockContext.failNextNoteChangeInsert = false;
    mockContext.forceIdempotencyMissOnceForRequestId = null;
  });

  it('replays idempotent push requests without duplicating note changes', async () => {
    const note = makeNote('note-idempotent', 1);
    const op = {
      requestId: 'req-idempotent-1',
      op: 'upsert' as const,
      noteId: note.id,
      baseVersion: 0,
      note,
      baseNote: {},
      clientChangedFields: ['content', 'title'],
    };

    const first = await pushSync({
      userId,
      deviceId,
      operations: [op],
    });
    const second = await pushSync({
      userId,
      deviceId,
      operations: [op],
    });

    expect(first.applied).toHaveLength(1);
    expect(second.applied).toHaveLength(1);
    expect(second.applied[0]).toEqual(first.applied[0]);
    expect(first.conflicts).toEqual([]);
    expect(second.conflicts).toEqual([]);

    const pull = await pullSync(userId, 0);
    expect(pull.changes).toHaveLength(1);
    expect(pull.changes[0].requestId).toBe('req-idempotent-1');
  });

  it('rolls back note mutation when note-change append fails', async () => {
    const note = makeNote('note-rollback-append', 1);
    mockContext.failNextNoteChangeInsert = true;

    await expect(
      pushSync({
        userId,
        deviceId,
        operations: [
          {
            requestId: 'req-rollback-append',
            op: 'upsert',
            noteId: note.id,
            baseVersion: 0,
            note,
          },
        ],
      })
    ).rejects.toThrow('mock note_changes insert failure');

    expect(mockContext.state.notes).toHaveLength(0);
    expect(mockContext.state.noteChanges).toHaveLength(0);
    expect(mockContext.state.idempotencyKeys).toHaveLength(0);
    expect(mockContext.publishSyncEvent).not.toHaveBeenCalled();
  });

  it('replays deterministically when idempotency lookup races a committed request', async () => {
    const note = makeNote('note-idempotency-race', 1);
    const op = {
      requestId: 'req-idempotency-race',
      op: 'upsert' as const,
      noteId: note.id,
      baseVersion: 0,
      note,
    };

    const first = await pushSync({
      userId,
      deviceId,
      operations: [op],
    });

    mockContext.forceIdempotencyMissOnceForRequestId = op.requestId;
    const replayed = await pushSync({
      userId,
      deviceId,
      operations: [op],
    });

    expect(first.applied).toHaveLength(1);
    expect(replayed.applied).toHaveLength(1);
    expect(replayed.applied[0]).toEqual(first.applied[0]);
    expect(replayed.conflicts).toEqual([]);
    expect(mockContext.state.noteChanges).toHaveLength(1);
    expect(mockContext.state.idempotencyKeys).toHaveLength(1);
  });

  it('flags reset required when requested cursor predates pruned change history', async () => {
    const firstNote = makeNote('note-gap-1', 1);
    const secondNote = makeNote('note-gap-2', 1);

    await pushSync({
      userId,
      deviceId,
      operations: [
        {
          requestId: 'req-gap-1',
          op: 'upsert',
          noteId: firstNote.id,
          baseVersion: 0,
          note: firstNote,
        },
        {
          requestId: 'req-gap-2',
          op: 'upsert',
          noteId: secondNote.id,
          baseVersion: 0,
          note: secondNote,
        },
      ],
    });

    mockContext.state.noteChanges = mockContext.state.noteChanges.filter(row => row.seq !== 1);

    const pull = await pullSync(userId, 0);
    expect(pull.resetRequired).toBe(true);
    expect(pull.resetReason).toBe('CURSOR_TOO_OLD');
    expect(pull.oldestAvailableCursor).toBe(2);
    expect(pull.latestCursor).toBe(2);
    expect(pull.changes).toEqual([]);
    expect(pull.nextCursor).toBe(2);
    const metrics = getSyncHealthMetrics();
    expect(metrics.pullResetsRequired).toBeGreaterThanOrEqual(1);
  });

  it('reports conflicts with server-changed fields derived from base snapshot', async () => {
    const initial = makeNote('note-conflict', 1);
    await pushSync({
      userId,
      deviceId,
      operations: [
        {
          requestId: 'req-seed-conflict',
          op: 'upsert',
          noteId: initial.id,
          baseVersion: 0,
          note: initial,
          baseNote: {},
          clientChangedFields: ['content', 'title'],
        },
      ],
    });

    const serverUpdated = {
      ...initial,
      content: 'server-content-v2',
      version: 2,
      updatedAt: Date.now(),
    };

    await pushSync({
      userId,
      deviceId,
      operations: [
        {
          requestId: 'req-server-update',
          op: 'upsert',
          noteId: initial.id,
          baseVersion: 1,
          note: serverUpdated,
          baseNote: {
            content: initial.content,
            title: initial.title,
          },
          clientChangedFields: ['content'],
        },
      ],
    });

    const localStale = {
      ...initial,
      title: 'local-title-v2',
      version: 2,
      updatedAt: Date.now(),
    };

    const conflict = await pushSync({
      userId,
      deviceId,
      operations: [
        {
          requestId: 'req-local-stale',
          op: 'upsert',
          noteId: initial.id,
          baseVersion: 1,
          note: localStale,
          baseNote: {
            content: initial.content,
            title: initial.title,
          },
          clientChangedFields: ['title'],
        },
      ],
    });

    expect(conflict.applied).toEqual([]);
    expect(conflict.conflicts).toHaveLength(1);
    expect(conflict.conflicts[0].changedFields).toContain('content');
    expect(conflict.conflicts[0].changedFields).not.toContain('title');
  });

  it('creates tombstones on delete, supports filtering, and prunes expired tombstones', async () => {
    const note = makeNote('note-tombstone', 1);
    await pushSync({
      userId,
      deviceId,
      operations: [
        {
          requestId: 'req-tombstone-seed',
          op: 'upsert',
          noteId: note.id,
          baseVersion: 0,
          note,
          baseNote: {},
          clientChangedFields: ['content'],
        },
      ],
    });

    const deletion = await pushSync({
      userId,
      deviceId,
      operations: [
        {
          requestId: 'req-tombstone-delete',
          op: 'delete',
          noteId: note.id,
          baseVersion: 1,
          baseNote: {
            content: note.content,
          },
          clientChangedFields: ['deletedAt'],
        },
      ],
    });

    expect(deletion.applied).toHaveLength(1);
    expect(deletion.applied[0].note.deletedAt).toBeTypeOf('number');

    const withDeleted = await getNotesSnapshot(userId, true);
    expect(withDeleted.notes).toHaveLength(1);
    expect(withDeleted.notes[0].deletedAt).toBeTypeOf('number');

    const withoutDeleted = await getNotesSnapshot(userId, false);
    expect(withoutDeleted.notes).toHaveLength(0);

    const pruned = await pruneTombstones(-1);
    expect(pruned).toBe(1);

    const afterPrune = await getNotesSnapshot(userId, true);
    expect(afterPrune.notes).toHaveLength(0);
  });

  it('tracks note-change prune metrics for alerting and diagnostics', async () => {
    const note = makeNote('note-prune-metrics', 1);
    await pushSync({
      userId,
      deviceId,
      operations: [
        {
          requestId: 'req-prune-metrics-seed',
          op: 'upsert',
          noteId: note.id,
          baseVersion: 0,
          note,
        },
      ],
    });

    expect(mockContext.state.noteChanges).toHaveLength(1);
    mockContext.state.noteChanges[0].createdAt = Date.now() - 120_000;

    const before = getSyncHealthMetrics();
    const prunedCount = await pruneNoteChanges(60_000);
    const after = getSyncHealthMetrics();

    expect(prunedCount).toBe(1);
    expect(after.noteChangesPruneRuns).toBe(before.noteChangesPruneRuns + 1);
    expect(after.noteChangesPrunedTotal).toBe(before.noteChangesPrunedTotal + 1);
    expect(after.lastNoteChangesPrunedCount).toBe(1);
    expect(after.lastNoteChangesPrunedAt).toBeTypeOf('number');
  });

  it('keeps delete-vs-upsert conflicts manual and includes tombstone changed fields when base note is missing', async () => {
    const note = makeNote('note-delete-upsert-missing-base', 1);
    await pushSync({
      userId,
      deviceId,
      operations: [
        {
          requestId: 'req-delete-upsert-seed',
          op: 'upsert',
          noteId: note.id,
          baseVersion: 0,
          note,
          baseNote: {},
          clientChangedFields: ['content'],
        },
      ],
    });

    await pushSync({
      userId,
      deviceId,
      operations: [
        {
          requestId: 'req-delete-upsert-delete',
          op: 'delete',
          noteId: note.id,
          baseVersion: 1,
          baseNote: {
            content: note.content,
          },
          clientChangedFields: ['deletedAt'],
        },
      ],
    });

    const staleUpsert = await pushSync({
      userId,
      deviceId,
      operations: [
        {
          requestId: 'req-delete-upsert-stale',
          op: 'upsert',
          noteId: note.id,
          baseVersion: 1,
          note: {
            ...note,
            content: 'local resurrect attempt',
            version: 2,
            updatedAt: Date.now(),
          },
          clientChangedFields: ['content', 'updatedAt', 'version'],
        },
      ],
    });

    expect(staleUpsert.applied).toEqual([]);
    expect(staleUpsert.conflicts).toHaveLength(1);
    expect(staleUpsert.conflicts[0].serverNote.deletedAt).toBeTypeOf('number');
    expect(staleUpsert.conflicts[0].changedFields).toContain('deletedAt');
    expect(staleUpsert.conflicts[0].changedFields).not.toContain('updatedAt');
    expect(staleUpsert.conflicts[0].changedFields).not.toContain('version');
  });

  it('returns conflict for stale upsert against tombstone with partial base note', async () => {
    const note = makeNote('note-delete-upsert-partial-base', 1);
    await pushSync({
      userId,
      deviceId,
      operations: [
        {
          requestId: 'req-partial-base-seed',
          op: 'upsert',
          noteId: note.id,
          baseVersion: 0,
          note,
          baseNote: {},
          clientChangedFields: ['content'],
        },
      ],
    });

    await pushSync({
      userId,
      deviceId,
      operations: [
        {
          requestId: 'req-partial-base-delete',
          op: 'delete',
          noteId: note.id,
          baseVersion: 1,
          baseNote: {
            content: note.content,
          },
          clientChangedFields: ['deletedAt'],
        },
      ],
    });

    const staleUpsert = await pushSync({
      userId,
      deviceId,
      operations: [
        {
          requestId: 'req-partial-base-stale',
          op: 'upsert',
          noteId: note.id,
          baseVersion: 1,
          note: {
            ...note,
            title: 'local-title-after-delete',
            version: 2,
            updatedAt: Date.now(),
          },
          baseNote: {
            content: note.content,
          },
          clientChangedFields: ['title'],
        },
      ],
    });

    expect(staleUpsert.applied).toEqual([]);
    expect(staleUpsert.conflicts).toHaveLength(1);
    expect(staleUpsert.conflicts[0].currentVersion).toBe(2);
    expect(staleUpsert.conflicts[0].serverNote.deletedAt).toBeTypeOf('number');
    expect(staleUpsert.conflicts[0].changedFields).toContain('deletedAt');
  });

  it('bootstraps once per user and is idempotent on repeated requests', async () => {
    const now = Date.now();
    const importNotes = [
      {
        ...makeNote('bootstrap-1', 1),
        createdAt: now - 2000,
      },
      {
        ...makeNote('bootstrap-2', 1),
        createdAt: now - 1000,
      },
    ];

    const first = await bootstrapSync({
      userId,
      deviceId,
      notesToImport: importNotes,
      sourceFingerprint: 'fp-1',
    });
    const second = await bootstrapSync({
      userId,
      deviceId,
      notesToImport: importNotes,
      sourceFingerprint: 'fp-2',
    });

    expect(first.alreadyBootstrapped).toBe(false);
    expect(first.imported).toBe(2);
    expect(second.alreadyBootstrapped).toBe(true);
    expect(second.imported).toBe(2);
    expect(second.cursor).toBe(first.cursor);

    const snapshot = await getNotesSnapshot(userId, true);
    expect(snapshot.notes).toHaveLength(2);
  });
});
