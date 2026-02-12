#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DEPLOY_WORKER=false
SKIP_PULL=false
READY_RETRIES="${VPS_READY_RETRIES:-30}"
READY_DELAY_SECONDS="${VPS_READY_DELAY_SECONDS:-2}"
POSTGRES_READY_RETRIES="${VPS_POSTGRES_READY_RETRIES:-20}"
POSTGRES_READY_DELAY_SECONDS="${VPS_POSTGRES_READY_DELAY_SECONDS:-2}"
DEPLOY_LOCK_FILE="${VPS_DEPLOY_LOCK_FILE:-/tmp/pocketbrain-deploy.lock}"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/deploy-vps.sh [options]

Options:
  --with-worker             Also deploy the Cloudflare Worker after backend checks.
  --skip-pull               Skip git pull.
  --ready-retries <count>   Readiness retry attempts for API/nginx checks (default: 30).
  --ready-delay <seconds>   Delay between readiness retries (default: 2).
  --help                    Show this help text.
EOF
}

validate_positive_integer() {
  local value="$1"
  local label="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -lt 1 ]]; then
    echo "Invalid ${label}: ${value} (expected integer >= 1)." >&2
    exit 1
  fi
}

collect_runtime_diagnostics() {
  echo "==> docker compose ps"
  docker compose ps || true
  echo "==> Recent API logs"
  docker compose logs --tail=200 api || true
  echo "==> Recent nginx logs"
  docker compose logs --tail=200 nginx || true
  echo "==> Recent postgres logs"
  docker compose logs --tail=120 postgres || true
}

wait_for_postgres() {
  for attempt in $(seq 1 "$POSTGRES_READY_RETRIES"); do
    if docker compose exec -T postgres pg_isready -U postgres -d postgres >/dev/null 2>&1; then
      return 0
    fi
    sleep "$POSTGRES_READY_DELAY_SECONDS"
  done
  echo "Postgres did not become ready after ${POSTGRES_READY_RETRIES} attempt(s)." >&2
  return 1
}

ensure_database_exists() {
  local db_exists
  db_exists="$(docker compose exec -T postgres psql -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='pocketbrain';" | tr -d '[:space:]' || true)"
  if [[ "$db_exists" == "1" ]]; then
    echo "==> Database pocketbrain exists"
    return 0
  fi

  echo "==> Creating database pocketbrain"
  docker compose exec -T postgres psql -U postgres -d postgres -c "CREATE DATABASE pocketbrain;"
}

wait_for_http_200() {
  local url="$1"
  local output_file="$2"
  local label="$3"
  local status=""

  echo "==> Readiness check: ${url}"
  for attempt in $(seq 1 "$READY_RETRIES"); do
    status="$(curl -s -o "$output_file" -w "%{http_code}" "$url" || true)"
    if [[ "$status" == "200" ]]; then
      echo "${label}_status=200 (attempt ${attempt}/${READY_RETRIES})"
      cat "$output_file"
      return 0
    fi
    sleep "$READY_DELAY_SECONDS"
  done

  echo "${label}_status=${status} after ${READY_RETRIES} attempt(s)" >&2
  if [[ -f "$output_file" ]]; then
    cat "$output_file"
  fi
  return 1
}

acquire_deploy_lock() {
  if ! command -v flock >/dev/null 2>&1; then
    echo "==> flock not found; deploy lock disabled"
    return 0
  fi

  exec 9>"$DEPLOY_LOCK_FILE"
  if ! flock -n 9; then
    echo "Another deploy is already running (lock: $DEPLOY_LOCK_FILE)." >&2
    exit 1
  fi

  echo "==> Acquired deploy lock: $DEPLOY_LOCK_FILE"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-worker)
      DEPLOY_WORKER=true
      shift
      ;;
    --skip-pull)
      SKIP_PULL=true
      shift
      ;;
    --ready-retries)
      READY_RETRIES="${2:-}"
      shift 2
      ;;
    --ready-delay)
      READY_DELAY_SECONDS="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

validate_positive_integer "$READY_RETRIES" "ready retry count"
validate_positive_integer "$READY_DELAY_SECONDS" "ready retry delay"
validate_positive_integer "$POSTGRES_READY_RETRIES" "postgres retry count"
validate_positive_integer "$POSTGRES_READY_DELAY_SECONDS" "postgres retry delay"

echo "==> Deploying PocketBrain backend from: $ROOT_DIR"
echo "==> Readiness retries: ${READY_RETRIES} (delay ${READY_DELAY_SECONDS}s)"
acquire_deploy_lock

if [[ "$SKIP_PULL" != "true" ]]; then
  echo "==> Pulling latest git changes"
  git pull --ff-only
fi

echo "==> Rendering server/.env from root .env"
bash scripts/render-server-env.sh --mode production --source .env --output server/.env

echo "==> Validating server runtime config"
NODE_ENV=production npm run config:check:server

if [[ "$DEPLOY_WORKER" == "true" ]]; then
  echo "==> Validating worker runtime config"
  NODE_ENV=production npm run config:check:worker
fi

echo "==> Validating Docker Compose configuration"
docker compose config -q

echo "==> Rebuilding and restarting containers"
docker compose up -d --build

echo "==> Waiting for postgres to become reachable"
if ! wait_for_postgres; then
  collect_runtime_diagnostics
  exit 1
fi

echo "==> Ensuring database exists"
if ! ensure_database_exists; then
  collect_runtime_diagnostics
  exit 1
fi

echo "==> Applying database schema"
if ! docker compose exec -T postgres psql -U postgres -d pocketbrain < server/drizzle/0000_initial.sql; then
  collect_runtime_diagnostics
  exit 1
fi

API_READY_FILE="/tmp/pocketbrain-api-ready.json"
NGINX_READY_FILE="/tmp/pocketbrain-nginx-ready.json"

if ! wait_for_http_200 "http://127.0.0.1:8788/ready" "$API_READY_FILE" "api_ready"; then
  collect_runtime_diagnostics
  exit 1
fi

if ! wait_for_http_200 "http://127.0.0.1:8080/ready" "$NGINX_READY_FILE" "nginx_ready"; then
  collect_runtime_diagnostics
  exit 1
fi

if [[ "$DEPLOY_WORKER" == "true" ]]; then
  echo "==> Deploying Cloudflare Worker"
  npm run worker:deploy
fi

echo "==> Deploy complete"
