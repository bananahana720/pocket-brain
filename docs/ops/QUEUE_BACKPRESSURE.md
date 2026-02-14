# Sync Queue Backpressure

Canonical tracker: `docs/RELIABILITY_PROGRAM.md`
Canonical release gate + rollback policy: `docs/RELIABILITY_PROGRAM.md` (section: `Consolidated Release Gate + Rollback Triggers`)

## Policy

- Queue compaction still keeps latest pending operation per note.
- Hard cap (`VITE_SYNC_QUEUE_HARD_CAP`, default `500`) is non-destructive.
- When pending sync operations reach cap, new note mutations are blocked in the UI.
- No oldest-op dropping is performed.

## User-Facing Behavior

- Sync badge shows `Blocked` while queue is at/over cap.
- Mutating actions show a warning: reconnect and allow queue to drain before editing.
- When queue drains below cap, users see a recovery toast (`Sync queue recovered...`), confirming writes are unblocked.

## Metrics

- Overflow entry counter: `sync_queue_block_events` (alias: `queue_overflow_events`).
- Overflow rejection counter: `sync_queue_blocked_mutations` (alias: `queue_overflow_blocked_mutations`).
- Overflow recovery counter: `sync_queue_recovery_events` (alias: `queue_overflow_recoveries`).
- Compaction counter: `sync_queue_compaction_drops` (normal dedupe pressure, not rollback by itself).
- Overflow depth signal: `overflowBy` in sync backpressure state (current queue pressure context).

## Operator Guidance

1. If blocks spike, first restore network/API health so queue can flush.
2. Correlate overflow counters with Worker/server dependency signals before changing queue policy:
   - Worker: `failureCauses.*`, `vpsProxyCircuit*`, additive `kv_unavailable` / `provider_network_error` when present.
   - Server: `/ready` dependency degradation, especially Redis/realtime.
3. Do not increase cap until push/pull path is healthy and queue recoveries resume.
4. If cap changes are required, change `VITE_SYNC_QUEUE_HARD_CAP` conservatively and monitor memory/perf impact.
5. Treat sustained overflow without recovery as release-stop:
   `increase(sync_queue_block_events[15m]) >= 5` and `increase(sync_queue_recovery_events[15m]) == 0`.
6. Use canonical rollback triggers in `docs/RELIABILITY_PROGRAM.md` for release decisions.
