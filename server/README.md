# PocketBrain Sync Server

Fastify + PostgreSQL + Redis backend for account-backed note sync, device sessions, and conflict-aware push/pull APIs.

## Run locally

1. Start infra from repo root:

```bash
docker compose up -d postgres redis
```

2. Install deps:

```bash
npm install --prefix server
```

3. Configure env:

```bash
cp server/.env.example server/.env
```

4. Configure auth vars in `server/.env`:

- `CLERK_SECRET_KEY`
- `CLERK_PUBLISHABLE_KEY`
- `ALLOW_INSECURE_DEV_AUTH=true` only for local development
- `STREAM_TICKET_SECRET` (HMAC secret for short-lived SSE stream tickets)
- `STREAM_TICKET_TTL_SECONDS` (default `60`)
- `MAINTENANCE_INTERVAL_MS` (default `600000`)
- `TOMBSTONE_RETENTION_MS` (default `2592000000`)
- `SYNC_BATCH_LIMIT` (default `100`)
- `SYNC_PULL_LIMIT` (default `500`)

For production, set `ALLOW_INSECURE_DEV_AUTH=false`.
When `ALLOW_INSECURE_DEV_AUTH=false`, `CLERK_SECRET_KEY` is required.
If you are still on a pre-cutover release with legacy SSE query-token compatibility, set `ALLOW_LEGACY_SSE_QUERY_TOKEN=false` permanently before deploying stream-ticket-only clients.

## Health endpoints

- `GET /health`: liveness check.
- `GET /ready`: readiness check (DB required, Redis status included).

5. Start server:

```bash
npm --prefix server run dev
```

## Build

```bash
npm --prefix server run build
```

## VPS Quick Deploy

From repo root on VPS:

```bash
bash scripts/deploy-vps.sh
```

Optional flags:
- `--with-worker` to deploy Worker after backend checks.
- `--skip-pull` to skip `git pull --ff-only`.
