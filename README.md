# SorobanPay — Decentralized Subscription & Recurring Payments Protocol

A production-grade, non-custodial recurring payments protocol built on Stellar's Soroban smart contract platform. Enables SaaS billing, creator subscriptions, and recurring donations directly on-chain — no custodial wallets, no pre-authorized transaction arrays.

---

## Architecture

```
SorobanPay
├── contracts/subscription/   Rust/Soroban smart contract
├── deploy/deploy.sh          Automated testnet/mainnet deployment
├── frontend/                 Next.js 14 TypeScript frontend
└── Makefile                  Build, test, and clean targets
```

**Three layers:**
1. **Smart Contract** — `SubscriptionProtocol` Soroban contract with `subscribe`, `execute_payment`, and `cancel` entry points. Uses persistent storage with TTL management and emits structured events for off-chain indexing.
2. **Frontend** — Next.js 14 App Router + Freighter wallet integration + Tailwind CSS.
3. **Build & Deploy** — GNU Makefile + bash deployment script with testnet/mainnet switching.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust | stable | https://rustup.rs |
| `wasm32-unknown-unknown` target | — | `rustup target add wasm32-unknown-unknown` |
| Stellar CLI | ≥ 21.x | https://developers.stellar.org/docs/tools/stellar-cli |
| Node.js | ≥ 18.x | https://nodejs.org |
| Freighter browser extension | latest | https://www.freighter.app |

---

## Smart Contract

### Build

```bash
make build
```

Compiles the Rust contract to `contracts/target/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm` using the `--release` profile (`opt-level = "z"`, `lto = true`).

### Test

```bash
make test
```

Runs the full test suite: unit tests (lifecycle, error paths, auth, events) and property-based tests (time-lock, double-payment prevention, balance invariant, and more).

### Clean

```bash
make clean
```

Removes all build artifacts from `contracts/target/`.

---

## Deployment

### Setup identity

```bash
# Create a Stellar identity (one-time)
stellar keys generate alice --network testnet

# Fund it on testnet
stellar keys fund alice --network testnet
```

### Deploy to testnet (default)

```bash
bash deploy/deploy.sh
```

The contract address is printed to stdout on success. All diagnostic output goes to stderr.

### Deploy to mainnet

```bash
STELLAR_NETWORK=mainnet STELLAR_IDENTITY=your-identity bash deploy/deploy.sh
```

### Environment variables for deploy.sh

| Variable | Default | Description |
|----------|---------|-------------|
| `STELLAR_NETWORK` | `testnet` | `testnet` or `mainnet` |
| `STELLAR_IDENTITY` | `alice` | Stellar CLI identity alias |

---

## Frontend

### Environment variables

Create `frontend/.env.local` (copy from `frontend/.env.example`):

```env
NEXT_PUBLIC_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
NEXT_PUBLIC_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
```

Replace `NEXT_PUBLIC_CONTRACT_ID` with the address output by `deploy.sh`.

### Install and run

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000 in a browser with Freighter installed.

### Build for production

```bash
cd frontend
npm run build
npm start
```

### Type check

```bash
cd frontend
npm run type-check
```

---

## Contract entry points

| Function | Auth required | Description |
|----------|--------------|-------------|
| `subscribe(subscriber, merchant, token, amount, interval)` | subscriber | Create or update subscription. Amount must be > 0, interval in [86400, 31536000] seconds. |
| `execute_payment(subscriber, merchant)` | merchant | Collect payment if interval has elapsed. Transfers tokens directly subscriber → merchant. |
| `cancel(subscriber, merchant)` | subscriber | Remove subscription from persistent storage. |

### Events emitted

| Event | Topics | Data |
|-------|--------|------|
| `subscribe` | `(symbol("subscribe"), subscriber, merchant)` | `amount: i128` |
| `executed` | `(symbol("executed"), subscriber, merchant)` | `amount: i128` |

---

## Error codes

| Code | Name | Trigger |
|------|------|---------|
| 1 | `AmountMustBePositive` | `amount ≤ 0` in `subscribe` |
| 2 | `IntervalTooShort` | `interval < 86400` in `subscribe` |
| 3 | `IntervalTooLong` | `interval > 31536000` in `subscribe` |
| 4 | `NoActiveSubscription` | No subscription found for `(subscriber, merchant)` pair |
| 5 | `PaymentNotDue` | `now < next_payment` in `execute_payment` |
| 6 | `Unauthorized` | Authorization check failed |

---

## Event Indexing Architecture

SorobanPay emits structured events via Soroban RPC for off-chain indexing. The contract publishes two core event types:

- **`subscribe`** — Emitted when a subscription is created or updated. Signals the start of a recurring payment relationship.
- **`executed`** — Emitted after a successful payment transfer and timestamp advance. Confirms payment collection.

**Cancellation Detection:** The contract does not emit a cancellation event. Instead, off-chain indexers detect cancellations by the absence of `executed` events after a period exceeding the subscription interval.

### Key Components

| Component | Purpose |
|-----------|---------|
| **Event Sources** | Soroban RPC's `getEvents()` endpoint (topics: event type, subscriber, merchant) |
| **Storage** | PostgreSQL, MongoDB, or time-series DBs for subscription state and payment history |
| **Indexing Pattern** | Pull-based polling with cursor-based pagination; event sourcing + CQRS for complex workflows |
| **Resumability** | Save RPC cursor in `indexer_state` to resume after failures |

### Event Schema

Each event contains:
- **Topics:** `(symbol, subscriber_address, merchant_address)` — enables filtering by party or event type
- **Data:** `amount: i128` — payment amount in token's smallest unit

### Recommended Architecture

For most SaaS and merchant dashboard use cases, a **PostgreSQL-backed pull indexer** is recommended. Characteristics:

1. Poll Soroban RPC every 5–30 seconds for new events.
2. Decode and persist to tables: `subscriptions`, `payments`, `indexer_state`.
3. Detect cancellations via batch job: mark subscriptions inactive if no `executed` event in `2 × interval`.
4. Serve queries via REST/GraphQL API for merchant dashboards.

For high-volume payment streams, consider **event sourcing + CQRS** to maintain an immutable event log and multiple projections (subscription summary, revenue analytics, etc.).

### Documentation

For detailed guidance on event sources, storage options, indexing patterns, workflows, and error handling, see [docs/architecture.md](docs/architecture.md).

---

## Security model

- **Non-custodial**: The contract never holds token balances. Transfers go directly `subscriber → merchant` via SEP-41 `transfer`.
- **Per-invocation auth**: Every entry point requires a fresh `require_auth()` signature — no stored sessions.
- **Allowance model**: Subscribers grant a SEP-41 allowance to the contract. Revoking allowance via `token.approve(contract_id, 0)` prevents future payments regardless of on-chain subscription state.
- **Time-lock**: Payment cannot be collected before `next_payment` — enforced on-chain by the Soroban ledger timestamp.
- **TTL**: Subscriptions have a ~30-day minimum and ~365-day maximum TTL. Each successful payment resets the 365-day clock.

## Storage cleanup strategy

The contract already includes a built-in cleanup model for stale subscriptions:

- **Automatic expiration**: `subscribe()` and `execute_payment()` call `extend_ttl()` to refresh storage TTL for active subscriptions.
- **Immediate removal on cancel**: `cancel()` deletes the subscription record from persistent storage.
- **Stale entry reclamation**: if a subscriber abandons a subscription and does not trigger payments or cancellation, the Soroban runtime can reclaim the record when the TTL expires.

Recommended repository strategy for periodic compaction:

1. **Rely on Soroban TTL for long-lived or abandoned entries.** The contract's current TTL policy is the primary guard against indefinite storage growth.
2. **Use off-chain indexing to detect stale subscriptions sooner.** A backend or indexer can watch `subscribe` and `executed` events and mark subscriptions as inactive if they have not been updated after a configurable overdue window.
3. **Trigger explicit cleanup from off-chain keepers if needed.** When a subscription is identified as stale or expired off-chain, a maintenance process can call a future cleanup entry point or `cancel()` on behalf of the subscriber/merchant pair.
4. **Avoid on-chain full scans.** Soroban does not provide efficient on-chain enumeration of all subscription keys, so storage compaction is best handled by off-chain systems using event history or a dedicated indexer.

Potential future enhancement:

- Add a keeper-accessible `prune_stale(subscriber, merchant)` entry point to remove records whose `next_payment` is long overdue or whose associated token allowance has been revoked. This would provide a formal cleanup API without requiring expensive on-chain storage scanning.

This plan keeps the contract lightweight and production-safe while ensuring stale subscription data is managed explicitly in documentation and off-chain processes.

---

## Contributing

We welcome contributions! Whether you want to report a bug, suggest an enhancement, or submit code changes, here's how to get started.

### Filing Issues

**Bug Reports** — If you've found a problem:
1. Check existing issues to avoid duplicates
2. Use the **bug** label
3. Provide:
   - Clear description of the issue
   - Steps to reproduce (if applicable)
   - Expected vs. actual behavior
   - Environment details (OS, Node.js version, Rust version)
   - Error messages or logs

**Feature Requests** — To suggest improvements:
1. Use the **enhancement** label
2. Describe the use case and expected behavior
3. Include any relevant examples or references

### Making Changes

**Setting up locally:**

```bash
# Clone the repository
git clone https://github.com/Chrisland58/SorobanPay.git
cd SorobanPay

# Install prerequisites (see Prerequisites section above)

# Build and test
make build
make test

# Frontend setup
cd frontend
npm install
npm run dev
```

**Submitting code:**
1. Create a feature branch: `git checkout -b fix/issue-number` or `git checkout -b feature/description`
2. Write tests for new functionality
3. Ensure all tests pass: `make test` (contract) and `npm run type-check` (frontend)
4. Run linters: `next lint` (frontend)
5. Commit with clear, descriptive messages
6. Push your branch and open a pull request

**PR guidelines:**
- Link the related issue (e.g., "Closes #189")
- Describe what changed and why
- Include any breaking changes
- Ensure CI/CD checks pass

### Labels

| Label | Purpose |
|-------|---------|
| `bug` | Something isn't working |
| `enhancement` | New feature or improvement |
| `documentation` | Updates to docs or comments |
| `test` | Test coverage or test improvements |
| `contract` | Changes to the Soroban smart contract |
| `frontend` | Changes to the Next.js frontend |
| `deployment` | Changes to build or deploy scripts |

---

## License

MIT
