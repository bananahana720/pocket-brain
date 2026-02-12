# Sync Queue Backpressure

## Policy

- Queue compaction still keeps latest pending operation per note.
- Hard cap (`VITE_SYNC_QUEUE_HARD_CAP`, default `500`) is non-destructive.
- When pending sync operations reach cap, new note mutations are blocked in the UI.
- No oldest-op dropping is performed.

## User-Facing Behavior

- Sync badge shows `Blocked` while queue is at/over cap.
- Mutating actions show a warning: reconnect and allow queue to drain before editing.

## Metrics

- `sync_queue_block_events`: transitions into blocked state.
- `sync_queue_blocked_mutations`: user mutation attempts blocked by policy.
- `sync_queue_compaction_drops`: normal compaction reductions.

## Operator Guidance

1. If blocks spike, first restore network/API health so queue can flush.
2. Do not increase cap until confirming push/pull recovery path is healthy.
3. If cap changes are required, change `VITE_SYNC_QUEUE_HARD_CAP` conservatively and monitor memory/perf impact.
