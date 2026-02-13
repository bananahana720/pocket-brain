# Reliability Alerting

Canonical tracker: `docs/RELIABILITY_PROGRAM.md`

## Core Signals

- `pocketbrain_sync_cursor_resets_total`
- `pocketbrain_note_changes_pruned_total`
- `pocketbrain_realtime_fallback_active`
- `pocketbrain_realtime_fallback_dwell_seconds`
- Worker metrics from `/api/v1/metrics`:
  - `vpsProxyFailures`
  - `vpsProxyTimeouts`
  - `vpsProxyCircuitOpens`
  - `vpsProxyCircuitRejects`
  - `failureCauses.upstream.{origin_unconfigured,timeout,network_error,upstream_5xx,circuit_open}`
  - `failureCauses.provider.{provider_timeout,provider_5xx,provider_circuit_open}`
- Client diagnostics counters:
  - `capture_persistence_primary_failures`
  - `capture_persistence_fallback_failures`
  - `capture_persistence_recoveries`
  - `sync_queue_block_events`
  - `sync_queue_recovery_events`
  - `sync_queue_blocked_mutations`
  - `sync_cursor_reset_recoveries`
  - `sync_sse_fallback_activations`
  - `sync_sse_fallback_recoveries`

## Starter Thresholds

- Cursor reset surge: warn when `rate(pocketbrain_sync_cursor_resets_total[5m]) > 0.02` for 15 minutes; page when `> 0.10` for 15 minutes.
- Realtime degraded dwell: alert when `pocketbrain_realtime_fallback_active == 1` and `pocketbrain_realtime_fallback_dwell_seconds > 300`.
- Note-change prune spike: alert when `increase(pocketbrain_note_changes_pruned_total[15m])` is materially above baseline.
- Worker upstream instability: alert on sustained growth in `vpsProxyCircuitOpens` and `vpsProxyCircuitRejects`.
- Upstream misroute/config regression: page on any sustained increase in `failureCauses.upstream.origin_unconfigured`.
- Provider degradation: alert when `failureCauses.provider.provider_timeout` or `failureCauses.provider.provider_5xx` grows for 10+ minutes.
- Queue backpressure pressure: warn when `increase(sync_queue_block_events[15m]) >= 5` or `increase(sync_queue_blocked_mutations[15m]) >= 25`; page if either doubles over 30 minutes.
- Queue non-recovery: page when `increase(sync_queue_block_events[15m]) >= 5` and `increase(sync_queue_recovery_events[15m]) == 0`.
- Capture durability risk: page on any sustained `capture_persistence_fallback_failures` increase after rollout.

## Rollback Triggers

1. Roll back frontend build when `capture_persistence_fallback_failures` increases post-deploy.
2. Stop rollout when queue enters repeated blocked periods without recovery (`block_events` rising, `recovery_events` flat).
3. Roll back worker routing/config when `failureCauses.upstream.origin_unconfigured` increases after release.
4. Roll back container release when `/ready` on `:8788` or `:8080` stays non-200 after retries.

## Operational Notes

- Tune all thresholds using production baseline traffic before paging.
- During incidents, correlate server `/ready` dependency state with Worker circuit metrics to separate upstream outages from auth/config issues.
- Keep warning thresholds for 7 days of baseline before promoting to paging, then ratchet gradually.
