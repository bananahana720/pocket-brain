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
  --sync-only               Only run remote git pull --ff-only (no docker rebuild/redeploy).
  --precheck-only           Validate SSH and remote repo path, then exit.
  --help                    Show this help text.

Environment:
  VPS_SSH_HOST      Default SSH host (user@hostname)
  VPS_PROJECT_DIR   Default remote repo path
  VPS_SSH_PORT      Default SSH port
  VPS_SSH_IDENTITY  Default SSH identity file
  VPS_SSH_RETRY_ATTEMPTS  SSH retry attempts for remote precheck/validation steps

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
    fi
    exit_code=$?
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

echo "==> Remote target: $VPS_HOST"
echo "==> Remote path: $PROJECT_DIR"
echo "==> SSH port: $SSH_PORT"
echo "==> SSH retries: $SSH_RETRIES"
if [[ -n "$SSH_IDENTITY" ]]; then
  echo "==> SSH identity: $SSH_IDENTITY"
fi

echo "==> Precheck: SSH connectivity"
run_ssh "echo connected" "ssh_connectivity"

echo "==> Precheck: repository layout"
run_ssh "set -euo pipefail; cd $REMOTE_PROJECT_DIR; test -d .git; test -x scripts/deploy-vps.sh || test -f scripts/deploy-vps.sh" "repo_layout"

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

DEPLOY_FLAGS=()
if [[ "$WITH_WORKER" == "true" ]]; then
  DEPLOY_FLAGS+=("--with-worker")
fi
if [[ "$SKIP_PULL" == "true" ]]; then
  DEPLOY_FLAGS+=("--skip-pull")
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
run_ssh "set -euo pipefail; cd $REMOTE_PROJECT_DIR; bash scripts/deploy-vps.sh$DEPLOY_FLAGS_JOINED" "remote_deploy_workflow" 1
echo "==> Running post-deploy verification"
VERIFY_ARGS=(--host "$VPS_HOST" --path "$PROJECT_DIR" --port "$SSH_PORT" --ssh-retries "$SSH_RETRIES")
if [[ -n "$SSH_IDENTITY" ]]; then
  VERIFY_ARGS+=(--identity "$SSH_IDENTITY")
fi
bash "$ROOT_DIR/scripts/verify-vps-remote.sh" "${VERIFY_ARGS[@]}"
echo "==> Remote deploy complete"
