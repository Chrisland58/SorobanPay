# SorobanPay — Storage TTL Management Operational Guide

This guide explains how Soroban persistent-storage TTL works within SorobanPay, how to detect at-risk entries before they expire, how to extend TTL programmatically, and how to integrate TTL health checks into your backend monitoring.

---

## 1. TTL Concepts Recap

Soroban persistent storage entries carry a **Time-To-Live (TTL)** measured in **ledger numbers**, not wall-clock time. An entry whose TTL reaches zero is archived (deleted) by the network. Archived entries can be restored, but that requires a separate `restoreFootprint` operation and is far more expensive than keeping the entry alive in the first place.

### Constants

| Constant | Ledgers | Approximate wall-clock time |
|---|---|---|
| `MIN_TTL_LEDGERS` | 518,400 | ~30 days |
| `MAX_TTL_LEDGERS` | 6,307,200 | ~365 days |

These are defined in `contracts/subscription/src/storage.rs`:

```rust
/// ~30 days at 5-second ledger close time (518_400 ledgers)
pub const MIN_TTL_LEDGERS: u32 = 30 * 24 * 60 * 60 / 5;  // 518_400

/// ~365 days at 5-second ledger close time (6_307_200 ledgers)
pub const MAX_TTL_LEDGERS: u32 = 365 * 24 * 60 * 60 / 5;  // 6_307_200
```

> **Assumption**: 5-second average ledger close time. The Stellar network targets this, but actual close times vary slightly. Monitor [Stellar Dashboard](https://dashboard.stellar.org) for live close-time averages.

### How TTL is set in SorobanPay

Every write to persistent storage calls `extend_ttl` with the two constants:

```rust
env.storage()
    .persistent()
    .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);
```

This call says: *"If the current TTL is below `MIN_TTL_LEDGERS`, extend it to `MAX_TTL_LEDGERS`."* The effect is:

- A **new** subscription starts with ~365 days of TTL.
- Each successful `execute_payment` resets the clock back to ~365 days.
- An **inactive** subscription — one that has not had a payment collected in over ~335 days (MAX minus MIN) — will not be automatically refreshed and its TTL will fall toward zero.

---

## 2. Detecting At-Risk Entries

### What "at-risk" means

A subscription is at-risk when its remaining TTL ledgers are below the alert threshold:

```
alert_threshold = MIN_TTL_LEDGERS * 1.2  = 518_400 * 1.2 = 622_080 ledgers ≈ 36 days
```

The 20% buffer above `MIN_TTL_LEDGERS` gives operators enough runway to investigate and act before the entry auto-extends (or expires if payment is never triggered).

### Querying TTL via Soroban RPC

Use the `getLedgerEntries` JSON-RPC method. Each response includes a `liveUntilLedgerSeq` field — the last ledger at which the entry is guaranteed to exist.

#### Step 1 — Compute the ledger key

Soroban storage keys are XDR-encoded. For a `DataKey::Subscription(subscriber, merchant)` entry, the key is a `SCVal` of type `SCV_VEC` containing a discriminant and two `SCV_ADDRESS` values.

Use the `stellar-sdk` to build and encode the key:

```javascript
// scripts/check-ttl.mjs
// Usage: node scripts/check-ttl.mjs <subscriber_address> <merchant_address>
//
// Prerequisites:
//   npm install @stellar/stellar-sdk

import { Contract, xdr, SorobanRpc, StrKey, Address } from "@stellar/stellar-sdk";

const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.CONTRACT_ID;

if (!CONTRACT_ID) {
  console.error("ERROR: Set CONTRACT_ID environment variable.");
  process.exit(1);
}

const [, , subscriberArg, merchantArg] = process.argv;

if (!subscriberArg || !merchantArg) {
  console.error("Usage: node scripts/check-ttl.mjs <subscriber> <merchant>");
  process.exit(1);
}

const server = new SorobanRpc.Server(RPC_URL, { allowHttp: false });

// Build the storage key: DataKey::Subscription(subscriber, merchant)
// This mirrors the Rust enum variant encoding used by Soroban.
function buildSubscriptionKey(contractId, subscriber, merchant) {
  const key = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Subscription"),
    new Address(subscriber).toScVal(),
    new Address(merchant).toScVal(),
  ]);

  const ledgerKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key,
      durability: xdr.ContractDataDurability.persistent(),
    })
  );

  return ledgerKey.toXDR("base64");
}

async function checkTTL(subscriber, merchant) {
  const keyB64 = buildSubscriptionKey(CONTRACT_ID, subscriber, merchant);

  const response = await server.getLedgerEntries(
    xdr.LedgerKey.fromXDR(keyB64, "base64")
  );

  if (response.entries.length === 0) {
    console.log("No entry found (subscription does not exist or has expired).");
    return null;
  }

  const entry = response.entries[0];
  const latestLedger = response.latestLedger;
  const liveUntil = entry.liveUntilLedgerSeq;
  const remainingLedgers = liveUntil - latestLedger;

  // ~5-second ledger close time
  const remainingSeconds = remainingLedgers * 5;
  const remainingDays = (remainingSeconds / 86400).toFixed(1);

  const MIN_TTL = 518_400;
  const ALERT_THRESHOLD = Math.ceil(MIN_TTL * 1.2); // 622_080

  console.log(`Subscriber:        ${subscriber}`);
  console.log(`Merchant:          ${merchant}`);
  console.log(`Latest ledger:     ${latestLedger}`);
  console.log(`Live until ledger: ${liveUntil}`);
  console.log(`Remaining ledgers: ${remainingLedgers}`);
  console.log(`Remaining (approx):${remainingDays} days`);
  console.log(`Alert threshold:   ${ALERT_THRESHOLD} ledgers (~36 days)`);
  console.log(
    `Status:            ${remainingLedgers < ALERT_THRESHOLD ? "⚠️  AT-RISK" : "✅ OK"}`
  );

  return { remainingLedgers, liveUntil, isAtRisk: remainingLedgers < ALERT_THRESHOLD };
}

checkTTL(subscriberArg, merchantArg).catch((err) => {
  console.error("RPC error:", err.message);
  process.exit(1);
});
```

**Run against testnet:**

```bash
export CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
export RPC_URL=https://soroban-testnet.stellar.org

node scripts/check-ttl.mjs \
  GABC...SUBSCRIBER \
  GDEF...MERCHANT
```

**Example output:**

```
Subscriber:        GABC...SUBSCRIBER
Merchant:          GDEF...MERCHANT
Latest ledger:     5984210
Live until ledger: 6502610
Remaining ledgers: 518400
Remaining (approx):30.0 days
Alert threshold:   622080 ledgers (~36 days)
Status:            ⚠️  AT-RISK
```

### Batch scanning

To scan all subscriptions you track off-chain (e.g., from your event index), pass up to 200 keys per `getLedgerEntries` call:

```javascript
// scripts/batch-ttl-scan.mjs
// Reads a JSON array of {subscriber, merchant} pairs from stdin and reports
// all at-risk entries.
//
// Usage:
//   cat subscriptions.json | node scripts/batch-ttl-scan.mjs

import { xdr, SorobanRpc, Address } from "@stellar/stellar-sdk";
import { createInterface } from "readline";

const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.CONTRACT_ID;
const ALERT_THRESHOLD = Math.ceil(518_400 * 1.2); // 622_080 ledgers

if (!CONTRACT_ID) {
  console.error("ERROR: Set CONTRACT_ID environment variable.");
  process.exit(1);
}

function buildSubscriptionKey(contractId, subscriber, merchant) {
  const key = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Subscription"),
    new Address(subscriber).toScVal(),
    new Address(merchant).toScVal(),
  ]);
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key,
      durability: xdr.ContractDataDurability.persistent(),
    })
  );
}

async function main() {
  const lines = [];
  for await (const line of createInterface({ input: process.stdin })) {
    lines.push(line);
  }
  const pairs = JSON.parse(lines.join(""));

  const server = new SorobanRpc.Server(RPC_URL, { allowHttp: false });

  // getLedgerEntries accepts up to 200 keys; chunk if needed
  const CHUNK = 200;
  const atRisk = [];

  for (let i = 0; i < pairs.length; i += CHUNK) {
    const chunk = pairs.slice(i, i + CHUNK);
    const keys = chunk.map(({ subscriber, merchant }) =>
      buildSubscriptionKey(CONTRACT_ID, subscriber, merchant)
    );
    const response = await server.getLedgerEntries(...keys);
    const latestLedger = response.latestLedger;

    for (const entry of response.entries) {
      const remaining = entry.liveUntilLedgerSeq - latestLedger;
      if (remaining < ALERT_THRESHOLD) {
        atRisk.push({
          liveUntilLedgerSeq: entry.liveUntilLedgerSeq,
          remainingLedgers: remaining,
          remainingDays: ((remaining * 5) / 86400).toFixed(1),
        });
      }
    }
  }

  if (atRisk.length === 0) {
    console.log("All entries healthy.");
  } else {
    console.log(`\n⚠️  ${atRisk.length} at-risk entries:\n`);
    console.table(atRisk);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
```

---

## 3. Programmatic TTL Extension

The safest way to extend the TTL of an at-risk subscription is to call `subscribe()` with the **same values** that are already stored on-chain. This is a no-op from a business logic standpoint (same amount, token, interval) but it re-runs the `extend_ttl` call inside the contract, resetting the TTL back to `MAX_TTL_LEDGERS` (~365 days).

> **Why not use `extendFootprintTtl` directly?**  
> The Stellar CLI's `contract extend` / `stellar ledger-entry extend` commands can extend TTL without invoking contract logic. This is valid but requires the *subscriber's* authority because persistent storage writes are gated on authorization. Using `subscribe()` is safer because it goes through the same auth checks the contract already enforces, and it does not require any privileged key beyond the subscriber's own.

### Refresh via Stellar CLI

```bash
# Fetch current on-chain values first
stellar contract read \
  --id "$CONTRACT_ID" \
  --key "Subscription(GABC...SUBSCRIBER, GDEF...MERCHANT)" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$PASSPHRASE"

# Re-call subscribe() with the same values to refresh TTL
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$SUBSCRIBER_IDENTITY" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$PASSPHRASE" \
  -- subscribe \
  --subscriber "$SUBSCRIBER_ADDRESS" \
  --merchant  "$MERCHANT_ADDRESS" \
  --token     "$TOKEN_ADDRESS" \
  --amount    "$AMOUNT" \
  --interval  "$INTERVAL"
```

### Refresh via JavaScript SDK

```javascript
// scripts/refresh-ttl.mjs
// Reads the current subscription data and re-calls subscribe() with the
// same values to extend TTL to MAX_TTL_LEDGERS (~365 days).
//
// Usage:
//   node scripts/refresh-ttl.mjs <subscriber_address> <merchant_address>
//
// Prerequisites:
//   npm install @stellar/stellar-sdk
//
// Required env vars:
//   CONTRACT_ID, RPC_URL, NETWORK_PASSPHRASE
//   SUBSCRIBER_SECRET — signing key for the subscriber account

import {
  Contract,
  Keypair,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  xdr,
  Address,
  nativeToScVal,
  scValToNative,
} from "@stellar/stellar-sdk";

const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.CONTRACT_ID;
const NETWORK_PASSPHRASE =
  process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET;
const SUBSCRIBER_SECRET = process.env.SUBSCRIBER_SECRET;

if (!CONTRACT_ID || !SUBSCRIBER_SECRET) {
  console.error(
    "ERROR: Set CONTRACT_ID and SUBSCRIBER_SECRET environment variables."
  );
  process.exit(1);
}

const [, , subscriberArg, merchantArg] = process.argv;
if (!subscriberArg || !merchantArg) {
  console.error("Usage: node scripts/refresh-ttl.mjs <subscriber> <merchant>");
  process.exit(1);
}

async function refreshTTL(subscriberAddr, merchantAddr) {
  const server = new SorobanRpc.Server(RPC_URL, { allowHttp: false });
  const keypair = Keypair.fromSecret(SUBSCRIBER_SECRET);
  const account = await server.getAccount(keypair.publicKey());

  const contract = new Contract(CONTRACT_ID);

  // Step 1 — Read existing subscription data from on-chain storage
  const keyXdr = buildSubscriptionKey(CONTRACT_ID, subscriberAddr, merchantAddr);
  const { entries } = await server.getLedgerEntries(keyXdr);
  if (entries.length === 0) {
    throw new Error("Subscription not found on-chain.");
  }
  const existing = scValToNative(entries[0].val.contractData().val());
  console.log("Current subscription data:", existing);

  // Step 2 — Build subscribe() call with same values (TTL refresh)
  const tx = new TransactionBuilder(account, {
    fee: "1000000", // 0.1 XLM max fee — adjust per network conditions
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "subscribe",
        new Address(subscriberAddr).toScVal(),
        new Address(merchantAddr).toScVal(),
        new Address(existing.token).toScVal(),
        nativeToScVal(existing.amount, { type: "i128" }),
        nativeToScVal(existing.interval, { type: "u64" })
      )
    )
    .setTimeout(30)
    .build();

  // Step 3 — Simulate to get resource footprint
  const simResult = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  // Step 4 — Assemble, sign, and submit
  const prepared = SorobanRpc.assembleTransaction(tx, simResult).build();
  prepared.sign(keypair);
  const sendResult = await server.sendTransaction(prepared);

  if (sendResult.status === "ERROR") {
    throw new Error(`Send failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  // Step 5 — Poll for confirmation
  let getResult;
  do {
    await new Promise((r) => setTimeout(r, 2000));
    getResult = await server.getTransaction(sendResult.hash);
  } while (getResult.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND);

  if (getResult.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    console.log("✅ TTL refreshed successfully. Hash:", sendResult.hash);
  } else {
    throw new Error(`Transaction failed: ${JSON.stringify(getResult)}`);
  }
}

function buildSubscriptionKey(contractId, subscriber, merchant) {
  const key = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Subscription"),
    new Address(subscriber).toScVal(),
    new Address(merchant).toScVal(),
  ]);
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key,
      durability: xdr.ContractDataDurability.persistent(),
    })
  );
}

refreshTTL(subscriberArg, merchantArg).catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
```

---

## 4. Monitoring TTL in Your Backend Health Check

Add a TTL health check endpoint to your backend that queries a representative sample of subscriptions and reports at-risk entries. The example below is an Express middleware pattern, but the concept applies to any backend framework.

```javascript
// backend/health/ttl.js
// Expose as GET /health/ttl
// Returns 200 OK when all monitored entries are healthy,
//         503 Service Unavailable when any are at-risk.

import { xdr, SorobanRpc, Address } from "@stellar/stellar-sdk";

const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.CONTRACT_ID;
const ALERT_THRESHOLD = Math.ceil(518_400 * 1.2); // 622_080 ledgers (~36 days)

/**
 * @param {Array<{subscriber: string, merchant: string}>} subscriptions
 * @returns {Promise<{healthy: boolean, atRisk: Array, latestLedger: number}>}
 */
export async function checkSubscriptionTTLHealth(subscriptions) {
  if (!subscriptions || subscriptions.length === 0) {
    return { healthy: true, atRisk: [], latestLedger: 0 };
  }

  const server = new SorobanRpc.Server(RPC_URL, { allowHttp: false });
  const keys = subscriptions.map(({ subscriber, merchant }) =>
    buildSubscriptionKey(CONTRACT_ID, subscriber, merchant)
  );

  const response = await server.getLedgerEntries(...keys.slice(0, 200));
  const { latestLedger, entries } = response;

  const atRisk = entries
    .filter((e) => e.liveUntilLedgerSeq - latestLedger < ALERT_THRESHOLD)
    .map((e) => ({
      liveUntilLedgerSeq: e.liveUntilLedgerSeq,
      remainingLedgers: e.liveUntilLedgerSeq - latestLedger,
      remainingDays: (((e.liveUntilLedgerSeq - latestLedger) * 5) / 86400).toFixed(1),
    }));

  return { healthy: atRisk.length === 0, atRisk, latestLedger };
}

// Express route handler
export async function ttlHealthHandler(req, res) {
  try {
    // In production, load from your subscription database
    const subscriptions = await loadMonitoredSubscriptions();
    const result = await checkSubscriptionTTLHealth(subscriptions);
    const status = result.healthy ? 200 : 503;
    res.status(status).json(result);
  } catch (err) {
    res.status(500).json({ healthy: false, error: err.message });
  }
}

function buildSubscriptionKey(contractId, subscriber, merchant) {
  const key = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Subscription"),
    new Address(subscriber).toScVal(),
    new Address(merchant).toScVal(),
  ]);
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key,
      durability: xdr.ContractDataDurability.persistent(),
    })
  );
}
```

Add to your health-check cron or uptime monitor to poll `GET /health/ttl` every hour.

---

## 5. Edge Cases

### Yearly subscription TTL refresh cadence

A yearly subscription has `interval = 31_536_000` seconds (exactly `MAX_TTL_LEDGERS * 5` seconds). The payment is due once per year. After each `execute_payment`, the TTL is reset to ~365 days — so the entry stays alive as long as payments are collected on time.

**Risk**: If the merchant does not collect for more than ~335 days (MAX_TTL minus MIN_TTL), the TTL will fall below the alert threshold. At ~30 days remaining it will no longer be auto-extended, and if it hits zero the entry is archived.

**Mitigation**: For yearly subscriptions, schedule a TTL refresh (call `subscribe()` with the same values) at the ~330-day mark if no payment has been collected. This is safe because `subscribe()` only updates `next_payment` if it creates a new entry; an existing entry's `next_payment` is overwritten to `now + interval` — so call it only if the next payment is not due yet and you are purely refreshing TTL.

> ⚠️ **Important**: Calling `subscribe()` on an existing subscription resets `next_payment = now + interval`. If you call it close to when a payment is actually due, this could delay the merchant's ability to collect. Verify `next_payment` before triggering a TTL-only refresh.

### What happens after entry expiry

If a subscription entry's TTL reaches zero:

1. The entry transitions to **archived** state on the Stellar network.
2. Calls to `execute_payment` will return `ContractError::NoActiveSubscription` (the storage `get` returns `None`).
3. Calls to `subscribe()` with the same pair will **recreate** the entry fresh, as if it is a new subscription. `next_payment` is set to `now + interval`, resetting the billing cycle from scratch.
4. The subscriber must re-authorize the new `subscribe()` transaction.

**Recreation path**:
1. Subscriber signs a new `subscribe()` call with the same parameters.
2. Subscriber re-approves the SEP-41 token allowance if it was also expired.
3. Merchant resumes collecting via `execute_payment` after the new `next_payment` window.

---

## 6. Alert Threshold Justification

### Threshold: `MIN_TTL_LEDGERS × 1.2 = 622,080 ledgers ≈ 36 days`

**Rationale:**

- `MIN_TTL_LEDGERS` (518,400 / ~30 days) is the point at which Soroban will auto-extend a live entry back to `MAX_TTL_LEDGERS` on the next write. However, for inactive subscriptions, no write happens unless you explicitly call `subscribe()` or `execute_payment`.
- The 20% buffer (~6 extra days) provides a window to:
  - Receive the alert from your monitoring system.
  - Investigate whether the subscription is legitimately inactive or needs operator action.
  - Execute a TTL refresh transaction and have it confirmed on-chain.
- On testnet, where ledger close times can be faster than 5 seconds, 6 days of buffer is sufficient. On mainnet, 6 days is ample given a typical alert→response SLA of hours.
- Going lower (e.g., 5%) reduces the reaction window to ~1.5 days — too tight for on-call rotations.
- Going higher (e.g., 50%) would alert on entries that are healthy for another ~6 months, creating alert fatigue.

### Recommended alert levels

| Level | Remaining ledgers | Approximate time | Action |
|---|---|---|---|
| `INFO` | < 1,244,160 (~72 days) | Warning: entry inactive for 293+ days | Notify merchant to collect payment |
| `WARN` | < 622,080 (~36 days) | At-risk: no payment collected in ~329+ days | Trigger automated TTL refresh |
| `CRITICAL` | < 103,680 (~6 days) | Imminent expiry | Page on-call, manual intervention |

---

## See Also

- [Network Configuration Guide](./networks.md) — testnet vs. mainnet RPC and passphrase values
- [Backend API Cookbook](./api-cookbook.md) — Recipe 8: Monitor subscription TTL health
- `contracts/subscription/src/storage.rs` — TTL constant definitions
- [Soroban RPC getLedgerEntries spec](https://developers.stellar.org/docs/data/rpc/api-reference/methods/getLedgerEntries)
- [Soroban Storage and TTL](https://developers.stellar.org/docs/build/smart-contracts/storage/ttl)
## 8. Reconciliation Operations

The reconciler (`backend/reconciler.ts`) compares the canonical on-chain event log
with stored subscription records and repairs any divergence. This section explains
how to run it safely, how to interpret the `RepairReport`, and how to handle each
discrepancy category.

---

### 8.1 Overview

On-chain events are the **source of truth**. The backend's database is a derived
projection that must stay consistent with the event stream. Divergence can arise from:

- A process crash mid-write after events were indexed but before the DB was updated.
- Missed events during a temporary RPC outage.
- Manual DB modifications by an operator.
- Clock skew between event timestamp and the DB write time.

The reconciler is designed to be **idempotent**: running it multiple times produces
the same outcome. It never deletes data without first comparing it against the chain.

---

### 8.2 Dry-Run Mode

Always run in dry-run mode first. A dry run replays the event log, computes the
diff, and prints what would be done — without touching the database.

```typescript
// backend/reconciler.ts exports the reconcile() function.
// Dry-run: pass a no-op DB implementation that never writes.

import { reconcile } from './reconciler';
import type { SubscriptionDB } from './reconciler';

// Read-only stub — returns stored records but never applies changes
const dryRunDB: SubscriptionDB = {
  get:    (s, m, t) => liveDB.get(s, m, t),   // read from real DB
  upsert: (_r) => { /* no-op */ },
  delete: (_s, _m, _t) => { /* no-op */ },
  all:    () => liveDB.all(),
};

const { repairs, errors } = reconcile(events, dryRunDB);

console.log('Proposed repairs:', repairs.length);
console.log('Errors:', errors);
console.table(repairs);
```

Run from the backend directory:

```bash
cd backend
# Print the repair plan to stdout without touching the DB
npx ts-node scripts/reconcile-dry-run.ts \
  --from-cursor 0 \
  --to-ledger latest \
  --dry-run
```

Expected output (no divergence):

```
Proposed repairs: 0
Errors: []
```

Expected output (divergence found):

```
Proposed repairs: 3
Errors: ["orphan record in DB for GAAA:GBBB:CTOK — no on-chain subscribe event found"]
┌─────────┬──────────┬──────────────────────────────────────────────────────────┐
│ (index) │ kind     │ details                                                  │
├─────────┼──────────┼──────────────────────────────────────────────────────────┤
│ 0       │ 'insert' │ subscriber: 'GAAA', merchant: 'GBBB', token: 'CTOK'     │
│ 1       │ 'update' │ amount changed from 100000n to 200000n                   │
│ 2       │ 'delete' │ subscriber: 'GXXX', merchant: 'GYYY'                     │
└─────────┴──────────┴──────────────────────────────────────────────────────────┘
```

---

### 8.3 Discrepancy Categories

The `repairs` array returned by `reconcile()` contains actions of three kinds:

#### `insert` — missing DB record

**Cause:** A `subscribe` event exists on-chain but no corresponding row exists in
the database.

**Common triggers:**
- The indexer was down when the event was emitted.
- A database write failed after the event was consumed.

**Repair action:** The reconciler calls `db.upsert(record)` with the full
subscription state derived from the event log.

**Audit evidence:** Every `insert` repair is recorded in the `repairs[]` array with
the full `StoredSubscription` payload. Persist this to your audit log before
applying repairs:

```typescript
for (const repair of repairs.filter(r => r.kind === 'insert')) {
  auditLog.write({ action: 'reconcile:insert', record: repair.record, at: Date.now() });
}
```

---

#### `update` — stale or wrong DB record

**Cause:** A DB record exists but one or more fields diverge from the chain state
(e.g., `amount` differs after a re-subscribe, or `next_payment` was not advanced
after an `executed` event).

**Common triggers:**
- A re-subscribe changed the amount but the DB was not updated.
- A payment execution event was processed out of order.

**Repair action:** The reconciler calls `db.upsert(want)` with the chain-derived
state. The previous value is preserved in `repair.previous` for rollback if needed.

```typescript
for (const repair of repairs.filter(r => r.kind === 'update')) {
  console.log('Field changed:', {
    subscriber: repair.next.subscriber,
    previousAmount: repair.previous.amount,
    newAmount:      repair.next.amount,
    previousNextPayment: repair.previous.next_payment,
    newNextPayment:      repair.next.next_payment,
  });
}
```

---

#### `delete` — DB record with no on-chain subscription

**Cause:** A row in the database has no corresponding `subscribe` event (or was
followed by a `cancel` event). The DB record is an orphan.

**Common triggers:**
- A `cancel` event was indexed but the DB delete failed.
- A direct DB insert by a script that bypassed the indexer.

**Repair action:** The reconciler calls `db.delete(subscriber, merchant, token)`.

> **Warning:** Before approving a bulk delete repair, verify the event log cursor
> covers the full history from ledger 0. A partial event window could cause valid
> subscriptions to appear as orphans if their `subscribe` event falls before the
> scan window.

---

#### `errors` — non-fatal anomalies

The `errors` string array surfaces problems that cannot be auto-repaired:

| Error pattern | Meaning | Action |
|---|---|---|
| `orphan record in DB for ... — no on-chain subscribe event found` | DB row has no chain history in the scanned window | Widen the event window; if still orphaned, escalate |
| `executed event for ... has no preceding subscribe` | Payment recorded before subscription creation | Investigate cursor gap; re-index from an earlier ledger |

Errors do not prevent repair actions from being applied. Log them and escalate
if they persist after re-indexing.

---

### 8.4 Approval Workflow

The recommended workflow before applying repairs to production:

```
1. Run dry-run  →  review repairs[] and errors[]
2. Check event window coverage (ledger range)
3. Verify each 'delete' repair against your event index
4. Get a second reviewer to sign off on any bulk repair (> 10 rows)
5. Apply repairs in a transaction-backed run
6. Verify: re-run dry-run after apply — expected repairs: 0
```

For automated nightly reconciliation, configure approval gates:

```bash
# CI/CD gate: fail if unsupervised deletes exceed threshold
if [ "$(node reconcile.js --count-deletes)" -gt 5 ]; then
  echo "ERROR: Too many delete repairs — manual review required"
  exit 1
fi
```

---

### 8.5 Applying Repairs

Once dry-run output is approved, apply repairs by passing the live database
implementation:

```typescript
import { reconcile } from './reconciler';
import { db } from './src/lib/prisma';   // real Prisma-backed SubscriptionDB

const { repairs, errors } = reconcile(events, db);

// Emit a structured log line for every repair
for (const repair of repairs) {
  logger.info({ event: 'reconcile.repair', repair });
}

if (errors.length > 0) {
  logger.warn({ event: 'reconcile.errors', errors });
}
```

All repairs are applied synchronously in the order produced by the diff. The
reconciler does not open its own database transaction — wrap the call in a
transaction if atomicity is required:

```typescript
await prisma.$transaction(async (tx) => {
  const txDB = wrapPrismaAsSubscriptionDB(tx);
  const { repairs, errors } = reconcile(events, txDB);
  logger.info({ event: 'reconcile.complete', repairs: repairs.length, errors: errors.length });
});
```

---

### 8.6 Audit Evidence

Retain a full audit trail for every reconciliation run:

```typescript
interface ReconcileAuditRecord {
  runId:          string;   // UUID for this reconcile run
  startedAt:      string;   // ISO-8601
  completedAt:    string;
  ledgerFrom:     number;
  ledgerTo:       number;
  eventsScanned:  number;
  repairsApplied: number;
  repairDetails:  RepairAction[];
  errors:         string[];
  operator:       string;   // who triggered the run
}
```

Persist the audit record to the `audit_logs` table
(see `backend/migrations/20240101000002_create_audit_logs.js`) before the
transaction commits:

```typescript
await auditLogs.create({
  data: {
    action:  'reconcile',
    payload: JSON.stringify(auditRecord, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v
    ),
  },
});
```

> `bigint` values (`amount`) must be serialised to string before `JSON.stringify`.

---

### 8.7 Repair and Escalation Runbook

#### Step 1 — Identify the scope

```bash
# Count divergences by kind
node reconcile.js --dry-run --output json | jq 'group_by(.kind) | map({kind: .[0].kind, count: length})'
```

#### Step 2 — Widen the event window if orphans appear

```bash
# Re-index from ledger 0 (slow but conclusive)
node reconcile.js --from-cursor 0 --to-ledger latest --dry-run
```

If orphans disappear after widening the window, the original scan missed early
events. Extend the indexer's starting cursor.

#### Step 3 — Apply inserts and updates

```bash
node reconcile.js --apply --kinds insert,update
```

#### Step 4 — Review deletes separately

```bash
node reconcile.js --dry-run --kinds delete
# Manual review of each delete target before applying
node reconcile.js --apply --kinds delete --confirm
```

#### Step 5 — Verify

```bash
# After apply, dry-run should show 0 repairs
node reconcile.js --dry-run
# Expected: "Proposed repairs: 0"
```

#### Escalation criteria

Escalate to on-call engineering if:

- Repair count exceeds 100 in a single run with no obvious cause (e.g., RPC outage).
- Any `delete` repair appears for a subscription with recent `executed` events
  (indicates potential event-log truncation).
- `errors[]` contains more than 5 entries after re-indexing from ledger 0.
- The dry-run → apply → verify cycle still shows remaining repairs after two runs.

---

### See Also

- `backend/reconciler.ts` — reconcile function source
- `backend/reconciler.test.ts` — 10 scenario test suite (dry-run behaviour, orphan
  detection, full lifecycle)
- `backend/migrations/20240101000002_create_audit_logs.js` — audit log table schema
- `backend/migrations/20240101000006_create_indexer_state.js` — indexer cursor state
- [Observability section (§7)](#7-observability-logs-metrics-traces-and-correlation-ids) — how to correlate reconcile logs
