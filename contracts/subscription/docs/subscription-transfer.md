# Subscription Transfer with Destination Consent

## Overview

The subscription contract supports transferring an active subscription from one merchant to another via a two-step process: **propose → accept**. This design ensures that a destination merchant cannot have payment obligations attached to them without their explicit on-chain consent.

---

## Two-Step Transfer Process

### Step 1: Propose (`propose_transfer`)

The subscriber initiates a transfer proposal:

```
propose_transfer(subscriber, from_merchant, to_merchant, expires_in_secs)
```

- `subscriber` must sign the transaction (they own the subscription relationship).
- A `TransferProposal` is stored on-chain under the key `(subscriber, from_merchant)`.
- The proposal expires after `expires_in_secs` seconds from the ledger timestamp at call time.
- `expires_in_secs` must be between **1 hour (3,600 s)** and **30 days (2,592,000 s)**.
- Emits a `transfer_proposed` event: topics `(symbol, subscriber, from_merchant, to_merchant)`, data `expires_at` as i128.

### Step 2: Accept (`accept_transfer`)

The destination merchant explicitly accepts:

```
accept_transfer(subscriber, from_merchant, to_merchant)
```

- `to_merchant` must sign the transaction.
- The contract verifies the proposal exists, that `to_merchant` matches the recorded destination, and that the proposal has not expired.
- Atomically:
  1. The old subscription `(subscriber, from_merchant)` is removed.
  2. A new subscription `(subscriber, to_merchant)` is created with the same `token`, `amount`, `interval`, and `next_payment`.
  3. The proposal record is removed.
- Emits a `transfer_accepted` event: topics `(symbol, subscriber, from_merchant, to_merchant)`, data `()`.

---

## Old Merchant Remains Authoritative Until Acceptance

Between `propose_transfer` and `accept_transfer`, the original subscription remains fully active under `from_merchant`. The old merchant can still call `execute_payment` and collect payments normally. The transfer proposal does not freeze or pause the subscription.

This means:
- Subscribers are not disrupted during the transfer window.
- Payment collection is uninterrupted.
- The old merchant's rights end only at the moment `accept_transfer` is successfully executed.

---

## Pending Payment State Is Preserved

When a transfer is accepted, the new subscription is created with the **same `next_payment` timestamp** as the original. This means:

- If the subscription was due for payment before the transfer, it remains due after the transfer — the new merchant can collect it immediately.
- No billing cycle is reset or skipped.
- The subscriber is not double-charged and does not receive an unexpected grace period.

---

## Error Cases

| Error | Cause |
|---|---|
| `NoSubscriptionToTransfer` | `propose_transfer` called but no active subscription exists for `(subscriber, from_merchant)`. |
| `InvalidTransferExpiry` | `expires_in_secs` is below 3,600 (1 hour) or above 2,592,000 (30 days). |
| `NoTransferProposal` | `accept_transfer` called but no proposal has been stored for `(subscriber, from_merchant)`. |
| `TransferUnauthorized` | `accept_transfer` called by an address that does not match the `to_merchant` in the proposal. |
| `TransferExpired` | `accept_transfer` called after the proposal's `expires_at` timestamp has passed. |
| `NoActiveSubscription` | `accept_transfer` succeeded on the proposal check but the original subscription was removed in the interim (edge case). |
| `InvalidTimestamp` | The ledger clock is zero or the expiry calculation would overflow u64. |

### Rejected acceptance (wrong acceptor)

If an impostor calls `accept_transfer` with a `to_merchant` that does not match the stored proposal, the call fails with `TransferUnauthorized` and the original subscription remains intact.

### Expired proposal

If `accept_transfer` is called after `expires_at`, the call fails with `TransferExpired`. The original subscription remains active. The subscriber may issue a new `propose_transfer` with a fresh expiry window.

### Repeated proposals

Calling `propose_transfer` a second time for the same `(subscriber, from_merchant)` pair overwrites the previous proposal. The latest `to_merchant` and `expires_at` take effect. This allows the subscriber to update or extend a pending proposal without first cancelling it.

---

## Storage Keys

| Key | Type | Contents |
|---|---|---|
| `DataKey::Subscription(subscriber, merchant)` | `SubscriptionData` | Active subscription record. |
| `DataKey::TransferProposal(subscriber, from_merchant)` | `TransferProposal` | Pending transfer proposal. |

A `TransferProposal` record holds:
- `to_merchant: Address` — the intended new merchant.
- `expires_at: u64` — Unix timestamp after which the proposal is void.

---

## Events

| Event symbol | Topics | Data |
|---|---|---|
| `transfer_proposed` | `(symbol, subscriber, from_merchant, to_merchant)` | `expires_at` as i128 |
| `transfer_accepted` | `(symbol, subscriber, from_merchant, to_merchant)` | `()` (unit) |
