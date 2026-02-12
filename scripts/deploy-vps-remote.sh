#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash scripts/deploy-vps-remote.sh [options]

Options:
  --host <user@hostname>    SSH target. Defaults to VPS_SSH_HOST env var.
  --path <remote-path>      Remote PocketBrain repo path. Defaults to VPS_PROJECT_DIR env var.
  --port <port>             SSH port. Defaults to VPS_SSH_PORT env var or 22.
  --identity <file>         SSH private key path. Defaults to VPS_SSH_IDENTITY env var.
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

SSH_ARGS=(
  -p "$SSH_PORT"
  -o BatchMode=yes
  -o ConnectTimeout=10
)

if [[ -n "$SSH_IDENTITY" ]]; then
  SSH_ARGS+=(-i "$SSH_IDENTITY")
fi

REMOTE_PROJECT_DIR="$(quote_for_shell "$PROJECT_DIR")"

echo "==> Remote target: $VPS_HOST"
echo "==> Remote path: $PROJECT_DIR"
echo "==> SSH port: $SSH_PORT"

echo "==> Precheck: SSH connectivity"
ssh "${SSH_ARGS[@]}" "$VPS_HOST" "echo connected"

echo "==> Precheck: repository layout"
ssh "${SSH_ARGS[@]}" "$VPS_HOST" "set -euo pipefail; cd $REMOTE_PROJECT_DIR; test -d .git; test -x scripts/deploy-vps.sh || test -f scripts/deploy-vps.sh"

if [[ "$PRECHECK_ONLY" == "true" ]]; then
  echo "==> Precheck complete"
  exit 0
fi

if [[ "$SYNC_ONLY" == "true" ]]; then
  echo "==> Running remote git sync only"
  ssh "${SSH_ARGS[@]}" "$VPS_HOST" "set -euo pipefail; cd $REMOTE_PROJECT_DIR; git pull --ff-only; git status --short"
  echo "==> Remote sync complete"
  exit 0
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

echo "==> Running remote deploy workflow"
ssh "${SSH_ARGS[@]}" "$VPS_HOST" "set -euo pipefail; cd $REMOTE_PROJECT_DIR; bash scripts/deploy-vps.sh$DEPLOY_FLAGS_JOINED"
echo "==> Remote deploy complete"
