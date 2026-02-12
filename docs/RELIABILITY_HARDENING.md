# Reliability Hardening (2026-02)

## Confirmed Root Causes

1. Sync clients can fall behind changelog retention and silently miss incremental history if cursors age out.
2. `note_changes` can grow without bounded retention, increasing storage and pull latency risk.
3. Redis degradation can reduce realtime fanout quality while still appearing broadly healthy to operators.
4. Worker `/api/v2/*` proxy failures can repeatedly burn latency under upstream failure without fail-fast behavior.
5. Offline client sync queues can accumulate redundant operations per note, increasing replay cost after reconnect.

## Remediations Implemented

### 1) Stale-cursor recovery for sync pull
- `server/src/services/sync.ts`
  - `pullSync()` returns `resetRequired=true` with `resetReason='CURSOR_TOO_OLD'` when client cursors predate retained `note_changes`.
  - Responses include `oldestAvailableCursor` and `latestCursor` for diagnostics.
- `hooks/useSyncEngine.ts`
  - On reset-required pulls, client performs snapshot refresh and cursor realignment.
- `types.ts`, `services/syncService.ts`
  - Added typed reset-aware pull response fields.

### 2) Changelog retention maintenance
- `server/src/services/sync.ts`
  - Added `pruneNoteChanges()` retention job and prune telemetry counters.
- `server/src/services/maintenance.ts`
  - Maintenance loop now prunes tombstones and stale note changes.
- `server/src/config/env.ts`
  - Added `NOTE_CHANGES_RETENTION_MS` (default 30 days).

### 3) Redis/realtime readiness + metrics hardening
- `server/src/routes/health.ts`
  - `/ready` reports realtime mode (`distributed` vs `local-fallback`) and degradation state.
  - `REQUIRE_REDIS_FOR_READY=true` now gates readiness to `503` on Redis degradation.
  - Added unauthenticated `/metrics` endpoint in Prometheus text format.
- `server/src/realtime/hub.ts`
  - Added realtime fallback dwell tracking:
    - `currentDegradedForMs`
    - `totalDegradedMs`
  - Subscriber lifecycle transitions (`ready`, `close`, `reconnecting`, `end`, `error`) now drive degraded-state accounting.
- `server/src/index.ts`
  - Exempts `/metrics` from auth pre-handler checks.

### 4) Worker VPS proxy circuit breaker
- `worker/src/index.ts`
  - Added short-lived VPS proxy circuit behavior:
    - opens after repeated upstream failures,
    - rejects quickly while open,
    - resets on successful upstream response.
  - Added metrics: `vpsProxyCircuitOpens`, `vpsProxyCircuitRejects`.

### 5) Client sync queue pressure controls
- `storage/notesStore.ts`
  - Keeps compaction to latest pending op per note.
  - Added hard cap policy (`VITE_SYNC_QUEUE_HARD_CAP`, default `500`) that drops oldest queued entries after compaction when cap is exceeded.
  - Exposes queue policy stats (`before`, `after`, `cap`, `compactionDrops`, `capDrops`) for telemetry and tests.
- `hooks/useSyncEngine.ts`
  - Emits queue-drop telemetry.
  - Logs structured queue-drop warnings.
  - Emits throttled user-visible warning on cap drops.
- `utils/telemetry.ts`, `components/DiagnosticsPanel.tsx`
  - Added client metrics:
    - `sync_queue_compaction_drops`
    - `sync_queue_cap_drops`
    - `sync_queue_cap_events`

## Metrics + Alert Integration Path

### Prometheus scrape endpoint
- `GET /metrics`
- Content type: `text/plain; version=0.0.4`
- Key metrics:
  - `pocketbrain_sync_cursor_resets_total`
  - `pocketbrain_note_changes_pruned_total`
  - `pocketbrain_realtime_fallback_dwell_seconds`
  - `pocketbrain_realtime_fallback_active`
  - `pocketbrain_realtime_fallback_dwell_seconds_total`

### Starter alert guidance
- Cursor reset surge:
  - alert when `rate(pocketbrain_sync_cursor_resets_total[5m])` exceeds baseline.
- Aggressive prune spike:
  - alert when `increase(pocketbrain_note_changes_pruned_total[15m])` exceeds expected maintenance window volume.
- Prolonged fallback:
  - alert when `pocketbrain_realtime_fallback_active == 1` and `pocketbrain_realtime_fallback_dwell_seconds > threshold`.

## Multi-instance Failure Validation Workflow

- Dedicated chaos test:
  - `npm run server:test:chaos`
- Covers:
  - two API instances,
  - Redis unavailable/degraded mode,
  - readiness behavior with `REQUIRE_REDIS_FOR_READY=false` (`200`) and `true` (`503`),
  - sync continuity across instances under degraded realtime (`push` on A, `pull` on B),
  - realtime endpoint availability (`events/ticket` + `events`).

## Test Coverage Added/Updated

- `server/tests/sync-service.test.ts`
  - stale-cursor reset-required scenario.
  - note-change prune metric counter assertions.
- `server/tests/health-routes.test.ts`
  - `/metrics` route exposure assertions.
- `server/tests/metrics-routes.test.ts`
  - Prometheus metric value formatting assertions with mocked telemetry states.
- `server/tests/health-redis-gating.test.ts`
  - strict/non-strict Redis readiness gating assertions.
- `server/tests/sync-queue-policy.test.ts`
  - queue compaction and hard-cap policy behavior assertions.
- `server/tests/chaos-multi-instance.test.ts`
  - dedicated two-instance Redis degradation chaos workflow.
- `e2e/sync-reset-recovery.spec.ts`
  - stale-cursor reset recovery preserving pending local edits.

## Residual Risks

1. Queue hard-cap drops can still discard unsynced operations under sustained offline pressure; warnings and telemetry improve visibility but do not eliminate data-loss risk.
2. Chaos workflow auto-skips when Postgres or loopback binding is unavailable in constrained environments.
3. Alert thresholds require production tuning against observed baseline traffic and maintenance cadence.
