# PocketBrain AI Proxy Worker

This Worker secures AI provider keys by storing encrypted keys server-side and issuing an HttpOnly session cookie.

## Required secrets

- `KEY_ENCRYPTION_SECRET`: High-entropy secret used to encrypt provider API keys at rest.

## Required KV namespace

- `AI_SESSIONS`: Stores encrypted API key sessions with 24-hour TTL.

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

## Local Dev

```bash
cp worker/.dev.vars.example worker/.dev.vars
npm run worker:dev
```

In a second terminal (app):

```bash
VITE_USE_AI_PROXY=true VITE_DEV_PROXY_WORKER=true npm run dev
```

`worker/wrangler.toml` is configured with `workers_dev = true` for local-first workflow.  
For production route-based deploys, set:
- `workers_dev = false`
- top-level `routes = [{ pattern = ".../api/*", zone_name = "..." }]`

## Deploy

```bash
npm run worker:secret:set
npm run worker:deploy
```

Then route `/api/*` traffic to this Worker in Cloudflare so the frontend can call same-origin API endpoints.
