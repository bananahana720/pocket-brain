---
name: pocket-brain-local-secure-stack
description: Stand up the PocketBrain local secure end-to-end stack (frontend + worker proxy + sync server + Postgres + Redis). Use when asked to run full local integration, reproduce auth or sync issues, validate /api/v2 proxy passthrough, or prepare secure-path E2E checks.
---

# PocketBrain Local Secure Stack

Start local infrastructure and application services in the documented order and verify health before testing.

## Workflow

1. Confirm local prerequisites.
- Ensure Node.js 18+, npm, Docker, and Docker Compose are available.

2. Start infrastructure dependencies.
- Run `docker compose up -d postgres redis`.

3. Seed local env files.
- Run `cp server/.env.example server/.env` if missing.
- Run `cp worker/.dev.vars.example worker/.dev.vars` if missing.
- Ensure `VPS_API_ORIGIN=http://127.0.0.1:8788` in `worker/.dev.vars`.

4. Start services in separate terminals.
- Terminal A: `npm run server:dev`.
- Terminal B: `npm run worker:dev`.
- Terminal C: `npm run dev:proxy`.

5. Verify health.
- Check `http://localhost:8788/health`.
- Check `http://localhost:8788/ready`.
- Open `http://localhost:3000`.

6. Run optional validation.
- Run `npm run test` for headless E2E checks when requested.
- Use targeted E2E files for scenario-specific regressions.

7. Teardown when finished.
- Stop local app processes.
- Run `docker compose stop postgres redis` or `docker compose down`.

## Troubleshooting

- Read `references/startup-sequence.md` for exact startup order.
- Read `references/troubleshooting.md` for common failures and recovery commands.

## Safety

- Never commit `server/.env` or `worker/.dev.vars`.
- Keep `ALLOW_INSECURE_DEV_AUTH=true` only for local development.
- Do not use local insecure defaults as production guidance.
