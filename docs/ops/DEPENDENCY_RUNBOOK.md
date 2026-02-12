# Dependency Outage Runbook

## Symptoms

- `/api/v2/*` returns `503` from Worker.
- Worker circuit metrics (`vpsProxyCircuitOpens`, `vpsProxyCircuitRejects`) increase quickly.
- Server `/ready` is non-200 or reports degraded dependencies.

## Triage Steps

1. Check server readiness directly (`/ready`) and capture dependency payload (`database`, `redis`, `realtime`).
2. Check Worker local diagnostics (`/api/v1/metrics`) for proxy timeout/failure/circuit counters.
3. Validate VPS origin reachability from edge and host network.
4. Validate Redis health and connection status in server logs.

## Mitigation Steps

1. If Redis is degraded: recover Redis first; production readiness now requires Redis.
2. If DB is degraded: restore DB availability before recycling app instances.
3. If only Worker->VPS path fails: fix network/routing/TLS path and confirm circuit closes after successful upstream responses.
4. Confirm stream-ticket flow (`/api/v2/events/ticket` then `/api/v2/events`) after recovery.

## Exit Criteria

- `/ready` returns `200` with healthy dependencies.
- Worker circuit metrics stop increasing and reject count stabilizes.
- Client sync status returns to `synced`/`syncing` from `degraded`.
