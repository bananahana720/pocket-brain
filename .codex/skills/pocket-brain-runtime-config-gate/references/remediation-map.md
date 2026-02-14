# Runtime Config Remediation Map

Match the validator error prefix and apply the minimum safe fix.

| Validator output contains | Likely cause | Remediation |
| --- | --- | --- |
| `server: ALLOW_INSECURE_DEV_AUTH must be false in production` | Insecure dev auth enabled | Set `ALLOW_INSECURE_DEV_AUTH=false`; rerun `NODE_ENV=production npm run config:check:server`. |
| `server: REQUIRE_REDIS_FOR_READY must be true in production` | Redis readiness gate disabled | Set `REQUIRE_REDIS_FOR_READY=true`; rerun server config check. |
| `server: KEY_ENCRYPTION_SECRET must be set` | Missing or placeholder key secret | Set a strong non-placeholder secret (32+ chars in production). |
| `server: CORS_ORIGIN must be explicit` | Wildcard CORS in production | Set concrete origin(s) instead of `*`. |
| `server: STREAM_TICKET_SECRET must differ` | Reused encryption key as stream secret | Set distinct `STREAM_TICKET_SECRET`. |
| `worker: CLERK_JWKS_URL, CLERK_ISSUER, and CLERK_AUDIENCE must be set together` | Partial Clerk tuple configured | Set all three or clear all three intentionally. |
| `worker: ... are required in production unless ALLOW_INSECURE_DEV_AUTH=true` | Missing Clerk tuple in production | Configure Clerk tuple; do not rely on insecure dev auth in production. |
| `worker: KEY_ENCRYPTION_SECRET must be non-placeholder` | Secret missing or placeholder | Set valid active secret and rerun worker config check. |
| `worker: KEY_ENCRYPTION_SECRET_PREV must differ` | Previous secret equals active secret | Set previous secret only for overlap and keep different from active. |
| `worker: VPS_API_ORIGIN must be set in production` | Upstream origin unset | Set `VPS_API_ORIGIN=https://...` and rerun check. |
| `worker: no routes are declared ...` | Route mode undeclared in production | Add top-level routes in `worker/wrangler.toml` or set `WORKER_ROUTE_MODE=dashboard`. |

Rerun command patterns:

- Full gate: `NODE_ENV=production npm run config:check`
- Server only: `NODE_ENV=production npm run config:check:server`
- Worker only: `NODE_ENV=production npm run config:check:worker`
