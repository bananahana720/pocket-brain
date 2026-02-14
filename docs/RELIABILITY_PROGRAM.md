# Reliability Program

Updated: 2026-02-13  
Owner: Client + Ops reliability track

## Objectives

1. Prevent local data loss during capture/persistence errors.
2. Make sync queue backpressure and recovery states observable to users and operators.
3. Keep deploy/config workflows fail-fast on drift and unsafe runtime settings.

## Baseline Captures (2026-02-13)

Collected locally after this change set with Docker Postgres/Redis running and local Worker dev.

- `GET /ready` (`http://127.0.0.1:8788/ready`)
  - `ok=true`
  - `dependencies.redis.ok=true`, `dependencies.redis.degraded=false`
  - `dependencies.realtime.mode=distributed`, `degraded=false`, `degradedTransitions=0`
  - `dependencies.streamTicket.replayStoreAvailable=true`, `degraded=false`, `consumeAttempts=0`

- `GET /metrics` (`http://127.0.0.1:8788/metrics`, sample)
  - `pocketbrain_realtime_subscriber_ready 1`
  - `pocketbrain_realtime_publisher_ready 1`
  - `pocketbrain_stream_ticket_replay_store_available 1`
  - `pocketbrain_stream_ticket_replay_degraded 0`
  - `pocketbrain_redis_ready_degraded 0`
  - `pocketbrain_redis_ready_failures_total 0`

- `GET /api/v1/metrics` (`http://127.0.0.1:8787/api/v1/metrics`)
  - `metrics.vpsProxyFailures=0`, `metrics.vpsProxyCircuitOpens=0`
  - `failureCauses.upstream.*=0`, `failureCauses.provider.*=0`
  - `reliability.authConfig.missingClerkConfig=0`
  - `reliability.runtimeConfig.invalidEncryptionSecret=0`
  - `reliability.secretRotation.fallbackDecrypts=0`

## Canonical Signals

### Client counters (Diagnostics panel)

- `capture_persistence_primary_failures`: IndexedDB capture write-through failed and fallback path started.
- `capture_persistence_fallback_failures`: fallback op-log write also failed (highest-risk local durability signal).
- `capture_persistence_recoveries`: fallback op-log write recovered capture persistence after primary failure.
- `sync_queue_block_events`: queue transitioned into blocked state at cap.
- `sync_queue_recovery_events`: queue transitioned from blocked to unblocked.
- `sync_queue_blocked_mutations`: user write attempts blocked by queue policy.

### Platform/ops signals

- Worker: `vpsProxyFailures`, `vpsProxyTimeouts`, `vpsProxyCircuitOpens`, `vpsProxyCircuitRejects`, `failureCauses.*`
- Server: `/ready` and `/metrics` (`pocketbrain_sync_cursor_resets_total`, realtime fallback gauges, prune counters)

## Rollback Triggers

Treat these as release-stop conditions for newly deployed changes:

1. Local durability regression trigger  
Condition: `capture_persistence_fallback_failures > 0` for a newly deployed client build.  
Action: stop rollout and rollback the frontend artifact to prior known-good build.

2. Backpressure non-recovery trigger  
Condition: `increase(sync_queue_block_events[15m]) >= 5` and `increase(sync_queue_recovery_events[15m]) == 0`.  
Action: halt deploy progression, investigate sync API/worker path before changing queue cap.

3. Config drift trigger  
Condition: remote VPS `HEAD` does not match intended release SHA after sync.  
Action: fail deploy and resolve git/branch drift before rerun.

4. Readiness regression trigger  
Condition: `/ready` on `:8788` or `:8080` is non-200 post deploy.  
Action: rollback/redeploy previous container image set and re-validate dependency health.

5. Worker routing/config regression trigger  
Condition: sustained `failureCauses.upstream.origin_unconfigured` increase after deploy.  
Action: rollback worker config/routes and re-run runtime config validation.

## Release Gate Checklist

Run these for production-bound changes:

1. `NODE_ENV=production KEY_ENCRYPTION_SECRET=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa STREAM_TICKET_SECRET=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb ALLOW_INSECURE_DEV_AUTH=false REQUIRE_REDIS_FOR_READY=true CORS_ORIGIN=https://app.pocketbrain.example CLERK_SECRET_KEY=sk_test_example CLERK_PUBLISHABLE_KEY=pk_test_example WORKER_ROUTE_MODE=dashboard VPS_API_ORIGIN=https://example.com npm run config:check`
2. `npm run vps:precheck:remote`
3. `npm run vps:sync:remote`
4. `npm run vps:deploy:remote -- --skip-pull`
5. `npm run vps:verify:remote`
6. Observe canary for 30 minutes and halt/rollback on any rollback trigger in this document.

## Validation Coverage

- Queue block + mutation rejection: `e2e/sync-queue-backpressure.spec.ts`
- Queue unblock + recovery durability: `e2e/sync-queue-recovery-durability.spec.ts`
- Cursor reset + pending local edit survival: `e2e/sync-reset-recovery.spec.ts`

## Linked Runbooks

- `docs/ops/ALERTING.md`
- `docs/ops/QUEUE_BACKPRESSURE.md`
- `docs/ops/DEPENDENCY_RUNBOOK.md`
