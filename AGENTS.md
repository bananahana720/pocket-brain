# PocketBrain Agent Guide

## Scope
- Workspace root: `/home/andrewhana/projects/pocket-brain`
- Stack: React + Vite frontend, Cloudflare Worker proxy, Playwright e2e
- Primary package manager: `npm`
- Prerequisites: Node.js 18+, npm, Cloudflare credentials for worker deploy workflows

## Core Workflows

### 1) Dependency setup
1. Install dependencies: `npm install`

Run this first after cloning or pulling changes that update `package-lock.json`.

### 2) Frontend-only local development (no worker)
1. Create `.env.local` (if needed) with one local AI fallback key:
   - `GEMINI_API_KEY=...` or
   - `OPENROUTER_API_KEY=...`
2. Start app: `npm run dev`
3. Open: `http://localhost:3000`

Use this when working on UI/state/storage behavior that does not require the worker proxy.

### 3) Proxy-integrated local development (recommended for AI/security path testing)
1. Prepare worker local secrets: `cp worker/.dev.vars.example worker/.dev.vars`
2. In terminal A, start worker: `npm run worker:dev`
3. In terminal B, start app with proxy flags: `npm run dev:proxy`
4. Open: `http://localhost:3000`

Use this when validating secure proxy flows and `/api/*` interactions.

### 4) First-time Cloudflare worker bootstrap
1. Export auth and config values:
   - `export CLOUDFLARE_API_TOKEN=...`
   - `export CLOUDFLARE_ACCOUNT_ID=...`
   - `export KEY_ENCRYPTION_SECRET="$(openssl rand -hex 32)"`
2. Run bootstrap: `npm run worker:bootstrap`

This script auto-updates placeholder values in `worker/wrangler.toml`, creates/configures KV when needed, sets the worker secret, and deploys.

### 5) Manual worker deploy workflow
1. Ensure `worker/wrangler.toml` has the real `account_id` and `AI_SESSIONS` namespace id.
2. Create KV namespace if needed: `npm run worker:kv:create`
3. Set `KEY_ENCRYPTION_SECRET` secret: `npm run worker:secret:set`
4. Deploy worker: `npm run worker:deploy`
5. In Cloudflare, route `/api/*` traffic to this worker for same-origin proxy calls.

Use this for iterative worker deploys after initial bootstrap.

### 6) Worker key rotation workflow
1. Set previous secret (temporary): `npx wrangler secret put KEY_ENCRYPTION_SECRET_PREV --config worker/wrangler.toml`
2. Set new active secret: `npm run worker:secret:set`
3. Redeploy: `npm run worker:deploy`
4. After session TTL has passed, remove previous secret: `npx wrangler secret delete KEY_ENCRYPTION_SECRET_PREV --config worker/wrangler.toml`

Use this to rotate encryption keys without immediately breaking active sessions.

### 7) Production route-based worker deploy toggle
1. Set `workers_dev = false` in `worker/wrangler.toml`.
2. Add top-level `routes = [{ pattern = ".../api/*", zone_name = "..." }]`.
3. Deploy: `npm run worker:deploy`

Use this when moving from local-first worker.dev mode to routed production traffic.

### 8) Test workflow
1. Run e2e headless: `npm run test`
2. Run e2e interactive mode: `npm run test:ui`

Playwright uses `npm run dev` as its web server and targets `http://localhost:3000`.

### 9) Production build smoke check
1. Build app: `npm run build`
2. Preview bundle: `npm run preview`

## Command Reference

| Command | Purpose |
| --- | --- |
| `npm install` | Install project dependencies from `package-lock.json` |
| `npm run dev` | Start Vite dev server for local frontend development |
| `npm run dev:proxy` | Start Vite with local proxy flags enabled |
| `npm run build` | Build production frontend assets |
| `npm run preview` | Preview built frontend locally |
| `npm run test` | Run Playwright e2e tests (headless) |
| `npm run test:ui` | Run Playwright tests with interactive UI |
| `npm run worker:dev` | Run local Cloudflare Worker on port `8787` |
| `npm run worker:bootstrap` | Bootstrap worker (KV + secret + deploy) |
| `npm run worker:kv:create` | Create `AI_SESSIONS` KV namespace |
| `npm run worker:secret:set` | Set `KEY_ENCRYPTION_SECRET` in worker |
| `npm run worker:deploy` | Deploy worker using `worker/wrangler.toml` |
| `cp worker/.dev.vars.example worker/.dev.vars` | Seed local worker dev secrets file |
| `npx wrangler secret put KEY_ENCRYPTION_SECRET_PREV --config worker/wrangler.toml` | Set previous encryption secret during rotation |
| `npx wrangler secret delete KEY_ENCRYPTION_SECRET_PREV --config worker/wrangler.toml` | Remove previous encryption secret after rotation window |

## Operational Notes
- Keep `worker/wrangler.toml` values aligned with your Cloudflare account and KV namespace.
- Do not commit real secrets in `.env.local` or `worker/.dev.vars`.
- Prefer proxy-integrated local workflow when changing AI/session/security behavior.
- For rotation safety, keep `KEY_ENCRYPTION_SECRET_PREV` only as long as needed to cover active session TTL.
