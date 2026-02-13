# Sync Queue Backpressure

Canonical tracker: `docs/RELIABILITY_PROGRAM.md`

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

- `sync_queue_block_events`: transitions into blocked state.
- `sync_queue_recovery_events`: transitions out of blocked state after queue drain.
- `sync_queue_blocked_mutations`: user mutation attempts blocked by policy.
- `sync_queue_compaction_drops`: normal compaction reductions.

## Operator Guidance

1. If blocks spike, first restore network/API health so queue can flush.
2. Do not increase cap until confirming push/pull recovery path is healthy.
3. If cap changes are required, change `VITE_SYNC_QUEUE_HARD_CAP` conservatively and monitor memory/perf impact.
4. Rollback trigger: if `increase(sync_queue_block_events[15m]) >= 5` and `increase(sync_queue_recovery_events[15m]) == 0`, stop rollout and recover sync path before further deploys.
