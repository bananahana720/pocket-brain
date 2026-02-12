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

echo "==> Validating server runtime config"
NODE_ENV=production npm run config:check:server

if [[ "$DEPLOY_WORKER" == "true" ]]; then
  echo "==> Validating worker runtime config"
  NODE_ENV=production npm run config:check:worker
fi

echo "==> Rebuilding and restarting containers"
docker compose up -d --build

echo "==> Applying database schema"
docker compose exec -T postgres psql -U postgres -d pocketbrain < server/drizzle/0000_initial.sql

echo "==> Readiness check: http://127.0.0.1:8080/ready"
HEALTH_STATUS=""
for attempt in {1..30}; do
  HEALTH_STATUS="$(curl -s -o /tmp/pocketbrain-health.json -w "%{http_code}" http://127.0.0.1:8080/ready || true)"
  if [[ "$HEALTH_STATUS" == "200" ]]; then
    break
  fi
  sleep 2
done

if [[ "$HEALTH_STATUS" != "200" ]]; then
  echo "Health check failed with status $HEALTH_STATUS after retries"
  cat /tmp/pocketbrain-health.json
  echo "==> Recent API logs"
  docker compose logs --tail=120 api || true
  exit 1
fi
cat /tmp/pocketbrain-health.json

if [[ "$DEPLOY_WORKER" == "true" ]]; then
  echo "==> Deploying Cloudflare Worker"
  npm run worker:deploy
fi

echo "==> Deploy complete"
