# Dependency Outage Runbook

## Symptoms

- `/api/v2/*` returns `503` from Worker.
- Worker circuit metrics (`vpsProxyCircuitOpens`, `vpsProxyCircuitRejects`) increase quickly.
- Worker cause counters in `/api/v1/metrics` rise:
  - upstream: `origin_unconfigured`, `timeout`, `network_error`, `upstream_5xx`, `circuit_open`
  - provider: `provider_timeout`, `provider_5xx`, `provider_circuit_open`
- Server `/ready` is non-200 or reports degraded dependencies.

## Triage Steps

1. Check server readiness directly (`/ready`) and capture dependency payload (`database`, `redis`, `realtime`).
2. Check Worker local diagnostics (`/api/v1/metrics`) for proxy timeout/failure/circuit counters and failure-cause maps.
3. Validate VPS origin reachability from edge and host network.
4. Validate Redis health and connection status in server logs.

### Cause-first triage

1. `origin_unconfigured`: runtime config/deploy mismatch. Re-render `server/.env` and validate worker vars before redeploy.
2. `timeout` or `network_error`: upstream path instability. Check VPS reachability, DNS, TLS path, and firewall.
3. `upstream_5xx`: API is reachable but unhealthy. Inspect API logs, DB, Redis, and migration status.
4. `circuit_open`: preceding failures tripped fail-fast behavior. Resolve root cause and confirm successful upstream response to close.
5. `provider_timeout` / `provider_5xx` / `provider_circuit_open`: external AI provider incident. Keep retries bounded and communicate degraded mode.

## Mitigation Steps

1. If Redis is degraded: recover Redis first; production readiness now requires Redis.
2. If DB is degraded: restore DB availability before recycling app instances.
3. If only Worker->VPS path fails: fix network/routing/TLS path and confirm circuit closes after successful upstream responses.
4. Confirm stream-ticket flow (`/api/v2/events/ticket` then `/api/v2/events`) after recovery.

## Secret Rotation Drill (Monthly)

1. Set overlap secret: `npx wrangler secret put KEY_ENCRYPTION_SECRET_PREV --config worker/wrangler.toml`
2. Set new active secret: `npm run worker:secret:set`
3. Deploy worker: `npm run worker:deploy`
4. Validate existing sessions still work and are re-encrypted on access.
5. After session TTL window expires, remove overlap secret:
   `npx wrangler secret delete KEY_ENCRYPTION_SECRET_PREV --config worker/wrangler.toml`

## Exit Criteria

- `/ready` returns `200` with healthy dependencies.
- Worker circuit metrics stop increasing and reject count stabilizes.
- Client sync status returns to `synced`/`syncing` from `degraded`.
