#!/usr/bin/env bash
# Automated tests for scripts/verify-image-attestation.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
VERIFY_SCRIPT="${REPO_ROOT}/scripts/verify-image-attestation.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

PASS=0
FAIL=0

assert_pass() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $name (expected exit 0)"
    FAIL=$((FAIL + 1))
  fi
}

assert_fail() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "FAIL: $name (expected non-zero exit)"
    FAIL=$((FAIL + 1))
  else
    echo "PASS: $name"
    PASS=$((PASS + 1))
  fi
}

# Fixtures
VALID_MANIFEST="${TMP_DIR}/valid-manifest.json"
cat > "$VALID_MANIFEST" << 'EOF'
{
  "artifact_id": "sorobanpay-abc12345-20260101T000000Z",
  "git_sha": "abc12345deadbeef",
  "build_time": "20260101T000000Z",
  "build_workflow": "Chrisland58/SorobanPay/.github/workflows/promotion-pipeline.yml@refs/heads/main",
  "workflow_run_id": "123456",
  "dependency_inventory": "sbom-inventory.json"
}
EOF

VALID_SBOM="${TMP_DIR}/valid-sbom.json"
cat > "$VALID_SBOM" << 'EOF'
{
  "bomFormat": "CycloneDX",
  "specVersion": "1.5",
  "components": [
    { "name": "soroban-subscription-contract", "type": "application" }
  ]
}
EOF

EMPTY_SBOM="${TMP_DIR}/empty-sbom.json"
cat > "$EMPTY_SBOM" << 'EOF'
{
  "bomFormat": "CycloneDX",
  "specVersion": "1.5",
  "components": []
}
EOF

MISSING_WORKFLOW_MANIFEST="${TMP_DIR}/missing-workflow.json"
cat > "$MISSING_WORKFLOW_MANIFEST" << 'EOF'
{
  "artifact_id": "sorobanpay-abc12345-20260101T000000Z",
  "git_sha": "abc12345deadbeef",
  "workflow_run_id": "123456",
  "dependency_inventory": "sbom-inventory.json"
}
EOF

INVALID_JSON="${TMP_DIR}/invalid.json"
echo "{ not valid json" > "$INVALID_JSON"

# 1. Expected behavior
assert_pass "valid manifest and sbom with matching sha and workflow" \
  bash "$VERIFY_SCRIPT" \
    --manifest "$VALID_MANIFEST" \
    --sbom "$VALID_SBOM" \
    --expected-sha "abc12345deadbeef" \
    --expected-workflow "Chrisland58/SorobanPay/.github/workflows/promotion-pipeline.yml@refs/heads/main"

# 2. Boundary cases
assert_fail "rejects empty SBOM components inventory" \
  bash "$VERIFY_SCRIPT" \
    --manifest "$VALID_MANIFEST" \
    --sbom "$EMPTY_SBOM" \
    --expected-sha "abc12345deadbeef"

assert_fail "rejects manifest missing build_workflow" \
  bash "$VERIFY_SCRIPT" \
    --manifest "$MISSING_WORKFLOW_MANIFEST" \
    --sbom "$VALID_SBOM" \
    --expected-sha "abc12345deadbeef"

assert_fail "rejects mismatched source commit sha" \
  bash "$VERIFY_SCRIPT" \
    --manifest "$VALID_MANIFEST" \
    --sbom "$VALID_SBOM" \
    --expected-sha "0000000000000000"

assert_fail "rejects untrusted build workflow" \
  bash "$VERIFY_SCRIPT" \
    --manifest "$VALID_MANIFEST" \
    --sbom "$VALID_SBOM" \
    --expected-workflow "untrusted/repo/.github/workflows/evil.yml@refs/heads/main"

# 3. Failure handling
assert_fail "rejects missing manifest file" \
  bash "$VERIFY_SCRIPT" \
    --manifest "${TMP_DIR}/nonexistent.json" \
    --sbom "$VALID_SBOM"

assert_fail "rejects missing sbom file" \
  bash "$VERIFY_SCRIPT" \
    --manifest "$VALID_MANIFEST" \
    --sbom "${TMP_DIR}/nonexistent-sbom.json"

assert_fail "rejects malformed JSON manifest" \
  bash "$VERIFY_SCRIPT" \
    --manifest "$INVALID_JSON" \
    --sbom "$VALID_SBOM"

assert_fail "rejects --verify-gh-attestation without --repo" \
  bash "$VERIFY_SCRIPT" \
    --manifest "$VALID_MANIFEST" \
    --sbom "$VALID_SBOM" \
    --verify-gh-attestation

echo "Summary: ${PASS} passed, ${FAIL} failed"
[[ "$FAIL" -eq 0 ]]
