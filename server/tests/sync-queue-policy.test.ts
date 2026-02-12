import { describe, expect, it } from 'vitest';
import { applySyncQueuePolicies } from '../../storage/notesStore.ts';
import type { SyncOp } from '../../types.ts';

function upsertOp(requestId: string, noteId: string): SyncOp {
  const now = Date.now();
  return {
    requestId,
    op: 'upsert',
    noteId,
    baseVersion: 0,
    note: {
      id: noteId,
      content: `content-${requestId}`,
      createdAt: now,
      updatedAt: now,
      version: 1,
      isProcessed: true,
    },
  };
}

describe('sync queue policy', () => {
  it('compacts to latest pending operation per note and reports compaction drops', () => {
    const sourceQueue: SyncOp[] = [
      upsertOp('req-1', 'note-a'),
      upsertOp('req-2', 'note-b'),
      upsertOp('req-3', 'note-a'),
      upsertOp('req-4', 'note-a'),
    ];

    const result = applySyncQueuePolicies(sourceQueue, 50);

    expect(result.queue.map(item => item.requestId)).toEqual(['req-2', 'req-4']);
    expect(result.queuePolicy).toEqual({
      before: 4,
      after: 2,
      cap: 50,
      compactionDrops: 2,
      capDrops: 0,
    });
  });

  it('drops oldest queued operations after compaction when hard cap is exceeded', () => {
    const sourceQueue: SyncOp[] = [
      upsertOp('req-1', 'note-1'),
      upsertOp('req-2', 'note-2'),
      upsertOp('req-3', 'note-3'),
      upsertOp('req-4', 'note-4'),
      upsertOp('req-5', 'note-5'),
    ];

    const result = applySyncQueuePolicies(sourceQueue, 3);

    expect(result.queue.map(item => item.requestId)).toEqual(['req-3', 'req-4', 'req-5']);
    expect(result.queuePolicy).toEqual({
      before: 5,
      after: 3,
      cap: 3,
      compactionDrops: 0,
      capDrops: 2,
    });
  });
});
