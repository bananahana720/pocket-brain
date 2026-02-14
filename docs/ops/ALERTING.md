# Reliability Alerting

Canonical tracker: `docs/RELIABILITY_PROGRAM.md`
Canonical release gate + rollback policy: `docs/RELIABILITY_PROGRAM.md` (section: `Consolidated Release Gate + Rollback Triggers`)

## Core Signals

### Server `/metrics`

- `pocketbrain_sync_cursor_resets_total`
- `pocketbrain_note_changes_pruned_total`
- `pocketbrain_realtime_fallback_active`
- `pocketbrain_realtime_fallback_dwell_seconds`

### Worker `/api/v1/metrics`

- Proxy counters: `vpsProxyFailures`, `vpsProxyTimeouts`, `vpsProxyCircuitOpens`, `vpsProxyCircuitRejects`
- Upstream causes: `failureCauses.upstream.{origin_unconfigured,timeout,network_error,upstream_5xx,circuit_open}`
- Provider causes: `failureCauses.provider.{provider_timeout,provider_5xx,provider_circuit_open}`
- Additive cause labels used by dashboards/current rollout:
  - `kv_unavailable` (if emitted by current Worker build)
  - `provider_network_error` (if emitted by current Worker build)
- Reliability counters:
  - `reliability.authConfig.{missingClerkConfig,partialClerkConfig}`
  - `reliability.runtimeConfig.invalidEncryptionSecret`
  - `reliability.secretRotation.{fallbackDecrypts,decryptFailures,reencryptSuccesses,reencryptFailures}`
  - `reliability.kvFailures` (if emitted by current Worker build)
- Normalized aliases:
  - `invalidClerkConfig = missingClerkConfig + partialClerkConfig`
  - `invalidRotationSecret = decryptFailures`
  - `kvFailures` passthrough or equivalent dashboard rollup

### Client diagnostics counters

- Durability: `capture_persistence_primary_failures`, `capture_persistence_fallback_failures`, `capture_persistence_recoveries`
- Queue overflow/backpressure: `sync_queue_block_events`, `sync_queue_blocked_mutations`, `sync_queue_recovery_events`, `sync_queue_compaction_drops`
- Sync resilience: `sync_cursor_reset_recoveries`, `sync_sse_fallback_activations`, `sync_sse_fallback_recoveries`

## Starter Thresholds

- Cursor reset surge: warn when `rate(pocketbrain_sync_cursor_resets_total[5m]) > 0.02` for 15 minutes; page when `> 0.10` for 15 minutes.
- Realtime degraded dwell: alert when `pocketbrain_realtime_fallback_active == 1` and `pocketbrain_realtime_fallback_dwell_seconds > 300`.
- Note-change prune spike: alert when `increase(pocketbrain_note_changes_pruned_total[15m])` is materially above baseline.
- Worker upstream instability: alert on sustained growth in `vpsProxyCircuitOpens` and `vpsProxyCircuitRejects`.
- Upstream misroute/config regression: page on any sustained increase in `failureCauses.upstream.origin_unconfigured`.
- Provider degradation: alert when `failureCauses.provider.provider_timeout` or `failureCauses.provider.provider_5xx` grows for 10+ minutes.
- Provider network transport degradation: alert on sustained `provider_network_error` growth (or equivalent provider transport-failure mapping).
- KV dependency degradation: page on sustained `kv_unavailable` or `kvFailures` growth.
- Auth/runtime config drift: page on any sustained increase in `invalidClerkConfig`, `invalidRotationSecret`, or `reliability.runtimeConfig.invalidEncryptionSecret` post-deploy.
- Queue backpressure pressure: warn when `increase(sync_queue_block_events[15m]) >= 5` or `increase(sync_queue_blocked_mutations[15m]) >= 25`; page if either doubles over 30 minutes.
- Queue non-recovery: page when `increase(sync_queue_block_events[15m]) >= 5` and `increase(sync_queue_recovery_events[15m]) == 0`.
- Capture durability risk: page on any sustained `capture_persistence_fallback_failures` increase after rollout.

## Rollback Policy

Use rollback triggers from `docs/RELIABILITY_PROGRAM.md` as the single source of truth.  
This alerting doc defines thresholds and escalation signals only.

## Operational Notes

- Tune all thresholds using production baseline traffic before paging.
- During incidents, correlate server `/ready` dependency state with Worker circuit metrics and additive config/rotation/KV counters to separate upstream outages from auth/config issues.
- Keep warning thresholds for 7 days of baseline before promoting to paging, then ratchet gradually.
