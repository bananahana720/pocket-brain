# Worker Bootstrap Prerequisites

Bootstrap script source: `scripts/bootstrap-worker.sh`.

## Required environment variables

- `CLOUDFLARE_API_TOKEN`
- `KEY_ENCRYPTION_SECRET`

Conditionally required:

- `CLOUDFLARE_ACCOUNT_ID` when `worker/wrangler.toml` still has `REPLACE_WITH_ACCOUNT_ID`.

## Required local state

- Valid `worker/wrangler.toml` exists.
- Node/npm available.
- `npm run config:check:worker` passes in production mode before bootstrap.

## Cloudflare token scope guidance

If bootstrap fails with auth errors, ensure token includes:

- Workers Scripts Write
- Workers KV Storage Write
- Account Settings Read
- Memberships Read
- User Details Read

## Bootstrap command

`npm run worker:bootstrap`

Expected behavior:

- Validates worker runtime config.
- Replaces account placeholder when needed.
- Creates `AI_SESSIONS` KV namespace when needed.
- Sets `KEY_ENCRYPTION_SECRET`.
- Deploys worker.
