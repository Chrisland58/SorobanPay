#!/usr/bin/env bash
set -euo pipefail

# Immutable artifact digest verification and promotion audit helper.
# Used by .github/workflows/promotion-pipeline.yml to ensure production
# deploys the exact digest validated in dev/staging and retains audit metadata.

usage() {
  cat <<'EOF'
Usage:
  verify-promotion-digest.sh verify --artifact <path> --expected-digest <sha256:hex> [--manifest <path>]
  verify-promotion-digest.sh record --output <path> --artifact-id <id> --digest <sha256:hex> \
    --git-sha <sha> --environment <env> --promoted-from <env> --actor <actor> --run-id <id> \
    [--approval-status <status>]
EOF
}

compute_digest() {
  local file_path="$1"
  if [[ ! -f "$file_path" ]]; then
    echo "ERROR: Artifact file not found: $file_path" >&2
    return 1
  fi
  local hex
  hex="$(sha256sum "$file_path" | awk '{print $1}')"
  echo "sha256:${hex}"
}

cmd_verify() {
  local artifact=""
  local expected_digest=""
  local manifest=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --artifact)
        artifact="${2:-}"
        shift 2
        ;;
      --expected-digest)
        expected_digest="${2:-}"
        shift 2
        ;;
      --manifest)
        manifest="${2:-}"
        shift 2
        ;;
      *)
        echo "ERROR: Unknown argument: $1" >&2
        usage >&2
        return 1
        ;;
    esac
  done

  if [[ -z "$artifact" || -z "$expected_digest" ]]; then
    echo "ERROR: --artifact and --expected-digest are required" >&2
    return 1
  fi

  if [[ ! "$expected_digest" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    echo "ERROR: Invalid expected digest format: $expected_digest" >&2
    return 1
  fi

  local actual_digest
  actual_digest="$(compute_digest "$artifact")"

  if [[ "$actual_digest" != "$expected_digest" ]]; then
    echo "ERROR: Artifact digest mismatch!" >&2
    echo "  Expected: $expected_digest" >&2
    echo "  Actual:   $actual_digest" >&2
    return 1
  fi

  if [[ -n "$manifest" ]]; then
    if [[ ! -f "$manifest" ]]; then
      echo "ERROR: Manifest file not found: $manifest" >&2
      return 1
    fi
    local manifest_digest
    manifest_digest="$(grep -oE '"wasm_digest"[[:space:]]*:[[:space:]]*"sha256:[a-f0-9]{64}"' "$manifest" | head -n1 | sed -E 's/.*"([^"]+)"$/\1/' || true)"
    if [[ -z "$manifest_digest" ]]; then
      echo "ERROR: Manifest missing valid wasm_digest field: $manifest" >&2
      return 1
    fi
    if [[ "$manifest_digest" != "$expected_digest" ]]; then
      echo "ERROR: Manifest digest mismatch!" >&2
      echo "  Expected: $expected_digest" >&2
      echo "  Manifest: $manifest_digest" >&2
      return 1
    fi
  fi

  echo "OK: Verified artifact digest $actual_digest"
}

cmd_record() {
  local output=""
  local artifact_id=""
  local digest=""
  local git_sha=""
  local environment=""
  local promoted_from=""
  local actor=""
  local run_id=""
  local approval_status="approved"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --output) output="${2:-}"; shift 2 ;;
      --artifact-id) artifact_id="${2:-}"; shift 2 ;;
      --digest) digest="${2:-}"; shift 2 ;;
      --git-sha) git_sha="${2:-}"; shift 2 ;;
      --environment) environment="${2:-}"; shift 2 ;;
      --promoted-from) promoted_from="${2:-}"; shift 2 ;;
      --actor) actor="${2:-}"; shift 2 ;;
      --run-id) run_id="${2:-}"; shift 2 ;;
      --approval-status) approval_status="${2:-}"; shift 2 ;;
      *)
        echo "ERROR: Unknown argument: $1" >&2
        usage >&2
        return 1
        ;;
    esac
  done

  if [[ -z "$output" || -z "$artifact_id" || -z "$digest" || -z "$git_sha" || -z "$environment" || -z "$actor" || -z "$run_id" ]]; then
    echo "ERROR: Missing required fields for promotion audit record" >&2
    return 1
  fi

  local timestamp
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  mkdir -p "$(dirname "$output")"
  cat > "$output" <<EOF
{
  "timestamp": "${timestamp}",
  "artifact_id": "${artifact_id}",
  "wasm_digest": "${digest}",
  "git_sha": "${git_sha}",
  "environment": "${environment}",
  "promoted_from": "${promoted_from}",
  "workflow_run_id": "${run_id}",
  "actor": "${actor}",
  "approval_status": "${approval_status}",
  "status": "success"
}
EOF
  echo "OK: Wrote promotion audit record to $output"
}

main() {
  local subcommand="${1:-}"
  if [[ -z "$subcommand" ]]; then
    usage >&2
    exit 1
  fi
  shift

  case "$subcommand" in
    verify) cmd_verify "$@" ;;
    record) cmd_record "$@" ;;
    *)
      echo "ERROR: Unknown subcommand: $subcommand" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
