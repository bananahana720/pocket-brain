# Runtime Config Checks

Validation logic source: `scripts/validate-runtime-config.mjs`.

## Server checks

- `ALLOW_INSECURE_DEV_AUTH` must be `false` in production.
- `REQUIRE_REDIS_FOR_READY` must be `true` in production.
- `KEY_ENCRYPTION_SECRET` must be non-placeholder and meet min length.
- `STREAM_TICKET_SECRET` must be valid and at least 16 chars.
- `STREAM_TICKET_TTL_SECONDS` must be integer in `[15, 900]` when set.
- `CORS_ORIGIN` must be explicit and no wildcard in production.
- `STREAM_TICKET_SECRET` must be explicitly set in production.
- `STREAM_TICKET_SECRET` must differ from `KEY_ENCRYPTION_SECRET` in production.
- `ALLOW_LEGACY_SSE_QUERY_TOKEN` must be `false` in production.

## Worker checks

- `ALLOW_INSECURE_DEV_AUTH` must not be `true` in production.
- Clerk tuple must be fully set or fully unset:
  `CLERK_JWKS_URL`, `CLERK_ISSUER`, `CLERK_AUDIENCE`.
- Clerk URL values must be valid absolute HTTPS URLs outside loopback hosts.
- `KEY_ENCRYPTION_SECRET` must be non-placeholder and meet min length.
- `KEY_ENCRYPTION_SECRET_PREV` must be valid and differ from active secret when set.
- `VPS_API_ORIGIN` must be set in production and be valid absolute HTTPS URL outside loopback hosts.
- If no routes are declared in `worker/wrangler.toml`, production must set `WORKER_ROUTE_MODE=dashboard`.
