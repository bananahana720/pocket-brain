# Reliability Program

Updated: 2026-02-14  
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

- Worker `/api/v1/metrics`:
  - core: `vpsProxyFailures`, `vpsProxyTimeouts`, `vpsProxyCircuitOpens`, `vpsProxyCircuitRejects`, `failureCauses.*`
  - auth/runtime/rotation: `reliability.authConfig.*`, `reliability.runtimeConfig.*`, `reliability.secretRotation.*`
- Server `/ready` + `/metrics`: `pocketbrain_sync_cursor_resets_total`, realtime fallback gauges, prune counters, Redis readiness gauges

## Additive Signal Alias Map

Some dashboards normalize raw Worker/client fields into additive labels. Treat these aliases as equivalent to the canonical fields below.

| Additive label | Canonical source | Operational meaning |
| --- | --- | --- |
| `invalidClerkConfig` | `reliability.authConfig.missingClerkConfig + reliability.authConfig.partialClerkConfig` | Clerk JWT config is missing or partial while bearer auth is attempted. |
| `invalidRotationSecret` | `reliability.secretRotation.decryptFailures` | Active/previous key rotation secrets failed to decrypt stored session data. |
| `kvFailures` | `reliability.kvFailures` (if emitted by current Worker build) | AI session KV read/write operations are failing. |
| `kv_unavailable` | `failureCauses.upstream.kv_unavailable` (if emitted by current Worker build) | KV dependency unavailable to Worker auth/session path. |
| `provider_network_error` | `failureCauses.provider.provider_network_error` (if emitted) or dashboard-mapped provider transport failures | AI provider path is failing on network transport. |
| `queue_overflow_events` | `sync_queue_block_events` | Queue reached hard cap and entered blocked state. |
| `queue_overflow_blocked_mutations` | `sync_queue_blocked_mutations` | User writes rejected while queue remained at/over cap. |
| `queue_overflow_recoveries` | `sync_queue_recovery_events` | Queue drained below cap and unblocked writes. |

## Failure-Mode Matrix

| Failure mode | Detection (metrics/endpoints) | User/ops surface | First mitigation | Primary runbook |
| --- | --- | --- | --- | --- |
| Local capture durability regression | `capture_persistence_fallback_failures > 0` | Capture writes can fail even after fallback path | Stop rollout, rollback frontend artifact | `docs/ops/ALERTING.md` |
| Sync queue overflow/backpressure | `increase(sync_queue_block_events[15m])`, `increase(sync_queue_blocked_mutations[15m])`, blocked badge in UI | Sync state shows `Blocked`; mutations rejected | Restore sync path first (API/Worker/network), avoid immediate cap increase | `docs/ops/QUEUE_BACKPRESSURE.md` |
| Worker auth/runtime config invalid | `invalidClerkConfig`, `reliability.runtimeConfig.invalidEncryptionSecret`, `failureCauses.upstream.origin_unconfigured` | `/api/v1/*` and `/api/v2/*` fail with auth/config errors | Re-run config gate, fix env/routes, redeploy | `docs/ops/DEPENDENCY_RUNBOOK.md` |
| Secret rotation mismatch | `invalidRotationSecret`, `reliability.secretRotation.decryptFailures` | Existing sessions become `AUTH_EXPIRED`/reconnect prompts | Restore `KEY_ENCRYPTION_SECRET_PREV` overlap and redeploy | `docs/ops/DEPENDENCY_RUNBOOK.md` |
| KV dependency unavailable/failing | `kv_unavailable`, `kvFailures` (or equivalent dashboard rollup) | auth/connect or session lookup failures | Validate `AI_SESSIONS` binding + Cloudflare KV health | `docs/ops/DEPENDENCY_RUNBOOK.md` |
| Worker->VPS path instability | `failureCauses.upstream.{timeout,network_error,upstream_5xx,circuit_open}`, circuit counters | `/api/v2/*` 503s, proxy circuit opens/rejects | Recover upstream network/API path, confirm circuit closes | `docs/ops/DEPENDENCY_RUNBOOK.md` |
| Provider outage/network degradation | `failureCauses.provider.{provider_timeout,provider_5xx,provider_circuit_open,provider_network_error}` | AI requests fail/degrade | Keep retries bounded, fail over provider if available | `docs/ops/DEPENDENCY_RUNBOOK.md` |
| Redis readiness degradation | `/ready` shows Redis degraded, `pocketbrain_redis_ready_degraded=1` | Realtime quality degrades or readiness fails (strict mode) | Recover Redis before recycling app instances | `docs/ops/DEPENDENCY_RUNBOOK.md` |

## Consolidated Release Gate + Rollback Triggers

### Release Gate Checklist (Canonical)

Run in this order for production-bound changes:

1. `NODE_ENV=production KEY_ENCRYPTION_SECRET=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa STREAM_TICKET_SECRET=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb ALLOW_INSECURE_DEV_AUTH=false REQUIRE_REDIS_FOR_READY=true CORS_ORIGIN=https://app.pocketbrain.example CLERK_SECRET_KEY=sk_test_example CLERK_PUBLISHABLE_KEY=pk_test_example WORKER_ROUTE_MODE=dashboard VPS_API_ORIGIN=https://example.com npm run config:check`
2. `npm run vps:precheck:remote`
3. `npm run vps:sync:remote`
4. `npm run vps:deploy:remote -- --skip-pull`
5. `npm run vps:verify:remote`
6. Run a 30-minute canary and halt promotion if any rollback trigger below fires.

### Rollback Triggers (Canonical)

| Trigger | Condition | Immediate action | Runbook |
| --- | --- | --- | --- |
| Local durability regression | `capture_persistence_fallback_failures > 0` after client deploy | Roll back frontend artifact | `docs/ops/ALERTING.md` |
| Queue non-recovery | `increase(sync_queue_block_events[15m]) >= 5` and `increase(sync_queue_recovery_events[15m]) == 0` | Stop rollout; recover sync path before queue cap changes | `docs/ops/QUEUE_BACKPRESSURE.md` |
| Worker config/routing regression | Sustained increase in `failureCauses.upstream.origin_unconfigured` or `invalidClerkConfig` | Roll back Worker config/routes, fix runtime config, redeploy | `docs/ops/DEPENDENCY_RUNBOOK.md` |
| Secret/KV regression | Sustained increase in `invalidRotationSecret`, `kv_unavailable`, or `kvFailures` | Stop rollout, restore prior secret/binding, redeploy | `docs/ops/DEPENDENCY_RUNBOOK.md` |
| Readiness regression | `/ready` on `:8788` or `:8080` remains non-200 after retry budget | Roll back/redeploy previous container image set | `docs/ops/DEPENDENCY_RUNBOOK.md` |
| Deploy drift | Remote VPS `HEAD` does not match intended release SHA after sync/deploy | Fail release and resolve git/branch drift before rerun | `docs/ops/DEPENDENCY_RUNBOOK.md` |

## Validation Coverage

- Queue block + mutation rejection: `e2e/sync-queue-backpressure.spec.ts`
- Queue unblock + recovery durability: `e2e/sync-queue-recovery-durability.spec.ts`
- Cursor reset + pending local edit survival: `e2e/sync-reset-recovery.spec.ts`

## Linked Runbooks

- `docs/ops/ALERTING.md`
- `docs/ops/QUEUE_BACKPRESSURE.md`
- `docs/ops/DEPENDENCY_RUNBOOK.md`
