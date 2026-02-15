# PocketBrain Agent Guide

## Scope
- Workspace root: `/home/andrewhana/projects/pocket-brain`
- Stack: React + Vite frontend, Cloudflare Worker proxy, Fastify sync server (Postgres + Redis), Playwright e2e
- Primary package manager: `npm`
- Prerequisites: Node.js 18+, npm, Docker + Docker Compose (for sync/VPS workflows), Cloudflare credentials for worker deploy workflows

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

Use this when working on UI/state/storage behavior that does not require worker or sync-server integration.

### 3) Proxy-integrated local development (recommended for AI/security path testing)
1. Prepare worker local secrets: `cp worker/.dev.vars.example worker/.dev.vars`
2. In terminal A, start worker: `npm run worker:dev`
3. In terminal B, start app with proxy flags: `npm run dev:proxy`
4. Open: `http://localhost:3000`

Use this when validating secure proxy flows and `/api/*` interactions.

### 4) Local sync server development (Fastify + Postgres + Redis)
1. Start infra from repo root: `docker compose up -d postgres redis`
2. Install server deps: `npm install --prefix server`
3. Create server env file: `cp server/.env.example server/.env`
4. Start backend: `npm run server:dev`
5. Backend endpoints:
   - Liveness: `http://localhost:8788/health`
   - Readiness: `http://localhost:8788/ready`

Use this when validating account sync, device/session APIs, and conflict behavior.

### 5) End-to-end local secure path (app + worker + sync server)
1. Start infra: `docker compose up -d postgres redis`
2. Configure backend: `cp server/.env.example server/.env`
3. Start backend: `npm run server:dev`
4. Configure worker: `cp worker/.dev.vars.example worker/.dev.vars`
5. Ensure worker local passthrough target is set: `VPS_API_ORIGIN=http://127.0.0.1:8788`
6. In terminal A, start worker: `npm run worker:dev`
7. In terminal B, start app with proxy flags: `npm run dev:proxy`
8. Open: `http://localhost:3000`

Use this when testing `/api/v2/*` proxy passthrough, auth flows, and stream-ticket sync behavior together.

### 6) First-time Cloudflare worker bootstrap
1. Export auth and config values:
   - `export CLOUDFLARE_API_TOKEN=...`
   - `export CLOUDFLARE_ACCOUNT_ID=...`
   - `export KEY_ENCRYPTION_SECRET="$(openssl rand -hex 32)"`
2. Run bootstrap: `npm run worker:bootstrap`

This script auto-updates placeholder values in `worker/wrangler.toml`, creates/configures KV when needed, sets the worker secret, and deploys.

### 7) Manual worker deploy workflow
1. Ensure `worker/wrangler.toml` has the real `account_id` and `AI_SESSIONS` namespace id.
2. Create KV namespace if needed: `npm run worker:kv:create`
3. Set `KEY_ENCRYPTION_SECRET` secret: `npm run worker:secret:set`
4. Deploy worker: `npm run worker:deploy`
5. In Cloudflare, route `/api/*` traffic to this worker for same-origin proxy calls.

Use this for iterative worker deploys after initial bootstrap.

### 8) Worker key rotation workflow
1. Set previous secret (temporary): `npx wrangler secret put KEY_ENCRYPTION_SECRET_PREV --config worker/wrangler.toml`
2. Set new active secret: `npm run worker:secret:set`
3. Redeploy: `npm run worker:deploy`
4. After session TTL has passed, remove previous secret: `npx wrangler secret delete KEY_ENCRYPTION_SECRET_PREV --config worker/wrangler.toml`

Use this to rotate encryption keys without immediately breaking active sessions.

### 9) Production route-based worker deploy toggle
1. Set `workers_dev = false` in `worker/wrangler.toml`.
2. Add top-level `routes = [{ pattern = ".../api/*", zone_name = "..." }]`.
3. Deploy: `npm run worker:deploy`

Use this when moving from local-first worker.dev mode to routed production traffic.

### 10) Backend build, test, and schema workflows
1. Build backend: `npm run server:build`
2. Run backend tests: `npm run server:test`
3. Generate migrations from schema changes: `npm --prefix server run db:generate`
4. Apply migrations: `npm --prefix server run db:migrate`

Use this for sync-server changes and DB schema updates.

### 11) Runtime config gate workflow
1. Render production server env from root env: `npm run server:env:render`
2. Validate all runtime config gates: `npm run config:check`
3. Optional scoped checks:
   - `npm run config:check:server`
   - `npm run config:check:worker`

Use this before worker deploys and VPS deploys to catch auth/secret/route-mode misconfiguration early.

### 12) Frontend/e2e test workflow
1. Run e2e headless: `npm run test`
2. Run e2e interactive mode: `npm run test:ui`

Playwright uses `npm run dev` as its web server and targets `http://localhost:3000`.

### 13) Chaos reliability test workflow
1. Run multi-instance degradation suite: `npm run server:test:chaos`

Use this for reliability regressions around sync behavior under degraded multi-instance conditions.

### 14) Production build smoke check
1. Build app: `npm run build`
2. Preview bundle: `npm run preview`

### 15) Public API smoke check
1. Run public contract checks: `npm run vps:smoke:public -- --base-url https://your-domain.example`
2. Optional authenticated sync pull check: `npm run vps:smoke:public -- --base-url https://your-domain.example --bearer <token>`

This validates JSON contracts for `/api/v1/auth/status`, `/api/v1/auth/connect` (invalid payload), and `/api/v2/sync/pull?cursor=0`.

### 16) VPS deploy workflow
1. Run deploy helper from repo root: `bash scripts/deploy-vps.sh`
2. Optional flags:
   - `--with-worker` to deploy Cloudflare Worker after backend readiness checks
   - `--skip-pull` to skip `git pull --ff-only`
   - `--ready-retries <count>` to override readiness retry attempts
   - `--ready-delay <seconds>` to override readiness retry delay
3. Deploy script behavior:
   - Acquires deploy lock (`/tmp/pocketbrain-deploy.lock`) to prevent overlapping deploys
   - Renders `server/.env` from root `.env`
   - Runs runtime config gates (`config:check:server`, and `config:check:worker` when `--with-worker`)
   - Validates Docker Compose and Drizzle migration metadata
   - Rebuilds/restarts containers, ensures database `pocketbrain` exists, and applies `npm run db:migrate` in the API container
   - Validates readiness on both `http://127.0.0.1:8788/ready` and `http://127.0.0.1:8080/ready`

### 17) Remote VPS management from local machine (SSH)
1. Preferred: create local remote config file once:
   - `cp .vps-remote.env.example .vps-remote.env`
   - Edit `VPS_SSH_HOST`, `VPS_PROJECT_DIR`, and optional SSH/retry fields.
2. Alternative: export remote connection vars per shell:
   - `export VPS_SSH_HOST=ubuntu@your-vps-host`
   - `export VPS_PROJECT_DIR=/srv/pocket-brain`
   - Optional: `export VPS_SSH_PORT=22`
   - Optional: `export VPS_SSH_IDENTITY=~/.ssh/id_ed25519`
3. Validate connectivity, repo layout, and runtime prerequisites:
   - `npm run vps:precheck:remote`
4. Sync only (git pull on VPS):
   - `npm run vps:sync:remote`
5. Full deploy via remote `scripts/deploy-vps.sh`:
   - `npm run vps:deploy:remote -- --skip-pull` (recommended after sync step)
6. Post-deploy verify (remote SHA + readiness/migration summary):
   - `npm run vps:verify:remote`
7. Optional direct flags:
   - `bash scripts/deploy-vps-remote.sh --with-worker`
   - `bash scripts/deploy-vps-remote.sh --skip-pull`
   - `bash scripts/deploy-vps-remote.sh --allow-stash`
   - `bash scripts/deploy-vps-remote.sh --ssh-retries 5`
   - `bash scripts/deploy-vps-remote.sh --sync-only`
   - `bash scripts/deploy-vps-remote.sh --precheck-only`
   - `bash scripts/deploy-vps-remote.sh --ready-retries 45 --ready-delay 2`
   - `bash scripts/verify-vps-remote.sh --ready-retries 30 --ready-delay 2`

## Command Reference

| Command | Purpose |
| --- | --- |
| `npm install` | Install project dependencies from `package-lock.json` |
| `npm run dev` | Start Vite dev server for local frontend development |
| `npm run dev:proxy` | Start Vite with local proxy flags enabled |
| `npm run server:dev` | Start Fastify sync server in watch mode (`server/src/index.ts`) |
| `npm run server:build` | Build the sync server TypeScript bundle |
| `npm run server:test` | Run sync server Vitest suite |
| `npm run server:test:chaos` | Run dedicated multi-instance chaos/degradation sync tests |
| `npm install --prefix server` | Install server package dependencies |
| `npm --prefix server run db:generate` | Generate DB migrations from schema changes |
| `npm --prefix server run db:migrate` | Apply pending DB migrations |
| `npm run server:env:render` | Render `server/.env` from root `.env` in production mode |
| `npm run config:check` | Run full runtime config validation (server + worker) |
| `npm run config:check:server` | Run runtime config validation for server scope only |
| `npm run config:check:worker` | Run runtime config validation for worker scope only |
| `docker compose up -d postgres redis` | Start local Postgres and Redis for sync server development |
| `docker compose up -d --build` | Rebuild and restart full VPS-style local stack |
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
| `cp server/.env.example server/.env` | Seed local sync-server environment file |
| `bash scripts/deploy-vps.sh` | Deploy backend stack on VPS (pull, render env, config-gate, rebuild, migrate, readiness checks) |
| `bash scripts/deploy-vps.sh --with-worker` | Deploy backend stack plus Cloudflare Worker |
| `bash scripts/deploy-vps.sh --skip-pull` | Deploy backend stack without running git pull |
| `bash scripts/deploy-vps.sh --ready-retries 45 --ready-delay 2` | Deploy with custom readiness retry settings |
| `bash scripts/render-server-env.sh --mode production --source .env --output server/.env` | Generate `server/.env` from root `.env` for production deploy checks |
| `npm run vps:precheck:remote` | Verify SSH connectivity + repo layout on remote VPS before running actions |
| `npm run vps:sync:remote` | Run `git pull --ff-only` on remote VPS repo over SSH |
| `npm run vps:deploy:remote` | Run full VPS deploy workflow remotely over SSH |
| `npm run vps:verify:remote` | Print remote git SHA and `/ready` summary over SSH |
| `npm run vps:smoke:public -- --base-url https://your-domain.example` | Run public Worker/routing JSON contract smoke checks |
| `bash scripts/deploy-vps-remote.sh --with-worker` | Remote deploy with Cloudflare Worker deploy step |
| `bash scripts/deploy-vps-remote.sh --skip-pull` | Remote deploy without running `git pull` on VPS |
| `bash scripts/deploy-vps-remote.sh --allow-stash` | Auto-stash dirty remote repo before sync/deploy |
| `bash scripts/deploy-vps-remote.sh --ssh-retries 5` | Remote deploy/precheck with custom SSH retry attempts |
| `bash scripts/deploy-vps-remote.sh --sync-only` | Run only remote `git pull --ff-only` |
| `bash scripts/deploy-vps-remote.sh --precheck-only` | Validate SSH + remote prerequisites without syncing/deploying |
| `bash scripts/deploy-vps-remote.sh --ready-retries 45 --ready-delay 2` | Remote deploy with custom readiness retry settings |
| `bash scripts/smoke-public-api.sh --base-url https://your-domain.example` | Run public API smoke checks directly via script |
| `npx wrangler secret put KEY_ENCRYPTION_SECRET_PREV --config worker/wrangler.toml` | Set previous encryption secret during rotation |
| `npx wrangler secret delete KEY_ENCRYPTION_SECRET_PREV --config worker/wrangler.toml` | Remove previous encryption secret after rotation window |

## Operational Notes
- Keep `worker/wrangler.toml` values aligned with your Cloudflare account and KV namespace.
- Keep `ALLOW_INSECURE_DEV_AUTH=true` only for local development; set it to `false` for production worker/server deployments.
- Use `WORKER_ROUTE_MODE=dashboard` only when route ownership is intentionally managed in the Cloudflare Dashboard.
- Do not commit real secrets in `.env.local`, `worker/.dev.vars`, or `server/.env`.
- For VPS deploys, treat root `.env` as the source of truth and render `server/.env` from it before runtime checks.
- Run runtime config gates before deploy workflows to catch secret/auth/route drift before restart.
- Prefer end-to-end local workflow when changing AI/session/security/sync behavior.
- For rotation safety, keep `KEY_ENCRYPTION_SECRET_PREV` only as long as needed to cover active session TTL.
- `/ready` is the deployment health endpoint; nginx `/` may return `404` and is not a deployment-failure signal.

## Session Learnings (2026-02-14)
- Remote VPS SSH workflow is now validated for Ubuntu hosts via `scripts/deploy-vps-remote.sh` and npm wrappers (`vps:precheck:remote`, `vps:sync:remote`, `vps:deploy:remote`).
- Commit/deploy signal playbook: after local validation, run `git push origin main` then `npm run vps:precheck:remote`, `npm run vps:sync:remote`, `npm run vps:deploy:remote -- --skip-pull`, and `npm run vps:verify:remote`.
- Always run remote precheck before sync/deploy to fail fast on SSH auth, host reachability, and repo layout issues.
- Remote deploy now fails fast on dirty VPS repo by default; use `--allow-stash` only for intentional one-off recovery.
- Run `npm run vps:verify:remote` after deploy to confirm remote SHA and `/ready` payload.
- Remote scripts now auto-load VPS settings from `.vps-remote.env` (fallback `.env`), auto-prefix raw hosts to `ubuntu@`, and default identity to `~/.ssh/id_ed25519` when present.
- Local/remote deploy scripts now auto-render `server/.env` from root `.env` and enforce runtime config gates before container restart.
- Deploy now validates Drizzle migration metadata, auto-creates database `pocketbrain` if missing, and runs `npm run db:migrate` in the API container.
- If `http://127.0.0.1:8080/ready` returns `404` while API `:8788/ready` is healthy, check nginx config inside the container and recreate nginx after syncing `nginx/nginx.conf`.
- Keep VPS repo state clean between deploys; local edits on tracked files and untracked backup files can cause confusion during future `git pull --ff-only` runs.
- Docker Compose warns that `version` in `docker-compose.yml` is obsolete; this is non-blocking but should be cleaned up in a follow-up.
- Public contract checks are now scripted via `npm run vps:smoke:public` and can validate auth-protected sync pull with `--bearer`.
- Dedicated multi-instance degradation validation is available via `npm run server:test:chaos`.
