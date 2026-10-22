# SorobanPay — Storage TTL and Subscription Lifetime

This document is the complete reference for how SorobanPay manages Soroban persistent
storage Time-To-Live (TTL), how TTL interacts with the subscription lifecycle, what
happens when a subscription expires, the cost implications of TTL extension, how to
monitor TTL health, and what to do in an emergency when entries are about to expire.

---

## Table of Contents

1. [TTL constants and their rationale](#1-ttl-constants-and-their-rationale)
2. [How `extend_ttl` works in `subscribe` and `execute_payment`](#2-how-extend_ttl-works-in-subscribe-and-execute_payment)
3. [Subscription lifecycle and TTL](#3-subscription-lifecycle-and-ttl)
4. [What happens when a subscription expires](#4-what-happens-when-a-subscription-expires)
5. [Cost implications of TTL extension](#5-cost-implications-of-ttl-extension)
6. [How to monitor TTL health](#6-how-to-monitor-ttl-health)
7. [Emergency TTL extension procedure](#7-emergency-ttl-extension-procedure)
8. [Storage types in SorobanPay](#8-storage-types-in-sorobanpay)
9. [Frequently asked questions](#9-frequently-asked-questions)
10. [Data inventory and retention](#10-data-inventory-and-retention)

---

## 1. TTL constants and their rationale

Every Soroban persistent storage entry carries a **Time-To-Live (TTL)** measured in
**ledger numbers** — not wall-clock time. When an entry's TTL reaches zero, the
Soroban host archives it and it is treated as non-existent by all contract reads.

### The two constants

```rust
// contracts/subscription/src/storage.rs

/// Threshold below which an entry's TTL is extended on the next active write.
/// ~30 days at 5-second ledger close time.
pub const MIN_TTL_LEDGERS: u32 = 30 * 24 * 60 * 60 / 5;   // 518_400 ledgers

/// Target TTL after an extension. ~365 days at 5-second ledger close time.
pub const MAX_TTL_LEDGERS: u32 = 365 * 24 * 60 * 60 / 5;  // 6_307_200 ledgers
```

### Ledger-to-time conversion

| Duration | Ledgers (at 5 s/ledger) |
|---|---|
| 1 day | 17,280 |
| 30 days | 518,400 |
| 365 days | 6,307,200 |

> **Caveat:** Stellar targets 5-second ledger close times on mainnet, but actual close
> times fluctuate. TTL counts are authoritative in ledgers; the day approximations
> above are estimates. Monitor the [Stellar Dashboard](https://dashboard.stellar.org)
> for live average close times.

### Why 30 days as the threshold?

The 30-day threshold (`MIN_TTL_LEDGERS`) balances two competing concerns:

1. **Cost efficiency:** Extending TTL costs a rent fee proportional to the entry size
   and the number of ledgers added. If the threshold were 1 ledger, every payment
   would trigger a full 365-day extension. At 30 days, extensions are triggered at
   most once every ~335 days (MAX minus MIN) for active subscriptions, reducing the
   frequency of rent payments.

2. **Safety margin:** 30 days gives operators enough runway to detect at-risk entries
   and intervene before they expire. For subscriptions on a 30-day interval, a
   successful payment resets the TTL — so the threshold is effectively never hit on
   healthy monthly subscriptions.

### Why 365 days as the ceiling?

The 365-day ceiling (`MAX_TTL_LEDGERS`) ensures that an active subscription survives
the longest supported billing interval (1 year at `interval = 31_536_000 s`). After
each payment the TTL resets to 365 days — guaranteeing the entry lives until the next
payment is due regardless of billing cadence.

---

## 2. How `extend_ttl` works in `subscribe` and `execute_payment`

### The `extend_ttl` call

```rust
env.storage()
    .persistent()
    .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);
```

The Soroban host interprets this as:

- **If** the entry's remaining TTL is already `> MIN_TTL_LEDGERS` — do nothing. No
  fee is charged; no storage write occurs.
- **If** the entry's remaining TTL is `≤ MIN_TTL_LEDGERS` — bump the TTL up to
  `MAX_TTL_LEDGERS`. A rent fee is charged proportional to `(MAX − current_TTL) ×
  entry_size`.

This conditional behaviour is the key cost-saving mechanism: the fee is only incurred
when the entry is genuinely at risk.

### In `subscribe`

`subscribe` calls `extend_ttl` unconditionally after every successful write. Because a
new or updated subscription starts with zero TTL (it was just written), the Soroban
host always extends it to `MAX_TTL_LEDGERS`.

```rust
// contracts/subscription/src/lib.rs (simplified)
env.storage().persistent().set(&key, &data);
env.storage()
    .persistent()
    .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);
```

**Effect:** A freshly created or modified subscription always starts with ~365 days of
guaranteed life.

### In `execute_payment`

`execute_payment` calls `extend_ttl` after a successful token transfer. This keeps an
active subscription alive as long as payments are being collected.

```rust
// contracts/subscription/src/lib.rs (simplified)
token::Client::new(&env, &token).transfer(&subscriber, &merchant, &data.amount);
data.next_payment = checked_next_payment(now, data.interval)?;
env.storage().persistent().set(&key, &data);
env.storage()
    .persistent()
    .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);
```

**Effect:** Each successful payment resets the subscription's TTL to ~365 days.

### When TTL is NOT extended

| Operation | TTL extended? | Reason |
|---|---|---|
| `subscribe` | ✅ Always | New/updated subscription needs maximum lifetime |
| `execute_payment` (success) | ✅ Always | Active subscription; reset clock |
| `execute_payment` (failure — `TransferFailed`) | ❌ No | Failed payment should not silently keep a problematic record alive |
| `execute_payment` (failure — `PaymentNotDue`) | ❌ No | Not a write; contract returns early |
| `cancel` | ❌ N/A | Entry is removed entirely |
| `get_subscription` | ❌ No | Read-only; no write occurs |
| `batch_execute_payment` (per-subscriber success) | ✅ Yes (per entry) | Same as single `execute_payment` |
| `batch_execute_payment` (per-subscriber skip) | ❌ No | No write occurred for that subscriber |

---

## 3. Subscription lifecycle and TTL

### Full lifecycle diagram

```
subscribe() called
       │
       ▼
Storage entry written
TTL set to MAX_TTL_LEDGERS (~365 days)
       │
       │   (time passes, TTL counts down)
       │
       ▼
execute_payment() called — payment due
       │
       ├── Transfer succeeds ─────────────────►  TTL reset to MAX (~365 days)
       │                                          next_payment advanced by interval
       │
       └── Transfer fails (insufficient balance) ►  TTL NOT extended
                                                     overdue_since timestamp recorded
                                                     Merchant may retry later
       │
       │   (if no activity for ~335+ days, TTL falls to MIN or below)
       │
       ▼
[No payment collected — TTL falls toward zero]
       │
       ├── TTL reaches MIN_TTL_LEDGERS (~30 days left)
       │   └── No automatic extension occurs (no write to trigger it)
       │
       ▼
[TTL reaches zero]
       │
       └── Entry archived by Soroban host
           All reads return None
           execute_payment → NoActiveSubscription
           cancel → NoActiveSubscription
```

### The gap between MIN and MAX TTL

The gap between `MAX_TTL_LEDGERS` (~365 days) and `MIN_TTL_LEDGERS` (~30 days) is
~335 days. An active subscription on any billing interval ≤ 335 days will have its
TTL automatically refreshed on each payment before it approaches the 30-day threshold.

For annual subscriptions (`interval = 365 days`), a successful payment resets the TTL
to 365 days. Since the next payment is due in exactly 365 days, the TTL will drop
very close to zero before the next payment is collected. See
[§7 — Emergency TTL extension](#7-emergency-ttl-extension-procedure) for the
recommended handling of annual subscriptions.

---

## 4. What happens when a subscription expires

### Entry archival

When TTL reaches zero, the Soroban host **archives** the ledger entry. From the
contract's perspective, any read of that key returns `None` — equivalent to the entry
never having existed.

### Contract behaviour after expiry

| Operation | Result after TTL expiry |
|---|---|
| `get_subscription(subscriber, merchant, token)` | Returns `None` |
| `execute_payment(subscriber, merchant, token)` | Returns `ContractError::NoActiveSubscription` (code 4) |
| `cancel(subscriber, merchant, token)` | Returns `ContractError::NoActiveSubscription` (code 4) |
| `subscribe(subscriber, merchant, ...)` | Succeeds — recreates the entry as a brand-new subscription; `next_payment = now + interval` |

### Important: entry recreation resets the billing cycle

If a subscriber calls `subscribe()` after their entry has expired, the contract treats
it as a new subscription. The `next_payment` is set to `now + interval` — the billing
cycle restarts from the creation timestamp, not from the original `next_payment`.

This means the merchant will not be able to collect a payment for a full interval
after the re-subscription. Communicate this to merchants who rely on predictable
billing schedules.

### Entry archival vs. cancellation

| Aspect | TTL expiry (archival) | Cancellation (`cancel()`) |
|---|---|---|
| Cause | Soroban host removes entry after TTL = 0 | Explicit subscriber action |
| Recovery | Re-subscribe (new billing cycle from scratch) | Re-subscribe (new billing cycle from scratch) |
| `cancel` event emitted | ❌ No | ✅ Yes |
| Data permanently gone | ✅ Yes (from active storage) | ✅ Yes |
| Off-chain index impact | Indexer must detect via `NoActiveSubscription` or TTL monitoring | Indexer detects via `cancel` event |

---

## 5. Cost implications of TTL extension

### What drives the cost

Soroban's rent fee formula charges based on:
- **Entry size in bytes** — `SubscriptionData` is approximately 200 bytes.
- **Extension duration in ledgers** — `MAX_TTL_LEDGERS − current_TTL`.
- **Network write bytes fee** — set by protocol validators; varies with network load.

Because the contract extends TTL only when the entry is below `MIN_TTL_LEDGERS`, the
worst-case extension per payment is `MAX_TTL_LEDGERS` ledgers (a fresh entry or an
entry at zero). In practice, for any subscription paid on a billing interval shorter
than ~335 days, the extension is only triggered occasionally.

### Cost per operation

| Operation | TTL extension triggered? | Approximate additional fee |
|---|---|---|
| `subscribe` (new subscription) | ✅ Always | ~200–2,000 stroops |
| `execute_payment` (TTL already > 30 days) | ❌ No | 0 extra stroops |
| `execute_payment` (TTL ≤ 30 days) | ✅ Yes | ~200–2,000 stroops |
| `subscribe` (refresh — same values) | ✅ Always | ~200–2,000 stroops |

> Strop costs are approximate and depend on network fee conditions. Always simulate
> before submitting to get exact `minResourceFee` values.

### Cost optimization strategies

1. **Use the conditional extension:** The contract already implements this — `extend_ttl`
   is a no-op when TTL > `MIN_TTL_LEDGERS`. No action required from integrators.

2. **Avoid redundant `subscribe` calls:** Calling `subscribe` with the same values
   (as a TTL refresh) charges a full extension fee. Only do this when genuinely
   needed (see [§7](#7-emergency-ttl-extension-procedure)).

3. **Factor TTL costs into subscription pricing:** For low-value subscriptions (< 1,000
   stroops per payment), the TTL extension cost may be a non-trivial fraction of the
   payment amount. Price accordingly.

4. **For annual subscriptions:** Only one payment per year triggers a TTL extension.
   Budget for the additional rent fee in the annual billing transaction.

### How to get exact cost estimates

```bash
# Simulate subscribe to see exact resource fees
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network testnet \
  --simulate-only \
  -- subscribe \
  --subscriber "$SUBSCRIBER_ADDRESS" \
  --merchant   "$MERCHANT_ADDRESS" \
  --token      "$TOKEN_ADDRESS" \
  --amount     1000 \
  --interval   2592000
```

Or via the JavaScript SDK:

```typescript
const simResult = await server.simulateTransaction(tx);
if (SorobanRpc.Api.isSimulationSuccess(simResult)) {
  console.log("Min resource fee:", simResult.minResourceFee, "stroops");
  console.log("Write bytes:", simResult.transactionData.resources().writeBytes());
}
```

---

## 6. How to monitor TTL health

### What to monitor

For each active subscription in your off-chain database, track the `liveUntilLedgerSeq`
field returned by `getLedgerEntries`. Compute the remaining ledgers by subtracting
the current `latestLedger` sequence.

### Recommended alert thresholds

| Level | Remaining ledgers | Approximate time | Action |
|---|---|---|---|
| `INFO` | < 1,244,160 (~72 days) | Entry inactive for 293+ days | Notify merchant that no payment has been collected |
| `WARN` | < 622,080 (~36 days) | Entry inactive for 329+ days | Trigger automated TTL refresh (see §7) |
| `CRITICAL` | < 103,680 (~6 days) | Entry near expiry | Page on-call; perform manual emergency extension |

The `WARN` threshold is `MIN_TTL_LEDGERS × 1.2 = 518,400 × 1.2 = 622,080`. The 20%
buffer provides a reaction window before the entry hits the auto-extension floor.

### Check TTL for a single subscription

```javascript
// Usage: node check-ttl.mjs <subscriber> <merchant>
import { xdr, SorobanRpc, Address } from "@stellar/stellar-sdk";

const server = new SorobanRpc.Server(process.env.RPC_URL ?? "https://soroban-testnet.stellar.org");
const CONTRACT_ID = process.env.CONTRACT_ID;
const MIN_TTL = 518_400;
const ALERT_THRESHOLD = Math.ceil(MIN_TTL * 1.2); // 622_080

const [, , subscriberArg, merchantArg] = process.argv;

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

const ledgerKey = buildSubscriptionKey(CONTRACT_ID, subscriberArg, merchantArg);
const response = await server.getLedgerEntries(ledgerKey);

if (!response.entries.length) {
  console.log("No entry found — subscription does not exist or has expired.");
  process.exit(0);
}

const remaining = response.entries[0].liveUntilLedgerSeq - response.latestLedger;
const days = ((remaining * 5) / 86400).toFixed(1);
console.log(`Remaining: ${remaining} ledgers (~${days} days)`);
console.log(`Status: ${remaining < ALERT_THRESHOLD ? "⚠️  AT-RISK" : "✅ OK"}`);
```

### Batch scan (up to 200 entries per call)

```javascript
// Scan all tracked subscriptions and report at-risk entries
const CHUNK_SIZE = 200;
const atRisk = [];

for (let i = 0; i < subscriptions.length; i += CHUNK_SIZE) {
  const chunk = subscriptions.slice(i, i + CHUNK_SIZE);
  const keys = chunk.map(({ subscriber, merchant }) =>
    buildSubscriptionKey(CONTRACT_ID, subscriber, merchant)
  );
  const response = await server.getLedgerEntries(...keys);

  for (const entry of response.entries) {
    const remaining = entry.liveUntilLedgerSeq - response.latestLedger;
    if (remaining < ALERT_THRESHOLD) {
      atRisk.push({ liveUntilLedgerSeq: entry.liveUntilLedgerSeq, remaining });
    }
  }
}

console.log(atRisk.length === 0 ? "All entries healthy." : `⚠️ ${atRisk.length} at-risk.`);
```

### Backend health endpoint

Expose a `/health/ttl` endpoint in the backend that returns `503 Service Unavailable`
when any monitored subscription is at-risk. Kubernetes readiness probes and uptime
monitors can poll this endpoint.

```typescript
// backend/src/routes/ttl-health.ts
export async function ttlHealthHandler(req: Request, res: Response) {
  const subscriptions = await db.subscriptions.findActive();
  const { atRisk } = await checkSubscriptionTTLHealth(subscriptions);
  res.status(atRisk.length === 0 ? 200 : 503).json({ healthy: atRisk.length === 0, atRisk });
}
```

See [operations.md](./operations.md) for the full implementation of the monitoring
scripts, batch scan, and backend health endpoint.

---

## 7. Emergency TTL extension procedure

Use this procedure when a subscription's TTL has fallen below the `CRITICAL` threshold
(< ~6 days remaining) or when you need to extend TTL outside of the normal payment
cycle (e.g., for an annual subscription that has not been collected yet and is
approaching its TTL limit).

### When to use this procedure

- A subscription has been inactive for > 330 days and no payment is due yet.
- The monitoring alert fires `CRITICAL` (< 103,680 ledgers / ~6 days remaining).
- An annual subscription's payment is delayed and TTL is at risk.
- You want to proactively extend TTL for a high-value subscription ahead of a
  scheduled payment.

### Method: re-call `subscribe()` with the same values

The safest TTL extension method is to call `subscribe()` with the **exact same**
parameters already stored on-chain. From a business logic perspective this is a no-op
(amount, interval, token, and merchant are unchanged), but it triggers the `extend_ttl`
call inside the contract, resetting TTL to `MAX_TTL_LEDGERS` (~365 days).

> ⚠️ **Important side effect:** Calling `subscribe()` on an existing subscription
> also resets `next_payment = now + interval`. If a payment is nearly due, this
> delays the merchant's next collection window by the full interval. Always check
> `next_payment` before triggering an emergency extension, and coordinate with the
> merchant.

#### Step 1 — Read the current subscription data

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network "$STELLAR_NETWORK" \
  -- get_subscription \
  --subscriber "$SUBSCRIBER_ADDRESS" \
  --merchant   "$MERCHANT_ADDRESS" \
  --token      "$TOKEN_ADDRESS"
```

Record the current `amount`, `interval`, and `next_payment` values.

#### Step 2 — Confirm next_payment is not imminent

If `next_payment` is within the next 48 hours, the merchant should attempt
`execute_payment` first. A successful payment will extend the TTL automatically
without resetting the billing cycle. Only fall back to the re-subscribe method if
the payment fails or the merchant is unavailable.

#### Step 3 — Execute the emergency extension

Using the Stellar CLI (subscriber must sign):

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$SUBSCRIBER_IDENTITY" \
  --network "$STELLAR_NETWORK" \
  -- subscribe \
  --subscriber "$SUBSCRIBER_ADDRESS" \
  --merchant   "$MERCHANT_ADDRESS" \
  --token      "$TOKEN_ADDRESS" \
  --amount     "$AMOUNT" \
  --interval   "$INTERVAL"
# Output: subscription updated, TTL reset to ~365 days
# Side effect: next_payment = now + interval
```

Using the JavaScript SDK:

```typescript
import {
  Contract, Keypair, Networks, SorobanRpc,
  TransactionBuilder, Address, nativeToScVal, scValToNative,
} from "@stellar/stellar-sdk";

const server = new SorobanRpc.Server(process.env.RPC_URL!);
const subscriberKeypair = Keypair.fromSecret(process.env.SUBSCRIBER_SECRET!);
const account = await server.getAccount(subscriberKeypair.publicKey());
const contract = new Contract(process.env.CONTRACT_ID!);

// Build the re-subscribe transaction with existing values
const tx = new TransactionBuilder(account, {
  fee: "1000000",
  networkPassphrase: process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET,
})
  .addOperation(
    contract.call(
      "subscribe",
      new Address(subscriberAddress).toScVal(),
      new Address(merchantAddress).toScVal(),
      new Address(tokenAddress).toScVal(),
      nativeToScVal(BigInt(existingAmount), { type: "i128" }),
      nativeToScVal(BigInt(existingInterval), { type: "u64" }),
      nativeToScVal(false, { type: "bool" }),  // strict = false
      nativeToScVal(null),                      // no grace period change
    )
  )
  .setTimeout(30)
  .build();

const sim = await server.simulateTransaction(tx);
if (SorobanRpc.Api.isSimulationError(sim)) {
  throw new Error(`Simulation failed: ${sim.error}`);
}

const prepared = SorobanRpc.assembleTransaction(tx, sim).build();
prepared.sign(subscriberKeypair);
const sendResult = await server.sendTransaction(prepared);

// Poll for confirmation
let result;
do {
  await new Promise((r) => setTimeout(r, 2000));
  result = await server.getTransaction(sendResult.hash);
} while (result.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND);

if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
  console.log("✅ Emergency TTL extension succeeded. Tx:", sendResult.hash);
} else {
  throw new Error(`Emergency extension failed: ${JSON.stringify(result)}`);
}
```

#### Step 4 — Verify the extension

```bash
# Re-check TTL after extension
node check-ttl.mjs "$SUBSCRIBER_ADDRESS" "$MERCHANT_ADDRESS"
# Expected status: ✅ OK (remaining ~6,307,200 ledgers / ~365 days)
```

#### Step 5 — Update your off-chain records

After the re-subscribe, update your database to reflect the new `next_payment` value
(which has been reset to `now + interval`). Notify the merchant that the next billing
window has shifted.

### Alternative method: `extendFootprintTtl` via Stellar CLI

As an alternative that does not affect `next_payment`, you can extend the TTL of the
raw ledger entry directly. This requires knowing the XDR-encoded ledger key and is
available via the Stellar CLI's `contract extend` subcommand.

```bash
# Encode the ledger key (requires stellar-sdk tooling)
LEDGER_KEY_XDR="<base64-encoded XDR of the subscription ledger key>"

# Extend TTL to MAX_TTL_LEDGERS
stellar contract extend \
  --id "$CONTRACT_ID" \
  --ledger-entries "$LEDGER_KEY_XDR" \
  --extend-to "$MAX_TTL_LEDGERS" \
  --source "$SUBSCRIBER_IDENTITY" \
  --network "$STELLAR_NETWORK"
```

This method requires the subscriber's authorization (Soroban gates persistent entry
TTL extensions on the contract's auth check). It does **not** reset `next_payment`
and is therefore safer when a payment is imminent. However, it is more complex to
set up (requires manual XDR encoding of the ledger key).

---

## 8. Storage types in SorobanPay

SorobanPay uses two Soroban storage tiers for different data lifetimes.

### Persistent storage (subscription records)

```rust
env.storage().persistent().set(&key, &data);
env.storage().persistent().extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);
```

**Used for:** `SubscriptionData` entries, admin config, protocol fee config.

**TTL:** Managed explicitly by the contract. Starts at `MAX_TTL_LEDGERS` (~365 days);
extended on each successful write.

**On expiry:** Entry is archived by Soroban host. Contract reads return `None`.

### Temporary storage (merchant indexes)

```rust
env.storage().temporary().set(&idx_key, &index);
```

**Used for:** `MerchantIndex` (mapping merchant → active subscriber count).

**TTL:** Managed automatically by Soroban (~24 hours). No explicit `extend_ttl` call
required or needed.

**On expiry:** Entry disappears. `get_subscription_count` returns `0` when the index
has expired. This is expected and acceptable — the count is a convenience projection,
not authoritative state.

---

## 9. Frequently asked questions

**Q: How long do subscriptions last by default?**  
A: Each subscription has a TTL of approximately 365 days from the last active write
(`subscribe` or successful `execute_payment`). Active subscriptions are automatically
kept alive as long as payments are collected.

**Q: What happens if I pause a subscription and then never resume it?**  
A: Paused subscriptions are not written to by the contract (no `extend_ttl`), so their
TTL counts down. If the subscription is not resumed before TTL reaches zero, the entry
is archived. Re-subscribing will restart the billing cycle from scratch.

**Q: Can I recover an expired subscription?**  
A: No. Once archived, the stored data is gone. The subscriber must call `subscribe()`
again, which creates a new subscription with `next_payment = now + interval`.

**Q: How much does TTL extension add to my transaction fee?**  
A: Approximately 200–2,000 stroops for a ~200-byte subscription entry per full
extension. Simulate the transaction before submitting to get the exact `minResourceFee`.

**Q: How can I tell if a subscription entry has expired?**  
A: Call `get_subscription` — if it returns `None`, the entry has either been cancelled
or its TTL has expired. To distinguish between the two, check your off-chain event
index for a `cancel` event. If no `cancel` event was emitted, the entry expired via TTL.

**Q: Why does `get_subscription` not extend TTL?**  
A: Read-only calls do not modify storage. Extending TTL requires a write, which
requires an auth signature and fee payment. Adding TTL extension to reads would make
every `get_subscription` call require a signed, fee-paying transaction — significantly
degrading the developer experience for read-only queries.

**Q: For a yearly subscription, will the TTL expire before the payment is due?**  
A: This depends on when `execute_payment` is called relative to `next_payment`. After
subscription creation, TTL is 365 days. The annual payment is due in exactly 365 days.
If the merchant collects on the exact due date, the TTL will have reached approximately
zero — triggering an extension back to 365 days on the next write. To be safe, monitor
annual subscriptions using the `WARN` threshold (< 36 days remaining) and use the
[emergency extension procedure](#7-emergency-ttl-extension-procedure) proactively.

**Q: Does Soroban notify me when an entry is about to expire?**  
A: No. The Soroban host does not emit events when entries approach expiry. You must
actively monitor TTL via `getLedgerEntries`. See
[§6 — How to monitor TTL health](#6-how-to-monitor-ttl-health).

**Q: What happens during a network upgrade?**  
A: TTL continues counting during protocol upgrades. Persistent storage entries survive
upgrades. Temporary storage entries may be cleared. Check the Stellar developer blog
for upgrade announcements that affect storage behaviour.

---

## 10. Data inventory and retention

| Store | Content | TTL / lifetime |
|---|---|---|
| Soroban persistent storage | `SubscriptionData` (subscriber, merchant, token, amount, interval, `next_payment`, `is_paused`) | `MAX_TTL_LEDGERS` (~365 days); reset on each successful write. Expiry is protocol-controlled garbage collection, not tenant erasure. |
| Soroban temporary storage | `MerchantIndex` (subscriber count per merchant) | ~24 hours. No persistent data; read-only projection. |
| PostgreSQL `subscriptions` | Off-chain copy of on-chain state; includes `subscribe` and `cancel` events | No configured retention. Do not purge without a retention policy. |
| PostgreSQL `payments` | Payment execution history (tx hash, amount, ledger, status) | No configured retention. Audit records; do not delete without legal review. |

The canonical source of truth is always the on-chain Soroban ledger. Off-chain
PostgreSQL records are derived projections from the event stream and may lag by one
indexer poll cycle.

---

## See Also

- [Operations Guide](./operations.md) — full TTL monitoring scripts, alert thresholds, batch scan, and the stuck-payment runbook
- [Versioning and Migration Guide](./versioning.md) — what happens to TTL when a contract is upgraded
- [Contract API Reference](./contract-api.md) — entry point parameter reference
- `contracts/subscription/src/storage.rs` — TTL constant definitions
- [Soroban Storage and TTL](https://developers.stellar.org/docs/build/smart-contracts/storage/ttl)
- [Soroban RPC `getLedgerEntries`](https://developers.stellar.org/docs/data/rpc/api-reference/methods/getLedgerEntries)
