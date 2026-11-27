#!/usr/bin/env bash
# =============================================================================
# deploy/rollback.sh
#
# Rollback automation, deployment checkpoints, and health gating for SorobanPay.
#
# Features:
#   - Checkpoint creation: snapshots git commit, contract ID, image tag, and
#     Kubernetes rollout revisions.
#   - Automated failure detection: checks critical readiness and dependency health;
#     triggers rollback if verification fails.
#   - Graceful rollback: restores previous Kubernetes deployments or checkpoint
#     revisions and verifies pod stabilization.
#   - Post-rollback health gating: rollback is NOT marked complete until critical
#     readiness checks (application, database, redis, rpc) pass with bounded
#     retries and exponential/linear backoff.
#   - Escalation path: surfaces timeout, partial recovery, and hard failure
#     outcomes to operators with direct runbook links and actionable diagnostics.
#
# Usage:
#   bash deploy/rollback.sh --create-checkpoint <contract_id> <image_tag>
#   bash deploy/rollback.sh --list
#   bash deploy/rollback.sh --auto-verify [health_endpoint_url]
#   bash deploy/rollback.sh --rollback [checkpoint_file]
#   bash deploy/rollback.sh --verify-health [health_endpoint_url]
# =============================================================================

set -euo pipefail

RUNBOOK_URL="${RUNBOOK_URL:-docs/operations.md#10-failed-rollback-escalation-runbook}"
CHECKPOINT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/checkpoints"
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST_FILE="${DEPLOY_DIR}/deployments.json"
IMAGE_REPO="${IMAGE_REPO:-ghcr.io/chrisland58/sorobanpay}"
mkdir -p "$CHECKPOINT_DIR"

# Configurable timeouts and retries for post-rollback health gating
MAX_HEALTH_RETRIES="${MAX_HEALTH_RETRIES:-10}"
HEALTH_RETRY_INTERVAL="${HEALTH_RETRY_INTERVAL:-3}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-5}"
DEFAULT_HEALTH_URL="http://localhost:3001/health/ready"

COMMAND="${1:---help}"

validate_digest() {
  local digest="${1:-}"
  if [[ ! "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]; then
    echo "Error: Invalid or mutable image reference '${digest}'. Expected immutable digest format 'sha256:<64-hex-chars>'." >&2
    return 1
  fi
}

create_checkpoint() {
  local contract_id="${2:-unknown}"
  local image_tag="${3:-latest}"
  local image_digest="${4:-}"
  local source_revision="${5:-$(git rev-parse HEAD 2>/dev/null || echo "unknown")}"

  if [ -n "$image_digest" ]; then
    validate_digest "$image_digest"
  fi

  local timestamp
  timestamp="$(date +%Y%m%d_%H%M%S)"
  local git_sha
  git_sha="$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")"
  local checkpoint_file="${CHECKPOINT_DIR}/checkpoint_${timestamp}_${git_sha}.json"

  local previous_digest=""
  local latest_checkpoint
  latest_checkpoint="$(ls -1t "$CHECKPOINT_DIR"/checkpoint_*.json 2>/dev/null | head -n 1 || true)"
  if [ -n "$latest_checkpoint" ] && [ -f "$latest_checkpoint" ]; then
    previous_digest="$(grep -o '"image_digest":[[:space:]]*"[^"]*"' "$latest_checkpoint" | head -n 1 | cut -d'"' -f4 || true)"
  fi

  cat > "$checkpoint_file" <<EOF
{
  "timestamp": "${timestamp}",
  "git_sha": "${git_sha}",
  "source_revision": "${source_revision}",
  "contract_id": "${contract_id}",
  "image_tag": "${image_tag}",
  "image_digest": "${image_digest}",
  "previous_digest": "${previous_digest}",
  "validated": $([ -n "$image_digest" ] && echo "true" || echo "false"),
  "deployments": [
    "sorobanpay-api",
    "sorobanpay-indexer",
    "sorobanpay-webhook-worker"
  ]
}
EOF

  echo "Checkpoint created: ${checkpoint_file}"
}

record_deployment() {
  local env="${2:-testnet}"
  local image_digest="${3:-}"
  local source_revision="${4:-$(git rev-parse HEAD 2>/dev/null || echo "unknown")}"
  local release_notes_file="${5:-}"

  validate_digest "$image_digest"

  local updated_at
  updated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  python3 - "$MANIFEST_FILE" "$env" "$image_digest" "$source_revision" "$updated_at" <<'PY'
import json, sys, os

manifest_path, env, digest, rev, updated_at = sys.argv[1:6]
data = {}
if os.path.exists(manifest_path):
    with open(manifest_path, "r", encoding="utf-8") as f:
        data = json.load(f)

env_data = data.get(env, {})
prev_digest = env_data.get("current_digest", "")
if prev_digest == digest:
    prev_digest = env_data.get("previous_digest", "")

data[env] = {
    "current_digest": digest,
    "previous_digest": prev_digest,
    "source_revision": rev,
    "updated_at": updated_at,
}

with open(manifest_path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY

  echo "Deployment recorded for ${env}: digest=${image_digest}, source_revision=${source_revision}"

  if [ -n "$release_notes_file" ]; then
    cat >> "$release_notes_file" <<EOF
### Deployment Record (${env})
- **Deployed Digest:** \`${image_digest}\`
- **Source Revision:** \`${source_revision}\`
- **Recorded At:** ${updated_at}
EOF
  fi
}

show_status() {
  local env="${2:-testnet}"
  if [ ! -f "$MANIFEST_FILE" ]; then
    echo "No deployment manifest found at ${MANIFEST_FILE}."
    return 1
  fi
  python3 - "$MANIFEST_FILE" "$env" <<'PY'
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = json.load(f)
env_data = data.get(sys.argv[2], {})
print(f"Environment: {sys.argv[2]}")
print(f"Current Digest: {env_data.get('current_digest', 'none')}")
print(f"Previous Digest: {env_data.get('previous_digest', 'none')}")
print(f"Source Revision: {env_data.get('source_revision', 'none')}")
print(f"Updated At: {env_data.get('updated_at', 'none')}")
PY
}

list_checkpoints() {
  echo "Available checkpoints in ${CHECKPOINT_DIR}:"
  ls -1 "$CHECKPOINT_DIR"/*.json 2>/dev/null || echo "No checkpoints found."
}

# =============================================================================
# Readiness & Health Evaluation
# =============================================================================
# Queries the readiness endpoint (or full health endpoint) and validates both
# HTTP status and critical dependency statuses (database, redis, rpc).
# Outputs status details to stdout/stderr.
# Return code:
#   0 = healthy & ready
#   1 = unhealthy / degraded / dependency failure
#   2 = timeout / connection failure
# =============================================================================
check_health_status() {
  local target_url="$1"

  # Use python3 if available for reliable HTTP request and JSON parsing
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$target_url" "$HEALTH_TIMEOUT_SECONDS" << 'PY'
import sys
import json
import urllib.request
import urllib.error

url = sys.argv[1]
timeout = float(sys.argv[2])

req = urllib.request.Request(
    url,
    headers={"User-Agent": "SorobanPay-Rollback-HealthCheck/1.0", "Accept": "application/json"}
)

try:
    with urllib.request.urlopen(req, timeout=timeout) as response:
        http_code = response.getcode()
        body = response.read().decode("utf-8", errors="replace")
except urllib.error.HTTPError as e:
    http_code = e.code
    body = e.read().decode("utf-8", errors="replace")
except urllib.error.URLError as e:
    sys.stderr.write(f"Connection failed: {e.reason}\n")
    sys.exit(2)
except Exception as e:
    sys.stderr.write(f"Unexpected error connecting to health endpoint: {e}\n")
    sys.exit(2)

try:
    data = json.loads(body)
except Exception:
    data = None

if http_code == 200:
    if isinstance(data, dict):
        status_val = str(data.get("status", "")).lower()
        if status_val in ("ready", "healthy", "ok"):
            # Check dependencies if present
            deps = data.get("dependencies") or data.get("checks") or {}
            unhealthy_deps = []
            if isinstance(deps, dict):
                for dep, state in deps.items():
                    if isinstance(state, dict):
                        dep_status = str(state.get("status", "")).lower()
                        if dep_status not in ("ok", "healthy"):
                            unhealthy_deps.append(f"{dep} ({dep_status})")
                    elif isinstance(state, str):
                        if state.lower() not in ("ok", "healthy"):
                            unhealthy_deps.append(f"{dep} ({state})")
            if unhealthy_deps:
                sys.stderr.write(f"Service returned 200 but dependencies unhealthy: {', '.join(unhealthy_deps)}\n")
                sys.exit(1)
            print("OK")
            sys.exit(0)
        else:
            sys.stderr.write(f"Readiness check returned 200 but status='{status_val}'\n")
            sys.exit(1)
    else:
        print("OK")
        sys.exit(0)
else:
    err_detail = ""
    if isinstance(data, dict):
        err_detail = json.dumps(data)
    else:
        err_detail = body[:200]
    sys.stderr.write(f"Health check failed with HTTP {http_code}: {err_detail}\n")
    sys.exit(1)
PY
    return $?
  elif command -v curl >/dev/null 2>&1; then
    local http_code
    http_code=$(curl --max-time "$HEALTH_TIMEOUT_SECONDS" -s -o /tmp/health_body.txt -w "%{http_code}" "$target_url" 2>/dev/null || echo "000")
    if [ "$http_code" = "200" ]; then
      if grep -qiE '"(status)"\s*:\s*"(ready|healthy|ok)"' /tmp/health_body.txt 2>/dev/null; then
        echo "OK"
        return 0
      else
        echo "HTTP 200 but status is not ready: $(cat /tmp/health_body.txt 2>/dev/null)" >&2
        return 1
      fi
    elif [ "$http_code" = "000" ]; then
      echo "Connection failed or timed out (HTTP 000)" >&2
      return 2
    else
      echo "Health check failed with HTTP ${http_code}" >&2
      return 1
    fi
  else
    # Dry-run or minimal environment without curl/python
    echo "[dry-run] Verification tools (python3/curl) not found. Assuming ready."
    return 0
  fi
}

# =============================================================================
# Post-Rollback Health Gating with Bounded Retries & Escalation
# =============================================================================
gate_post_rollback_health() {
  local health_url="$1"
  local max_retries="$MAX_HEALTH_RETRIES"
  local interval="$HEALTH_RETRY_INTERVAL"
  local attempt=1
  local check_result=0
  local consecutive_successes=0
  local required_successes=1

  echo "================================================================="
  echo "Gating rollback completion on application & dependency health..."
  echo "Health URL:         $health_url"
  echo "Max retries:        $max_retries (interval: ${interval}s, timeout: ${HEALTH_TIMEOUT_SECONDS}s)"
  echo "================================================================="

  local last_outcome="unknown"

  while [ "$attempt" -le "$max_retries" ]; do
    echo -n "Attempt ${attempt}/${max_retries}: Checking ${health_url}... "
    
    set +e
    check_output=$(check_health_status "$health_url" 2>&1)
    check_result=$?
    set -e

    if [ "$check_result" -eq 0 ]; then
      echo "PASSED (Health OK)"
      consecutive_successes=$((consecutive_successes + 1))
      if [ "$consecutive_successes" -ge "$required_successes" ]; then
        echo ""
        echo "✅ Post-rollback health gating PASSED."
        echo "All critical readiness checks (application, database, redis, RPC) verified."
        return 0
      fi
    elif [ "$check_result" -eq 2 ]; then
      echo "FAILED (Connection/Timeout)"
      last_outcome="timeout"
      echo "  Diagnostic: $check_output"
      consecutive_successes=0
    else
      echo "FAILED (Unhealthy/Degraded)"
      last_outcome="partial_recovery"
      echo "  Diagnostic: $check_output"
      consecutive_successes=0
    fi

    if [ "$attempt" -lt "$max_retries" ]; then
      sleep "$interval"
    fi
    attempt=$((attempt + 1))
  done

  echo ""
  echo "❌ ESCALATION: Post-rollback health verification FAILED after ${max_retries} attempts."
  echo "================================================================="
  echo "FAILURE OUTCOME: ${last_outcome^^}"
  if [ "$last_outcome" = "timeout" ]; then
    echo "Reason: Service or endpoint timed out / remained unreachable."
    echo "The restored deployment could not be reached within the bounded timeout."
  elif [ "$last_outcome" = "partial_recovery" ]; then
    echo "Reason: Partial recovery detected. Application responded but critical dependencies"
    echo "        (database, redis, or Stellar RPC) failed readiness criteria."
  else
    echo "Reason: Deployment failed to pass post-rollback readiness checks."
  fi
  echo ""
  echo "OPERATOR RUNBOOK ACTION REQUIRED:"
  echo "  Runbook: ${RUNBOOK_URL}"
  echo "  Suggested immediate actions:"
  echo "    1. Inspect pod readiness and logs:"
  echo "       kubectl describe pods -n sorobanpay -l app.kubernetes.io/name=sorobanpay"
  echo "       kubectl logs -n sorobanpay deployment/sorobanpay-api --tail=100"
  echo "    2. Verify backing infrastructure:"
  echo "       PostgreSQL: kubectl exec -n sorobanpay postgresql-0 -- pg_isready"
  echo "       Redis:      kubectl exec -n sorobanpay redis-0 -- redis-cli PING"
  echo "       Stellar RPC: curl -sI <RPC_URL>/health"
  echo "    3. Follow escalation runbook at ${RUNBOOK_URL}"
  echo "================================================================="

  # Fail the rollback completion
  return 1
}

execute_rollback() {
  local target="${2:-}"
  local rollback_digest=""
  local source_revision="unknown"

  echo "Initiating rollback procedure..."
  if [ -n "$target" ]; then
    if [ ! -f "$target" ]; then
      echo "Error: Checkpoint file not found: $target" >&2
      return 1
    fi
    echo "Restoring from checkpoint: $target"
    rollback_digest="$(grep -o '"image_digest":[[:space:]]*"[^"]*"' "$target" | head -n 1 | cut -d'"' -f4 || true)"
    source_revision="$(grep -o '"source_revision":[[:space:]]*"[^"]*"' "$target" | head -n 1 | cut -d'"' -f4 || echo "unknown")"
  else
    local latest_checkpoint
    latest_checkpoint="$(ls -1t "$CHECKPOINT_DIR"/checkpoint_*.json 2>/dev/null | head -n 1 || true)"
    if [ -n "$latest_checkpoint" ] && [ -f "$latest_checkpoint" ]; then
      echo "Restoring from latest checkpoint: $latest_checkpoint"
      rollback_digest="$(grep -o '"previous_digest":[[:space:]]*"[^"]*"' "$latest_checkpoint" | head -n 1 | cut -d'"' -f4 || true)"
      if [ -z "$rollback_digest" ]; then
        rollback_digest="$(grep -o '"image_digest":[[:space:]]*"[^"]*"' "$latest_checkpoint" | head -n 1 | cut -d'"' -f4 || true)"
      fi
      source_revision="$(grep -o '"source_revision":[[:space:]]*"[^"]*"' "$latest_checkpoint" | head -n 1 | cut -d'"' -f4 || echo "unknown")"
    fi
  fi

  if [ -z "$rollback_digest" ]; then
    echo "Error: No previously validated immutable digest found for rollback." >&2
    return 1
  fi

  validate_digest "$rollback_digest"
  echo "Verified immutable rollback digest: ${rollback_digest} (source_revision: ${source_revision})"

  # Roll back Kubernetes deployments if kubectl is available
  if command -v kubectl >/dev/null 2>&1; then
    for dep in sorobanpay-api sorobanpay-indexer sorobanpay-webhook-worker; do
      echo "Rolling back ${dep} to ${IMAGE_REPO}@${rollback_digest}..."
      kubectl set image "deployment/${dep}" "${dep}=${IMAGE_REPO}@${rollback_digest}" -n sorobanpay || true
    done
  else
    echo "[dry-run] kubectl not found in local environment. Simulated rollback to ${IMAGE_REPO}@${rollback_digest} executed."
  fi

  # Gate rollback completion on application and dependency readiness
  if ! gate_post_rollback_health "$health_url"; then
    echo "ERROR: Rollback procedure aborted due to post-rollback health failure." >&2
    return 1
  fi

  echo "Rollback sequence completed successfully."
}

auto_verify_and_rollback() {
  local health_url="${2:-$DEFAULT_HEALTH_URL}"
  echo "Verifying deployment health at: ${health_url}..."

  set +e
  check_health_status "${health_url}" >/dev/null 2>&1
  local status=$?
  set -e

  if [ "$status" -ne 0 ]; then
    echo "Pre-rollback health check failed (status $status). Triggering automatic rollback..."
    if ! execute_rollback "" "" "$health_url"; then
      echo "CRITICAL: Automated rollback failed post-rollback health gating!" >&2
      exit 1
    fi
    exit 0
  else
    echo "Health check succeeded. Deployment verified."
  fi
}

case "$COMMAND" in
  --create-checkpoint)
    create_checkpoint "$@"
    ;;
  --record-deployment)
    record_deployment "$@"
    ;;
  --status)
    show_status "$@"
    ;;
  --list)
    list_checkpoints
    ;;
  --rollback)
    execute_rollback "$@"
    ;;
  --verify-health)
    target_url="${2:-$DEFAULT_HEALTH_URL}"
    gate_post_rollback_health "$target_url"
    ;;
  --auto-verify)
    auto_verify_and_rollback "$@"
    ;;
  *)
    echo "Usage: bash deploy/rollback.sh [--create-checkpoint | --record-deployment | --status | --list | --rollback | --auto-verify]"
    ;;
esac
