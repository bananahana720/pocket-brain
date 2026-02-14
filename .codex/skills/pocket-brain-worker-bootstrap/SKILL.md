---
name: pocket-brain-worker-bootstrap
description: Bootstrap and deploy the PocketBrain Cloudflare Worker with KV namespace and encryption secret setup. Use when asked to perform first-time worker setup, configure AI_SESSIONS KV, set KEY_ENCRYPTION_SECRET, rotate worker keys, or troubleshoot worker bootstrap authentication and config failures.
---

# PocketBrain Worker Bootstrap

Bootstrap worker infrastructure safely and verify deployment prerequisites before release.

## Workflow

1. Confirm bootstrap prerequisites.
- Read `references/bootstrap-prereqs.md`.
- Require `CLOUDFLARE_API_TOKEN` and `KEY_ENCRYPTION_SECRET`.
- Require `CLOUDFLARE_ACCOUNT_ID` only when `worker/wrangler.toml` still has placeholder account ID.

2. Run preflight runtime checks.
- Run `NODE_ENV=production npm run config:check:worker`.
- Stop and report if preflight fails.

3. Execute bootstrap.
- Run `npm run worker:bootstrap`.
- Allow script-managed KV creation and secret setup to complete.

4. Validate result.
- Confirm deploy command exits cleanly.
- Confirm no placeholder values remain in `worker/wrangler.toml` when bootstrap expected replacements.

5. Handle rotation tasks when requested.
- Read `references/key-rotation.md`.
- Execute overlap-secret rotation sequence exactly and remove previous secret after TTL window.

## Reporting

Return:
- Prerequisite check result.
- Bootstrap command result.
- Any unresolved manual action (for example, route configuration in Cloudflare dashboard).
- Rotation status when applicable.

## Safety

- Never echo secret values in output.
- Never commit `worker/.dev.vars` or any live secret material.
- Never remove `KEY_ENCRYPTION_SECRET_PREV` until the active session TTL window is covered.
