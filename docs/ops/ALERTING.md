# Reliability Alerting

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
- Client diagnostics counters:
  - `sync_queue_block_events`
  - `sync_queue_blocked_mutations`
  - `sync_cursor_reset_recoveries`

## Starter Thresholds

- Cursor reset surge: alert when `rate(pocketbrain_sync_cursor_resets_total[5m])` exceeds normal baseline for 15 minutes.
- Realtime degraded dwell: alert when `pocketbrain_realtime_fallback_active == 1` and `pocketbrain_realtime_fallback_dwell_seconds > 300`.
- Note-change prune spike: alert when `increase(pocketbrain_note_changes_pruned_total[15m])` is materially above baseline.
- Worker upstream instability: alert on sustained growth in `vpsProxyCircuitOpens` and `vpsProxyCircuitRejects`.
- Queue backpressure pressure: alert if `sync_queue_block_events` or `sync_queue_blocked_mutations` climb continuously over a deploy window.

## Operational Notes

- Tune all thresholds using production baseline traffic before paging.
- During incidents, correlate server `/ready` dependency state with Worker circuit metrics to separate upstream outages from auth/config issues.
