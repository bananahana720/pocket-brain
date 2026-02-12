import {
  bigint,
  bigserial,
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clerkUserId: text('clerk_user_id').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  table => ({
    clerkUserIdx: uniqueIndex('users_clerk_user_id_idx').on(table.clerkUserId),
  })
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    platform: text('platform').notNull(),
    lastSeenAt: bigint('last_seen_at', { mode: 'number' }).notNull(),
    revokedAt: bigint('revoked_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.id, table.userId] }),
    userIdx: index('devices_user_id_idx').on(table.userId),
  })
);

export const notes = pgTable(
  'notes',
  {
    id: text('id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    title: text('title'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    type: text('type').$type<'NOTE' | 'TASK' | 'IDEA'>().notNull().default('NOTE'),
    isCompleted: boolean('is_completed').notNull().default(false),
    isArchived: boolean('is_archived').notNull().default(false),
    isPinned: boolean('is_pinned').notNull().default(false),
    isProcessed: boolean('is_processed').notNull().default(true),
    dueDate: bigint('due_date', { mode: 'number' }),
    priority: text('priority').$type<'urgent' | 'normal' | 'low' | null>(),
    analysisState: text('analysis_state').$type<'pending' | 'complete' | 'failed' | null>(),
    analysisVersion: bigint('analysis_version', { mode: 'number' }).notNull().default(0),
    contentHash: text('content_hash'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
    version: bigint('version', { mode: 'number' }).notNull().default(1),
    deletedAt: bigint('deleted_at', { mode: 'number' }),
    lastModifiedByDeviceId: uuid('last_modified_by_device_id'),
  },
  table => ({
    pk: primaryKey({ columns: [table.userId, table.id] }),
    userUpdatedIdx: index('notes_user_updated_idx').on(table.userId, table.updatedAt),
    userDeletedIdx: index('notes_user_deleted_idx').on(table.userId, table.deletedAt),
  })
);

export const noteChanges = pgTable(
  'note_changes',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    noteId: text('note_id').notNull(),
    opType: text('op_type').$type<'upsert' | 'delete'>().notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    baseVersion: bigint('base_version', { mode: 'number' }).notNull(),
    newVersion: bigint('new_version', { mode: 'number' }).notNull(),
    requestId: text('request_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  table => ({
    userSeqIdx: index('note_changes_user_seq_idx').on(table.userId, table.seq),
    userRequestIdx: uniqueIndex('note_changes_user_request_idx').on(table.userId, table.requestId),
  })
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    requestId: text('request_id').notNull(),
    responseHash: text('response_hash').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.userId, table.requestId] }),
    expiresIdx: index('idempotency_keys_expires_idx').on(table.expiresAt),
  })
);

export const aiProviderKeys = pgTable(
  'ai_provider_keys',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').$type<'gemini' | 'openrouter'>().notNull(),
    encryptedApiKey: text('encrypted_api_key').notNull(),
    encryptedKeyVersion: text('encrypted_key_version').notNull().default('v1'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.userId] }),
  })
);

export const syncBootstrap = pgTable(
  'sync_bootstrap',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    importedAt: bigint('imported_at', { mode: 'number' }).notNull(),
    sourceFingerprint: text('source_fingerprint').notNull(),
    importedCount: bigint('imported_count', { mode: 'number' }).notNull(),
    cursorAfterImport: bigint('cursor_after_import', { mode: 'number' }).notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.userId] }),
  })
);

export type DbUser = typeof users.$inferSelect;
export type DbNote = typeof notes.$inferSelect;
