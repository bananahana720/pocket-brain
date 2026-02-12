# PocketBrain Memory

## Session: 2026-02-12 (VPS operations + reliability hardening continuity)

### Locked environment facts
- VPS host: `15.204.218.124`
- VPS user: `ubuntu`
- Project path on VPS: `/opt/pocket-brain`
- Primary local-to-remote entrypoint: `scripts/deploy-vps-remote.sh`

### New operational commands
- `npm run vps:precheck:remote`
- `npm run vps:sync:remote`
- `npm run vps:deploy:remote`

### Recommended run order for remote operations
1. Run precheck to validate SSH connectivity and remote repo layout.
2. Run sync-only when you only need `git pull --ff-only`.
3. Run full deploy for container rebuild + schema apply + readiness verification.

### Observed failure modes and fixes
- Symptom: deploy fails during schema apply with `FATAL: database "pocketbrain" does not exist`.
  - Fix: create DB `pocketbrain` on VPS Postgres, then rerun deploy.
- Symptom: `http://127.0.0.1:8080/ready` returns `404`, but API readiness on `:8788/ready` is healthy.
  - Fix: verify nginx config mounted inside container, sync corrected `nginx/nginx.conf`, and recreate nginx container.
- Symptom: nginx fails to start with config validation errors.
  - Fix: remove invalid `log_format` placement from server block in `nginx/nginx.conf`.

### Post-session residuals to reconcile
- VPS repo drift observed after successful deploy:
  - modified tracked file: `nginx/nginx.conf`
  - untracked file: `docker-compose.yml.bak`
- Follow-up: clean remote drift before future pulls to keep deploy state deterministic.

### Reliability hardening continuity notes
- Metrics and chaos testing paths were expanded in this session context; maintain dedicated chaos validation separate from default server tests.
- Keep `/ready` diagnostics and `/metrics` scrape path behavior aligned so readiness gating and observability remain independent.
