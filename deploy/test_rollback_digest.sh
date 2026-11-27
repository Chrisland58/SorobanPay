#!/usr/bin/env bash
# =============================================================================
# deploy/test_rollback_digest.sh
#
# Automated coverage for immutable digest retention, deployment status
# recording, and digest-verified rollback in deploy/rollback.sh.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROLLBACK_SCRIPT="${SCRIPT_DIR}/rollback.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

DIGEST_1="sha256:1111111111111111111111111111111111111111111111111111111111111111"
DIGEST_2="sha256:2222222222222222222222222222222222222222222222222222222222222222"
REV_1="aaaaaaa1111111111111111111111111111111111"
REV_2="bbbbbbb2222222222222222222222222222222222"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; exit 1; }

# 1. Expected behavior: create checkpoint with immutable digest
out="$(bash "$ROLLBACK_SCRIPT" --create-checkpoint "C_TEST" "v1.0.0" "$DIGEST_1" "$REV_1")"
cp_file="$(echo "$out" | sed -n 's/^Checkpoint created: //p')"
[ -f "$cp_file" ] || fail "Checkpoint file was not created"
grep -q "\"image_digest\": \"${DIGEST_1}\"" "$cp_file" || fail "Checkpoint missing image_digest"
grep -q "\"source_revision\": \"${REV_1}\"" "$cp_file" || fail "Checkpoint missing source_revision"
pass "create checkpoint with immutable digest"

# 2. Expected behavior: record deployment and retain previous_digest
notes_file="${TMP_DIR}/release_notes.md"
bash "$ROLLBACK_SCRIPT" --record-deployment "testnet" "$DIGEST_1" "$REV_1" "$notes_file" >/dev/null
bash "$ROLLBACK_SCRIPT" --record-deployment "testnet" "$DIGEST_2" "$REV_2" "$notes_file" >/dev/null

status_out="$(bash "$ROLLBACK_SCRIPT" --status "testnet")"
echo "$status_out" | grep -q "Current Digest: ${DIGEST_2}" || fail "Status missing current digest"
echo "$status_out" | grep -q "Previous Digest: ${DIGEST_1}" || fail "Status missing previous digest"
echo "$status_out" | grep -q "Source Revision: ${REV_2}" || fail "Status missing source revision"
grep -q "$DIGEST_2" "$notes_file" || fail "Release notes missing deployed digest"
grep -q "$REV_2" "$notes_file" || fail "Release notes missing source revision"
pass "record deployment retains previous_digest and updates release notes"

# 3. Expected behavior: rollback using validated checkpoint digest
rb_out="$(bash "$ROLLBACK_SCRIPT" --rollback "$cp_file")"
echo "$rb_out" | grep -q "Verified immutable rollback digest: ${DIGEST_1}" || fail "Rollback did not verify immutable digest"
pass "rollback verifies immutable digest"

# 4. Failure handling: reject mutable tag instead of sha256 digest
if bash "$ROLLBACK_SCRIPT" --create-checkpoint "C_TEST" "latest" "latest" "$REV_1" >/dev/null 2>&1; then
  fail "Should reject mutable tag 'latest' as digest"
fi
pass "reject mutable tag in create-checkpoint"

if bash "$ROLLBACK_SCRIPT" --record-deployment "testnet" "sha256:short" "$REV_1" >/dev/null 2>&1; then
  fail "Should reject malformed sha256 digest"
fi
pass "reject malformed digest in record-deployment"

# 5. Failure handling: missing checkpoint file
if bash "$ROLLBACK_SCRIPT" --rollback "${TMP_DIR}/nonexistent.json" >/dev/null 2>&1; then
  fail "Should fail when checkpoint file does not exist"
fi
pass "fail on missing checkpoint file"

echo "All rollback digest tests passed."
