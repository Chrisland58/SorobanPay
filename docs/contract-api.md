# Contract API Reference

Full reference for all `SubscriptionProtocol` entry points with concrete parameter values and expected outcomes.

> **Current version:** `1.0.0` — schema version `1`.  
> See [versioning.md](versioning.md) for the upgrade and migration policy.

---

## Entry point index

| Function | Auth | Category | Description |
|----------|------|----------|-------------|
| [`initialize`](#initialize) | none | Admin | One-time setup; stores admin address |
| [`get_version`](#get_version) | none | Version | Returns the semantic version string |
| [`get_schema_version`](#get_schema_version) | none | Version | Returns the on-chain schema version |
| [`migrate`](#migrate) | admin | Admin | Bumps stored schema version; requires re-deploy |
| [`subscribe`](#subscribe) | subscriber | Core | Create or update a recurring subscription |
| [`execute_payment`](#execute_payment) | merchant | Core | Collect the next due payment |
| [`batch_execute_payment`](#batch_execute_payment) | merchant | Core | Collect payments from up to 50 subscribers in one call |
| [`cancel`](#cancel) | subscriber | Core | Remove a subscription from storage |
| [`get_subscription`](#get_subscription) | none | Query | Read active subscription data |
| [`compute_subscription_key`](#compute_subscription_key) | none | Utility | Derive the 32-byte storage key for a pair |
| [`get_merchant_subscription_keys`](#get_merchant_subscription_keys) | none | Utility | List all subscription key hashes for a merchant |

---

## Admin & versioning entry points

### `initialize`

One-time setup call. Stores the admin address and initial schema version on-chain. Panics if called a second time.

**Auth:** none required.

| Parameter | Type | Description |
|-----------|------|-------------|
| `admin` | `Address` | Address permitted to call `migrate` |

**CLI:**
```bash
stellar contract invoke \
  --id $CONTRACT_ID --source deployer --network testnet \
  -- initialize \
  --admin GABC...ADMIN
```

---

### `get_version`

Read-only. Returns the semantic version string compiled into the contract (e.g. `"1.0.0"`).

**Auth:** none. No parameters.

**CLI:**
```bash
stellar contract invoke \
  --id $CONTRACT_ID --source alice --network testnet \
  -- get_version
# Output: "1.0.0"
```

**TypeScript:**
```typescript
import { SorobanRpc, scValToNative } from "@stellar/stellar-sdk";

const simResult = await server.simulateTransaction(
  buildVersionQueryTx(contract, account, networkPassphrase)
);
const version = scValToNative(simResult.result?.retval);
// version === "1.0.0"
```

---

### `get_schema_version`

Read-only. Returns the schema version number stored on-chain (updated by `migrate`).

**Auth:** none. No parameters.

Returns `0` if `initialize` has never been called.

---

### `migrate`

Bumps the on-chain `SchemaVersion` key to `CURRENT_SCHEMA_VERSION`. Required after deploying a contract binary where `CURRENT_SCHEMA_VERSION` has been incremented.

**Auth:** stored admin must sign.

| Parameter | Type | Description |
|-----------|------|-------------|
| `admin` | `Address` | Must match the address set in `initialize` |

**Error cases:**

| Error | Code | Trigger |
|-------|------|---------|
| `NotInitialized` | 17 | `initialize` was never called |
| `NotAdmin` | 16 | `admin` does not match the stored admin address |
| `AlreadyMigrated` | 15 | Schema is already at the current version |

**CLI:**
```bash
stellar contract invoke \
  --id $CONTRACT_ID --source admin-key --network testnet \
  -- migrate \
  --admin GABC...ADMIN
```

---

## Core subscription entry points

### `subscribe`

Creates or updates a recurring payment authorization from a subscriber to a merchant.

**Auth:** subscriber must sign.

### Parameters

| Parameter | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `subscriber` | `Address` | ≠ merchant | Wallet authorizing the subscription |
| `merchant` | `Address` | ≠ subscriber | Recipient of recurring payments |
| `token` | `Address` | SEP-41, not contract address | Token contract address |
| `amount` | `i128` | > 0, ≤ 10¹⁸ | Base units per payment interval (see [token-decimals.md](token-decimals.md)) |
| `interval` | `u64` | 86400–31536000 s | Seconds between payments |
| `strict` | `bool` | — | When `true`, rejects the call if subscriber's current SEP-41 allowance for this contract is below `amount`. When `false`, a low-allowance warning event is emitted instead. |

### Error cases

| Error | Code | Trigger |
|-------|------|---------|
| `SelfSubscription` | 10 | `subscriber == merchant` |
| `InvalidTokenAddress` | 11 | `token` is the contract's own address |
| `AmountMustBePositive` | 1 | `amount ≤ 0` |
| `AmountTooLarge` | 9 | `amount > 10¹⁸` |
| `IntervalTooShort` | 2 | `interval < 86400` |
| `IntervalTooLong` | 3 | `interval > 31536000` |
| `InvalidTimestamp` | 8 | Ledger clock is zero |
| `InsufficientAllowance` | 14 | `strict == true` and subscriber's allowance < `amount` |

### CLI example

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source alice \
  --network testnet \
  -- subscribe \
  --subscriber GABC1234...SUBSCRIBER \
  --merchant  GXYZ5678...MERCHANT \
  --token     CABC1111...TOKEN \
  --amount    100 \
  --interval  2592000 \
  --strict    false
```

### TypeScript example

```typescript
import { Contract, nativeToScVal, Address, xdr } from "@stellar/stellar-sdk";

const contract = new Contract(contractId);

const op = contract.call(
  "subscribe",
  new Address(subscriber).toScVal(),
  new Address(merchant).toScVal(),
  new Address(tokenAddress).toScVal(),
  nativeToScVal(100n, { type: "i128" }),      // amount
  nativeToScVal(2592000n, { type: "u64" }),   // interval: 30 days
  xdr.ScVal.scvBool(false),                   // strict: warn on low allowance
);
```

> **Note:** The `strict` parameter was added in v1.0.0. The frontend `transaction_builder.ts` currently passes `false` implicitly. Pass `true` if you want the call to fail fast when the allowance has not yet been set.

### Expected outcome

- Subscription stored in persistent ledger under key `sha256(subscriber_xdr ++ merchant_xdr)`.
- `subscribe` event emitted: topics `[Symbol("subscribe"), subscriber, merchant, token]`, data `amount`.
- If allowance < amount and `strict == false`: `low_allowance` event also emitted.
- `next_payment` set to `current_ledger_time + interval`.
- Calling `subscribe` again for the same pair **updates** amount/interval and resets TTL.
- Subscription TTL is reset to ~365 days.

---

### `execute_payment`

Collects the next due payment for a single subscriber. Transfers `amount` tokens directly from subscriber to merchant.

**Auth:** merchant must sign.

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `subscriber` | `Address` | Subscriber whose payment is due |
| `merchant` | `Address` | Caller — receives the payment |

### CLI example

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source merchant-key \
  --network testnet \
  -- execute_payment \
  --subscriber GABC1234...SUBSCRIBER \
  --merchant   GXYZ5678...MERCHANT
```

### TypeScript example

```typescript
const op = contract.call(
  "execute_payment",
  new Address(subscriber).toScVal(),
  new Address(merchant).toScVal(),
);
```

### Expected outcome

- `amount` tokens transferred `subscriber → merchant` via SEP-41 `transfer`.
- `next_payment` advanced by `interval` seconds.
- Subscription TTL reset to ~365 days.
- `executed` event emitted: topics `[Symbol("executed"), subscriber, merchant, token]`, data `amount`.

### Error cases

| Error | Code | Trigger |
|-------|------|---------|
| `NoActiveSubscription` | 4 | No subscription found for this pair |
| `PaymentNotDue` | 5 | `now < next_payment` |
| `Unauthorized` | 6 | Caller is not the merchant |
| `TransferFailed` | 7 | Subscriber balance < amount; `payment_transfer_failure` event emitted |

---

### `batch_execute_payment`

Collects payments from multiple subscribers in a single transaction. Uses a single `require_auth` for the merchant. Hard cap: **50 subscribers** per call.

Each subscriber is processed independently — a failed or not-due entry does not abort the rest of the batch.

**Auth:** merchant must sign (once for the whole batch).

### Parameters

| Parameter | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `merchant` | `Address` | — | Caller — receives all collected payments |
| `subscribers` | `Vec<Address>` | 1–50 entries | Accounts to attempt payment collection from |

### Return value

`Vec<(Address, bool)>` — one entry per subscriber in the same order as the input. The `bool` is `true` if the payment was successfully collected, `false` otherwise (not due, no subscription, or insufficient balance).

### CLI example

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source merchant-key \
  --network testnet \
  -- batch_execute_payment \
  --merchant   GXYZ5678...MERCHANT \
  --subscribers '["GABC...ALICE", "GDEF...BOB"]'
```

### TypeScript example

```typescript
import { nativeToScVal, Address, xdr } from "@stellar/stellar-sdk";

const subscriberVec = xdr.ScVal.scvVec(
  subscribers.map((s) => new Address(s).toScVal())
);

const op = contract.call(
  "batch_execute_payment",
  new Address(merchant).toScVal(),
  subscriberVec,
);
```

### Events emitted per subscriber

For each successful collection: `payment_transfer_success` and `executed` are both emitted.  
For each insufficient-balance failure: `payment_transfer_failure` is emitted.  
At the start of the batch: `batch_execute_initiated` is emitted with the batch size.

### Error cases

| Error | Code | Trigger |
|-------|------|---------|
| `EmptyBatch` | 12 | `subscribers` is empty |
| `BatchTooLarge` | 13 | `subscribers.len() > 50` |
| `InvalidTimestamp` | 8 | Ledger clock is zero |

---

### `cancel`

Removes the subscription from persistent storage. No further payments can be collected.

**Auth:** subscriber must sign.

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `subscriber` | `Address` | Owner of the subscription |
| `merchant` | `Address` | The counterparty |

### CLI example

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source alice \
  --network testnet \
  -- cancel \
  --subscriber GABC1234...SUBSCRIBER \
  --merchant   GXYZ5678...MERCHANT
```

### TypeScript example

```typescript
const op = contract.call(
  "cancel",
  new Address(subscriber).toScVal(),
  new Address(merchant).toScVal(),
);
```

### Expected outcome

- Subscription entry deleted from persistent storage.
- Subscriber removed from the merchant's on-chain subscription index.
- `cancel` event emitted: topics `[Symbol("cancel"), subscriber, merchant]`, data `()`.
- Any future `execute_payment` call returns `NoActiveSubscription` (error 4).

### Error cases

| Error | Code | Trigger |
|-------|------|---------|
| `NoActiveSubscription` | 4 | No subscription found for this pair |

---

## Query entry points

### `get_subscription`

Read-only. Returns the full `SubscriptionData` for a subscriber-merchant pair, or `None` if no subscription exists.

Calling this function also silently extends the entry's TTL (same thresholds as `subscribe`).

**Auth:** none.

| Parameter | Type | Description |
|-----------|------|-------------|
| `subscriber` | `Address` | Subscriber to look up |
| `merchant` | `Address` | Merchant counterparty |

**Return type:** `Option<SubscriptionData>`

```rust
pub struct SubscriptionData {
    pub token:        Address,  // SEP-41 token contract
    pub amount:       i128,     // payment amount per interval
    pub interval:     u64,      // seconds between payments
    pub next_payment: u64,      // unix timestamp of next valid payment window
    pub is_paused:    bool,     // true when payments are suspended
}
```

**CLI:**
```bash
stellar contract invoke \
  --id $CONTRACT_ID --source alice --network testnet \
  -- get_subscription \
  --subscriber GABC...ALICE \
  --merchant   GXYZ...MERCHANT
```

**TypeScript:**
```typescript
const result = await server.simulateTransaction(
  buildGetSubscriptionTx(contract, subscriber, merchant, account, networkPassphrase)
);
const data = scValToNative(result.result?.retval);
// data: { token, amount, interval, next_payment, is_paused } or null
```

---

## Utility entry points

### `compute_subscription_key`

Returns the 32-byte `sha256(subscriber_xdr ++ merchant_xdr)` storage key for a given pair. Useful for off-chain tooling that needs to inspect raw ledger entries.

**Auth:** none.

| Parameter | Type | Description |
|-----------|------|-------------|
| `subscriber` | `Address` | Subscriber address |
| `merchant` | `Address` | Merchant address |

Returns `BytesN<32>`.

---

### `get_merchant_subscription_keys`

Returns all 32-byte subscription key hashes currently indexed for the given merchant. Off-chain tools can iterate these hashes to enumerate all active subscriptions the merchant participates in.

**Auth:** none.

| Parameter | Type | Description |
|-----------|------|-------------|
| `merchant` | `Address` | Merchant to look up |

Returns `Vec<BytesN<32>>`. Returns an empty vector if the merchant has no subscriptions or the index entry has expired.

> **Note:** The index is stored under **temporary** storage (not persistent). It may be evicted if the ledger TTL lapses. Always treat the result as advisory and verify individual entries with `get_subscription`.

---

## All error codes

| Code | Name | Trigger |
|------|------|---------|
| 1 | `AmountMustBePositive` | `amount ≤ 0` in `subscribe` |
| 2 | `IntervalTooShort` | `interval < 86400` in `subscribe` |
| 3 | `IntervalTooLong` | `interval > 31536000` in `subscribe` |
| 4 | `NoActiveSubscription` | No subscription found for `(subscriber, merchant)` |
| 5 | `PaymentNotDue` | `now < next_payment` in `execute_payment` |
| 6 | `Unauthorized` | Authorization check failed |
| 7 | `TransferFailed` | Insufficient subscriber balance at payment time |
| 8 | `InvalidTimestamp` | Ledger timestamp is zero or would overflow |
| 9 | `AmountTooLarge` | `amount > 10¹⁸` in `subscribe` |
| 10 | `SelfSubscription` | `subscriber == merchant` in `subscribe` |
| 11 | `InvalidTokenAddress` | `token` is the contract's own address |
| 12 | `EmptyBatch` | `subscribers` list is empty in `batch_execute_payment` |
| 13 | `BatchTooLarge` | `subscribers.len() > 50` in `batch_execute_payment` |
| 14 | `InsufficientAllowance` | `strict == true` and `allowance < amount` in `subscribe` |
| 15 | `AlreadyMigrated` | Schema already at current version in `migrate` |
| 16 | `NotAdmin` | Caller is not the stored admin in `migrate` |
| 17 | `NotInitialized` | `initialize` was never called |

Error codes 1–17 are **stable** — they will never be reassigned. New codes will use numbers ≥ 18.

---

## End-to-end flow example

```bash
# 0. Deploy and initialize (one-time)
CONTRACT_ID=$(bash deploy/deploy.sh)
stellar contract invoke --id $CONTRACT_ID --source deployer --network testnet \
  -- initialize --admin GABC...ADMIN

# 1. Subscribe: alice subscribes to pay merchant 100 USDC every 30 days
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- subscribe \
  --subscriber GABC...ALICE \
  --merchant   GXYZ...MERCHANT \
  --token      CABC...USDC \
  --amount     100 \
  --interval   2592000 \
  --strict     false

# 2. Collect a single payment (merchant calls this on/after the due date)
stellar contract invoke --id $CONTRACT_ID --source merchant-key --network testnet \
  -- execute_payment \
  --subscriber GABC...ALICE \
  --merchant   GXYZ...MERCHANT

# 3. Batch-collect from multiple subscribers
stellar contract invoke --id $CONTRACT_ID --source merchant-key --network testnet \
  -- batch_execute_payment \
  --merchant   GXYZ...MERCHANT \
  --subscribers '["GABC...ALICE", "GDEF...BOB"]'

# 4. Read subscription state
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- get_subscription \
  --subscriber GABC...ALICE \
  --merchant   GXYZ...MERCHANT

# 5. Cancel (subscriber terminates the agreement)
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- cancel \
  --subscriber GABC...ALICE \
  --merchant   GXYZ...MERCHANT
```

See [events.md](events.md) for the full event schema and decoding examples.  
See [versioning.md](versioning.md) for the upgrade policy and how to add new entry points safely.
