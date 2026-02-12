import fs from 'node:fs/promises';
import { Client } from 'pg';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/index.js';

const SQL_SCHEMA_URL = new URL('../drizzle/0000_initial.sql', import.meta.url);
const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/pocketbrain_test';

const TEST_USER_ID = 'integration-user-sync';
const TEST_DEVICE_ID = '11111111-1111-4111-8111-111111111111';

async function probeDatabase(): Promise<{ available: true } | { available: false; reason: string }> {
  const client = new Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    await client.query('select 1');
    return { available: true };
  } catch (error) {
    const errorWithCode = error as { message?: unknown; code?: unknown; errno?: unknown };
    const message =
      typeof errorWithCode?.message === 'string' && errorWithCode.message.trim()
        ? errorWithCode.message.trim()
        : typeof errorWithCode?.code === 'string'
        ? errorWithCode.code
        : typeof errorWithCode?.errno === 'string' || typeof errorWithCode?.errno === 'number'
        ? String(errorWithCode.errno)
        : 'unknown error';
    return { available: false, reason: `database unavailable (${message})` };
  } finally {
    await client.end().catch(() => undefined);
  }
}

const dbProbe = await probeDatabase();

if (!dbProbe.available) {
  console.warn(`[sync-integration.test] ${dbProbe.reason}; skipping DB-backed sync integration tests.`);
  describe('sync integration (db)', () => {
    it.skip(`auto-skip: ${dbProbe.reason}`, () => {});
  });
} else {
  describe('sync integration (db)', () => {
    let app: FastifyInstance;
    let dbClient: Client;

    beforeAll(async () => {
      dbClient = new Client({ connectionString: DATABASE_URL });
      await dbClient.connect();
      const schemaSql = await fs.readFile(SQL_SCHEMA_URL, 'utf8');
      await dbClient.query(schemaSql);
      app = await buildServer();
    });

    beforeEach(async () => {
      await dbClient.query(`
        TRUNCATE TABLE
          sync_bootstrap,
          note_changes,
          idempotency_keys,
          ai_provider_keys,
          notes,
          devices,
          users
        RESTART IDENTITY CASCADE
      `);
    });

    afterAll(async () => {
      await app.close();
      await dbClient.end();
    });

    it('keeps tombstone conflict semantics for stale upsert and respects includeDeleted filtering', async () => {
      const now = Date.now();
      const note = {
        id: 'integration-note-1',
        content: 'initial integration note',
        createdAt: now,
        updatedAt: now,
        version: 1,
        title: 'Integration Note',
        tags: ['integration'],
        type: 'NOTE',
        isProcessed: true,
        isCompleted: false,
        isArchived: false,
        isPinned: false,
      };

      const upsertResponse = await app.inject({
        method: 'POST',
        url: '/api/v2/sync/push',
        headers: {
          'x-dev-user-id': TEST_USER_ID,
          'x-device-id': TEST_DEVICE_ID,
        },
        payload: {
          operations: [
            {
              requestId: 'req-int-upsert-0001',
              op: 'upsert',
              noteId: note.id,
              baseVersion: 0,
              note,
              baseNote: {},
              clientChangedFields: ['content'],
            },
          ],
        },
      });

      expect(upsertResponse.statusCode).toBe(200);
      const upsertPayload = upsertResponse.json();
      expect(upsertPayload.applied).toHaveLength(1);
      expect(upsertPayload.conflicts).toEqual([]);

      const deleteResponse = await app.inject({
        method: 'POST',
        url: '/api/v2/sync/push',
        headers: {
          'x-dev-user-id': TEST_USER_ID,
          'x-device-id': TEST_DEVICE_ID,
        },
        payload: {
          operations: [
            {
              requestId: 'req-int-delete-0002',
              op: 'delete',
              noteId: note.id,
              baseVersion: 1,
              baseNote: {
                content: note.content,
              },
              clientChangedFields: ['deletedAt'],
            },
          ],
        },
      });

      expect(deleteResponse.statusCode).toBe(200);
      const deletePayload = deleteResponse.json();
      expect(deletePayload.applied).toHaveLength(1);
      expect(deletePayload.applied[0].note.deletedAt).toBeTypeOf('number');

      const staleUpsertResponse = await app.inject({
        method: 'POST',
        url: '/api/v2/sync/push',
        headers: {
          'x-dev-user-id': TEST_USER_ID,
          'x-device-id': TEST_DEVICE_ID,
        },
        payload: {
          operations: [
            {
              requestId: 'req-int-upsert-stale-0003',
              op: 'upsert',
              noteId: note.id,
              baseVersion: 1,
              note: {
                ...note,
                content: 'local stale upsert after delete',
                version: 2,
                updatedAt: Date.now(),
              },
              clientChangedFields: ['content', 'updatedAt', 'version'],
            },
          ],
        },
      });

      expect(staleUpsertResponse.statusCode).toBe(200);
      const stalePayload = staleUpsertResponse.json();
      expect(stalePayload.applied).toEqual([]);
      expect(stalePayload.conflicts).toHaveLength(1);
      expect(stalePayload.conflicts[0].serverNote.deletedAt).toBeTypeOf('number');
      expect(stalePayload.conflicts[0].changedFields).toContain('deletedAt');
      expect(stalePayload.conflicts[0].changedFields).not.toContain('updatedAt');
      expect(stalePayload.conflicts[0].changedFields).not.toContain('version');

      const includeDeletedResponse = await app.inject({
        method: 'GET',
        url: '/api/v2/notes?includeDeleted=true',
        headers: {
          'x-dev-user-id': TEST_USER_ID,
          'x-device-id': TEST_DEVICE_ID,
        },
      });

      expect(includeDeletedResponse.statusCode).toBe(200);
      const includeDeletedPayload = includeDeletedResponse.json();
      expect(includeDeletedPayload.notes).toHaveLength(1);
      expect(includeDeletedPayload.notes[0].deletedAt).toBeTypeOf('number');

      const excludeDeletedResponse = await app.inject({
        method: 'GET',
        url: '/api/v2/notes?includeDeleted=false',
        headers: {
          'x-dev-user-id': TEST_USER_ID,
          'x-device-id': TEST_DEVICE_ID,
        },
      });

      expect(excludeDeletedResponse.statusCode).toBe(200);
      const excludeDeletedPayload = excludeDeletedResponse.json();
      expect(excludeDeletedPayload.notes).toHaveLength(0);
    });
  });
}
