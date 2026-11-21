# Contract API Reference

Full reference for the three `SubscriptionProtocol` entry points with concrete parameter values and expected outcomes.

---

## `subscribe`

Creates or updates a recurring payment authorization from a subscriber to a merchant.

**Auth:** subscriber must sign.

### Parameters

| Parameter | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `subscriber` | `Address` | — | Wallet authorizing the subscription |
| `merchant` | `Address` | — | Recipient of recurring payments |
| `token` | `Address` | SEP-41 | Token contract address |
| `amount` | `i128` | > 0 | Units per payment interval |
| `interval` | `u64` | 86400–31536000 s | Seconds between payments |

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
  --interval  2592000
```

### TypeScript example

```typescript
import { Contract, nativeToScVal, Address } from "@stellar/stellar-sdk";

const contract = new Contract(contractId);

const op = contract.call(
  "subscribe",
  new Address(subscriber).toScVal(),
  new Address(merchant).toScVal(),
  new Address(tokenAddress).toScVal(),
  nativeToScVal(100n, { type: "i128" }),      // amount
  nativeToScVal(2592000n, { type: "u64" }),   // interval: 30 days
);
```

### Expected outcome

- Subscription stored in persistent ledger under key `(subscriber, merchant)`.
- `subscribe` event emitted: topics `[Symbol("subscribe"), subscriber, merchant]`, data `amount: 100`.
- `next_payment` set to `current_ledger_time` (first payment collectable immediately).
- Calling `subscribe` again for the same pair **updates** amount/interval and resets TTL.

---

## `execute_payment`

Collects the next due payment. Transfers `amount` tokens directly from subscriber to merchant.

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

- `amount` tokens transferred `subscriber → merchant` via SEP-41 `transfer_from`.
- `next_payment` advanced by `interval` seconds.
- Subscription TTL reset to 365 days.
- `executed` event emitted: topics `[Symbol("executed"), subscriber, merchant]`, data `amount: 100`.

### Error cases

| Error | Code | Trigger |
|-------|------|---------|
| `NoActiveSubscription` | 4 | No subscription found for this pair |
| `PaymentNotDue` | 5 | `now < next_payment` |
| `Unauthorized` | 6 | Caller is not the merchant |

---

## `cancel`

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
- No cancellation event is emitted. Off-chain indexers detect cancellation by the absence of `executed` events after `2 × interval`.
- Any future `execute_payment` call returns `NoActiveSubscription` (error 4).

---

## End-to-end flow example

```bash
# 1. Subscribe: alice subscribes to pay merchant 100 USDC every 30 days
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- subscribe \
  --subscriber GABC...ALICE \
  --merchant   GXYZ...MERCHANT \
  --token      CABC...USDC \
  --amount     100 \
  --interval   2592000

# 2. Collect payment (merchant calls this on/after the due date)
stellar contract invoke --id $CONTRACT_ID --source merchant-key --network testnet \
  -- execute_payment \
  --subscriber GABC...ALICE \
  --merchant   GXYZ...MERCHANT

# 3. Cancel (subscriber terminates the agreement)
stellar contract invoke --id $CONTRACT_ID --source alice --network testnet \
  -- cancel \
  --subscriber GABC...ALICE \
  --merchant   GXYZ...MERCHANT
```

See [events.md](events.md) for the full event schema and decoding examples.

---

## Payment Split Configuration (Issue #1609)

Merchants can configure an opt-in split that distributes each subscription payment proportionally among up to 5 beneficiaries. When a split is active, `execute_payment` transfers directly from the subscriber to each beneficiary; it falls back to the standard single-transfer behavior when no split is configured.

### Types

**`SplitRecipient`**

| Field | Type | Description |
|-------|------|-------------|
| `recipient` | `Address` | Destination address for this beneficiary's allocation |
| `share_bps` | `u32` | Basis-point share (1–9999); 10000 basis points = 100% |

**`SplitConfig`**

| Field | Type | Description |
|-------|------|-------------|
| `recipients` | `Vec<SplitRecipient>` | Ordered list of beneficiaries |

### Rules

- Maximum **5** recipients per subscription.
- All `share_bps` values must sum to exactly **10000**.
- No duplicate recipient addresses.
- No zero `share_bps` values.
- Splits are stored independently of subscription data and survive subscription updates.
- Splits only affect **future** payments; already-settled payments are unaffected.
- Pass an empty vec to `set_split` to remove an existing split.

---

## `set_split`

Configure (or remove) the beneficiary split for a subscription.

**Auth:** merchant must sign.

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `subscriber` | `Address` | Subscriber whose payments will be split |
| `merchant` | `Address` | Merchant authorizing the split |
| `recipients` | `Vec<SplitRecipient>` | Beneficiaries and their shares; pass an empty vec to clear |

### CLI example

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source merchant-key \
  --network testnet \
  -- set_split \
  --subscriber GABC1234...SUBSCRIBER \
  --merchant   GXYZ5678...MERCHANT \
  --recipients '[{"recipient":"GBBB...R1","share_bps":5000},{"recipient":"GCCC...R2","share_bps":5000}]'
```

### Expected outcome

- Split configuration stored under key `SplitConfig(subscriber, merchant)`.
- Subsequent `execute_payment` calls distribute proportionally among beneficiaries.
- Each beneficiary transfer emits a `split_payment` event.

### Error cases

| Error | Code | Trigger |
|-------|------|---------|
| `NoActiveSubscription` | 4 | No subscription found for this pair |
| `TooManyRecipients` | 10 | More than 5 recipients provided |
| `InvalidShareSum` | 11 | Shares do not sum to exactly 10000 |
| `DuplicateRecipient` | 12 | Two or more entries share the same address |
| `ZeroShare` | 13 | Any `share_bps` value is 0 |

---

## `get_split`

Return the current split configuration for a subscriber-merchant pair.

**Auth:** none — public read-only view.

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `subscriber` | `Address` | The subscriber |
| `merchant` | `Address` | The merchant |

### Returns

`Some(SplitConfig)` if a split is configured, `None` otherwise.

### CLI example

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --network testnet \
  -- get_split \
  --subscriber GABC1234...SUBSCRIBER \
  --merchant   GXYZ5678...MERCHANT
```

---

## Settlement events with splits

When a split is active, `execute_payment` emits one `split_payment` event per beneficiary **in addition to** the existing `executed` event for the full amount.

### `split_payment` event

| Field | Value |
|-------|-------|
| Topics | `(Symbol("split_payment"), subscriber, merchant, recipient)` |
| Data | `allocation: i128` — exact base-unit amount sent to this recipient |

The last recipient absorbs any integer-division remainder to guarantee the sum of all allocations equals `data.amount` exactly, with no dust lost.

