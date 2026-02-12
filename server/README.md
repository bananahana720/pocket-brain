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
- `NOTE_CHANGES_RETENTION_MS` (default `2592000000`)
- `SYNC_BATCH_LIMIT` (default `100`)
- `SYNC_PULL_LIMIT` (default `500`)
- `REQUIRE_REDIS_FOR_READY` (defaults to `true` in production and `false` in development/test; set explicitly to override)

For production, set `ALLOW_INSECURE_DEV_AUTH=false`.
When `ALLOW_INSECURE_DEV_AUTH=false`, `CLERK_SECRET_KEY` is required.
If you are still on a pre-cutover release with legacy SSE query-token compatibility, set `ALLOW_LEGACY_SSE_QUERY_TOKEN=false` permanently before deploying stream-ticket-only clients.

## Health endpoints

- `GET /health`: liveness check.
- `GET /ready`: readiness check (DB required, Redis status included) plus realtime/sync/maintenance health metrics.
- `GET /metrics`: Prometheus scrape endpoint (unauthenticated; protect by network/ingress policy in production).

### Prometheus metrics

Key reliability metrics:
- `pocketbrain_sync_cursor_resets_total`
- `pocketbrain_note_changes_pruned_total`
- `pocketbrain_realtime_fallback_dwell_seconds`
- `pocketbrain_realtime_fallback_active`
- `pocketbrain_realtime_fallback_dwell_seconds_total`

Example scrape check:

```bash
curl -s http://127.0.0.1:8788/metrics | grep pocketbrain_
```

Starter alert ideas:
- cursor reset surge: `rate(pocketbrain_sync_cursor_resets_total[5m])` above baseline
- prune surge: `increase(pocketbrain_note_changes_pruned_total[15m])` above expected maintenance volume
- sustained realtime fallback: `pocketbrain_realtime_fallback_active == 1` with elevated `pocketbrain_realtime_fallback_dwell_seconds`

5. Start server:

```bash
npm --prefix server run dev
```

## Build

```bash
npm --prefix server run build
```

## Dedicated chaos workflow

Run the multi-instance Redis-degradation validation:

```bash
npm --prefix server run test:chaos
```

This workflow validates:
- 2 API instances against the same Postgres
- Redis unavailable/degraded behavior
- readiness with strict/non-strict Redis gating
- cross-instance sync continuity and realtime endpoint availability

## VPS Quick Deploy

From repo root on VPS:

```bash
bash scripts/deploy-vps.sh
```

Optional flags:
- `--with-worker` to deploy Worker after backend checks.
- `--skip-pull` to skip `git pull --ff-only`.
