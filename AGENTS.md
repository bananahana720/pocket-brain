# PocketBrain Agent Guide

## Scope
- Workspace root: `/home/andrewhana/projects/pocket-brain`
- Stack: React + Vite frontend, Cloudflare Worker proxy, Playwright e2e
- Primary package manager: `npm`

## Core Workflows

### 1) Frontend-only local development
1. Install dependencies: `npm install`
2. Start app: `npm run dev`
3. Open: `http://localhost:3000`

Use this when working on UI/state/storage behavior that does not require the worker proxy.

### 2) Proxy-integrated local development (recommended for AI path testing)
1. Prepare worker local secrets: `cp worker/.dev.vars.example worker/.dev.vars`
2. In terminal A, start worker: `npm run worker:dev`
3. In terminal B, start app with proxy flags: `npm run dev:proxy`
4. Open: `http://localhost:3000`

Use this when validating secure proxy flows and `/api/*` interactions.

### 3) First-time Cloudflare worker bootstrap
1. Export auth and config values:
   - `export CLOUDFLARE_API_TOKEN=...`
   - `export CLOUDFLARE_ACCOUNT_ID=...`
   - `export KEY_ENCRYPTION_SECRET="$(openssl rand -hex 32)"`
2. Run bootstrap: `npm run worker:bootstrap`

This script creates/configures KV, sets the worker secret, and deploys.

### 4) Manual worker deploy workflow
1. Create KV namespace if needed: `npm run worker:kv:create`
2. Set `KEY_ENCRYPTION_SECRET` secret: `npm run worker:secret:set`
3. Deploy worker: `npm run worker:deploy`

Use this for iterative worker deploys after initial bootstrap.

### 5) Test workflow
1. Run e2e headless: `npm run test`
2. Run e2e interactive mode: `npm run test:ui`

Playwright uses `npm run dev` as its web server and targets `http://localhost:3000`.

### 6) Production build smoke check
1. Build app: `npm run build`
2. Preview bundle: `npm run preview`

## Command Reference

| Command | Purpose |
| --- | --- |
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

## Operational Notes
- Keep `worker/wrangler.toml` values aligned with your Cloudflare account and KV namespace.
- Do not commit real secrets in `.env.local` or `worker/.dev.vars`.
- Prefer proxy-integrated local workflow when changing AI/session/security behavior.
