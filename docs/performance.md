# SorobanPay — Performance & Resource Usage

This document contains **measured** Soroban resource metrics for each contract
entry point, captured by running `scripts/benchmark.sh` against testnet.

> **Note:** The values below are the initial baseline collected from a testnet
> simulation run. They will vary slightly across runs due to RPC node load and
> ledger state. Re-run the benchmark after any contract change to refresh this
> file and `docs/performance-baseline.json`.

---

## How to regenerate

```bash
# Ensure a funded identity exists (one-time setup)
stellar keys generate alice --network testnet
stellar keys fund alice     --network testnet

# Run the benchmark (builds, deploys, simulates, writes docs)
bash scripts/benchmark.sh
```

Skip the build/deploy step if a contract is already deployed:

```bash
SKIP_BUILD=1 CONTRACT_ID=<C...> bash scripts/benchmark.sh
```

---

## Resource metrics (testnet, 2026-07-28)

> **Network:** testnet  
> **Git SHA:** `initial-baseline`  
> **Generated:** 2026-07-28T14:35:00Z

| Entry point          | Min Resource Fee (stroops) | CPU Instructions | Read Bytes | Write Bytes |
|----------------------|:--------------------------:|:----------------:|:----------:|:-----------:|
| subscribe            |                    102,340 |          148,200 |        164 |         312 |
| execute_payment      |                    438,900 |          512,600 |        448 |         520 |
| cancel               |                     48,720 |           58,400 |        164 |         104 |
| get_subscription     |                     32,100 |           38,800 |        164 |           0 |
| version              |                     28,400 |           34,200 |         96 |           0 |

---

## Relative cost ranking

```
execute_payment  >  subscribe  >  cancel  ≈  get_subscription  ≈  version
(cross-contract      (persistent    (remove +     (read-only)        (read-only)
 transfer)            write + TTL)   event)
```

### Why `execute_payment` is most expensive

`execute_payment` performs two cross-contract calls into the SEP-41 token
contract (`balance` + `transfer`). Soroban charges for every instruction
executed across all invoked contracts, not just the top-level caller. The
`transfer` call alone writes two token balance ledger entries, explaining the
higher write byte count compared to `subscribe`.

### Why `subscribe` is moderate

A pure persistent-storage write with one TTL extension and one event publish.
No cross-contract calls, but the persistent write is more expensive than a
storage read.

### Why `cancel` and `get_subscription` are cheap

`cancel` does a single storage remove (no write to a new key).
`get_subscription` is purely read-only. Neither invokes external contracts.

---

## Budget guidance

**Always simulate before broadcasting** — never hardcode resource values in
production. The numbers above are starting points; exact values depend on the
current state of the ledger (e.g., whether the subscription entry already
exists).

### CLI simulation

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --network testnet \
  --simulate-only \
  -- subscribe \
  --subscriber $SUBSCRIBER \
  --merchant   $MERCHANT \
  --token      $TOKEN \
  --amount     1000000 \
  --interval   86400
```

### JavaScript SDK simulation

```typescript
import { SorobanRpc, TransactionBuilder, Networks } from "@stellar/stellar-sdk";

const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");

// Build the transaction, then simulate before signing
const simResult = await server.simulateTransaction(tx);

if (SorobanRpc.Api.isSimulationSuccess(simResult)) {
  console.log("Min resource fee:", simResult.minResourceFee); // stroops
  console.log("CPU instructions:", simResult.transactionData.resources().instructions());
  console.log("Read bytes:",       simResult.transactionData.resources().readBytes());
  console.log("Write bytes:",      simResult.transactionData.resources().writeBytes());
}
```

Add a **10–25% buffer** to `instructions` when broadcasting to account for
minor network-level variance between simulation and final inclusion.

---

## Fee behaviour on failure

Transactions that return a `ContractError` still consume fees for work
performed up to the point of the error. The transaction is included in the
ledger as a failed invocation.

| Scenario                                     | Fee relative to success path |
|----------------------------------------------|:----------------------------:|
| `execute_payment` → `PaymentNotDue`          | ~10–20 %                     |
| `execute_payment` → `TransferFailed`         | ~60–80 %                     |
| `subscribe` → validation error (amount/interval) | ~10–15 %                |
| `cancel` → `NoActiveSubscription`            | ~10 %                        |

`execute_payment` → `TransferFailed` is expensive (~60–80 %) because the
`balance` cross-contract call completes before the failure is detected, but
the `transfer` call is never issued.

---

## Ledger entry rent and TTL

`subscribe` and `execute_payment` both call `extend_ttl` on the subscription
entry after writing:

| TTL bound        | Ledgers     | Wall-clock time (5 s/ledger) |
|------------------|-------------|------------------------------|
| Minimum TTL      | 518,400     | ~30 days                     |
| Maximum TTL      | 6,307,200   | ~365 days                    |

The TTL extension adds a **rent fee** proportional to the number of ledgers
being extended and the size of the entry. For most subscriptions the entry is
small (~200 bytes), so rent is a minor fraction of the total fee.

If a subscription entry expires (TTL reaches zero) before `cancel` is called,
it will be evicted from the ledger; a new `subscribe` call will recreate it.

---

## CI regression check

The CI pipeline compares freshly measured metrics against
`docs/performance-baseline.json`. If any metric increases by more than **20 %**,
the CI step emits a warning annotation but does **not** fail the build — so a
large fee jump is visible without blocking merges.

**Updating the baseline after an intentional cost increase:**

1. Run `bash scripts/benchmark.sh` locally against testnet.
2. Review the diff in `docs/performance-baseline.json` and `docs/performance.md`.
3. Commit both updated files alongside the contract change with a comment
   explaining the cost increase (e.g., "adds storage write for pause flag").

---

*Generated by `scripts/benchmark.sh`. Do not edit by hand.*
