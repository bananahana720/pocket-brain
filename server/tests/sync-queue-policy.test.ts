import { describe, expect, it } from 'vitest';
import { applySyncQueuePolicies, limitQueueToCapPreservingExisting } from '../../storage/notesStore.ts';
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
      blocked: false,
      overflowBy: 0,
      pendingOps: 2,
    });
  });

  it('blocks additional writes when hard cap is reached without dropping operations', () => {
    const sourceQueue: SyncOp[] = [
      upsertOp('req-1', 'note-1'),
      upsertOp('req-2', 'note-2'),
      upsertOp('req-3', 'note-3'),
      upsertOp('req-4', 'note-4'),
      upsertOp('req-5', 'note-5'),
    ];

    const result = applySyncQueuePolicies(sourceQueue, 3);

    expect(result.queue.map(item => item.requestId)).toEqual(['req-1', 'req-2', 'req-3', 'req-4', 'req-5']);
    expect(result.queuePolicy).toEqual({
      before: 5,
      after: 5,
      cap: 3,
      compactionDrops: 0,
      blocked: true,
      overflowBy: 2,
      pendingOps: 5,
    });
  });

  it('keeps existing queued notes and fills remaining cap with new notes', () => {
    const baseQueue: SyncOp[] = [
      upsertOp('base-1', 'note-1'),
      upsertOp('base-2', 'note-2'),
      upsertOp('base-3', 'note-3'),
    ];
    const candidateQueue: SyncOp[] = [
      upsertOp('base-1-retry', 'note-1'),
      upsertOp('base-2-retry', 'note-2'),
      upsertOp('base-3-retry', 'note-3'),
      upsertOp('new-4', 'note-4'),
      upsertOp('new-5', 'note-5'),
      upsertOp('new-6', 'note-6'),
    ];

    const limited = limitQueueToCapPreservingExisting(baseQueue, candidateQueue, 5);

    expect(limited.map(item => item.noteId)).toEqual(['note-1', 'note-2', 'note-3', 'note-4', 'note-5']);
  });
});
