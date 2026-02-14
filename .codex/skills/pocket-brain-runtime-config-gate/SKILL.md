---
name: pocket-brain-runtime-config-gate
description: Validate PocketBrain server and worker runtime configuration using the project config-gate scripts. Use when asked to run config checks, prepare a production deploy, debug auth or route-mode misconfiguration, verify secret-rotation safety, or troubleshoot runtime readiness failures caused by environment drift.
---

# PocketBrain Runtime Config Gate

Validate runtime configuration before deploy and after incident remediations.

## Workflow

1. Select validation scope.
- Choose `server`, `worker`, or `all` based on requested task or changed files.

2. Prepare server env for production-style checks.
- Run `bash scripts/render-server-env.sh --mode production --source .env --output server/.env`.
- Stop immediately and report if render fails.

3. Run runtime validators.
- Run `NODE_ENV=production npm run config:check:server` for server-only checks.
- Run `NODE_ENV=production npm run config:check:worker` for worker-only checks.
- Run `NODE_ENV=production npm run config:check` for full checks.

4. Classify and remediate failures.
- Read `references/required-checks.md` for rule coverage.
- Read `references/remediation-map.md` for failure-to-fix mappings.
- Propose the smallest safe fix and rerun the same command.

5. Confirm gate status.
- Report pass/fail for each checked scope.
- Provide the exact rerun command for reproducibility.

## Reporting

Return:
- Scope and commands run.
- Validation errors grouped by server/worker.
- Remediation steps.
- Final gate verdict.

## Safety

- Never print raw secret values from `.env`, `server/.env`, or worker secrets.
- Never commit generated `server/.env`.
- Prefer route-mode safe defaults: declared `routes` or `WORKER_ROUTE_MODE=dashboard`.
