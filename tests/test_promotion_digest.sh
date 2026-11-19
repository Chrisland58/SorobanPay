#!/usr/bin/env bash
set -euo pipefail

# Automated tests for scripts/verify-promotion-digest.sh
# Covers expected digest verification, boundary/format checks, failure handling,
# and promotion audit record generation.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
VERIFY_SCRIPT="${REPO_ROOT}/scripts/verify-promotion-digest.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

ARTIFACT="${TMP_DIR}/soroban_subscription_contract.wasm"
MANIFEST="${TMP_DIR}/artifact-manifest.json"
AUDIT_FILE="${TMP_DIR}/promotion-audit-prod.json"

printf 'mock-wasm-binary-v1' > "$ARTIFACT"
EXPECTED_HEX="$(sha256sum "$ARTIFACT" | awk '{print $1}')"
EXPECTED_DIGEST="sha256:${EXPECTED_HEX}"

cat > "$MANIFEST" <<EOF
{
  "artifact_id": "sorobanpay-abc12345-20261119T000000Z",
  "git_sha": "abc1234567890abcdef1234567890abcdef123456",
  "wasm_digest": "${EXPECTED_DIGEST}"
}
EOF

echo "Test 1: verify succeeds with matching artifact and manifest digest"
bash "$VERIFY_SCRIPT" verify \
  --artifact "$ARTIFACT" \
  --expected-digest "$EXPECTED_DIGEST" \
  --manifest "$MANIFEST"

echo "Test 2: verify fails when artifact is tampered with"
printf 'tampered-wasm-binary' > "${TMP_DIR}/tampered.wasm"
if bash "$VERIFY_SCRIPT" verify \
  --artifact "${TMP_DIR}/tampered.wasm" \
  --expected-digest "$EXPECTED_DIGEST" \
  --manifest "$MANIFEST" 2>/dev/null; then
  echo "FAIL: Expected digest mismatch to fail" >&2
  exit 1
fi

echo "Test 3: verify fails when manifest digest mismatches"
cat > "${TMP_DIR}/bad-manifest.json" <<EOF
{
  "artifact_id": "sorobanpay-abc12345-20261119T000000Z",
  "wasm_digest": "sha256:0000000000000000000000000000000000000000000000000000000000000000"
}
EOF
if bash "$VERIFY_SCRIPT" verify \
  --artifact "$ARTIFACT" \
  --expected-digest "$EXPECTED_DIGEST" \
  --manifest "${TMP_DIR}/bad-manifest.json" 2>/dev/null; then
  echo "FAIL: Expected manifest mismatch to fail" >&2
  exit 1
fi

echo "Test 4: verify fails on invalid digest format"
if bash "$VERIFY_SCRIPT" verify \
  --artifact "$ARTIFACT" \
  --expected-digest "invalid-digest" 2>/dev/null; then
  echo "FAIL: Expected invalid digest format to fail" >&2
  exit 1
fi

echo "Test 5: record writes audit JSON with actor, timestamp, and commit metadata"
bash "$VERIFY_SCRIPT" record \
  --output "$AUDIT_FILE" \
  --artifact-id "sorobanpay-abc12345-20261119T000000Z" \
  --digest "$EXPECTED_DIGEST" \
  --git-sha "abc1234567890abcdef1234567890abcdef123456" \
  --environment "prod" \
  --promoted-from "staging" \
  --actor "release-approver" \
  --run-id "987654321" \
  --approval-status "approved"

grep -q '"actor": "release-approver"' "$AUDIT_FILE"
grep -q '"git_sha": "abc1234567890abcdef1234567890abcdef123456"' "$AUDIT_FILE"
grep -q "\"wasm_digest\": \"${EXPECTED_DIGEST}\"" "$AUDIT_FILE"
grep -q '"timestamp":' "$AUDIT_FILE"

echo "All promotion digest tests passed."
