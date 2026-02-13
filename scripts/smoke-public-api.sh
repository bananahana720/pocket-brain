#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/smoke-public-api.sh --base-url <url> [--bearer <token>]

Options:
  --base-url <url>   Required. Base URL for public API checks (for example https://app.example.com).
  --bearer <token>   Optional bearer token. When provided, /api/v2/sync/pull is expected to return 200.
  --help             Show this help text.
USAGE
}

BASE_URL=""
BEARER_TOKEN=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      BASE_URL="${2:-}"
      shift 2
      ;;
    --base-url=*)
      BASE_URL="${1#*=}"
      shift
      ;;
    --bearer)
      BEARER_TOKEN="${2:-}"
      shift 2
      ;;
    --bearer=*)
      BEARER_TOKEN="${1#*=}"
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

if [[ -z "$BASE_URL" ]]; then
  echo "Missing required --base-url." >&2
  usage
  exit 1
fi

if [[ "$BASE_URL" != http://* && "$BASE_URL" != https://* ]]; then
  echo "Invalid --base-url: must start with http:// or https://" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required but not found." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required but not found." >&2
  exit 1
fi

BASE_URL="${BASE_URL%/}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

TOTAL=0
PASSED=0
FAILED=0
FAILED_NAMES=()

extract_header_value() {
  local header_name="$1"
  local headers_file="$2"

  awk -v key="${header_name,,}" -F':' '
    BEGIN { found = 0 }
    {
      line = $0
      gsub(/\r/, "", line)
      split(line, parts, ":")
      current = tolower(parts[1])
      if (current == key) {
        value = substr(line, index(line, ":") + 1)
        sub(/^[[:space:]]+/, "", value)
        print tolower(value)
        found = 1
        exit
      }
    }
    END {
      if (!found) {
        print ""
      }
    }
  ' "$headers_file"
}

validate_json_object() {
  local body_file="$1"

  node -e '
const fs = require("node:fs");
const body = fs.readFileSync(process.argv[1], "utf8");
let parsed;
try {
  parsed = JSON.parse(body);
} catch {
  process.exit(1);
}
if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
  process.exit(1);
}
' "$body_file" >/dev/null 2>&1
}

validate_contract_auth_status() {
  local body_file="$1"

  node -e '
const fs = require("node:fs");
const parsed = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (typeof parsed.connected !== "boolean") {
  process.exit(1);
}
if (typeof parsed.scope !== "string" || parsed.scope.length === 0) {
  process.exit(1);
}
' "$body_file" >/dev/null 2>&1
}

validate_contract_bad_request_error() {
  local body_file="$1"

  node -e '
const fs = require("node:fs");
const parsed = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!parsed.error || typeof parsed.error !== "object") {
  process.exit(1);
}
if (parsed.error.code !== "BAD_REQUEST") {
  process.exit(1);
}
if (typeof parsed.error.message !== "string" || parsed.error.message.length === 0) {
  process.exit(1);
}
' "$body_file" >/dev/null 2>&1
}

validate_contract_sync_pull_unauthorized() {
  local body_file="$1"

  node -e '
const fs = require("node:fs");
const parsed = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!parsed.error || typeof parsed.error !== "object") {
  process.exit(1);
}
if (parsed.error.code !== "AUTH_REQUIRED") {
  process.exit(1);
}
if (typeof parsed.error.message !== "string" || parsed.error.message.length === 0) {
  process.exit(1);
}
' "$body_file" >/dev/null 2>&1
}

validate_contract_sync_pull_success() {
  local body_file="$1"

  node -e '
const fs = require("node:fs");
const parsed = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!Array.isArray(parsed.changes)) {
  process.exit(1);
}
if (typeof parsed.nextCursor !== "number" || !Number.isFinite(parsed.nextCursor)) {
  process.exit(1);
}
if (Object.prototype.hasOwnProperty.call(parsed, "resetRequired") && typeof parsed.resetRequired !== "boolean") {
  process.exit(1);
}
' "$body_file" >/dev/null 2>&1
}

perform_check() {
  local name="$1"
  local method="$2"
  local path="$3"
  local expected_status="$4"
  local payload="$5"
  local validator="$6"

  local url="${BASE_URL}${path}"
  local body_file="${TMP_DIR}/${name}.body"
  local headers_file="${TMP_DIR}/${name}.headers"

  local -a curl_args=(
    -sS
    -X "$method"
    "$url"
    -D "$headers_file"
    -o "$body_file"
    -w "%{http_code}"
    -H "Accept: application/json"
  )

  if [[ -n "$BEARER_TOKEN" ]]; then
    curl_args+=( -H "Authorization: Bearer ${BEARER_TOKEN}" )
  fi

  if [[ -n "$payload" ]]; then
    curl_args+=( -H "Content-Type: application/json" --data "$payload" )
  fi

  local http_status
  http_status="$(curl "${curl_args[@]}" || true)"

  if [[ "$http_status" != "$expected_status" ]]; then
    echo "FAIL ${name}: expected status ${expected_status}, got ${http_status}"
    return 1
  fi

  local content_type
  content_type="$(extract_header_value "content-type" "$headers_file")"
  if [[ "$content_type" != *"application/json"* ]]; then
    echo "FAIL ${name}: expected application/json response, got '${content_type:-missing}'"
    return 1
  fi

  if ! validate_json_object "$body_file"; then
    echo "FAIL ${name}: response was not a JSON object"
    return 1
  fi

  if ! "$validator" "$body_file"; then
    echo "FAIL ${name}: JSON contract mismatch"
    return 1
  fi

  echo "PASS ${name}"
  return 0
}

run_check() {
  local name="$1"
  local method="$2"
  local path="$3"
  local expected_status="$4"
  local payload="$5"
  local validator="$6"

  TOTAL=$((TOTAL + 1))
  if perform_check "$name" "$method" "$path" "$expected_status" "$payload" "$validator"; then
    PASSED=$((PASSED + 1))
  else
    FAILED=$((FAILED + 1))
    FAILED_NAMES+=("$name")
  fi
}

SYNC_EXPECTED_STATUS="401"
SYNC_VALIDATOR="validate_contract_sync_pull_unauthorized"
if [[ -n "$BEARER_TOKEN" ]]; then
  SYNC_EXPECTED_STATUS="200"
  SYNC_VALIDATOR="validate_contract_sync_pull_success"
fi

run_check "auth-status" "GET" "/api/v1/auth/status" "200" "" "validate_contract_auth_status"
run_check "auth-connect-invalid" "POST" "/api/v1/auth/connect" "400" '{"provider":"invalid-provider","apiKey":"invalid"}' "validate_contract_bad_request_error"
run_check "sync-pull" "GET" "/api/v2/sync/pull?cursor=0" "$SYNC_EXPECTED_STATUS" "" "$SYNC_VALIDATOR"

if [[ "$FAILED" -eq 0 ]]; then
  echo "Smoke summary: PASS (${PASSED}/${TOTAL})"
  exit 0
fi

echo "Smoke summary: FAIL (${PASSED}/${TOTAL} passed, ${FAILED} failed)"
echo "Failed checks: ${FAILED_NAMES[*]}"
exit 1
