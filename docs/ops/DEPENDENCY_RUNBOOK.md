# Dependency Outage Runbook

Canonical tracker: `docs/RELIABILITY_PROGRAM.md`
Canonical release gate + rollback policy: `docs/RELIABILITY_PROGRAM.md` (section: `Consolidated Release Gate + Rollback Triggers`)

## Symptoms

- `/api/v2/*` returns `503` from Worker.
- Worker circuit metrics (`vpsProxyCircuitOpens`, `vpsProxyCircuitRejects`) increase quickly.
- Worker cause counters in `/api/v1/metrics` rise:
  - upstream: `origin_unconfigured`, `timeout`, `network_error`, `upstream_5xx`, `circuit_open`
  - provider: `provider_timeout`, `provider_5xx`, `provider_circuit_open`
  - additive causes in current rollout/dashboards: `kv_unavailable`, `provider_network_error`
- Worker reliability counters rise:
  - `reliability.authConfig.{missingClerkConfig,partialClerkConfig}` (`invalidClerkConfig` rollup)
  - `reliability.runtimeConfig.invalidEncryptionSecret`
  - `reliability.secretRotation.decryptFailures` (`invalidRotationSecret` rollup)
  - `reliability.kvFailures` (if emitted by current Worker build)
- Server `/ready` is non-200 or reports degraded dependencies.

## Triage Steps

1. Check server readiness directly (`/ready`) and capture dependency payload (`database`, `redis`, `realtime`).
2. Check Worker local diagnostics (`/api/v1/metrics`) for proxy counters, failure-cause maps, and reliability counters.
3. Validate VPS origin reachability from edge and host network.
4. Validate Redis health and connection status in server logs.
5. Validate Worker auth/session dependencies:
   - `AI_SESSIONS` KV binding exists and is reachable.
   - Clerk vars are either fully configured (`CLERK_JWKS_URL`, `CLERK_ISSUER`, `CLERK_AUDIENCE`) or intentionally disabled for local loopback-only dev.
   - Rotation overlap secret (`KEY_ENCRYPTION_SECRET_PREV`) is present during planned rotation windows.

### Cause-first triage

1. `origin_unconfigured` or `invalidClerkConfig`:
   Runtime config/deploy mismatch. Re-render env and validate Worker vars before redeploy.
2. `invalidEncryptionSecret`:
   Worker encryption secret is missing/short/invalid for runtime mode. Correct secret, rerun config gate, redeploy.
3. `invalidRotationSecret`:
   Session decryption failed for both active and previous secret. Restore correct `KEY_ENCRYPTION_SECRET_PREV` overlap and redeploy.
4. `kv_unavailable` or `kvFailures`:
   Worker KV dependency degraded/unbound. Validate `AI_SESSIONS` namespace binding and Cloudflare KV health.
5. `timeout` or `network_error`:
   Worker->VPS path instability. Check VPS reachability, DNS, TLS, routing, and firewall.
6. `upstream_5xx`:
   API is reachable but unhealthy. Inspect API logs, DB, Redis, and migration status.
7. `circuit_open`:
   Repeated failures tripped fail-fast behavior. Resolve root cause and confirm a successful upstream response to close circuit.
8. `provider_timeout` / `provider_5xx` / `provider_circuit_open` / `provider_network_error`:
   External AI provider degradation. Keep retries bounded, fail over provider when possible, and communicate degraded mode.

## Mitigation Steps

1. If Redis is degraded: recover Redis first; production readiness now requires Redis.
2. If DB is degraded: restore DB availability before recycling app instances.
3. If config/auth counters are rising (`invalidClerkConfig`, `invalidEncryptionSecret`): fix env vars, then rerun config gate before redeploy.
4. If rotation counters are rising (`invalidRotationSecret`): restore overlap secret and verify session decrypt/re-encrypt path.
5. If KV counters are rising (`kv_unavailable`, `kvFailures`): repair `AI_SESSIONS` binding and KV availability before further rollout.
6. If only Worker->VPS path fails: fix network/routing/TLS path and confirm circuit closes after successful upstream responses.
7. Confirm stream-ticket flow (`/api/v2/events/ticket` then `/api/v2/events`) after recovery.
8. Re-run config gate before redeploy:
   `NODE_ENV=production KEY_ENCRYPTION_SECRET=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa STREAM_TICKET_SECRET=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb ALLOW_INSECURE_DEV_AUTH=false REQUIRE_REDIS_FOR_READY=true CORS_ORIGIN=https://app.pocketbrain.example CLERK_SECRET_KEY=sk_test_example CLERK_PUBLISHABLE_KEY=pk_test_example WORKER_ROUTE_MODE=dashboard VPS_API_ORIGIN=https://example.com npm run config:check`

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

## Rollback Policy

Use rollback triggers from `docs/RELIABILITY_PROGRAM.md` as the canonical source.  
For dependency incidents, prioritize rollback when config/rotation/KV counters rise post-deploy or readiness fails retry budget.
