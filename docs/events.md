# SorobanPay — Contract Event Reference

The `SubscriptionProtocol` contract emits structured events via the Soroban host. Off-chain consumers can use these events for real-time indexing, merchant dashboards, analytics, and notification triggers.

---

## Table of Contents

1. [Event Overview](#event-overview)
2. [Event Schemas](#event-schemas)
   - [subscribe](#subscribe)
   - [executed](#executed)
   - [payment\_transfer\_success](#payment_transfer_success)
   - [payment\_transfer\_failure](#payment_transfer_failure)
   - [cancel](#cancel)
   - [batch\_execute\_initiated](#batch_execute_initiated)
3. [Fetching Events via Stellar RPC](#fetching-events-via-stellar-rpc)
4. [Cursor-Based Polling](#cursor-based-polling)
5. [Off-Chain Filtering Patterns](#off-chain-filtering-patterns)
6. [Decoding Events in TypeScript](#decoding-events-in-typescript)
7. [Decoding Events in Python](#decoding-events-in-python)
8. [Amount Units](#amount-units)
9. [Event Guarantees and Limitations](#event-guarantees-and-limitations)

---

## Event Overview

| Event | Emitted by | When | State change? |
|-------|-----------|------|---------------|
| `subscribe` | `subscribe` | Subscription created or updated | Yes — subscription stored |
| `executed` | `execute_payment`, `execute_payment_batch` | Token transfer succeeded and `next_payment` advanced | Yes — `next_payment` updated |
| `payment_transfer_success` | `execute_payment`, `execute_payment_batch` | Same conditions as `executed` | Yes — paired with `executed` |
| `payment_transfer_failure` | `execute_payment`, `execute_payment_batch` | Subscriber balance was insufficient | No — subscription unchanged |
| `cancel` | `cancel` | Subscription removed from storage | Yes — subscription deleted |
| `batch_execute_initiated` | `execute_payment_batch` | Batch payment started | No — telemetry only |

> **Note on `payment_transfer_success` vs `executed`:** Both events are emitted together on every successful payment. `payment_transfer_success` has 3 topics (no token address) and is used by telemetry consumers tracking success/failure rates. `executed` has 4 topics (including token address) and is the canonical event for off-chain indexers updating payment history.

---

## Event Schemas

All Soroban events are encoded as XDR. The Stellar RPC returns each event as:

```json
{
  "id": "000012345...",
  "type": "contract",
  "ledger": 12345,
  "ledgerClosedAt": "2024-01-01T00:00:00Z",
  "contractId": "CXXX...",
  "topic": ["<base64-xdr>", "<base64-xdr>", ...],
  "value": "<base64-xdr>"
}
```

Each `topic` and `value` is a base64-encoded `ScVal`.

---

### `subscribe`

Emitted when `subscribe()` succeeds — whether creating a new subscription or overwriting an existing one.

| Field | Soroban type | Decoded value |
|-------|-------------|---------------|
| `topic[0]` | `Symbol` | `"subscribe"` |
| `topic[1]` | `Address` | subscriber address |
| `topic[2]` | `Address` | merchant address |
| `topic[3]` | `Address` | token contract address |
| `value` (data) | `i128` | subscription amount in token's smallest unit |

**Use case:** An off-chain indexer listens for `subscribe` events to create or update subscription records in a database.

---

### `executed`

Emitted after a successful payment transfer **and** after `next_payment` has been advanced. Always paired with `payment_transfer_success` in the same transaction.

| Field | Soroban type | Decoded value |
|-------|-------------|---------------|
| `topic[0]` | `Symbol` | `"executed"` |
| `topic[1]` | `Address` | subscriber address |
| `topic[2]` | `Address` | merchant address |
| `topic[3]` | `Address` | token contract address |
| `value` (data) | `i128` | amount transferred in token's smallest unit |

**Use case:** Record each collected payment in the payments history table. The token address in `topic[3]` allows multi-token merchants to categorize revenue by asset.

---

### `payment_transfer_success`

Emitted in the same transaction as `executed`, immediately before it. Provides a simpler 3-topic signal for consumers that do not need the token address.

| Field | Soroban type | Decoded value |
|-------|-------------|---------------|
| `topic[0]` | `Symbol` | `"payment_transfer_success"` |
| `topic[1]` | `Address` | subscriber address |
| `topic[2]` | `Address` | merchant address |
| `value` (data) | `i128` | amount transferred |

**Use case:** Aggregate success/failure counts per merchant without decoding the token address.

---

### `payment_transfer_failure`

Emitted when `execute_payment` or `execute_payment_batch` detects that the subscriber's balance is below the subscription amount. The subscription state is **not** modified — it is eligible for retry.

| Field | Soroban type | Decoded value |
|-------|-------------|---------------|
| `topic[0]` | `Symbol` | `"payment_transfer_failure"` |
| `topic[1]` | `Address` | subscriber address |
| `topic[2]` | `Address` | merchant address |
| `value` (data) | `i128` | amount that was attempted |

> **Important:** If a payment fails due to a **revoked allowance** (rather than insufficient balance), the token contract panics and the entire Soroban transaction reverts atomically. In that case, `payment_transfer_failure` is **not** emitted — the transaction appears as failed in the ledger with no contract events.

**Use case:** Flag a subscriber account for follow-up (email notification, retry queue, dunning workflow).

---

### `cancel`

Emitted after `cancel()` successfully removes the subscription from storage.

| Field | Soroban type | Decoded value |
|-------|-------------|---------------|
| `topic[0]` | `Symbol` | `"cancel"` |
| `topic[1]` | `Address` | subscriber address |
| `topic[2]` | `Address` | merchant address |
| `value` (data) | `()` | unit / empty |

**Use case:** Immediately mark the subscription as inactive in the off-chain database. Do not wait for an absent `executed` event — the `cancel` event is the explicit, reliable termination signal.

---

### `batch_execute_initiated`

Emitted at the start of `execute_payment_batch`, before any individual payments are processed.

| Field | Soroban type | Decoded value |
|-------|-------------|---------------|
| `topic[0]` | `Symbol` | `"batch_execute_initiated"` |
| `topic[1]` | `Address` | merchant address |
| `value` (data) | `i128` | number of subscribers in the batch |

**Use case:** Telemetry — track batch sizes and batch execution frequency for capacity planning.

---

## Fetching Events via Stellar RPC

### curl — all events for a contract

```bash
curl -s https://soroban-testnet.stellar.org \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getEvents",
    "params": {
      "startLedger": 1000000,
      "filters": [
        {
          "type": "contract",
          "contractIds": ["CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"],
          "topics": [["*"]]
        }
      ],
      "pagination": { "limit": 200 }
    }
  }'
```

### curl — filter by event type

Only fetch `executed` events:

```bash
curl -s https://soroban-testnet.stellar.org \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getEvents",
    "params": {
      "startLedger": 1000000,
      "filters": [
        {
          "type": "contract",
          "contractIds": ["CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"],
          "topics": [["AAAADwAAAAhleGVjdXRlZA=="]]
        }
      ],
      "pagination": { "limit": 200 }
    }
  }'
```

> The topic filter value `AAAADwAAAAhleGVjdXRlZA==` is the base64-encoded XDR for `Symbol("executed")`. You can generate these with `xdr.ScVal.scvSymbol("executed").toXDR("base64")` from the Stellar SDK.

### curl — filter by subscriber address

Only fetch events for a specific subscriber (any event type):

```bash
curl -s https://soroban-testnet.stellar.org \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getEvents",
    "params": {
      "startLedger": 1000000,
      "filters": [
        {
          "type": "contract",
          "contractIds": ["CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"],
          "topics": [["*", "<subscriber-address-xdr>"]]
        }
      ],
      "pagination": { "limit": 200 }
    }
  }'
```

### TypeScript — fetch events

```typescript
import { SorobanRpc } from "@stellar/stellar-sdk";

const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");

const response = await server.getEvents({
  startLedger: 1_000_000,
  filters: [
    {
      type: "contract",
      contractIds: [process.env.CONTRACT_ID!],
    },
  ],
  limit: 200,
});

console.log(`Fetched ${response.events.length} events`);
console.log("Cursor for next page:", response.cursor);
```

---

## Cursor-Based Polling

For continuous indexing, always save the cursor from the last response and use it as the starting point for the next request. This guarantees you never miss events and never process duplicates.

```typescript
import { SorobanRpc } from "@stellar/stellar-sdk";
import fs from "fs";

const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");
const CURSOR_FILE = "./indexer-cursor.txt";
const CONTRACT_ID = process.env.CONTRACT_ID!;
const POLL_INTERVAL_MS = 10_000; // 10 seconds

async function loadCursor(): Promise<string | undefined> {
  try {
    return fs.readFileSync(CURSOR_FILE, "utf-8").trim() || undefined;
  } catch {
    return undefined;
  }
}

function saveCursor(cursor: string) {
  fs.writeFileSync(CURSOR_FILE, cursor, "utf-8");
}

async function pollEvents() {
  const cursor = await loadCursor();

  const response = await server.getEvents({
    startLedger: cursor ? undefined : 1_000_000,
    cursor: cursor,
    filters: [
      {
        type: "contract",
        contractIds: [CONTRACT_ID],
      },
    ],
    limit: 200,
  });

  for (const event of response.events) {
    await processEvent(event);
  }

  if (response.cursor) {
    saveCursor(response.cursor);
    console.log(`Processed ${response.events.length} events. Cursor: ${response.cursor}`);
  }
}

// Start polling loop
async function startIndexer() {
  console.log("Starting SorobanPay event indexer...");
  while (true) {
    try {
      await pollEvents();
    } catch (err) {
      console.error("Polling error (will retry):", err);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

startIndexer();
```

---

## Off-Chain Filtering Patterns

### Filter by event type

```typescript
import { xdr, scValToNative } from "@stellar/stellar-sdk";

function getEventType(event: SorobanRpc.Api.EventResponse): string | null {
  if (!event.topic[0]) return null;
  return scValToNative(event.topic[0]) as string;
}

// Route events to handlers
for (const event of response.events) {
  const type = getEventType(event);
  switch (type) {
    case "subscribe":           handleSubscribe(event);          break;
    case "executed":            handleExecuted(event);           break;
    case "payment_transfer_success": handleSuccess(event);       break;
    case "payment_transfer_failure": handleFailure(event);       break;
    case "cancel":              handleCancel(event);             break;
    case "batch_execute_initiated": handleBatch(event);          break;
    default:
      console.warn("Unknown event type:", type);
  }
}
```

### Filter by merchant (topic[2])

```typescript
import { Address, xdr, scValToNative } from "@stellar/stellar-sdk";

function getMerchantFromEvent(event: SorobanRpc.Api.EventResponse): string | null {
  // topic[2] is the merchant for subscribe, executed, cancel events
  if (!event.topic[2]) return null;
  return scValToNative(event.topic[2]) as string;
}

const MY_MERCHANT = "GXYZ...MERCHANT";
const merchantEvents = response.events.filter(
  (e) => getMerchantFromEvent(e) === MY_MERCHANT
);
```

### Filter by subscriber (topic[1])

```typescript
function getSubscriberFromEvent(event: SorobanRpc.Api.EventResponse): string | null {
  if (!event.topic[1]) return null;
  return scValToNative(event.topic[1]) as string;
}

const MY_SUBSCRIBER = "GABC...SUBSCRIBER";
const subscriberEvents = response.events.filter(
  (e) => getSubscriberFromEvent(e) === MY_SUBSCRIBER
);
```

---

## Decoding Events in TypeScript

### Type definitions

```typescript
export interface SubscribeEvent {
  type: "subscribe";
  subscriber: string;
  merchant: string;
  token: string;
  amount: bigint;
  ledger: number;
  timestamp: string;
}

export interface ExecutedEvent {
  type: "executed";
  subscriber: string;
  merchant: string;
  token: string;
  amount: bigint;
  ledger: number;
  timestamp: string;
}

export interface PaymentTransferSuccessEvent {
  type: "payment_transfer_success";
  subscriber: string;
  merchant: string;
  amount: bigint;
  ledger: number;
  timestamp: string;
}

export interface PaymentTransferFailureEvent {
  type: "payment_transfer_failure";
  subscriber: string;
  merchant: string;
  amount: bigint;
  ledger: number;
  timestamp: string;
}

export interface CancelEvent {
  type: "cancel";
  subscriber: string;
  merchant: string;
  ledger: number;
  timestamp: string;
}

export interface BatchExecuteInitiatedEvent {
  type: "batch_execute_initiated";
  merchant: string;
  batchSize: number;
  ledger: number;
  timestamp: string;
}

export type ContractEvent =
  | SubscribeEvent
  | ExecutedEvent
  | PaymentTransferSuccessEvent
  | PaymentTransferFailureEvent
  | CancelEvent
  | BatchExecuteInitiatedEvent;
```

### Decoder function

```typescript
import { xdr, scValToNative, SorobanRpc } from "@stellar/stellar-sdk";

export function decodeContractEvent(
  raw: SorobanRpc.Api.EventResponse
): ContractEvent | null {
  const topics = raw.topic.map((t) => scValToNative(t));
  const data = scValToNative(raw.value);
  const ledger = raw.ledger;
  const timestamp = raw.ledgerClosedAt;

  const [eventType] = topics as string[];

  switch (eventType) {
    case "subscribe": {
      const [, subscriber, merchant, token] = topics as string[];
      return { type: "subscribe", subscriber, merchant, token, amount: BigInt(data), ledger, timestamp };
    }
    case "executed": {
      const [, subscriber, merchant, token] = topics as string[];
      return { type: "executed", subscriber, merchant, token, amount: BigInt(data), ledger, timestamp };
    }
    case "payment_transfer_success": {
      const [, subscriber, merchant] = topics as string[];
      return { type: "payment_transfer_success", subscriber, merchant, amount: BigInt(data), ledger, timestamp };
    }
    case "payment_transfer_failure": {
      const [, subscriber, merchant] = topics as string[];
      return { type: "payment_transfer_failure", subscriber, merchant, amount: BigInt(data), ledger, timestamp };
    }
    case "cancel": {
      const [, subscriber, merchant] = topics as string[];
      return { type: "cancel", subscriber, merchant, ledger, timestamp };
    }
    case "batch_execute_initiated": {
      const [, merchant] = topics as string[];
      return { type: "batch_execute_initiated", merchant, batchSize: Number(data), ledger, timestamp };
    }
    default:
      return null;
  }
}
```

### Complete indexer example

```typescript
import { SorobanRpc } from "@stellar/stellar-sdk";
import { decodeContractEvent, ContractEvent } from "./eventDecoder";

const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");

async function processEvent(event: ContractEvent) {
  switch (event.type) {
    case "subscribe":
      // Upsert subscription in DB
      await db.subscriptions.upsert({
        where: { subscriber_merchant: { subscriber: event.subscriber, merchant: event.merchant } },
        create: { subscriber: event.subscriber, merchant: event.merchant, token: event.token, amount: event.amount.toString() },
        update: { token: event.token, amount: event.amount.toString() },
      });
      break;

    case "executed":
      // Record payment in payments table
      await db.payments.create({
        data: {
          subscriber: event.subscriber,
          merchant: event.merchant,
          token: event.token,
          amount: event.amount.toString(),
          ledger: event.ledger,
          executedAt: new Date(event.timestamp),
        },
      });
      break;

    case "payment_transfer_failure":
      // Flag for retry
      await db.subscriptions.update({
        where: { subscriber_merchant: { subscriber: event.subscriber, merchant: event.merchant } },
        data: { status: "PAYMENT_FAILED", lastFailureAt: new Date(event.timestamp) },
      });
      break;

    case "cancel":
      // Mark subscription inactive
      await db.subscriptions.update({
        where: { subscriber_merchant: { subscriber: event.subscriber, merchant: event.merchant } },
        data: { status: "CANCELLED", cancelledAt: new Date(event.timestamp) },
      });
      break;
  }
}

async function indexEvents(startLedger: number) {
  const response = await server.getEvents({
    startLedger,
    filters: [{ type: "contract", contractIds: [process.env.CONTRACT_ID!] }],
    limit: 200,
  });

  for (const raw of response.events) {
    const decoded = decodeContractEvent(raw);
    if (decoded) await processEvent(decoded);
  }

  return response.cursor;
}
```

---

## Decoding Events in Python

### Installation

```bash
pip install stellar-sdk
```

### Type-aware decoder

```python
from dataclasses import dataclass
from typing import Optional, Union
from stellar_sdk import SorobanServer
from stellar_sdk.xdr import SCVal, SCValType

server = SorobanServer("https://soroban-testnet.stellar.org")


def scval_to_str(scval: SCVal) -> str:
    """Decode a Symbol or Address ScVal to a Python string."""
    if scval.type == SCValType.SCV_SYMBOL:
        return scval.sym.sc_symbol.decode("utf-8")
    if scval.type == SCValType.SCV_ADDRESS:
        # stellar_sdk Address decodes to a public key string
        from stellar_sdk import Address
        return str(Address.from_xdr_sc_address(scval.address))
    return repr(scval)


def scval_to_i128(scval: SCVal) -> int:
    """Decode an i128 ScVal to a Python int."""
    hi = scval.i128.hi.int64
    lo = scval.i128.lo.uint64
    # Reconstruct signed 128-bit integer
    value = (hi << 64) | lo
    if hi < 0:
        value = value - (1 << 128)
    return value


@dataclass
class SubscribeEvent:
    type: str
    subscriber: str
    merchant: str
    token: str
    amount: int


@dataclass
class ExecutedEvent:
    type: str
    subscriber: str
    merchant: str
    token: str
    amount: int


@dataclass
class PaymentTransferFailureEvent:
    type: str
    subscriber: str
    merchant: str
    amount: int


@dataclass
class CancelEvent:
    type: str
    subscriber: str
    merchant: str


ContractEvent = Union[SubscribeEvent, ExecutedEvent, PaymentTransferFailureEvent, CancelEvent]


def decode_event(topic_xdrs: list[str], value_xdr: str) -> Optional[ContractEvent]:
    """Decode a raw Soroban event to a typed Python dataclass."""
    topics = [SCVal.from_xdr(t) for t in topic_xdrs]
    value = SCVal.from_xdr(value_xdr)

    if not topics:
        return None

    event_type = scval_to_str(topics[0])

    if event_type == "subscribe" and len(topics) >= 4:
        return SubscribeEvent(
            type=event_type,
            subscriber=scval_to_str(topics[1]),
            merchant=scval_to_str(topics[2]),
            token=scval_to_str(topics[3]),
            amount=scval_to_i128(value),
        )

    if event_type == "executed" and len(topics) >= 4:
        return ExecutedEvent(
            type=event_type,
            subscriber=scval_to_str(topics[1]),
            merchant=scval_to_str(topics[2]),
            token=scval_to_str(topics[3]),
            amount=scval_to_i128(value),
        )

    if event_type == "payment_transfer_failure" and len(topics) >= 3:
        return PaymentTransferFailureEvent(
            type=event_type,
            subscriber=scval_to_str(topics[1]),
            merchant=scval_to_str(topics[2]),
            amount=scval_to_i128(value),
        )

    if event_type == "cancel" and len(topics) >= 3:
        return CancelEvent(
            type=event_type,
            subscriber=scval_to_str(topics[1]),
            merchant=scval_to_str(topics[2]),
        )

    return None


# ── Example usage ──────────────────────────────────────────────────────────

def fetch_and_decode_events(contract_id: str, start_ledger: int) -> list[ContractEvent]:
    response = server.get_events(
        start_ledger=start_ledger,
        filters=[{"type": "contract", "contractIds": [contract_id]}],
        limit=200,
    )

    decoded = []
    for event in response.events:
        topic_xdrs = [t.to_xdr() for t in event.topic]
        value_xdr = event.value.to_xdr()
        result = decode_event(topic_xdrs, value_xdr)
        if result:
            decoded.append(result)

    return decoded


if __name__ == "__main__":
    import os
    CONTRACT_ID = os.environ["CONTRACT_ID"]
    events = fetch_and_decode_events(CONTRACT_ID, start_ledger=1_000_000)
    for e in events:
        print(e)
```

---

## Amount Units

All `amount` values in SorobanPay events are denominated in the **token's smallest unit (stroops)**. The human-readable amount depends on the token's decimal precision:

| Token type | Decimals | Conversion |
|------------|---------|-----------|
| Stellar Lumens (XLM) | 7 | `amount / 10_000_000` |
| USDC (Circle) | 7 | `amount / 10_000_000` |
| Custom SAC | varies | Check token contract's `decimals()` function |

```typescript
// TypeScript
const USDC_DECIMALS = 7;
const humanAmount = Number(event.amount) / Math.pow(10, USDC_DECIMALS);
console.log(`${humanAmount.toFixed(2)} USDC`);
```

```python
# Python
USDC_DECIMALS = 7
human_amount = event.amount / 10 ** USDC_DECIMALS
print(f"{human_amount:.2f} USDC")
```

See [docs/token-decimals.md](token-decimals.md) for full guidance on decimal handling.

---

## Event Guarantees and Limitations

### What is guaranteed

- Events are only emitted if the associated state change succeeds. A `subscribe` event means the subscription record was stored. An `executed` event means the token transfer completed and `next_payment` was advanced.
- Events are ordered within a ledger by contract invocation order. Within a single `execute_payment_batch` transaction, `batch_execute_initiated` always precedes all per-subscriber events.
- The Soroban RPC retains events for a rolling window (currently ~7 days for testnet, longer for mainnet depending on the archive node). Always persist events to your own database.

### What is not guaranteed

- **Revoked allowance failure:** If a payment fails because the subscriber revoked their token allowance, the Soroban transaction reverts atomically and **no event is emitted**. The transaction appears as failed in the ledger. Detect this by monitoring failed transactions to `execute_payment`.
- **Cancellation before subscription:** Calling `cancel` on a non-existent subscription returns `NoActiveSubscription` and emits **no event**.
- **Event delivery:** If your indexer is offline when events are emitted, you will miss them from the live stream. Always use cursor-based pagination starting from your last known cursor, and backfill from a ledger archive if needed.
- **Reorgs:** Stellar does not have reorgs (finality is immediate). Once an event appears in a closed ledger, it is permanent.
