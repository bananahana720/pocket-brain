#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  bash scripts/verify-vps-remote.sh [options]

Options:
  --host <user@hostname>    SSH target. Defaults to VPS_SSH_HOST env var.
  --path <remote-path>      Remote PocketBrain repo path. Defaults to VPS_PROJECT_DIR env var.
  --port <port>             SSH port. Defaults to VPS_SSH_PORT env var or 22.
  --identity <file>         SSH private key path. Defaults to VPS_SSH_IDENTITY env var.
  --help                    Show this help text.
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

echo "==> Verifying remote deploy target: $VPS_HOST ($PROJECT_DIR)"

ssh "${SSH_ARGS[@]}" "$VPS_HOST" "set -euo pipefail; cd $REMOTE_PROJECT_DIR; echo \"remote_head=\$(git rev-parse --short HEAD)\"; if [[ -n \"\$(git status --porcelain)\" ]]; then echo \"remote_repo_status=dirty\"; git status --short; else echo \"remote_repo_status=clean\"; fi; READY_STATUS=\$(curl -s -o /tmp/pocketbrain-ready.json -w \"%{http_code}\" http://127.0.0.1:8080/ready || true); echo \"ready_status=\$READY_STATUS\"; echo \"ready_summary=\"; cat /tmp/pocketbrain-ready.json; [[ \"\$READY_STATUS\" == \"200\" ]]"

echo "==> Remote verification complete"
