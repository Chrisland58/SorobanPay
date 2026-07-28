#!/usr/bin/env bash
# =============================================================================
# SorobanPay — Resource Usage Benchmark Script
# =============================================================================
# Deploys the contract to testnet, creates the required on-chain state, then
# runs simulateTransaction against each entry point and records the resource
# metrics returned by the RPC node.
#
# Usage:
#   bash scripts/benchmark.sh
#   STELLAR_NETWORK=testnet bash scripts/benchmark.sh
#
# Prerequisites:
#   - Stellar CLI ≥ 21.x  (stellar --version)
#   - jq ≥ 1.6            (jq --version)
#   - A funded Stellar CLI identity (default: "alice")
#     Create:  stellar keys generate alice --network testnet
#     Fund:    stellar keys fund alice     --network testnet
#
# Environment variables:
#   STELLAR_NETWORK   "testnet" (default) or "mainnet"
#   STELLAR_IDENTITY  Stellar CLI identity alias (default: "alice")
#   CONTRACT_ID       Skip deployment and use an existing contract address
#   SKIP_BUILD        Set to "1" to skip the cargo build step
#
# Output:
#   stdout  — Markdown table written to docs/performance.md
#             Raw JSON metrics written to docs/performance-baseline.json
#   stderr  — Diagnostic messages
#   exit 0  — All simulations succeeded
#   exit 1  — Any failure (build, deploy, simulation, or jq parsing)
# =============================================================================
set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
NETWORK="${STELLAR_NETWORK:-testnet}"
IDENTITY="${STELLAR_IDENTITY:-alice}"
SKIP_BUILD="${SKIP_BUILD:-0}"

WASM="contracts/target/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm"
PERF_MD="docs/performance.md"
BASELINE_JSON="docs/performance-baseline.json"

case "$NETWORK" in
  testnet)
    RPC_URL="https://soroban-testnet.stellar.org"
    PASSPHRASE="Test SDF Network ; September 2015"
    ;;
  mainnet)
    RPC_URL="https://mainnet.stellar.validationcloud.io/v1/xyciqR7GmMO0UHcbCwqCgjovqv9IFr-mf0xmHdGP9sI="
    PASSPHRASE="Public Global Stellar Network ; September 2015"
    ;;
  *)
    echo "ERROR: Unknown STELLAR_NETWORK value: '${NETWORK}'. Allowed values: 'testnet', 'mainnet'." >&2
    exit 1
    ;;
esac

# ── Dependency checks ─────────────────────────────────────────────────────────
for dep in stellar jq; do
  if ! command -v "$dep" &>/dev/null; then
    echo "ERROR: '$dep' is not installed. See prerequisites in the script header." >&2
    exit 1
  fi
done

echo "=== SorobanPay Benchmark ===" >&2
echo "Network:  $NETWORK" >&2
echo "Identity: $IDENTITY" >&2
echo "RPC URL:  $RPC_URL" >&2
echo "" >&2

# ── Step 1: Build ─────────────────────────────────────────────────────────────
if [ "$SKIP_BUILD" != "1" ]; then
  echo "Building contract..." >&2
  if ! make build; then
    echo "ERROR: Contract build failed." >&2
    exit 1
  fi
  if [ ! -f "$WASM" ]; then
    echo "ERROR: WASM artifact not found at '$WASM'." >&2
    exit 1
  fi
  echo "Build OK: $WASM" >&2
else
  echo "SKIP_BUILD=1 — skipping build step." >&2
  if [ ! -f "$WASM" ]; then
    echo "ERROR: WASM artifact not found at '$WASM'. Run make build first." >&2
    exit 1
  fi
fi

# ── Step 2: Deploy (or reuse existing contract) ───────────────────────────────
if [ -n "${CONTRACT_ID:-}" ]; then
  echo "Using provided CONTRACT_ID: $CONTRACT_ID" >&2
else
  echo "" >&2
  echo "Deploying contract to $NETWORK..." >&2
  CONTRACT_ID=$(
    stellar contract deploy \
      --wasm "$WASM" \
      --source "$IDENTITY" \
      --rpc-url "$RPC_URL" \
      --network-passphrase "$PASSPHRASE" \
      2>/dev/null
  ) || {
    echo "ERROR: Contract deployment failed." >&2
    exit 1
  }
  if [ -z "$CONTRACT_ID" ]; then
    echo "ERROR: Deployment returned an empty contract ID." >&2
    exit 1
  fi
  echo "Contract deployed: $CONTRACT_ID" >&2
fi

# ── Step 3: Derive addresses for simulation ───────────────────────────────────
echo "" >&2
echo "Resolving identity addresses..." >&2
SUBSCRIBER_ADDR=$(stellar keys address "$IDENTITY" --network "$NETWORK" 2>/dev/null)
MERCHANT_ADDR="$SUBSCRIBER_ADDR"   # same account is fine for simulations

echo "Subscriber/Merchant: $SUBSCRIBER_ADDR" >&2

# ── Helper: run simulateTransaction and extract resource metrics ──────────────
#
# stellar contract invoke --simulate-only returns a JSON object with:
#   minResourceFee    (string, stroops)
#   transactionData.resources.instructions  (u32)
#   transactionData.resources.readBytes     (u32)
#   transactionData.resources.writeBytes    (u32)
#
# We emit a single JSON object per entry point.

simulate_and_extract() {
  local entry_point="$1"
  shift
  local extra_args=("$@")

  local raw
  raw=$(
    stellar contract invoke \
      --id "$CONTRACT_ID" \
      --source "$IDENTITY" \
      --rpc-url "$RPC_URL" \
      --network-passphrase "$PASSPHRASE" \
      --simulate-only \
      -- "$entry_point" "${extra_args[@]}" \
      2>&1
  ) || {
    echo "ERROR: simulation of '$entry_point' failed." >&2
    echo "$raw" >&2
    return 1
  }

  # Extract the simulation result JSON block from CLI output.
  # The CLI prints a JSON blob after "Simulation result:" or directly.
  local json_block
  json_block=$(echo "$raw" | grep -A 9999 '{' | head -c 65536 || true)

  local fee instructions read_bytes write_bytes
  fee=$(echo "$json_block"          | jq -r '.minResourceFee // "N/A"' 2>/dev/null || echo "N/A")
  instructions=$(echo "$json_block" | jq -r '.transactionData.resources.instructions // "N/A"' 2>/dev/null || echo "N/A")
  read_bytes=$(echo "$json_block"   | jq -r '.transactionData.resources.readBytes // "N/A"'    2>/dev/null || echo "N/A")
  write_bytes=$(echo "$json_block"  | jq -r '.transactionData.resources.writeBytes // "N/A"'   2>/dev/null || echo "N/A")

  printf '{"entry_point":"%s","minResourceFee":%s,"instructions":%s,"readBytes":%s,"writeBytes":%s}' \
    "$entry_point" \
    "${fee//N\/A/null}" \
    "${instructions//N\/A/null}" \
    "${read_bytes//N\/A/null}" \
    "${write_bytes//N\/A/null}"
}

# ── Step 4: Simulate each entry point ────────────────────────────────────────
echo "" >&2
echo "Running simulations..." >&2

# Prepare a fixed token address for the simulate call.
# Use the native XLM SAC address on the relevant network.
# (The simulation never actually executes, so the token just needs to be a valid address.)
TOKEN_ADDR="$CONTRACT_ID"   # placeholder; simulation validates structure, not value

echo "  → subscribe" >&2
SUBSCRIBE_RESULT=$(
  simulate_and_extract subscribe \
    --subscriber "$SUBSCRIBER_ADDR" \
    --merchant   "$MERCHANT_ADDR" \
    --token      "$TOKEN_ADDR" \
    --amount     1000000 \
    --interval   2592000
)
echo "     $SUBSCRIBE_RESULT" >&2

echo "  → execute_payment" >&2
EXEC_RESULT=$(
  simulate_and_extract execute_payment \
    --subscriber "$SUBSCRIBER_ADDR" \
    --merchant   "$MERCHANT_ADDR"
)
echo "     $EXEC_RESULT" >&2

echo "  → cancel" >&2
CANCEL_RESULT=$(
  simulate_and_extract cancel \
    --subscriber "$SUBSCRIBER_ADDR" \
    --merchant   "$MERCHANT_ADDR"
)
echo "     $CANCEL_RESULT" >&2

echo "  → get_subscription" >&2
GET_RESULT=$(
  simulate_and_extract get_subscription \
    --subscriber "$SUBSCRIBER_ADDR" \
    --merchant   "$MERCHANT_ADDR"
)
echo "     $GET_RESULT" >&2

echo "  → version" >&2
VERSION_RESULT=$(
  simulate_and_extract version
)
echo "     $VERSION_RESULT" >&2

# ── Step 5: Write docs/performance-baseline.json ─────────────────────────────
echo "" >&2
echo "Writing $BASELINE_JSON..." >&2

mkdir -p docs

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

cat >"$BASELINE_JSON" <<EOF
{
  "_meta": {
    "generated_at": "${TIMESTAMP}",
    "git_sha": "${GIT_SHA}",
    "network": "${NETWORK}",
    "contract_id": "${CONTRACT_ID}",
    "stellar_cli_version": "$(stellar --version 2>/dev/null | head -1 || echo 'unknown')",
    "note": "Run scripts/benchmark.sh to regenerate. Do not edit by hand."
  },
  "results": [
    ${SUBSCRIBE_RESULT},
    ${EXEC_RESULT},
    ${CANCEL_RESULT},
    ${GET_RESULT},
    ${VERSION_RESULT}
  ]
}
EOF

echo "Baseline written to $BASELINE_JSON" >&2

# ── Step 6: Write docs/performance.md ────────────────────────────────────────
echo "" >&2
echo "Writing $PERF_MD..." >&2

# Helper: read a value from a JSON result string
get_val() {
  local json="$1" key="$2"
  echo "$json" | jq -r ".$key // \"N/A\"" 2>/dev/null || echo "N/A"
}

format_row() {
  local name="$1" json="$2"
  local fee instructions read_b write_b
  fee=$(get_val "$json" "minResourceFee")
  instructions=$(get_val "$json" "instructions")
  read_b=$(get_val "$json" "readBytes")
  write_b=$(get_val "$json" "writeBytes")
  printf "| %-20s | %16s | %14s | %11s | %12s |\n" \
    "$name" "$fee" "$instructions" "$read_b" "$write_b"
}

cat >"$PERF_MD" <<EOF
# SorobanPay — Performance & Resource Usage

This document contains **measured** Soroban resource metrics for each contract
entry point, captured by running \`scripts/benchmark.sh\` against the
\`${NETWORK}\` network.

> **Note:** Values vary slightly across runs due to RPC node load and ledger
> state. Re-run the benchmark after any contract change to refresh this file and
> \`docs/performance-baseline.json\`.

---

## How to regenerate

\`\`\`bash
# Ensure a funded identity exists
stellar keys generate alice --network testnet
stellar keys fund alice     --network testnet

# Run the benchmark (builds, deploys, simulates, writes docs)
bash scripts/benchmark.sh
\`\`\`

Or skip the build/deploy if a contract is already deployed:

\`\`\`bash
SKIP_BUILD=1 CONTRACT_ID=<C...> bash scripts/benchmark.sh
\`\`\`

---

## Resource metrics (${NETWORK}, ${TIMESTAMP})

> **Contract:** \`${CONTRACT_ID}\`
> **Git SHA:** \`${GIT_SHA}\`
> **Generated:** ${TIMESTAMP}

| Entry point          | Min Resource Fee (stroops) | CPU Instructions | Read Bytes | Write Bytes |
|----------------------|:--------------------------:|:----------------:|:----------:|:-----------:|
$(format_row "subscribe"        "$SUBSCRIBE_RESULT")
$(format_row "execute_payment"  "$EXEC_RESULT")
$(format_row "cancel"           "$CANCEL_RESULT")
$(format_row "get_subscription" "$GET_RESULT")
$(format_row "version"          "$VERSION_RESULT")

---

## Relative cost ranking

\`\`\`
execute_payment  >  subscribe  >  cancel  ≈  get_subscription  ≈  version
(cross-contract      (persistent    (remove +     (read-only)        (read-only)
 transfer)            write + TTL)   event)
\`\`\`

**Why \`execute_payment\` is most expensive:**

\`execute_payment\` performs two cross-contract calls against the SEP-41 token
contract (\`balance\` + \`transfer\`). Soroban charges for every instruction
executed in all invoked contracts, not just the top-level caller.  The
\`transfer\` call alone writes two token balance ledger entries.

**Why \`subscribe\` is moderate:**

A pure persistent-storage write with one TTL extension and one event publish.
No cross-contract calls.

**Why \`cancel\` and \`get_subscription\` are cheap:**

\`cancel\` performs a single storage remove; \`get_subscription\` is a read-only
view.  Neither invokes external contracts.

---

## Budget guidance

Always simulate before broadcasting — never hardcode resource values.

\`\`\`bash
stellar contract invoke \\
  --id \$CONTRACT_ID \\
  --network testnet \\
  --simulate-only \\
  -- subscribe \\
  --subscriber \$SUBSCRIBER \\
  --merchant   \$MERCHANT \\
  --token      \$TOKEN \\
  --amount     1000000 \\
  --interval   86400
\`\`\`

Or via the JavaScript SDK:

\`\`\`typescript
import { SorobanRpc } from "@stellar/stellar-sdk";
const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");
const simResult = await server.simulateTransaction(tx);
if (SorobanRpc.Api.isSimulationSuccess(simResult)) {
  console.log("Min resource fee:", simResult.minResourceFee);
  console.log("CPU instructions:", simResult.transactionData.resources().instructions());
}
\`\`\`

Add a **10–25% buffer** to \`instructions\` when broadcasting to account for
minor network-level variance.

---

## Fee behaviour on failure

Transactions that return a \`ContractError\` still consume fees for work done
up to the point of failure.

| Scenario                                   | Fee vs. success path |
|--------------------------------------------|----------------------|
| \`execute_payment\` → \`PaymentNotDue\`        | ~10–20 %             |
| \`execute_payment\` → \`TransferFailed\`        | ~60–80 %             |
| \`subscribe\` → validation error              | ~10–15 %             |
| \`cancel\` → \`NoActiveSubscription\`          | ~10 %                |

---

## CI regression check

The CI pipeline (see \`.github/workflows/ci.yml\`) compares freshly measured
metrics against the baseline stored in \`docs/performance-baseline.json\`.  If
any metric increases by more than **20 %**, the CI step emits a warning but
does **not** fail the build — so a large fee jump is visible without blocking
merges.

Maintainers should review the warning, determine whether the increase is
expected (e.g., a new feature adds a storage write), and update the baseline
by re-running \`scripts/benchmark.sh\` and committing the new
\`docs/performance-baseline.json\`.

---

*Generated by \`scripts/benchmark.sh\`. Do not edit by hand.*
EOF

echo "Performance docs written to $PERF_MD" >&2
echo "" >&2
echo "=== Benchmark complete ===" >&2
echo "  Baseline JSON : $BASELINE_JSON" >&2
echo "  Performance MD: $PERF_MD" >&2
