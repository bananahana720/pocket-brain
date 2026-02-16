#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ENV="$ROOT_DIR/.env"
OUTPUT_ENV="$ROOT_DIR/server/.env"
MODE="production"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/render-server-env.sh [options]

Options:
  --source <path>    Source env file (default: ./.env)
  --output <path>    Output env file (default: ./server/.env)
  --mode <mode>      Render mode: production|development (default: production)
  --help             Show this help text.
EOF
}

resolve_path() {
  local input="$1"
  if [[ "$input" = /* ]]; then
    printf "%s" "$input"
  else
    printf "%s/%s" "$ROOT_DIR" "$input"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      SOURCE_ENV="$(resolve_path "${2:-}")"
      shift 2
      ;;
    --output)
      OUTPUT_ENV="$(resolve_path "${2:-}")"
      shift 2
      ;;
    --mode)
      MODE="${2:-}"
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

if [[ "$MODE" != "production" && "$MODE" != "development" ]]; then
  echo "Unsupported --mode value: $MODE" >&2
  exit 1
fi

if [[ ! -f "$SOURCE_ENV" ]]; then
  echo "Source env file not found: $SOURCE_ENV" >&2
  exit 1
fi

read_env_value() {
  local key="$1"
  local value
  value="$(grep -E "^${key}=" "$SOURCE_ENV" | tail -n1 | cut -d= -f2- || true)"
  printf "%s" "$value"
}

is_placeholder() {
  local value
  value="$(printf "%s" "$1" | tr '[:upper:]' '[:lower:]')"
  if [[ -z "$value" ]]; then
    return 0
  fi
  if [[ "$value" == *"replace-with"* || "$value" == *"your-"* || "$value" == *"example"* ]]; then
    return 0
  fi
  return 1
}

KEY_ENCRYPTION_SECRET="$(read_env_value KEY_ENCRYPTION_SECRET)"
MIN_SECRET_LEN=16
if [[ "$MODE" == "production" ]]; then
  MIN_SECRET_LEN=32
fi
if is_placeholder "$KEY_ENCRYPTION_SECRET" || [[ ${#KEY_ENCRYPTION_SECRET} -lt "$MIN_SECRET_LEN" ]]; then
  echo "KEY_ENCRYPTION_SECRET must be set in $SOURCE_ENV with at least $MIN_SECRET_LEN non-placeholder chars." >&2
  exit 1
fi

CLERK_SECRET_KEY="$(read_env_value CLERK_SECRET_KEY)"
ALLOW_INSECURE_DEV_AUTH="$(read_env_value ALLOW_INSECURE_DEV_AUTH)"
if [[ "$MODE" == "production" ]]; then
  ALLOW_INSECURE_DEV_AUTH="false"
  if [[ -z "$CLERK_SECRET_KEY" ]]; then
    echo "CLERK_SECRET_KEY must be set in $SOURCE_ENV for production mode." >&2
    exit 1
  fi
fi
if [[ -z "$ALLOW_INSECURE_DEV_AUTH" ]]; then
  ALLOW_INSECURE_DEV_AUTH="true"
fi

STREAM_TICKET_SECRET="$(read_env_value STREAM_TICKET_SECRET)"
if is_placeholder "$STREAM_TICKET_SECRET" || [[ ${#STREAM_TICKET_SECRET} -lt 16 ]]; then
  STREAM_TICKET_SECRET="$KEY_ENCRYPTION_SECRET"
fi

POSTGRES_DB="$(read_env_value POSTGRES_DB)"
if [[ -z "$POSTGRES_DB" ]]; then
  POSTGRES_DB="pocketbrain"
fi

POSTGRES_USER="$(read_env_value POSTGRES_USER)"
if [[ -z "$POSTGRES_USER" ]]; then
  POSTGRES_USER="postgres"
fi

POSTGRES_PASSWORD="$(read_env_value POSTGRES_PASSWORD)"

DATABASE_URL="$(read_env_value DATABASE_URL)"
if [[ -z "$DATABASE_URL" ]]; then
  if [[ "$MODE" == "production" ]]; then
    if [[ -z "$POSTGRES_PASSWORD" || "$POSTGRES_PASSWORD" == "postgres" ]]; then
      echo "DATABASE_URL is missing and POSTGRES_PASSWORD is not set to a non-default value in $SOURCE_ENV for production mode." >&2
      exit 1
    fi
    DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}"
  else
    if [[ -z "$POSTGRES_PASSWORD" ]]; then
      POSTGRES_PASSWORD="postgres"
    fi
    DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}"
  fi
fi

REDIS_URL="$(read_env_value REDIS_URL)"
if [[ -z "$REDIS_URL" ]]; then
  if [[ "$MODE" == "production" ]]; then
    REDIS_URL="redis://redis:6379"
  else
    REDIS_URL="redis://localhost:6379"
  fi
fi

REQUIRE_REDIS_FOR_READY="$(read_env_value REQUIRE_REDIS_FOR_READY)"
if [[ -z "$REQUIRE_REDIS_FOR_READY" ]]; then
  if [[ "$MODE" == "production" ]]; then
    REQUIRE_REDIS_FOR_READY="true"
  else
    REQUIRE_REDIS_FOR_READY="false"
  fi
fi

NODE_ENV_VALUE="$MODE"
if [[ "$MODE" == "development" ]]; then
  NODE_ENV_VALUE="development"
fi

SERVER_HOST="$(read_env_value SERVER_HOST)"
if [[ -z "$SERVER_HOST" ]]; then
  SERVER_HOST="0.0.0.0"
fi
SERVER_PORT="$(read_env_value SERVER_PORT)"
if [[ -z "$SERVER_PORT" ]]; then
  SERVER_PORT="8788"
fi
CORS_ORIGIN="$(read_env_value CORS_ORIGIN)"
if [[ -z "$CORS_ORIGIN" ]]; then
  if [[ "$MODE" == "production" ]]; then
    echo "CORS_ORIGIN must be set in $SOURCE_ENV for production mode." >&2
    exit 1
  else
    CORS_ORIGIN="http://localhost:3000"
  fi
fi
TRUST_PROXY="$(read_env_value TRUST_PROXY)"
if [[ -z "$TRUST_PROXY" ]]; then
  TRUST_PROXY="true"
fi

STREAM_TICKET_TTL_SECONDS="$(read_env_value STREAM_TICKET_TTL_SECONDS)"
MAINTENANCE_INTERVAL_MS="$(read_env_value MAINTENANCE_INTERVAL_MS)"
TOMBSTONE_RETENTION_MS="$(read_env_value TOMBSTONE_RETENTION_MS)"
NOTE_CHANGES_RETENTION_MS="$(read_env_value NOTE_CHANGES_RETENTION_MS)"
if [[ -z "$NOTE_CHANGES_RETENTION_MS" ]]; then
  NOTE_CHANGES_RETENTION_MS="$((45 * 24 * 60 * 60 * 1000))"
fi
PG_POOL_MAX="$(read_env_value PG_POOL_MAX)"
PG_POOL_IDLE_TIMEOUT_MS="$(read_env_value PG_POOL_IDLE_TIMEOUT_MS)"
PG_POOL_CONNECTION_TIMEOUT_MS="$(read_env_value PG_POOL_CONNECTION_TIMEOUT_MS)"
SYNC_BATCH_LIMIT="$(read_env_value SYNC_BATCH_LIMIT)"
SYNC_PULL_LIMIT="$(read_env_value SYNC_PULL_LIMIT)"
LOG_LEVEL="$(read_env_value LOG_LEVEL)"
AUTH_DEV_USER_ID="$(read_env_value AUTH_DEV_USER_ID)"
CLERK_PUBLISHABLE_KEY="$(read_env_value CLERK_PUBLISHABLE_KEY)"

mkdir -p "$(dirname "$OUTPUT_ENV")"
umask 077

{
  echo "# Generated by scripts/render-server-env.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "NODE_ENV=$NODE_ENV_VALUE"
  echo "SERVER_HOST=$SERVER_HOST"
  echo "SERVER_PORT=$SERVER_PORT"
  echo "DATABASE_URL=$DATABASE_URL"
  echo "REDIS_URL=$REDIS_URL"
  echo "CORS_ORIGIN=$CORS_ORIGIN"
  echo "TRUST_PROXY=$TRUST_PROXY"
  echo "ALLOW_INSECURE_DEV_AUTH=$ALLOW_INSECURE_DEV_AUTH"
  echo "KEY_ENCRYPTION_SECRET=$KEY_ENCRYPTION_SECRET"
  echo "STREAM_TICKET_SECRET=$STREAM_TICKET_SECRET"
  echo "CLERK_SECRET_KEY=$CLERK_SECRET_KEY"
  echo "CLERK_PUBLISHABLE_KEY=$CLERK_PUBLISHABLE_KEY"
  echo "REQUIRE_REDIS_FOR_READY=$REQUIRE_REDIS_FOR_READY"
  [[ -n "$STREAM_TICKET_TTL_SECONDS" ]] && echo "STREAM_TICKET_TTL_SECONDS=$STREAM_TICKET_TTL_SECONDS"
  [[ -n "$MAINTENANCE_INTERVAL_MS" ]] && echo "MAINTENANCE_INTERVAL_MS=$MAINTENANCE_INTERVAL_MS"
  [[ -n "$TOMBSTONE_RETENTION_MS" ]] && echo "TOMBSTONE_RETENTION_MS=$TOMBSTONE_RETENTION_MS"
  echo "NOTE_CHANGES_RETENTION_MS=$NOTE_CHANGES_RETENTION_MS"
  [[ -n "$PG_POOL_MAX" ]] && echo "PG_POOL_MAX=$PG_POOL_MAX"
  [[ -n "$PG_POOL_IDLE_TIMEOUT_MS" ]] && echo "PG_POOL_IDLE_TIMEOUT_MS=$PG_POOL_IDLE_TIMEOUT_MS"
  [[ -n "$PG_POOL_CONNECTION_TIMEOUT_MS" ]] && echo "PG_POOL_CONNECTION_TIMEOUT_MS=$PG_POOL_CONNECTION_TIMEOUT_MS"
  [[ -n "$SYNC_BATCH_LIMIT" ]] && echo "SYNC_BATCH_LIMIT=$SYNC_BATCH_LIMIT"
  [[ -n "$SYNC_PULL_LIMIT" ]] && echo "SYNC_PULL_LIMIT=$SYNC_PULL_LIMIT"
  [[ -n "$LOG_LEVEL" ]] && echo "LOG_LEVEL=$LOG_LEVEL"
  [[ -n "$AUTH_DEV_USER_ID" ]] && echo "AUTH_DEV_USER_ID=$AUTH_DEV_USER_ID"
} > "$OUTPUT_ENV"

chmod 600 "$OUTPUT_ENV"
echo "Rendered $OUTPUT_ENV from $SOURCE_ENV ($MODE mode)."
