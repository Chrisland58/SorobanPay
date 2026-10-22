# Contract API Reference

Full reference for all `SubscriptionProtocol` entry points — parameters, error codes, CLI examples, and TypeScript examples.

---

## Table of Contents

1. [Contract Overview](#contract-overview)
2. [Data Types](#data-types)
3. [Entry Points](#entry-points)
   - [subscribe](#subscribe)
   - [execute\_payment](#execute_payment)
   - [execute\_payment\_batch](#execute_payment_batch)
   - [cancel](#cancel)
   - [get\_subscription](#get_subscription)
   - [version](#version)
   - [contract\_name](#contract_name)
4. [Error Codes](#error-codes)
5. [Storage Constants](#storage-constants)
6. [End-to-End Example](#end-to-end-example)

---

## Contract Overview

`SubscriptionProtocol` is a non-custodial recurring payments contract deployed on Stellar's Soroban platform. It stores one persistent record per `(subscriber, merchant)` pair and enforces time-locked payment collection. All token transfers go directly `subscriber → merchant` — the contract never holds balances.

**Contract name:** `SorobanPay`  
**Contract version:** `1.0.0`  
**Language:** Rust / Soroban SDK  
**WASM artifact:** `contracts/target/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm`

---

## Data Types

### `SubscriptionData`

Persistent on-chain record for an active subscription.

| Field | Type | Description |
|-------|------|-------------|
| `token` | `Address` | SEP-41 token contract address used for payments |
| `amount` | `i128` | Payment amount per interval (in token's smallest unit / stroops) |
| `interval` | `u64` | Seconds between payment windows |
| `next_payment` | `u64` | Unix timestamp of the earliest valid next payment |
| `is_paused` | `bool` | Reserved field — not currently read by `execute_payment` |

### `DataKey`

Storage key type: `Subscription(Address, Address)` — composite key of `(subscriber, merchant)`.

---

## Entry Points

### `subscribe`

Creates or overwrites a recurring payment authorization.

**Auth:** `subscriber` must sign.

#### Parameters

| Parameter | Type | Valid Range | Description |
|-----------|------|-------------|-------------|
| `subscriber` | `Address` | ≠ `merchant` | Account that will be charged on each interval |
| `merchant` | `Address` | ≠ `subscriber` | Account that receives payments |
| `token` | `Address` | Valid SEP-41, ≠ contract address | Token contract for the payment stream |
| `amount` | `i128` | `(0, 10^18]` | Base units (stroops) charged per interval |
| `interval` | `u64` | `[86400, 31536000]` | Seconds between payments (1 day – 1 year) |

#### Return value

`Result<(), ContractError>` — returns `Ok(())` on success.

#### Side effects

- Writes or overwrites `SubscriptionData` in persistent storage under key `Subscription(subscriber, merchant)`.
- Sets `next_payment = current_ledger_timestamp + interval` (first payment collectable immediately after the interval elapses).
- Calls `extend_ttl` to ensure the entry survives at least 30 days, up to 365 days.
- Emits the `subscribe` event.

Calling `subscribe` again for the same pair **updates** amount, interval, and token — it does not create a duplicate. The TTL is reset and `next_payment` is recalculated from the current time.

#### Error cases

| Error | Code | Condition |
|-------|------|-----------|
| `SelfSubscription` | 10 | `subscriber == merchant` |
| `InvalidTokenAddress` | 11 | `token` equals the contract's own address |
| `AmountMustBePositive` | 1 | `amount <= 0` |
| `AmountTooLarge` | 9 | `amount > 1_000_000_000_000_000_000` (10¹⁸) |
| `IntervalTooShort` | 2 | `interval < 86400` |
| `IntervalTooLong` | 3 | `interval > 31536000` |
| `InvalidTimestamp` | 8 | Ledger timestamp is zero or computing `next_payment` overflows `u64` |

#### CLI example

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source alice \
  --network testnet \
  -- subscribe \
  --subscriber GABC1234...SUBSCRIBER \
  --merchant   GXYZ5678...MERCHANT \
  --token      CABC1111...USDC \
  --amount     100000000 \
  --interval   2592000
```

#### TypeScript example

```typescript
import { Contract, nativeToScVal, Address } from "@stellar/stellar-sdk";

const contract = new Contract(contractId);

const op = contract.call(
  "subscribe",
  new Address(subscriber).toScVal(),
  new Address(merchant).toScVal(),
  new Address(tokenAddress).toScVal(),
  nativeToScVal(100_000_000n, { type: "i128" }),   // 100 USDC (7 decimal places)
  nativeToScVal(2_592_000n, { type: "u64" }),       // 30 days in seconds
);
```

---

### `execute_payment`

Collects the next due payment for a single subscriber. Transfers `amount` tokens directly from `subscriber` to `merchant`.

**Auth:** `merchant` must sign.

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `subscriber` | `Address` | Account whose payment is due |
| `merchant` | `Address` | Caller — receives the payment |

#### Return value

`Result<(), ContractError>` — returns `Ok(())` on successful transfer.

#### Side effects on success

- Transfers `data.amount` tokens via SEP-41 `transfer(subscriber, merchant, amount)`.
- Advances `next_payment` to `now + interval` (late-payment-aware rescheduling — delay is absorbed into future schedule).
- Calls `extend_ttl` to reset the subscription's TTL to 365 days.
- Emits `payment_transfer_success` and `executed` events.

#### Side effects on insufficient balance

- Emits `payment_transfer_failure` event.
- Returns `Err(TransferFailed)`.
- Subscription state is **not modified** — the call can be retried once funds are available.

#### Late payment rescheduling

When a payment is collected late, `next_payment = now + interval`. This means delays cascade to future payments rather than creating immediate double-billing. Merchants requiring "make-up" charges should implement that logic off-chain.

#### Error cases

| Error | Code | Condition |
|-------|------|-----------|
| `NoActiveSubscription` | 4 | No subscription found for `(subscriber, merchant)` |
| `PaymentNotDue` | 5 | `now < data.next_payment` |
| `TransferFailed` | 7 | Subscriber balance is less than `data.amount` |
| `InvalidTimestamp` | 8 | Ledger timestamp is zero |

#### CLI example

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source merchant-key \
  --network testnet \
  -- execute_payment \
  --subscriber GABC1234...SUBSCRIBER \
  --merchant   GXYZ5678...MERCHANT
```

#### TypeScript example

```typescript
const op = contract.call(
  "execute_payment",
  new Address(subscriber).toScVal(),
  new Address(merchant).toScVal(),
);
```

---

### `execute_payment_batch`

Collects multiple recurring payments in a single transaction. All payments must be to the **same merchant** (enforced by the auth check).

**Auth:** `merchant` must sign once for the entire batch.

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `merchant` | `Address` | Caller — receives all payments in the batch |
| `payments` | `Vec<Address>` | List of subscriber addresses to collect from |

#### Return value

`Result<(), ContractError>` — returns `Ok(())` after processing the entire batch.

Per-subscription failures (missing subscription, payment not due, insufficient balance) are **not** propagated as errors. Each payment is processed independently:

- If the subscription does not exist → silently skipped.
- If `now < next_payment` → silently skipped.
- If subscriber balance is insufficient → `payment_transfer_failure` event emitted, skipped.
- If transfer succeeds → `payment_transfer_success` + `executed` events emitted, state updated.

#### Error cases

| Error | Code | Condition |
|-------|------|-----------|
| `EmptyBatch` | 12 | `payments` vector is empty |

#### CLI example

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source merchant-key \
  --network testnet \
  -- execute_payment_batch \
  --merchant GXYZ5678...MERCHANT \
  --payments '["GABC1234...SUB1","GDEF5678...SUB2","GHIJ9012...SUB3"]'
```

#### TypeScript example

```typescript
import { Contract, nativeToScVal, Address, xdr } from "@stellar/stellar-sdk";

const subscribers = [
  "GABC1234...SUB1",
  "GDEF5678...SUB2",
  "GHIJ9012...SUB3",
];

const subscribersScVal = xdr.ScVal.scvVec(
  subscribers.map((s) => new Address(s).toScVal())
);

const op = contract.call(
  "execute_payment_batch",
  new Address(merchant).toScVal(),
  subscribersScVal,
);
```

---

### `cancel`

Removes the subscription from persistent storage. No further payments can be collected after a successful cancel.

**Auth:** `subscriber` must sign.

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `subscriber` | `Address` | Owner of the subscription |
| `merchant` | `Address` | The counterparty |

#### Return value

`Result<(), ContractError>` — returns `Ok(())` on success.

#### Side effects

- Removes the `Subscription(subscriber, merchant)` entry from persistent storage.
- Emits the `cancel` event.
- Does **not** extend or touch TTL (the entry is removed entirely).

#### Error cases

| Error | Code | Condition |
|-------|------|-----------|
| `NoActiveSubscription` | 4 | No subscription found for `(subscriber, merchant)` |

#### CLI example

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source alice \
  --network testnet \
  -- cancel \
  --subscriber GABC1234...SUBSCRIBER \
  --merchant   GXYZ5678...MERCHANT
```

#### TypeScript example

```typescript
const op = contract.call(
  "cancel",
  new Address(subscriber).toScVal(),
  new Address(merchant).toScVal(),
);
```

---

### `get_subscription`

Read-only view — returns the current subscription record for a `(subscriber, merchant)` pair.

**Auth:** None required.

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `subscriber` | `Address` | Account being charged |
| `merchant` | `Address` | Account receiving payments |

#### Return value

`Option<SubscriptionData>` — `Some(data)` if the subscription exists, `None` if not.

```typescript
// SubscriptionData shape returned from the contract
interface SubscriptionData {
  token: string;        // SEP-41 token contract address
  amount: bigint;       // payment amount in stroops (i128)
  interval: bigint;     // seconds between payments (u64)
  next_payment: bigint; // Unix timestamp of next collectable payment (u64)
  is_paused: boolean;   // reserved; not enforced by execute_payment
}
```

#### Side effects

- Bumps the TTL of the storage entry (if present) to prevent silent expiry while being monitored.

#### CLI example

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source alice \
  --network testnet \
  -- get_subscription \
  --subscriber GABC1234...SUBSCRIBER \
  --merchant   GXYZ5678...MERCHANT
```

#### TypeScript example

```typescript
import { SorobanRpc, Contract, Address, scValToNative } from "@stellar/stellar-sdk";

const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");
const contract = new Contract(contractId);

// Build a simulation to read the subscription state
const tx = /* ... build transaction with get_subscription call */;
const sim = await server.simulateTransaction(tx);

if (SorobanRpc.Api.isSimulationSuccess(sim) && sim.result) {
  const sub = scValToNative(sim.result.retval);
  if (sub) {
    console.log("Token:        ", sub.token);
    console.log("Amount:       ", sub.amount.toString(), "stroops");
    console.log("Interval:     ", (Number(sub.interval) / 86400).toFixed(1), "days");
    console.log("Next payment: ", new Date(Number(sub.next_payment) * 1000).toISOString());
  } else {
    console.log("No active subscription.");
  }
}
```

---

### `version`

Returns the contract version string.

**Auth:** None required.

#### Return value

`Symbol` — e.g., `"1.0.0"` (Soroban Symbol, max 32 chars).

#### CLI example

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source alice \
  --network testnet \
  -- version
```

#### TypeScript example

```typescript
import { scValToNative } from "@stellar/stellar-sdk";

// Simulated call returns Symbol "1.0.0"
const versionSym = scValToNative(sim.result!.retval);
console.log("Contract version:", versionSym); // "1.0.0"
```

**Usage pattern:** check the major version prefix before making calls to ensure SDK compatibility:

```typescript
const version = scValToNative(sim.result!.retval) as string;
if (!version.startsWith("1.")) {
  throw new Error(`Unsupported contract version: ${version}`);
}
```

---

### `contract_name`

Returns the contract name for identification.

**Auth:** None required.

#### Return value

`Symbol` — `"SorobanPay"` (Soroban Symbol).

#### CLI example

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source alice \
  --network testnet \
  -- contract_name
```

---

## Error Codes

Complete list of `ContractError` variants with recovery guidance.

| Code | Name | Trigger | Recovery |
|------|------|---------|----------|
| 1 | `AmountMustBePositive` | `subscribe` called with `amount <= 0` | Pass a positive `amount` value |
| 2 | `IntervalTooShort` | `subscribe` called with `interval < 86400` | Minimum interval is 86400 seconds (1 day) |
| 3 | `IntervalTooLong` | `subscribe` called with `interval > 31536000` | Maximum interval is 31536000 seconds (365 days) |
| 4 | `NoActiveSubscription` | `execute_payment` or `cancel` found no subscription for the pair | Verify the subscriber/merchant pair; call `get_subscription` first |
| 5 | `PaymentNotDue` | `execute_payment` called before `next_payment` timestamp | Wait until `now >= next_payment`; use `get_subscription` to check the due date |
| 6 | `Unauthorized` | Authorization check failed (supplementary — `require_auth()` panics directly) | Ensure the correct keypair signs the transaction |
| 7 | `TransferFailed` | Subscriber balance less than `amount` at payment time | Subscriber must fund their account; retry after sufficient balance is confirmed |
| 8 | `InvalidTimestamp` | Ledger timestamp is zero, or `next_payment = ts + interval` overflows `u64` | Network issue (zero timestamp) or unrealistically large interval; reduce interval |
| 9 | `AmountTooLarge` | `subscribe` called with `amount > 10^18` | Reduce amount; max is `1_000_000_000_000_000_000` stroops |
| 10 | `SelfSubscription` | `subscriber == merchant` in `subscribe` | Use two distinct addresses |
| 11 | `InvalidTokenAddress` | `token` equals the contract's own address in `subscribe` | Use a valid SEP-41 token contract address, not the subscription contract itself |
| 12 | `EmptyBatch` | `execute_payment_batch` called with an empty `payments` vector | Provide at least one subscriber address |

### Reading error codes from the RPC response

A failed contract invocation returns an XDR-encoded error. With the Stellar SDK:

```typescript
import { SorobanRpc, xdr } from "@stellar/stellar-sdk";

try {
  const result = await server.sendTransaction(tx);
  if (result.status === "ERROR") {
    // Parse the result XDR to get the contract error
    const resultXdr = xdr.TransactionResult.fromXDR(result.resultXdr, "base64");
    console.error("Transaction failed:", result.resultXdr);
  }
} catch (err) {
  // The Soroban SDK throws on simulation errors
  console.error("Simulation failed:", err);
}
```

---

## Storage Constants

| Constant | Value | Approximate wall-clock time |
|----------|-------|-----------------------------|
| `MAX_AMOUNT` | `1_000_000_000_000_000_000` | — (1 × 10¹⁸ stroops) |
| `MIN_TTL_LEDGERS` | `518_400` | ~30 days at 5 s/ledger |
| `MAX_TTL_LEDGERS` | `6_307_200` | ~365 days at 5 s/ledger |
| Min `interval` | `86_400` s | 1 day |
| Max `interval` | `31_536_000` s | 365 days |

TTL is extended on every `subscribe` call and every successful `execute_payment`. An active subscription is always guaranteed ≥ 30 days remaining TTL. Subscriptions that go a full year without a successful payment expire and are garbage-collected by the Soroban host.

---

## End-to-End Example

### Lifecycle: subscribe → collect → cancel

```bash
# 1. Subscribe: alice authorizes 50 USDC every 30 days to merchant
stellar contract invoke \
  --id $CONTRACT_ID --source alice --network testnet \
  -- subscribe \
  --subscriber GABC...ALICE \
  --merchant   GXYZ...MERCHANT \
  --token      CABC...USDC \
  --amount     500000000 \
  --interval   2592000

# 2. (30 days later) Merchant collects payment
stellar contract invoke \
  --id $CONTRACT_ID --source merchant-key --network testnet \
  -- execute_payment \
  --subscriber GABC...ALICE \
  --merchant   GXYZ...MERCHANT

# 3. Check subscription state
stellar contract invoke \
  --id $CONTRACT_ID --source alice --network testnet \
  -- get_subscription \
  --subscriber GABC...ALICE \
  --merchant   GXYZ...MERCHANT

# 4. Alice cancels
stellar contract invoke \
  --id $CONTRACT_ID --source alice --network testnet \
  -- cancel \
  --subscriber GABC...ALICE \
  --merchant   GXYZ...MERCHANT
```

### Batch collection example

```typescript
import { Contract, SorobanRpc, TransactionBuilder, Networks, Address, xdr } from "@stellar/stellar-sdk";
import Stellar from "@stellar/stellar-sdk";

const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");
const contract = new Contract(process.env.CONTRACT_ID!);

const merchantKeypair = Stellar.Keypair.fromSecret(process.env.MERCHANT_SECRET!);
const merchantAccount = await server.getAccount(merchantKeypair.publicKey());

const subscribers = [
  "GABC1111...SUB1",
  "GABC2222...SUB2",
  "GABC3333...SUB3",
];

const subscribersScVal = xdr.ScVal.scvVec(
  subscribers.map((s) => new Address(s).toScVal())
);

const tx = new TransactionBuilder(merchantAccount, {
  fee: "100000",
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(
    contract.call(
      "execute_payment_batch",
      new Address(merchantKeypair.publicKey()).toScVal(),
      subscribersScVal,
    )
  )
  .setTimeout(30)
  .build();

// Simulate to get resource footprint
const simResult = await server.simulateTransaction(tx);
if (!SorobanRpc.Api.isSimulationSuccess(simResult)) {
  throw new Error("Simulation failed: " + JSON.stringify(simResult));
}

// Assemble, sign, and submit
const preparedTx = SorobanRpc.assembleTransaction(tx, simResult).build();
preparedTx.sign(merchantKeypair);

const sendResult = await server.sendTransaction(preparedTx);
console.log("Batch tx hash:", sendResult.hash);

// Poll for confirmation
let getResult = await server.getTransaction(sendResult.hash);
while (getResult.status === "NOT_FOUND") {
  await new Promise((r) => setTimeout(r, 2000));
  getResult = await server.getTransaction(sendResult.hash);
}
console.log("Batch status:", getResult.status);
```

See [docs/events.md](events.md) for the full event schema and how to decode `payment_transfer_success`, `payment_transfer_failure`, and `executed` events from the batch.
