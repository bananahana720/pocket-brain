#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/load-vps-env.sh"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/deploy-vps-remote.sh [options]

Options:
  --host <user@hostname>    SSH target. Defaults to VPS_SSH_HOST env var.
  --path <remote-path>      Remote PocketBrain repo path. Defaults to VPS_PROJECT_DIR env var.
  --port <port>             SSH port. Defaults to VPS_SSH_PORT env var or 22.
  --identity <file>         SSH private key path. Defaults to VPS_SSH_IDENTITY env var.
  --ssh-retries <count>     SSH retry attempts for precheck/validation commands.
  --allow-stash             If remote repo is dirty, stash tracked+untracked changes before sync/deploy.
  --with-worker             Passes --with-worker to remote deploy script.
  --skip-pull               Passes --skip-pull to remote deploy script.
  --ready-retries <count>   Readiness retries passed to remote deploy/verify checks.
  --ready-delay <seconds>   Readiness delay passed to remote deploy/verify checks.
  --public-base-url <url>   Optional base URL passed to post-deploy public API verification.
  --public-bearer <token>   Optional bearer token passed to post-deploy public API verification.
  --sync-only               Only run remote git pull --ff-only (no docker rebuild/redeploy).
  --precheck-only           Validate SSH and remote repo path, then exit.
  --help                    Show this help text.

Environment:
  VPS_SSH_HOST      Default SSH host (user@hostname)
  VPS_PROJECT_DIR   Default remote repo path
  VPS_SSH_PORT      Default SSH port
  VPS_SSH_IDENTITY  Default SSH identity file
  VPS_SSH_RETRY_ATTEMPTS  SSH retry attempts for remote precheck/validation steps
  VPS_POSTGRES_READY_RETRIES  Postgres readiness retries for remote deploy-vps.sh.
  VPS_POSTGRES_READY_DELAY_SECONDS  Postgres readiness delay for remote deploy-vps.sh.
  VPS_REDIS_READY_RETRIES  Redis readiness retries for remote deploy-vps.sh.
  VPS_REDIS_READY_DELAY_SECONDS  Redis readiness delay for remote deploy-vps.sh.
  VPS_PUBLIC_BASE_URL  Optional default for --public-base-url
  VPS_PUBLIC_BEARER  Optional default for --public-bearer
  VPS_PUBLIC_BEARER_TOKEN  Optional default for --public-bearer

The script auto-loads these vars from `.vps-remote.env` (preferred) and `.env`.

Examples:
  bash scripts/deploy-vps-remote.sh --host ubuntu@203.0.113.10 --path /srv/pocket-brain
  bash scripts/deploy-vps-remote.sh --with-worker
  bash scripts/deploy-vps-remote.sh --sync-only
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
POSTGRES_READY_RETRIES="${VPS_POSTGRES_READY_RETRIES:-20}"
POSTGRES_READY_DELAY_SECONDS="${VPS_POSTGRES_READY_DELAY_SECONDS:-2}"
REDIS_READY_RETRIES="${VPS_REDIS_READY_RETRIES:-20}"
REDIS_READY_DELAY_SECONDS="${VPS_REDIS_READY_DELAY_SECONDS:-2}"
PUBLIC_BASE_URL="${VPS_PUBLIC_BASE_URL:-}"
PUBLIC_BEARER="${VPS_PUBLIC_BEARER:-${VPS_PUBLIC_BEARER_TOKEN:-}}"
ALLOW_STASH=false
WITH_WORKER=false
SKIP_PULL=false
SYNC_ONLY=false
PRECHECK_ONLY=false

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
    --public-base-url)
      PUBLIC_BASE_URL="${2:-}"
      shift 2
      ;;
    --public-bearer)
      PUBLIC_BEARER="${2:-}"
      shift 2
      ;;
    --allow-stash)
      ALLOW_STASH=true
      shift
      ;;
    --with-worker)
      WITH_WORKER=true
      shift
      ;;
    --skip-pull)
      SKIP_PULL=true
      shift
      ;;
    --sync-only)
      SYNC_ONLY=true
      shift
      ;;
    --precheck-only)
      PRECHECK_ONLY=true
      shift
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
if ! [[ "$POSTGRES_READY_RETRIES" =~ ^[0-9]+$ ]] || [[ "$POSTGRES_READY_RETRIES" -lt 1 ]]; then
  echo "Invalid postgres retry count: $POSTGRES_READY_RETRIES (expected integer >= 1)." >&2
  exit 1
fi
if ! [[ "$POSTGRES_READY_DELAY_SECONDS" =~ ^[0-9]+$ ]] || [[ "$POSTGRES_READY_DELAY_SECONDS" -lt 1 ]]; then
  echo "Invalid postgres retry delay: $POSTGRES_READY_DELAY_SECONDS (expected integer >= 1)." >&2
  exit 1
fi
if ! [[ "$REDIS_READY_RETRIES" =~ ^[0-9]+$ ]] || [[ "$REDIS_READY_RETRIES" -lt 1 ]]; then
  echo "Invalid redis retry count: $REDIS_READY_RETRIES (expected integer >= 1)." >&2
  exit 1
fi
if ! [[ "$REDIS_READY_DELAY_SECONDS" =~ ^[0-9]+$ ]] || [[ "$REDIS_READY_DELAY_SECONDS" -lt 1 ]]; then
  echo "Invalid redis retry delay: $REDIS_READY_DELAY_SECONDS (expected integer >= 1)." >&2
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

collect_remote_runtime_diagnostics() {
  echo "==> Collecting remote runtime diagnostics"
  run_ssh "set -euo pipefail; cd $REMOTE_PROJECT_DIR; echo \"compose_ps=\"; docker compose ps || true; echo \"api_logs=\"; docker compose logs --tail=200 api || true; echo \"nginx_logs=\"; docker compose logs --tail=200 nginx || true; echo \"postgres_logs=\"; docker compose logs --tail=120 postgres || true" "remote_runtime_diagnostics" 1 || true
}

echo "==> Remote target: $VPS_HOST"
echo "==> Remote path: $PROJECT_DIR"
echo "==> SSH port: $SSH_PORT"
echo "==> SSH retries: $SSH_RETRIES"
echo "==> Ready retries: $READY_RETRIES (delay ${READY_DELAY_SECONDS}s)"
echo "==> Postgres retries: $POSTGRES_READY_RETRIES (delay ${POSTGRES_READY_DELAY_SECONDS}s)"
echo "==> Redis retries: $REDIS_READY_RETRIES (delay ${REDIS_READY_DELAY_SECONDS}s)"
if [[ -n "$SSH_IDENTITY" ]]; then
  echo "==> SSH identity: $SSH_IDENTITY"
fi

echo "==> Precheck: SSH connectivity"
run_ssh "echo connected" "ssh_connectivity"

echo "==> Precheck: repository layout"
run_ssh "set -euo pipefail; cd $REMOTE_PROJECT_DIR; test -d .git; test -x scripts/deploy-vps.sh || test -f scripts/deploy-vps.sh" "repo_layout"

echo "==> Precheck: runtime prerequisites"
run_ssh "set -euo pipefail; cd $REMOTE_PROJECT_DIR; command -v docker >/dev/null || { echo \"docker is missing on remote host\" >&2; exit 1; }; docker compose version >/dev/null || { echo \"docker compose is unavailable on remote host\" >&2; exit 1; }; command -v node >/dev/null || { echo \"node is missing on remote host\" >&2; exit 1; }; command -v npm >/dev/null || { echo \"npm is missing on remote host\" >&2; exit 1; }; command -v curl >/dev/null || { echo \"curl is missing on remote host\" >&2; exit 1; }; node -e \"const major=parseInt(process.versions.node.split('.')[0],10); if (!Number.isFinite(major) || major < 18) process.exit(1);\" || { echo \"node >= 18 is required on remote host\" >&2; exit 1; }; [[ -f .env ]] || { echo \"Missing .env at $PROJECT_DIR/.env\" >&2; exit 1; }; [[ -f docker-compose.yml ]] || { echo \"Missing docker-compose.yml at $PROJECT_DIR\" >&2; exit 1; }; [[ -f scripts/deploy-vps.sh ]] || { echo \"Missing scripts/deploy-vps.sh\" >&2; exit 1; }" "runtime_prerequisites" 1

if [[ "$PRECHECK_ONLY" == "true" ]]; then
  echo "==> Precheck complete"
  exit 0
fi

ensure_remote_repo_clean() {
  if [[ "$ALLOW_STASH" == "true" ]]; then
    echo "==> Checking remote repo cleanliness (auto-stash enabled)"
    run_ssh "set -euo pipefail; cd $REMOTE_PROJECT_DIR; if [[ -n \"\$(git status --porcelain)\" ]]; then echo \"Remote repo is dirty; creating stash before continuing\"; git status --short; STASH_NAME=\"codex-predeploy-\$(date +%Y%m%d-%H%M%S)\"; git stash push -u -m \"\$STASH_NAME\"; echo \"Created stash: \$STASH_NAME\"; fi" "repo_cleanliness_stash"
    return
  fi

  echo "==> Checking remote repo cleanliness"
  run_ssh "set -euo pipefail; cd $REMOTE_PROJECT_DIR; if [[ -n \"\$(git status --porcelain)\" ]]; then echo \"Remote repo is dirty; refusing to continue.\" >&2; git status --short >&2; echo \"Re-run with --allow-stash to auto-stash remote changes.\" >&2; exit 1; fi" "repo_cleanliness_check" 1
}

ensure_remote_repo_clean

if [[ "$SYNC_ONLY" == "true" ]]; then
  echo "==> Running remote git sync only"
  run_ssh "set -euo pipefail; cd $REMOTE_PROJECT_DIR; git pull --ff-only; git status --short" "sync_only"
  echo "==> Remote sync complete"
  exit 0
fi

if [[ "$SKIP_PULL" != "true" ]]; then
  echo "==> Pulling remote repository before config validation"
  run_ssh "set -euo pipefail; cd $REMOTE_PROJECT_DIR; git pull --ff-only" "pre_deploy_pull"
  SKIP_PULL=true
fi

echo "==> Checking remote deploy flag compatibility"
REMOTE_FLAG_SUPPORT_OUTPUT="$(run_ssh "set -euo pipefail; cd $REMOTE_PROJECT_DIR; if grep -q -- '--ready-retries' scripts/deploy-vps.sh; then echo supports_ready_flags=true; else echo supports_ready_flags=false; fi" "deploy_flag_compatibility" 1)"
echo "$REMOTE_FLAG_SUPPORT_OUTPUT"
REMOTE_SUPPORTS_READY_FLAGS=false
if printf "%s" "$REMOTE_FLAG_SUPPORT_OUTPUT" | grep -q "supports_ready_flags=true"; then
  REMOTE_SUPPORTS_READY_FLAGS=true
fi

DEPLOY_FLAGS=()
if [[ "$WITH_WORKER" == "true" ]]; then
  DEPLOY_FLAGS+=("--with-worker")
fi
if [[ "$SKIP_PULL" == "true" ]]; then
  DEPLOY_FLAGS+=("--skip-pull")
fi
if [[ "$REMOTE_SUPPORTS_READY_FLAGS" == "true" ]]; then
  DEPLOY_FLAGS+=("--ready-retries" "$READY_RETRIES")
  DEPLOY_FLAGS+=("--ready-delay" "$READY_DELAY_SECONDS")
else
  echo "==> Remote deploy script does not support --ready-* flags yet; using remote defaults"
fi

DEPLOY_FLAGS_JOINED=""
if [[ ${#DEPLOY_FLAGS[@]} -gt 0 ]]; then
  for flag in "${DEPLOY_FLAGS[@]}"; do
    DEPLOY_FLAGS_JOINED+=" $(quote_for_shell "$flag")"
  done
fi

echo "==> Validating remote server runtime config"
run_ssh "set -euo pipefail; cd $REMOTE_PROJECT_DIR; bash scripts/render-server-env.sh --mode production --source .env --output server/.env; NODE_ENV=production npm run config:check:server" "server_config_validation"

if [[ "$WITH_WORKER" == "true" ]]; then
  echo "==> Validating remote worker runtime config"
  run_ssh "set -euo pipefail; cd $REMOTE_PROJECT_DIR; NODE_ENV=production npm run config:check:worker" "worker_config_validation"
fi

echo "==> Running remote deploy workflow"
DEPLOY_ENV_PREFIX="VPS_POSTGRES_READY_RETRIES=$(quote_for_shell "$POSTGRES_READY_RETRIES") VPS_POSTGRES_READY_DELAY_SECONDS=$(quote_for_shell "$POSTGRES_READY_DELAY_SECONDS") VPS_REDIS_READY_RETRIES=$(quote_for_shell "$REDIS_READY_RETRIES") VPS_REDIS_READY_DELAY_SECONDS=$(quote_for_shell "$REDIS_READY_DELAY_SECONDS")"
if ! run_ssh "set -euo pipefail; cd $REMOTE_PROJECT_DIR; $DEPLOY_ENV_PREFIX bash scripts/deploy-vps.sh$DEPLOY_FLAGS_JOINED" "remote_deploy_workflow" 1; then
  collect_remote_runtime_diagnostics
  exit 1
fi
echo "==> Running post-deploy verification"
VERIFY_ARGS=(--host "$VPS_HOST" --path "$PROJECT_DIR" --port "$SSH_PORT" --ssh-retries "$SSH_RETRIES" --ready-retries "$READY_RETRIES" --ready-delay "$READY_DELAY_SECONDS")
if [[ -n "$SSH_IDENTITY" ]]; then
  VERIFY_ARGS+=(--identity "$SSH_IDENTITY")
fi
if [[ -n "$PUBLIC_BASE_URL" ]]; then
  VERIFY_ARGS+=(--public-base-url "$PUBLIC_BASE_URL")
fi
if [[ -n "$PUBLIC_BEARER" ]]; then
  VERIFY_ARGS+=(--public-bearer "$PUBLIC_BEARER")
fi
bash "$ROOT_DIR/scripts/verify-vps-remote.sh" "${VERIFY_ARGS[@]}"
echo "==> Remote deploy complete"
