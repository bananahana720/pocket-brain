#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DEPLOY_WORKER=false
SKIP_PULL=false

for arg in "$@"; do
  case "$arg" in
    --with-worker)
      DEPLOY_WORKER=true
      ;;
    --skip-pull)
      SKIP_PULL=true
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: bash scripts/deploy-vps.sh [--with-worker] [--skip-pull]"
      exit 1
      ;;
  esac
done

echo "==> Deploying PocketBrain backend from: $ROOT_DIR"

if [[ "$SKIP_PULL" != "true" ]]; then
  echo "==> Pulling latest git changes"
  git pull --ff-only
fi

echo "==> Rebuilding and restarting containers"
docker compose up -d --build

echo "==> Applying database schema"
docker compose exec -T postgres psql -U postgres -d pocketbrain < server/drizzle/0000_initial.sql

echo "==> Health check: http://127.0.0.1:8080/health"
HEALTH_STATUS="$(curl -s -o /tmp/pocketbrain-health.json -w "%{http_code}" http://127.0.0.1:8080/health)"
if [[ "$HEALTH_STATUS" != "200" ]]; then
  echo "Health check failed with status $HEALTH_STATUS"
  cat /tmp/pocketbrain-health.json
  exit 1
fi
cat /tmp/pocketbrain-health.json

if [[ "$DEPLOY_WORKER" == "true" ]]; then
  echo "==> Deploying Cloudflare Worker"
  npm run worker:deploy
fi

echo "==> Deploy complete"
