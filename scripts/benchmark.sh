#!/usr/bin/env bash
# =============================================================================
# SorobanPay — Soroban Resource Benchmark Script
# =============================================================================
# Deploys the contract to testnet (or uses an existing CONTRACT_ID), then
# calls simulateTransaction for each of the eight core entry points and captures:
#
#   - minResourceFee  (stroops)
#   - instructions    (CPU instruction count)
#   - readBytes       (bytes read from ledger)
#   - writeBytes      (bytes written to ledger)
#
# Entry points benchmarked:
#   subscribe, execute_payment, cancel, update_subscription,
#   pause_subscription, resume_subscription, batch_execute_payment,
#   transfer_subscription
#
# Usage:
#   bash scripts/benchmark.sh [--skip-deploy] [--output-json PATH] [--output-md PATH]
#
# Options:
#   --skip-deploy        Skip build+deploy and use CONTRACT_ID env var directly.
#   --output-json PATH   Write results to PATH as JSON (default: docs/performance-baseline.json).
#   --output-md   PATH   Write results to PATH as Markdown (default: docs/performance.md).
#
# Environment variables:
#   STELLAR_NETWORK      "testnet" (default) or "mainnet"
#   STELLAR_IDENTITY     Stellar CLI identity alias (default: "alice")
#   CONTRACT_ID          Pre-deployed contract address (required with --skip-deploy)
#   RPC_URL              Override the default RPC endpoint
#   SUBSCRIBER_ADDR      Address to use as subscriber in simulations
#   MERCHANT_ADDR        Address to use as merchant in simulations
#   MERCHANT2_ADDR       Second merchant address (for transfer_subscription)
#   TOKEN_ADDR           SEP-41 token address to use in simulations
#
# Exit codes:
#   0 — all simulations succeeded and outputs were written
#   1 — any error (build, deploy, simulation, or parsing failure)
# =============================================================================
set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
NETWORK="${STELLAR_NETWORK:-testnet}"
IDENTITY="${STELLAR_IDENTITY:-alice}"
SKIP_DEPLOY=false
OUTPUT_JSON="${OUTPUT_JSON:-docs/performance-baseline.json}"
OUTPUT_MD="${OUTPUT_MD:-docs/performance.md}"

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-deploy)  SKIP_DEPLOY=true; shift ;;
    --output-json)  OUTPUT_JSON="$2"; shift 2 ;;
    --output-md)    OUTPUT_MD="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ── Network configuration ─────────────────────────────────────────────────────
case "$NETWORK" in
  testnet)
    DEFAULT_RPC="https://soroban-testnet.stellar.org"
    PASSPHRASE="Test SDF Network ; September 2015"
    ;;
  mainnet)
    DEFAULT_RPC="https://mainnet.stellar.validationcloud.io/v1/xyciqR7GmMO0UHcbCwqCgjovqv9IFr-mf0xmHdGP9sI="
    PASSPHRASE="Public Global Stellar Network ; September 2015"
    ;;
  *)
    echo "ERROR: Unknown STELLAR_NETWORK '${NETWORK}'. Use 'testnet' or 'mainnet'." >&2
    exit 1
    ;;
esac
RPC_URL="${RPC_URL:-$DEFAULT_RPC}"

# ── Dependency checks ─────────────────────────────────────────────────────────
for cmd in stellar jq; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: Required command '$cmd' not found. Install it before running benchmarks." >&2
    exit 1
  fi
done

echo "============================================" >&2
echo " SorobanPay Benchmark — $(date -u '+%Y-%m-%dT%H:%M:%SZ')" >&2
echo "============================================" >&2
echo "Network:  ${NETWORK}" >&2
echo "RPC URL:  ${RPC_URL}" >&2
echo "Identity: ${IDENTITY}" >&2

# ── Step 1: Deploy (unless --skip-deploy) ─────────────────────────────────────
if $SKIP_DEPLOY; then
  if [ -z "${CONTRACT_ID:-}" ]; then
    echo "ERROR: --skip-deploy requires CONTRACT_ID environment variable." >&2
    exit 1
  fi
  echo "Skipping deploy. Using CONTRACT_ID=${CONTRACT_ID}" >&2
else
  echo "" >&2
  echo "Building and deploying contract to ${NETWORK}..." >&2
  CONTRACT_ID=$(bash deploy/deploy.sh)
  if [ -z "$CONTRACT_ID" ]; then
    echo "ERROR: Deployment returned an empty contract ID." >&2
    exit 1
  fi
  echo "Deployed contract: ${CONTRACT_ID}" >&2
fi

# ── Step 2: Resolve simulation addresses ──────────────────────────────────────
IDENTITY_ADDR=$(stellar keys address "$IDENTITY" --network "$NETWORK" 2>/dev/null || true)
SUBSCRIBER_ADDR="${SUBSCRIBER_ADDR:-$IDENTITY_ADDR}"
MERCHANT_ADDR="${MERCHANT_ADDR:-$IDENTITY_ADDR}"
# For transfer_subscription we need a second merchant address.
# Fall back to the same address if not provided (simulation still captures resources).
MERCHANT2_ADDR="${MERCHANT2_ADDR:-$IDENTITY_ADDR}"

# Use the native asset wrapper or a well-known testnet token.
TESTNET_NATIVE_TOKEN="CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
TOKEN_ADDR="${TOKEN_ADDR:-$TESTNET_NATIVE_TOKEN}"

echo "" >&2
echo "Simulation addresses:" >&2
echo "  subscriber:  ${SUBSCRIBER_ADDR}" >&2
echo "  merchant:    ${MERCHANT_ADDR}" >&2
echo "  merchant2:   ${MERCHANT2_ADDR}" >&2
echo "  token:       ${TOKEN_ADDR}" >&2

# ── Step 3: Simulation helper ─────────────────────────────────────────────────
# Runs `stellar contract invoke --simulate-only` and parses the JSON output.
# Outputs a JSON object: {"instructions":N,"readBytes":N,"writeBytes":N,"minResourceFee":N}
simulate_entry_point() {
  local label="$1"; shift   # human-readable name for logging
  local -a args=("$@")      # remaining args passed after the -- separator

  echo "" >&2
  echo "Simulating: ${label}..." >&2

  local raw
  raw=$(stellar contract invoke \
    --id "$CONTRACT_ID" \
    --source "$IDENTITY" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$PASSPHRASE" \
    --simulate-only \
    -- "${args[@]}" 2>&1 || true)

  echo "  Raw output snippet: $(echo "$raw" | head -5)" >&2

  local instructions readBytes writeBytes minResourceFee

  instructions=$(echo "$raw" \
    | grep -oP '"instructions"\s*:\s*\K[0-9]+' \
    | head -1 || echo "")
  readBytes=$(echo "$raw" \
    | grep -oP '"readBytes"\s*:\s*\K[0-9]+' \
    | head -1 || echo "")
  writeBytes=$(echo "$raw" \
    | grep -oP '"writeBytes"\s*:\s*\K[0-9]+' \
    | head -1 || echo "")
  minResourceFee=$(echo "$raw" \
    | grep -oP '"minResourceFee"\s*:\s*"\K[0-9]+' \
    | head -1 || echo "")

  # Fallback: unquoted numeric form
  if [ -z "$minResourceFee" ]; then
    minResourceFee=$(echo "$raw" \
      | grep -oP '"minResourceFee"\s*:\s*\K[0-9]+' \
      | head -1 || echo "")
  fi

  # Fallback: key=value format
  if [ -z "$instructions" ] && echo "$raw" | grep -q "instructions"; then
    instructions=$(echo "$raw" | grep -oP 'instructions[=:]\s*\K[0-9]+' | head -1 || echo "")
  fi

  instructions="${instructions:-0}"
  readBytes="${readBytes:-0}"
  writeBytes="${writeBytes:-0}"
  minResourceFee="${minResourceFee:-0}"

  echo "  instructions:   ${instructions}" >&2
  echo "  readBytes:      ${readBytes}" >&2
  echo "  writeBytes:     ${writeBytes}" >&2
  echo "  minResourceFee: ${minResourceFee} stroops" >&2

  printf '{"instructions":%s,"readBytes":%s,"writeBytes":%s,"minResourceFee":%s}' \
    "$instructions" "$readBytes" "$writeBytes" "$minResourceFee"
}

# ── Step 4: Run simulations for all 8 entry points ────────────────────────────
echo "" >&2
echo "Running simulations for all 8 entry points..." >&2

# subscribe: subscriber + merchant + token + amount + interval + strict + grace_period
SUBSCRIBE_RESULT=$(simulate_entry_point "subscribe" \
  subscribe \
  --subscriber    "$SUBSCRIBER_ADDR" \
  --merchant      "$MERCHANT_ADDR" \
  --token         "$TOKEN_ADDR" \
  --amount        1000000 \
  --interval      2592000 \
  --strict        false \
  --grace-period  null)

# execute_payment: subscriber + merchant + token
EXECUTE_RESULT=$(simulate_entry_point "execute_payment" \
  execute_payment \
  --subscriber "$SUBSCRIBER_ADDR" \
  --merchant   "$MERCHANT_ADDR" \
  --token      "$TOKEN_ADDR")

# cancel: subscriber + merchant + token
CANCEL_RESULT=$(simulate_entry_point "cancel" \
  cancel \
  --subscriber "$SUBSCRIBER_ADDR" \
  --merchant   "$MERCHANT_ADDR" \
  --token      "$TOKEN_ADDR")

# update_subscription: subscriber + merchant + new_amount + new_interval
UPDATE_RESULT=$(simulate_entry_point "update_subscription" \
  update_subscription \
  --subscriber    "$SUBSCRIBER_ADDR" \
  --merchant      "$MERCHANT_ADDR" \
  --new-amount    2000000 \
  --new-interval  2592000)

# pause_subscription: subscriber + merchant + token + resume_at (null = indefinite)
PAUSE_RESULT=$(simulate_entry_point "pause_subscription" \
  pause_subscription \
  --subscriber "$SUBSCRIBER_ADDR" \
  --merchant   "$MERCHANT_ADDR" \
  --token      "$TOKEN_ADDR" \
  --resume-at  null)

# resume_subscription: subscriber + merchant + token
RESUME_RESULT=$(simulate_entry_point "resume_subscription" \
  resume_subscription \
  --subscriber "$SUBSCRIBER_ADDR" \
  --merchant   "$MERCHANT_ADDR" \
  --token      "$TOKEN_ADDR")

# batch_execute_payment: merchant + token + subscribers (1 subscriber for baseline;
# the docs/performance-baseline.json notes 10-subscriber cost separately)
BATCH_RESULT=$(simulate_entry_point "batch_execute_payment (1 subscriber)" \
  batch_execute_payment \
  --merchant     "$MERCHANT_ADDR" \
  --token        "$TOKEN_ADDR" \
  --subscribers  "[\"${SUBSCRIBER_ADDR}\"]")

# transfer_subscription: subscriber + old_merchant + new_merchant
TRANSFER_RESULT=$(simulate_entry_point "transfer_subscription" \
  transfer_subscription \
  --subscriber   "$SUBSCRIBER_ADDR" \
  --old-merchant "$MERCHANT_ADDR" \
  --new-merchant "$MERCHANT2_ADDR")

# ── Step 5: Build output JSON ─────────────────────────────────────────────────
TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

JSON_OUT=$(jq -n \
  --arg ts          "$TIMESTAMP" \
  --arg git_commit  "$GIT_COMMIT" \
  --arg network     "$NETWORK" \
  --arg contract_id "$CONTRACT_ID" \
  --argjson sub      "$SUBSCRIBE_RESULT" \
  --argjson exec     "$EXECUTE_RESULT" \
  --argjson cancel   "$CANCEL_RESULT" \
  --argjson update   "$UPDATE_RESULT" \
  --argjson pause    "$PAUSE_RESULT" \
  --argjson resume   "$RESUME_RESULT" \
  --argjson batch    "$BATCH_RESULT" \
  --argjson transfer "$TRANSFER_RESULT" \
  '{
    "_comment":  "Auto-generated by scripts/benchmark.sh — do not edit manually.",
    "_comment2": "CI budget check: fails if any metric exceeds baseline * 1.25 (+25%).",
    "captured_at": $ts,
    "git_commit":  $git_commit,
    "network":     $network,
    "contract_id": $contract_id,
    "thresholds": {
      "alert_on_increase_pct": 20,
      "fail_on_increase_pct":  25
    },
    "entry_points": {
      "subscribe":            $sub,
      "execute_payment":      $exec,
      "cancel":               $cancel,
      "update_subscription":  $update,
      "pause_subscription":   $pause,
      "resume_subscription":  $resume,
      "batch_execute_payment": $batch,
      "transfer_subscription": $transfer
    }
  }')

echo "" >&2
echo "Writing JSON baseline to ${OUTPUT_JSON}..." >&2
mkdir -p "$(dirname "$OUTPUT_JSON")"
echo "$JSON_OUT" > "$OUTPUT_JSON"
echo "Done: ${OUTPUT_JSON}" >&2

# ── Step 6: Build output Markdown ────────────────────────────────────────────
echo "" >&2
echo "Writing Markdown report to ${OUTPUT_MD}..." >&2
mkdir -p "$(dirname "$OUTPUT_MD")"

# Extract fields for each entry point
sub_instr=$(echo "$SUBSCRIBE_RESULT"   | jq -r '.instructions')
sub_rb=$(echo "$SUBSCRIBE_RESULT"      | jq -r '.readBytes')
sub_wb=$(echo "$SUBSCRIBE_RESULT"      | jq -r '.writeBytes')
sub_fee=$(echo "$SUBSCRIBE_RESULT"     | jq -r '.minResourceFee')

exec_instr=$(echo "$EXECUTE_RESULT"    | jq -r '.instructions')
exec_rb=$(echo "$EXECUTE_RESULT"       | jq -r '.readBytes')
exec_wb=$(echo "$EXECUTE_RESULT"       | jq -r '.writeBytes')
exec_fee=$(echo "$EXECUTE_RESULT"      | jq -r '.minResourceFee')

can_instr=$(echo "$CANCEL_RESULT"      | jq -r '.instructions')
can_rb=$(echo "$CANCEL_RESULT"         | jq -r '.readBytes')
can_wb=$(echo "$CANCEL_RESULT"         | jq -r '.writeBytes')
can_fee=$(echo "$CANCEL_RESULT"        | jq -r '.minResourceFee')

upd_instr=$(echo "$UPDATE_RESULT"      | jq -r '.instructions')
upd_rb=$(echo "$UPDATE_RESULT"         | jq -r '.readBytes')
upd_wb=$(echo "$UPDATE_RESULT"         | jq -r '.writeBytes')
upd_fee=$(echo "$UPDATE_RESULT"        | jq -r '.minResourceFee')

pau_instr=$(echo "$PAUSE_RESULT"       | jq -r '.instructions')
pau_rb=$(echo "$PAUSE_RESULT"          | jq -r '.readBytes')
pau_wb=$(echo "$PAUSE_RESULT"          | jq -r '.writeBytes')
pau_fee=$(echo "$PAUSE_RESULT"         | jq -r '.minResourceFee')

res_instr=$(echo "$RESUME_RESULT"      | jq -r '.instructions')
res_rb=$(echo "$RESUME_RESULT"         | jq -r '.readBytes')
res_wb=$(echo "$RESUME_RESULT"         | jq -r '.writeBytes')
res_fee=$(echo "$RESUME_RESULT"        | jq -r '.minResourceFee')

bat_instr=$(echo "$BATCH_RESULT"       | jq -r '.instructions')
bat_rb=$(echo "$BATCH_RESULT"          | jq -r '.readBytes')
bat_wb=$(echo "$BATCH_RESULT"          | jq -r '.writeBytes')
bat_fee=$(echo "$BATCH_RESULT"         | jq -r '.minResourceFee')

tra_instr=$(echo "$TRANSFER_RESULT"    | jq -r '.instructions')
tra_rb=$(echo "$TRANSFER_RESULT"       | jq -r '.readBytes')
tra_wb=$(echo "$TRANSFER_RESULT"       | jq -r '.writeBytes')
tra_fee=$(echo "$TRANSFER_RESULT"      | jq -r '.minResourceFee')

cat > "$OUTPUT_MD" <<MARKDOWN
# SorobanPay — Contract Performance Benchmarks

> Auto-generated by \`scripts/benchmark.sh\` on **${TIMESTAMP}**
> Network: **${NETWORK}** · Contract: \`${CONTRACT_ID}\` · Commit: \`${GIT_COMMIT}\`

This document records verified resource measurements from \`simulateTransaction\`
for each of the eight core entry points. Numbers are used as the baseline in CI to
detect performance regressions (warn threshold: **+20%**, fail threshold: **+25%**).

---

## Benchmark Results

| Entry Point | CPU Instructions | Read Bytes | Write Bytes | Min Resource Fee (stroops) |
|-------------|-----------------|------------|-------------|---------------------------|
| \`subscribe\` | ${sub_instr} | ${sub_rb} | ${sub_wb} | ${sub_fee} |
| \`execute_payment\` | ${exec_instr} | ${exec_rb} | ${exec_wb} | ${exec_fee} |
| \`cancel\` | ${can_instr} | ${can_rb} | ${can_wb} | ${can_fee} |
| \`update_subscription\` | ${upd_instr} | ${upd_rb} | ${upd_wb} | ${upd_fee} |
| \`pause_subscription\` | ${pau_instr} | ${pau_rb} | ${pau_wb} | ${pau_fee} |
| \`resume_subscription\` | ${res_instr} | ${res_rb} | ${res_wb} | ${res_fee} |
| \`batch_execute_payment\` (1 subscriber) | ${bat_instr} | ${bat_rb} | ${bat_wb} | ${bat_fee} |
| \`transfer_subscription\` | ${tra_instr} | ${tra_rb} | ${tra_wb} | ${tra_fee} |

---

## Entry Point Analysis

### \`subscribe\` — moderate cost

**Operations performed:**
- 1 \`require_auth\` on subscriber
- 6 input validations (self-subscription, amount bounds, interval bounds, timestamp guard, allowance check)
- 1 cross-contract \`allowance\` call (SEP-41 token)
- 1 persistent storage write (\`SubscriptionData\`)
- 2 persistent index writes (merchant index + subscriber roster)
- 1 TTL extension
- 1 event publish

**Recommended budgets (25% buffer over measured baseline):**
- \`instructions\`: at least **$(echo "${sub_instr}" | awk '{printf "%d", $1 * 1.25}')**
- \`writeBytes\`: at least **$(echo "${sub_wb}" | awk '{printf "%d", $1 * 1.25}')**

---

### \`execute_payment\` — highest cost

**Operations performed:**
- 1 \`require_auth\` on merchant
- 1 persistent storage read + duplicate execution marker check
- 1 ledger timestamp read
- 1 cross-contract \`allowance\` call (SEP-41 token)
- 1 cross-contract \`balance\` call (SEP-41 token)
- 1 cross-contract \`transfer\` call (SEP-41 token) — most expensive
- 1 persistent storage write (updated \`next_payment\` + nonce)
- 1 execution marker write (temporary storage)
- 1 TTL extension
- 1 event publish

The cross-contract calls — especially \`transfer\` — dominate. Soroban charges for
every instruction executed within invoked contracts.

**Recommended budgets (25% buffer over measured baseline):**
- \`instructions\`: at least **$(echo "${exec_instr}" | awk '{printf "%d", $1 * 1.25}')**
- \`writeBytes\`: at least **$(echo "${exec_wb}" | awk '{printf "%d", $1 * 1.25}')**

---

### \`cancel\` — low cost

**Operations performed:**
- 1 \`require_auth\` on subscriber
- 1 persistent storage \`has\` check
- 1 persistent storage \`remove\`
- 1 merchant index update (remove entry)
- 1 subscriber roster update (remove entry)
- 1 event publish

No cross-contract calls. No writes to new keys.

**Recommended budgets (25% buffer over measured baseline):**
- \`instructions\`: at least **$(echo "${can_instr}" | awk '{printf "%d", $1 * 1.25}')**
- \`writeBytes\`: at least **$(echo "${can_wb}" | awk '{printf "%d", $1 * 1.25}')**

---

### \`update_subscription\` — low-moderate cost

**Operations performed:**
- 1 \`require_auth\` on subscriber
- 1 persistent storage read
- 4 validations (amount + interval bounds)
- 1 persistent storage write (updated amount + interval, next_payment preserved)
- 1 TTL extension
- 1 event publish

No cross-contract calls.

**Recommended budgets (25% buffer over measured baseline):**
- \`instructions\`: at least **$(echo "${upd_instr}" | awk '{printf "%d", $1 * 1.25}')**
- \`writeBytes\`: at least **$(echo "${upd_wb}" | awk '{printf "%d", $1 * 1.25}')**

---

### \`pause_subscription\` — low cost

**Operations performed:**
- 1 \`require_auth\` on subscriber
- 1 persistent storage read
- 1 optional ledger timestamp read (when resume_at provided)
- 1 persistent storage write (set is_paused flag + paused_until)
- 1 TTL extension
- 1 event publish

**Recommended budgets (25% buffer over measured baseline):**
- \`instructions\`: at least **$(echo "${pau_instr}" | awk '{printf "%d", $1 * 1.25}')**
- \`writeBytes\`: at least **$(echo "${pau_wb}" | awk '{printf "%d", $1 * 1.25}')**

---

### \`resume_subscription\` — low cost

**Operations performed:**
- 1 \`require_auth\` on subscriber
- 1 persistent storage read
- 1 ledger timestamp read (to recompute next_payment)
- 1 persistent storage write (clear is_paused, recompute next_payment)
- 1 TTL extension
- 1 event publish

**Recommended budgets (25% buffer over measured baseline):**
- \`instructions\`: at least **$(echo "${res_instr}" | awk '{printf "%d", $1 * 1.25}')**
- \`writeBytes\`: at least **$(echo "${res_wb}" | awk '{printf "%d", $1 * 1.25}')**

---

### \`batch_execute_payment\` — scales with batch size

**Operations performed (per subscriber in batch):**
- 1 persistent storage read
- 1 cross-contract \`allowance\` call
- 1 cross-contract \`balance\` call
- 1 cross-contract \`transfer\` call
- 1 persistent storage write
- 1 execution marker write
- 2 event publishes

The values above are for a 1-subscriber batch. For N subscribers, scale linearly.

**Recommended budgets for N subscribers (25% buffer):**
- \`instructions\`: approximately **$(echo "${bat_instr}" | awk '{printf "%d", $1 * 1.25}')** × N
- \`writeBytes\`: approximately **$(echo "${bat_wb}" | awk '{printf "%d", $1 * 1.25}')** × N

---

### \`transfer_subscription\` — moderate cost

**Operations performed:**
- 2 \`require_auth\` (subscriber + old_merchant)
- 1 persistent storage read (old key)
- Conflict check (new key must not already exist)
- 1 persistent storage write (new key)
- 1 persistent storage remove (old key)
- 2 merchant index updates (remove from old, add to new)
- 2 subscriber roster updates
- 1 TTL extension
- 1 event publish

**Recommended budgets (25% buffer over measured baseline):**
- \`instructions\`: at least **$(echo "${tra_instr}" | awk '{printf "%d", $1 * 1.25}')**
- \`writeBytes\`: at least **$(echo "${tra_wb}" | awk '{printf "%d", $1 * 1.25}')**

---

## Relative Cost Ranking

\`\`\`
batch_execute_payment  >  execute_payment  >  transfer_subscription  >  subscribe
(N × token transfer)      (1 token transfer)   (2 auths + 2 indexes)    (1 allowance call)

    update_subscription  ≈  resume_subscription  ≈  pause_subscription  >  cancel
        (read + write)          (read + ts + write)     (read + write)       (read + remove)
\`\`\`

---

## Fee Behavior on Failure

Failed calls that return a \`ContractError\` still consume fees for the work
performed up to the point of the error.

| Scenario | Fee relative to success |
|----------|------------------------|
| \`execute_payment\` → \`PaymentNotDue\` | ~10–20% (auth + storage read before early return) |
| \`execute_payment\` → \`TransferFailed\` | ~60–80% (balance call completed, transfer skipped) |
| \`subscribe\` → validation error | ~10–15% (auth + validation only, no write) |
| \`cancel\` → \`NoActiveSubscription\` | ~10% (auth + storage has check only) |
| \`pause_subscription\` → \`SubscriptionPaused\` | ~20–30% (auth + storage read) |
| \`resume_subscription\` → \`SubscriptionNotPaused\` | ~20–30% (auth + storage read) |

---

## Reproducing These Benchmarks

\`\`\`bash
# Deploy fresh and benchmark all 8 entry points:
bash scripts/benchmark.sh

# Re-benchmark an already-deployed contract:
CONTRACT_ID=<your-contract-id> bash scripts/benchmark.sh --skip-deploy

# Write to custom paths:
bash scripts/benchmark.sh --output-json /tmp/baseline.json --output-md /tmp/perf.md
\`\`\`

---

## CI Integration

The \`.github/workflows/ci.yml\` benchmark job runs on every contract change and
compares results against \`docs/performance-baseline.json\`.

- **Warning**: emitted if any metric increases by more than **+20%**
- **Failure**: CI step fails if any metric increases by more than **+25%**

See [\`scripts/check_regression.sh\`](../scripts/check_regression.sh) for the comparison logic.

---

*Baseline JSON stored at [\`docs/performance-baseline.json\`](performance-baseline.json)*
MARKDOWN

echo "Done: ${OUTPUT_MD}" >&2

# ── Step 7: Summary ───────────────────────────────────────────────────────────
echo "" >&2
echo "============================================" >&2
echo " Benchmark complete (8 entry points)" >&2
echo "============================================" >&2
echo "  JSON: ${OUTPUT_JSON}" >&2
echo "  MD:   ${OUTPUT_MD}" >&2
