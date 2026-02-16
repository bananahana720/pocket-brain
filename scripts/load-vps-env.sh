#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

load_var_from_file_if_unset() {
  local var_name="$1"
  local file_path="$2"

  if [[ -n "${!var_name:-}" ]]; then
    return
  fi
  if [[ ! -f "$file_path" ]]; then
    return
  fi

  local line
  line="$(grep -E "^${var_name}=" "$file_path" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    return
  fi

  local raw_value="${line#*=}"
  if [[ "$raw_value" =~ ^\"(.*)\"$ ]]; then
    raw_value="${BASH_REMATCH[1]}"
  elif [[ "$raw_value" =~ ^\'(.*)\'$ ]]; then
    raw_value="${BASH_REMATCH[1]}"
  fi

  printf -v "$var_name" "%s" "$raw_value"
  export "$var_name"
}

load_vps_env() {
  local candidate_files=(
    "$ROOT_DIR/.vps-remote.env"
    "$ROOT_DIR/.env"
  )

  for file_path in "${candidate_files[@]}"; do
    load_var_from_file_if_unset "VPS_SSH_HOST" "$file_path"
    load_var_from_file_if_unset "VPS_PROJECT_DIR" "$file_path"
    load_var_from_file_if_unset "VPS_SSH_PORT" "$file_path"
    load_var_from_file_if_unset "VPS_SSH_IDENTITY" "$file_path"
    load_var_from_file_if_unset "VPS_SSH_RETRY_ATTEMPTS" "$file_path"
    load_var_from_file_if_unset "VPS_READY_RETRIES" "$file_path"
    load_var_from_file_if_unset "VPS_READY_DELAY_SECONDS" "$file_path"
    load_var_from_file_if_unset "VPS_POSTGRES_READY_RETRIES" "$file_path"
    load_var_from_file_if_unset "VPS_POSTGRES_READY_DELAY_SECONDS" "$file_path"
    load_var_from_file_if_unset "VPS_REDIS_READY_RETRIES" "$file_path"
    load_var_from_file_if_unset "VPS_REDIS_READY_DELAY_SECONDS" "$file_path"
    load_var_from_file_if_unset "VPS_PUBLIC_BASE_URL" "$file_path"
    load_var_from_file_if_unset "VPS_PUBLIC_BEARER" "$file_path"
    load_var_from_file_if_unset "VPS_PUBLIC_BEARER_TOKEN" "$file_path"
  done

  if [[ -n "${VPS_SSH_HOST:-}" && "${VPS_SSH_HOST}" != *@* ]]; then
    export VPS_SSH_HOST="ubuntu@${VPS_SSH_HOST}"
  fi

  if [[ -z "${VPS_SSH_IDENTITY:-}" && -f "$HOME/.ssh/id_ed25519" ]]; then
    export VPS_SSH_IDENTITY="$HOME/.ssh/id_ed25519"
  fi

  if [[ -n "${VPS_SSH_IDENTITY:-}" && "${VPS_SSH_IDENTITY}" == "~/"* ]]; then
    export VPS_SSH_IDENTITY="$HOME/${VPS_SSH_IDENTITY#\~/}"
  fi

  if [[ -z "${VPS_SSH_PORT:-}" ]]; then
    export VPS_SSH_PORT="22"
  fi

  if [[ -z "${VPS_SSH_RETRY_ATTEMPTS:-}" ]]; then
    export VPS_SSH_RETRY_ATTEMPTS="3"
  fi

  if [[ -z "${VPS_READY_RETRIES:-}" ]]; then
    export VPS_READY_RETRIES="30"
  fi

  if [[ -z "${VPS_READY_DELAY_SECONDS:-}" ]]; then
    export VPS_READY_DELAY_SECONDS="2"
  fi

  if [[ -z "${VPS_POSTGRES_READY_RETRIES:-}" ]]; then
    export VPS_POSTGRES_READY_RETRIES="20"
  fi

  if [[ -z "${VPS_POSTGRES_READY_DELAY_SECONDS:-}" ]]; then
    export VPS_POSTGRES_READY_DELAY_SECONDS="2"
  fi

  if [[ -z "${VPS_REDIS_READY_RETRIES:-}" ]]; then
    export VPS_REDIS_READY_RETRIES="20"
  fi

  if [[ -z "${VPS_REDIS_READY_DELAY_SECONDS:-}" ]]; then
    export VPS_REDIS_READY_DELAY_SECONDS="2"
  fi
}

load_vps_env
