import Fastify, { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSyncRoutes } from '../src/routes/sync.js';
import * as syncService from '../src/services/sync.js';

function makeNote(id: string) {
  const now = Date.now();
  return {
    id,
    content: `Note ${id}`,
    createdAt: now,
    updatedAt: now,
    version: 1,
    type: 'NOTE' as const,
    tags: ['test'],
    isProcessed: true,
    isCompleted: false,
    isArchived: false,
    isPinned: false,
  };
}

describe('sync routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    app.addHook('preHandler', async request => {
      (request as any).appUserId = 'user-1';
      (request as any).deviceId = 'device-1';
    });

    await registerSyncRoutes(app);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('returns applied results and stable idempotent replay response', async () => {
    const responsePayload = {
      applied: [
        {
          requestId: 'request-0001',
          note: makeNote('n1'),
          cursor: 11,
        },
      ],
      conflicts: [],
      nextCursor: 11,
    };

    const pushSpy = vi
      .spyOn(syncService, 'pushSync')
      .mockResolvedValueOnce(responsePayload)
      .mockResolvedValueOnce(responsePayload);

    const body = {
      operations: [
        {
          requestId: 'request-0001',
          op: 'upsert',
          noteId: 'n1',
          baseVersion: 0,
          note: makeNote('n1'),
        },
      ],
    };

    const first = await app.inject({
      method: 'POST',
      url: '/api/v2/sync/push',
      payload: body,
    });

    const second = await app.inject({
      method: 'POST',
      url: '/api/v2/sync/push',
      payload: body,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json()).toEqual(responsePayload);
    expect(second.json()).toEqual(responsePayload);
    expect(pushSpy).toHaveBeenCalledTimes(2);
  });

  it('returns conflicts for version mismatch payloads', async () => {
    vi.spyOn(syncService, 'pushSync').mockResolvedValue({
      applied: [],
      conflicts: [
        {
          requestId: 'req-conflict',
          noteId: 'n2',
          baseVersion: 1,
          currentVersion: 3,
          serverNote: {
            ...makeNote('n2'),
            version: 3,
          },
          changedFields: ['content', 'version'],
        },
      ],
      nextCursor: 21,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/sync/push',
      payload: {
        operations: [
          {
            requestId: 'req-conflict',
            op: 'upsert',
            noteId: 'n2',
            baseVersion: 1,
            note: makeNote('n2'),
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.applied).toEqual([]);
    expect(payload.conflicts).toHaveLength(1);
    expect(payload.conflicts[0].requestId).toBe('req-conflict');
    expect(payload.conflicts[0].currentVersion).toBe(3);
  });

  it('rejects malformed sync push payloads', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/sync/push',
      payload: {
        operations: [
          {
            requestId: 'short',
            op: 'upsert',
            noteId: 'n1',
            baseVersion: -1,
          },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    const payload = response.json();
    expect(payload.error.code).toBe('BAD_REQUEST');
  });

  it('bootstraps local notes once through the route', async () => {
    const bootstrapSpy = vi.spyOn(syncService, 'bootstrapSync').mockResolvedValue({
      imported: 3,
      alreadyBootstrapped: false,
      cursor: 33,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/sync/bootstrap',
      payload: {
        notes: [makeNote('n1'), makeNote('n2'), makeNote('n3')],
        sourceFingerprint: 'test-fingerprint',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ imported: 3, alreadyBootstrapped: false, cursor: 33 });
    expect(bootstrapSpy).toHaveBeenCalledTimes(1);
  });
});
