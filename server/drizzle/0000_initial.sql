CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id text NOT NULL UNIQUE,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text NOT NULL,
  platform text NOT NULL,
  last_seen_at bigint NOT NULL,
  revoked_at bigint,
  created_at bigint NOT NULL,
  PRIMARY KEY (id, user_id)
);
CREATE INDEX IF NOT EXISTS devices_user_id_idx ON devices(user_id);

CREATE TABLE IF NOT EXISTS notes (
  id text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content text NOT NULL,
  title text,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  type text NOT NULL DEFAULT 'NOTE',
  is_completed boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  is_pinned boolean NOT NULL DEFAULT false,
  is_processed boolean NOT NULL DEFAULT true,
  due_date bigint,
  priority text,
  analysis_state text,
  analysis_version bigint NOT NULL DEFAULT 0,
  content_hash text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  deleted_at bigint,
  last_modified_by_device_id uuid,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS notes_user_updated_idx ON notes(user_id, updated_at);
CREATE INDEX IF NOT EXISTS notes_user_deleted_idx ON notes(user_id, deleted_at);

CREATE TABLE IF NOT EXISTS note_changes (
  seq bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id text NOT NULL,
  op_type text NOT NULL,
  payload jsonb NOT NULL,
  base_version bigint NOT NULL,
  new_version bigint NOT NULL,
  request_id text NOT NULL,
  device_id uuid NOT NULL,
  created_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS note_changes_user_seq_idx ON note_changes(user_id, seq);
CREATE UNIQUE INDEX IF NOT EXISTS note_changes_user_request_idx ON note_changes(user_id, request_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  response_hash text NOT NULL,
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  PRIMARY KEY (user_id, request_id)
);
CREATE INDEX IF NOT EXISTS idempotency_keys_expires_idx ON idempotency_keys(expires_at);

CREATE TABLE IF NOT EXISTS ai_provider_keys (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  encrypted_api_key text NOT NULL,
  encrypted_key_version text NOT NULL DEFAULT 'v1',
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  PRIMARY KEY (user_id)
);

CREATE TABLE IF NOT EXISTS sync_bootstrap (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  imported_at bigint NOT NULL,
  source_fingerprint text NOT NULL,
  imported_count bigint NOT NULL,
  cursor_after_import bigint NOT NULL,
  PRIMARY KEY (user_id)
);
