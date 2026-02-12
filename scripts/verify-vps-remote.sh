#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/load-vps-env.sh"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/verify-vps-remote.sh [options]

Options:
  --host <user@hostname>    SSH target. Defaults to VPS_SSH_HOST env var.
  --path <remote-path>      Remote PocketBrain repo path. Defaults to VPS_PROJECT_DIR env var.
  --port <port>             SSH port. Defaults to VPS_SSH_PORT env var or 22.
  --identity <file>         SSH private key path. Defaults to VPS_SSH_IDENTITY env var.
  --ssh-retries <count>     SSH retry attempts for verification command.
  --ready-retries <count>   Readiness retries on remote host. Default: 30.
  --ready-delay <seconds>   Delay between readiness retries. Default: 2.
  --help                    Show this help text.

The script auto-loads VPS vars from `.vps-remote.env` (preferred) and `.env`.
EOF
}

escape_single_quotes() {
  printf "%s" "$1" | sed "s/'/'\\\\''/g"
}

quote_for_shell() {
  printf "'%s'" "$(escape_single_quotes "$1")"
}

VPS_HOST="${VPS_SSH_HOST:-}"
PROJECT_DIR="${VPS_PROJECT_DIR:-}"
SSH_PORT="${VPS_SSH_PORT:-22}"
SSH_IDENTITY="${VPS_SSH_IDENTITY:-}"
SSH_RETRIES="${VPS_SSH_RETRY_ATTEMPTS:-3}"
READY_RETRIES="${VPS_READY_RETRIES:-30}"
READY_DELAY_SECONDS="${VPS_READY_DELAY_SECONDS:-2}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      VPS_HOST="${2:-}"
      shift 2
      ;;
    --path)
      PROJECT_DIR="${2:-}"
      shift 2
      ;;
    --port)
      SSH_PORT="${2:-}"
      shift 2
      ;;
    --identity)
      SSH_IDENTITY="${2:-}"
      shift 2
      ;;
    --ssh-retries)
      SSH_RETRIES="${2:-}"
      shift 2
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

if [[ -z "$VPS_HOST" ]]; then
  echo "Missing VPS host. Set --host or VPS_SSH_HOST." >&2
  exit 1
fi

if [[ -z "$PROJECT_DIR" ]]; then
  echo "Missing remote project path. Set --path or VPS_PROJECT_DIR." >&2
  exit 1
fi

if ! [[ "$SSH_RETRIES" =~ ^[0-9]+$ ]] || [[ "$SSH_RETRIES" -lt 1 ]]; then
  echo "Invalid SSH retry count: $SSH_RETRIES (expected integer >= 1)." >&2
  exit 1
fi
if ! [[ "$READY_RETRIES" =~ ^[0-9]+$ ]] || [[ "$READY_RETRIES" -lt 1 ]]; then
  echo "Invalid ready retry count: $READY_RETRIES (expected integer >= 1)." >&2
  exit 1
fi
if ! [[ "$READY_DELAY_SECONDS" =~ ^[0-9]+$ ]] || [[ "$READY_DELAY_SECONDS" -lt 1 ]]; then
  echo "Invalid ready retry delay: $READY_DELAY_SECONDS (expected integer >= 1)." >&2
  exit 1
fi

SSH_ARGS=(
  -p "$SSH_PORT"
  -o BatchMode=yes
  -o ConnectTimeout=10
)

if [[ -n "$SSH_IDENTITY" ]]; then
  SSH_ARGS+=(-i "$SSH_IDENTITY")
fi

REMOTE_PROJECT_DIR="$(quote_for_shell "$PROJECT_DIR")"

run_ssh() {
  local remote_cmd="$1"
  local label="$2"
  local attempts="${3:-$SSH_RETRIES}"
  local attempt=1
  local exit_code=0

  while (( attempt <= attempts )); do
    if ssh "${SSH_ARGS[@]}" "$VPS_HOST" "$remote_cmd"; then
      return 0
    else
      exit_code=$?
    fi
    if (( attempt == attempts )); then
      echo "Remote command failed after ${attempts} attempt(s): $label" >&2
      return "$exit_code"
    fi
    local delay=$((attempt * 2))
    echo "Remote command failed (${label}), retrying in ${delay}s (${attempt}/${attempts})..." >&2
    sleep "$delay"
    attempt=$((attempt + 1))
  done

  return "$exit_code"
}

echo "==> Verifying remote deploy target: $VPS_HOST ($PROJECT_DIR)"
echo "==> Ready retries: $READY_RETRIES (delay ${READY_DELAY_SECONDS}s)"
REMOTE_VERIFY_CMD="$(cat <<EOF
set -euo pipefail
cd $REMOTE_PROJECT_DIR

echo "remote_head=\$(git rev-parse --short HEAD)"
if [[ -n "\$(git status --porcelain)" ]]; then
  echo "remote_repo_status=dirty"
  git status --short
else
  echo "remote_repo_status=clean"
fi

READY_STATUS=""
for attempt in \$(seq 1 $READY_RETRIES); do
  READY_STATUS=\$(curl -s -o /tmp/pocketbrain-ready.json -w "%{http_code}" http://127.0.0.1:8080/ready || true)
  if [[ "\$READY_STATUS" == "200" ]]; then
    break
  fi
  sleep $READY_DELAY_SECONDS
done
echo "ready_status=\$READY_STATUS"
echo "ready_summary="
cat /tmp/pocketbrain-ready.json || true

API_READY_STATUS=\$(curl -s -o /tmp/pocketbrain-api-ready.json -w "%{http_code}" http://127.0.0.1:8788/ready || true)
echo "api_ready_status=\$API_READY_STATUS"
echo "api_ready_summary="
cat /tmp/pocketbrain-api-ready.json || true

HEALTH_STATUS=\$(curl -s -o /tmp/pocketbrain-health.json -w "%{http_code}" http://127.0.0.1:8080/health || true)
echo "health_status=\$HEALTH_STATUS"
ROOT_STATUS=\$(curl -s -o /tmp/pocketbrain-root-body.txt -w "%{http_code}" http://127.0.0.1:8080/ || true)
echo "root_status=\$ROOT_STATUS"

if [[ "\$READY_STATUS" != "200" || "\$API_READY_STATUS" != "200" ]]; then
  echo "compose_ps="
  docker compose ps || true
  echo "api_logs_tail="
  docker compose logs --tail=120 api || true
  echo "nginx_logs_tail="
  docker compose logs --tail=120 nginx || true
fi

[[ "\$READY_STATUS" == "200" && "\$API_READY_STATUS" == "200" ]]
EOF
)"

run_ssh "$REMOTE_VERIFY_CMD" "remote_verify"

echo "==> Remote verification complete"
