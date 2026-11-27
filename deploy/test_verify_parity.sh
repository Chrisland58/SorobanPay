#!/usr/bin/env bash
# =============================================================================
# Offline tests for deploy/verify_parity.sh
# =============================================================================
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/verify_parity.sh"
TMP_ROOT="$(mktemp -d)"
PASS=0
FAIL=0

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

# ── 1. Syntax check ───────────────────────────────────────────────────────────
if bash -n "$SCRIPT" 2>/dev/null; then
  pass "syntax check"
else
  fail "syntax check"
fi

# ── Fixture helper ────────────────────────────────────────────────────────────
make_manifest() {
  local path="$1"
  local network="$2"
  local contract_id="$3"
  cat > "$path" <<JSON
{
  "${network}": {
    "network": "${network}",
    "contract_id": "${contract_id}"
  }
}
JSON
}

CONTRACT_A="CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
CONTRACT_B="CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"

# ── 2. Positive path: matching testnet configuration ──────────────────────────
MANIFEST_OK="$TMP_ROOT/deployments_ok.json"
make_manifest "$MANIFEST_OK" "testnet" "$CONTRACT_A"

if env -i PATH="$PATH" \
  BACKEND_STELLAR_NETWORK="testnet" \
  BACKEND_CONTRACT_ID="$CONTRACT_A" \
  FRONTEND_STELLAR_NETWORK="testnet" \
  FRONTEND_CONTRACT_ID="$CONTRACT_A" \
  bash "$SCRIPT" --target-network testnet --manifest "$MANIFEST_OK" >/dev/null 2>&1; then
  pass "matching testnet configuration passes"
else
  fail "matching testnet configuration passes"
fi

# ── 3. Deliberate mismatch test: deployment stopped before traffic shift ──────
TRAFFIC_SHIFT_MARKER="$TMP_ROOT/traffic_shifted"
rm -f "$TRAFFIC_SHIFT_MARKER"

set +e
MISMATCH_OUT=$(
  env -i PATH="$PATH" \
    BACKEND_STELLAR_NETWORK="testnet" \
    BACKEND_CONTRACT_ID="$CONTRACT_A" \
    FRONTEND_STELLAR_NETWORK="testnet" \
    FRONTEND_CONTRACT_ID="$CONTRACT_B" \
    bash -c '
      if bash "$1" --target-network testnet --manifest "$2"; then
        touch "$3"
      fi
    ' _ "$SCRIPT" "$MANIFEST_OK" "$TRAFFIC_SHIFT_MARKER" 2>&1
)
MISMATCH_RC=$?
set -e

if [[ $MISMATCH_RC -eq 0 && ! -f "$TRAFFIC_SHIFT_MARKER" ]] && echo "$MISMATCH_OUT" | grep -q "frontend"; then
  pass "deliberate contract_id mismatch stops deployment before traffic shift and names component"
else
  fail "deliberate contract_id mismatch stops deployment before traffic shift and names component"
fi

# ── 4. Network identity mismatch test ─────────────────────────────────────────
set +e
NET_OUT=$(
  env -i PATH="$PATH" \
    BACKEND_STELLAR_NETWORK="mainnet" \
    BACKEND_CONTRACT_ID="$CONTRACT_A" \
    FRONTEND_STELLAR_NETWORK="testnet" \
    FRONTEND_CONTRACT_ID="$CONTRACT_A" \
    bash "$SCRIPT" --target-network testnet --manifest "$MANIFEST_OK" 2>&1
)
NET_RC=$?
set -e

if [[ $NET_RC -ne 0 ]] && echo "$NET_OUT" | grep -q "MISMATCH \[network\]" && echo "$NET_OUT" | grep -q "backend"; then
  pass "network identity mismatch fails and reports divergent component"
else
  fail "network identity mismatch fails and reports divergent component"
fi

# ── 5. Secret redaction test ──────────────────────────────────────────────────
SECRET_KEY="SSECRETKEYDONOTEXPOSE1234567890"
DB_URL="postgres://admin:supersecretpassword@db.internal:5432/sorobanpay"
JWT_SECRET="jwt-top-secret-token-value"

set +e
SECRET_OUT=$(
  env -i PATH="$PATH" \
    STELLAR_SECRET_KEY="$SECRET_KEY" \
    DATABASE_URL="$DB_URL" \
    JWT_SECRET="$JWT_SECRET" \
    BACKEND_STELLAR_NETWORK="testnet" \
    BACKEND_CONTRACT_ID="$CONTRACT_A" \
    FRONTEND_STELLAR_NETWORK="testnet" \
    FRONTEND_CONTRACT_ID="$CONTRACT_B" \
    bash "$SCRIPT" --target-network testnet --manifest "$MANIFEST_OK" 2>&1
)
SECRET_RC=$?
set -e

if [[ $SECRET_RC -ne 0 ]] \
  && ! echo "$SECRET_OUT" | grep -qF "$SECRET_KEY" \
  && ! echo "$SECRET_OUT" | grep -qF "$DB_URL" \
  && ! echo "$SECRET_OUT" | grep -qF "$JWT_SECRET"; then
  pass "secret values are never exposed in mismatch output"
else
  fail "secret values are never exposed in mismatch output"
fi

# ── 6. Boundary cases: missing config, missing manifest, invalid network ──────
if ! env -i PATH="$PATH" \
  BACKEND_STELLAR_NETWORK="testnet" \
  BACKEND_CONTRACT_ID="$CONTRACT_A" \
  bash "$SCRIPT" --target-network testnet --manifest "$MANIFEST_OK" >/dev/null 2>&1; then
  pass "missing frontend configuration fails"
else
  fail "missing frontend configuration fails"
fi

if ! bash "$SCRIPT" --target-network testnet --manifest "$TMP_ROOT/nonexistent.json" >/dev/null 2>&1; then
  pass "missing manifest file fails"
else
  fail "missing manifest file fails"
fi

if ! bash "$SCRIPT" --target-network invalidnet --manifest "$MANIFEST_OK" >/dev/null 2>&1; then
  pass "invalid target network fails"
else
  fail "invalid target network fails"
fi

echo ""
echo "Summary: ${PASS} passed, ${FAIL} failed"
[[ $FAIL -eq 0 ]]
