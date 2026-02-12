#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is required."
  echo "Create one: https://developers.cloudflare.com/fundamentals/api/get-started/create-token/"
  exit 1
fi

if [[ -n "${CF_API_TOKEN:-}" ]]; then
  echo "CF_API_TOKEN is set, but this script uses CLOUDFLARE_API_TOKEN."
  echo "Export CLOUDFLARE_API_TOKEN and retry."
  exit 1
fi

if [[ -z "${KEY_ENCRYPTION_SECRET:-}" ]]; then
  echo "KEY_ENCRYPTION_SECRET is required."
  echo "Generate one (example): openssl rand -hex 32"
  exit 1
fi

echo "Validating worker runtime config..."
NODE_ENV=production npm run config:check:worker

XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$ROOT_DIR/.wrangler-home}"
export XDG_CONFIG_HOME
export WRANGLER_SEND_METRICS=false

if grep -q 'REPLACE_WITH_ACCOUNT_ID' worker/wrangler.toml; then
  if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
    echo "CLOUDFLARE_ACCOUNT_ID is required because worker/wrangler.toml still has REPLACE_WITH_ACCOUNT_ID."
    echo "Set it and rerun. Example: export CLOUDFLARE_ACCOUNT_ID=your_account_id"
    exit 1
  fi
  sed -i.bak "s/account_id = \"REPLACE_WITH_ACCOUNT_ID\"/account_id = \"$CLOUDFLARE_ACCOUNT_ID\"/" worker/wrangler.toml
  rm -f worker/wrangler.toml.bak
  echo "Updated worker/wrangler.toml with account_id: $CLOUDFLARE_ACCOUNT_ID"
fi

if grep -q 'REPLACE_WITH_KV_NAMESPACE_ID' worker/wrangler.toml; then
  echo "Creating KV namespace AI_SESSIONS..."
  KV_OUTPUT="$(npx wrangler kv namespace create AI_SESSIONS --config worker/wrangler.toml 2>&1 || true)"
  echo "$KV_OUTPUT"

  if printf '%s\n' "$KV_OUTPUT" | grep -Eq 'Unable to authenticate request|Authentication failed|code: 10001|code: 9106'; then
    echo "Authentication failed against Cloudflare API."
    echo "Verify CLOUDFLARE_API_TOKEN permissions and that it belongs to account_id in worker/wrangler.toml."
    echo "Required scopes: Workers Scripts Write, Workers KV Storage Write, Account Settings Read, Memberships Read, User Details Read."
    exit 1
  fi

  KV_ID="$(printf '%s\n' "$KV_OUTPUT" | sed -n 's/.*id = "\([^"]*\)".*/\1/p' | head -n1)"
  if [[ -z "$KV_ID" ]]; then
    echo "Failed to parse KV namespace id. Update worker/wrangler.toml manually."
    exit 1
  fi

  sed -i.bak "s/id = \"REPLACE_WITH_KV_NAMESPACE_ID\"/id = \"$KV_ID\"/" worker/wrangler.toml
  rm -f worker/wrangler.toml.bak
  echo "Updated worker/wrangler.toml with KV id: $KV_ID"
else
  echo "KV namespace id already set in worker/wrangler.toml."
fi

echo "Setting KEY_ENCRYPTION_SECRET..."
printf '%s' "$KEY_ENCRYPTION_SECRET" | npx wrangler secret put KEY_ENCRYPTION_SECRET --config worker/wrangler.toml

echo "Deploying worker..."
npx wrangler deploy --config worker/wrangler.toml

echo "Done. Route /api/* to this worker in Cloudflare dashboard if not already configured."
