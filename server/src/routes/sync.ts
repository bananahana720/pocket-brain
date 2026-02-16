import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { bootstrapSync, getNotesSnapshot, pullSync, pushSync, type SyncOp } from '../services/sync.js';
import { env } from '../config/env.js';

const REQUEST_ID_MAX_LENGTH = 128;
const NOTE_ID_MAX_LENGTH = 128;
const NOTE_CONTENT_MAX_LENGTH = 100_000;
const NOTE_TITLE_MAX_LENGTH = 512;
const NOTE_TAG_MAX_LENGTH = 64;
const NOTE_TAGS_MAX = 20;
const CONTENT_HASH_MAX_LENGTH = 128;
const DEVICE_ID_MAX_LENGTH = 128;
const SOURCE_FINGERPRINT_MAX_LENGTH = 128;
const CHANGED_FIELD_MAX_LENGTH = 64;

const syncNoteSchema = z.object({
  id: z.string().min(1).max(NOTE_ID_MAX_LENGTH),
  content: z.string().max(NOTE_CONTENT_MAX_LENGTH),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  version: z.number().int().min(0),
  deletedAt: z.number().int().optional(),
  title: z.string().max(NOTE_TITLE_MAX_LENGTH).optional(),
  tags: z.array(z.string().min(1).max(NOTE_TAG_MAX_LENGTH)).max(NOTE_TAGS_MAX).optional(),
  type: z.enum(['NOTE', 'TASK', 'IDEA']).optional(),
  isProcessed: z.boolean().optional(),
  isCompleted: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  isPinned: z.boolean().optional(),
  dueDate: z.number().int().optional(),
  priority: z.enum(['urgent', 'normal', 'low']).optional(),
  analysisState: z.enum(['pending', 'complete', 'failed']).optional(),
  analysisVersion: z.number().int().optional(),
  contentHash: z.string().max(CONTENT_HASH_MAX_LENGTH).optional(),
  lastModifiedByDeviceId: z.string().min(1).max(DEVICE_ID_MAX_LENGTH).optional(),
});

const syncNoteBaseSchema = syncNoteSchema.partial();

const syncPushSchema = z.object({
  operations: z
    .array(
      z.object({
        requestId: z.string().min(8).max(REQUEST_ID_MAX_LENGTH),
        op: z.enum(['upsert', 'delete']),
        noteId: z.string().min(1).max(NOTE_ID_MAX_LENGTH),
        baseVersion: z.number().int().min(0),
        note: syncNoteSchema.optional(),
        clientChangedFields: z.array(z.string().min(1).max(CHANGED_FIELD_MAX_LENGTH)).max(32).optional(),
        baseNote: syncNoteBaseSchema.optional(),
        autoMergeAttempted: z.boolean().optional(),
      })
    )
    .min(1)
    .max(env.SYNC_BATCH_LIMIT),
});

const syncBootstrapSchema = z.object({
  notes: z.array(syncNoteSchema).max(5000),
  sourceFingerprint: z.string().max(SOURCE_FINGERPRINT_MAX_LENGTH).default('local-import-v1'),
});

export async function registerSyncRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v2/notes', async request => {
    const includeDeleted = request.query && typeof (request.query as Record<string, unknown>).includeDeleted === 'string'
      ? (request.query as Record<string, string>).includeDeleted === 'true'
      : true;

    const snapshot = await getNotesSnapshot(request.appUserId, includeDeleted);
    return {
      notes: snapshot.notes,
      cursor: snapshot.cursor,
    };
  });

  app.get('/api/v2/sync/pull', async request => {
    const rawCursor = (request.query as Record<string, string | undefined>)?.cursor || '0';
    const cursor = Number.isFinite(Number(rawCursor)) ? Math.max(0, Number(rawCursor)) : 0;

    const result = await pullSync(request.appUserId, cursor);
    if (result.resetRequired) {
      request.log.warn(
        {
          cursor,
          reason: result.resetReason,
          oldestAvailableCursor: result.oldestAvailableCursor,
          latestCursor: result.latestCursor,
        },
        'sync pull requested cursor reset'
      );
    }
    return result;
  });

  app.post('/api/v2/sync/push', async (request, reply) => {
    const parsed = syncPushSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: parsed.error.issues[0]?.message || 'Invalid sync push payload',
          retryable: false,
        },
      });
      return;
    }

    const operations = parsed.data.operations as SyncOp[];
    const result = await pushSync({
      userId: request.appUserId,
      deviceId: request.deviceId,
      operations,
    });

    return result;
  });

  app.post('/api/v2/sync/bootstrap', async (request, reply) => {
    const parsed = syncBootstrapSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({
        error: {
          code: 'BAD_REQUEST',
          message: parsed.error.issues[0]?.message || 'Invalid sync bootstrap payload',
          retryable: false,
        },
      });
      return;
    }

    const result = await bootstrapSync({
      userId: request.appUserId,
      deviceId: request.deviceId,
      notesToImport: parsed.data.notes,
      sourceFingerprint: parsed.data.sourceFingerprint,
    });

    return result;
  });
}
