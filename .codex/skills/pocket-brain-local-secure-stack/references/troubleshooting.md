# Local Secure Stack Troubleshooting

## Common failures

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `npm run server:dev` fails to connect to Postgres | Postgres container not ready or env mismatch | Run `docker compose ps`; restart DB services; confirm `server/.env` values. |
| Worker auth or proxy calls fail locally | Missing or incorrect `VPS_API_ORIGIN` in `worker/.dev.vars` | Set `VPS_API_ORIGIN=http://127.0.0.1:8788` and restart worker. |
| Frontend requests bypass worker proxy | Frontend started with `npm run dev` instead of proxy mode | Restart with `npm run dev:proxy`. |
| `:8788/ready` is non-200 | Redis or DB dependency degraded | Inspect server logs and dependency containers; recover DB/Redis first. |
| E2E tests fail on boot | Stack not fully started before test run | Wait for `:8788/ready` and app load, then rerun tests. |

## Quick recovery commands

- Restart infra: `docker compose restart postgres redis`
- Restart backend: rerun `npm run server:dev`
- Restart worker: rerun `npm run worker:dev`
- Restart frontend proxy: rerun `npm run dev:proxy`

## Safety notes

- Keep local-only secrets in local files (`server/.env`, `worker/.dev.vars`).
- Do not commit generated env files.
- Do not carry local insecure auth settings to production environments.
