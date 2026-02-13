# PocketBrain AI Proxy Worker

This Worker secures AI provider keys by storing encrypted keys server-side and issuing an HttpOnly session cookie.

## Required secrets

- `KEY_ENCRYPTION_SECRET`: High-entropy secret used to encrypt provider API keys at rest.
  - Production minimum: 32 characters.
- `KEY_ENCRYPTION_SECRET_PREV` (optional during rotation): previous secret kept temporarily so existing sessions can be decrypted and re-encrypted in-place.

## Required auth vars

Set these together for Clerk JWT verification:

- `CLERK_JWKS_URL`
- `CLERK_ISSUER`
- `CLERK_AUDIENCE`

Set `ALLOW_INSECURE_DEV_AUTH=false` in production. Keep insecure auth enabled only for loopback/local development when explicitly needed.

## Optional proxy vars

- `VPS_API_ORIGIN` (required in production for `/api/v2/*` passthrough)
  - Use `https://` for non-loopback hosts.
  - Local loopback example: `http://127.0.0.1:8788`.
- `VPS_PROXY_TIMEOUT_MS` (default `7000`): timeout for Worker `/api/v2/*` upstream calls.
- `VPS_PROXY_RETRIES` (default `1`): retry attempts for transient `/api/v2/*` failures (except `/api/v2/events` stream handshake).
- Worker also applies a short in-memory circuit-breaker for repeated `/api/v2/*` upstream failures to fail fast during outages.
  - opens after 3 consecutive failures
  - open window 20 seconds
  - while open, `/api/v2/*` failures include `Retry-After` to guide client backoff.
  - additive `error.cause` values for `/api/v2/*`: `origin_unconfigured`, `timeout`, `network_error`, `upstream_5xx`, `circuit_open`
  - additive `error.cause` values for `/api/v1/ai/*` provider outages: `provider_timeout`, `provider_5xx`, `provider_circuit_open`

## Required KV namespace

- `AI_SESSIONS`: Stores encrypted API key sessions with 24-hour TTL.

## Required Durable Object

- `ControlPlaneDO`: Stores distributed rate-limit and provider circuit-breaker state.
- Defined in `worker/wrangler.toml`; Wrangler applies the migration on deploy.

Create + configure + deploy in one step:

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
export KEY_ENCRYPTION_SECRET="$(openssl rand -hex 32)"
npm run worker:bootstrap
```

Or run manual sub-steps with:
- `npm run worker:kv:create`
- update `worker/wrangler.toml` with the emitted namespace id
- `npm run worker:secret:set`
- `npm run worker:deploy`
- set Clerk vars (`CLERK_JWKS_URL`, `CLERK_ISSUER`, `CLERK_AUDIENCE`) and `ALLOW_INSECURE_DEV_AUTH=false` for production

## Local Dev

```bash
cp worker/.dev.vars.example worker/.dev.vars
npm run worker:dev
```

For local JWT bypass, keep `ALLOW_INSECURE_DEV_AUTH=true` in `.dev.vars`.
For local JWT verification, set `ALLOW_INSECURE_DEV_AUTH=false` and provide all Clerk vars (`CLERK_JWKS_URL`, `CLERK_ISSUER`, `CLERK_AUDIENCE`).

Diagnostics endpoint (`GET /api/v1/metrics`) now includes:
- proxy circuit metrics (`vpsProxyCircuitOpens`, `vpsProxyCircuitRejects`)
- failure-cause counters for upstream and provider outages (`failureCauses.upstream`, `failureCauses.provider`)
- current circuit state (`open`, `openUntil`, `remainingMs`) for local troubleshooting.

In a second terminal (app):

```bash
VITE_USE_AI_PROXY=true VITE_DEV_PROXY_WORKER=true npm run dev
```

`worker/wrangler.toml` is configured with `workers_dev = true` for local-first workflow.  
For production route-based deploys, set:
- `workers_dev = false`
- top-level `routes = [{ pattern = ".../api/*", zone_name = "..." }]`

If production routes are managed in Cloudflare Dashboard instead of `worker/wrangler.toml`, set:
- `WORKER_ROUTE_MODE=dashboard` when running `npm run config:check:worker` (and deployment workflows that run runtime config checks)

## Deploy

```bash
npm run worker:secret:set
npm run worker:deploy
```

Then route `/api/*` traffic to this Worker in Cloudflare so the frontend can call same-origin API endpoints.

## Monthly Secret Rotation Drill

1. Add overlap secret:
   `npx wrangler secret put KEY_ENCRYPTION_SECRET_PREV --config worker/wrangler.toml`
2. Set new active secret:
   `npm run worker:secret:set`
3. Deploy:
   `npm run worker:deploy`
4. After session TTL window passes, remove overlap:
   `npx wrangler secret delete KEY_ENCRYPTION_SECRET_PREV --config worker/wrangler.toml`
