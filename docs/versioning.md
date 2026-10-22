# SorobanPay — Contract Versioning and Migration Guide

This document covers the versioning rules for the SorobanPay smart contract, the step-by-step migration checklist, how to run `migrate(admin)` after a schema-version bump, the frontend and backend compatibility matrix, and how to verify a successful migration.

> **Current contract version:** `1.0.0`
> **Current schema version:** `1`

---

## Table of Contents

1. [Versioning Rules](#1-versioning-rules)
2. [Version Constants](#2-version-constants)
3. [Step-by-Step Migration Checklist](#3-step-by-step-migration-checklist)
4. [How to Run `migrate(admin)`](#4-how-to-run-migrateadmin)
5. [Frontend and Backend Compatibility Matrix](#5-frontend-and-backend-compatibility-matrix)
6. [How to Verify Migration Success](#6-how-to-verify-migration-success)
7. [Adding a New Entry Point (checklist)](#7-adding-a-new-entry-point-checklist)
8. [Adding a New Field to `SubscriptionData`](#8-adding-a-new-field-to-subscriptiondata)
9. [Off-Chain Version Check](#9-off-chain-version-check)
10. [Version History](#10-version-history)

---

## 1. Versioning Rules

SorobanPay follows **Semantic Versioning** (`MAJOR.MINOR.PATCH`).

### When to bump PATCH (`1.0.0 → 1.0.1`)

Increment the patch number for changes that fix bugs without altering the public interface or storage schema:

- Fix an incorrect fee rounding calculation.
- Correct an event field that emits the wrong data type.
- Fix a panic in an edge-case error path.
- Any change where existing callers continue to work without modification and no ledger data needs updating.

### When to bump MINOR (`1.0.0 → 1.1.0`)

Increment the minor number for additive, backwards-compatible changes:

- Add a new entry point (`pause`, `resume`, `expire_subscription`, etc.).
- Append new **optional** parameters at the end of an existing entry point's parameter list.
- Emit new event types with a new `Symbol` discriminant.
- Add new error codes (new numbers ≥ 18; codes 1–17 are frozen).
- Add new fields **appended** to the end of `SubscriptionData` (requires `CURRENT_SCHEMA_VERSION` bump).

Minor bumps do not require existing callers to change. Existing transactions continue to work.

### When to bump MAJOR (`1.x.x → 2.0.0`)

Increment the major number for any **breaking change** — a change that causes existing clients to fail:

| Breaking change | Example |
|---|---|
| Remove an existing entry point | Remove `batch_execute_payment` |
| Rename an existing entry point | Rename `execute_payment` to `collect` |
| Change the type of an existing parameter | Change `amount` from `i128` to `u64` |
| Reorder parameters of an existing entry point | Swap `subscriber` and `merchant` positions |
| Remove or reassign an error code | Reuse code 4 for a different error |
| Change the topic structure of an existing event | Add a new topic between existing topics |
| Change the storage key scheme | Rename `DataKey::Subscription` |

Major bumps **always** require deploying a new contract address and running a coordinated migration. See [Section 3](#3-step-by-step-migration-checklist) for the full checklist.

### Schema version vs. contract version

The **schema version** (`CURRENT_SCHEMA_VERSION`) tracks the structure of the `SubscriptionData` struct stored in persistent storage. It is separate from the contract version:

- `CONTRACT_VERSION` changes on any release.
- `CURRENT_SCHEMA_VERSION` changes only when fields are added to or removed from `SubscriptionData`.

A minor contract version bump (e.g. `1.0.0 → 1.1.0`) that adds a new field to `SubscriptionData` must also increment `CURRENT_SCHEMA_VERSION` (e.g. `1 → 2`).

---

## 2. Version Constants

Version constants are defined in `contracts/subscription/src/storage.rs`:

```rust
pub const CONTRACT_VERSION: &str = "1.0.0";
pub const VERSION_MAJOR: u32 = 1;
pub const VERSION_MINOR: u32 = 0;
pub const VERSION_PATCH: u32 = 0;
pub const CONTRACT_NAME: &str = "SorobanPay-SubscriptionProtocol";
pub const CURRENT_SCHEMA_VERSION: u32 = 1;
```

Two read-only entry points expose these values at runtime:

```bash
# Query the version string
stellar contract invoke \
  --id $CONTRACT_ID --network testnet \
  -- get_version

# Query the schema version
stellar contract invoke \
  --id $CONTRACT_ID --network testnet \
  -- get_schema_version
```

Both entry points require no authorization and can be called in a read-only simulation.

---

## 3. Step-by-Step Migration Checklist

Use this checklist for every upgrade, regardless of whether it is a patch, minor, or major bump.

### Pre-migration (before deploying new code)

- [ ] **Audit the diff.** Review all changes to `contracts/subscription/src/`. Confirm whether the change is patch, minor, or major by applying the rules in [Section 1](#1-versioning-rules).
- [ ] **Update `CONTRACT_VERSION`** in `contracts/subscription/src/storage.rs` to match the bump type.
- [ ] **Update `CURRENT_SCHEMA_VERSION`** if `SubscriptionData` fields changed.
- [ ] **Update `CHANGELOG.md`** under `[Unreleased]` with a summary of changes and the new version number.
- [ ] **Update `docs/contract-api.md`** for any added or changed entry points, parameters, error codes, or events.
- [ ] **Write upgrade regression tests** under the `upgrade-test` feature flag (see `make test-upgrade`).
- [ ] **Run full test suite** and confirm everything passes: `make test`.
- [ ] **Run linters:** `make lint`.

### Deployment

- [ ] **Build the new WASM:** `make build`.
- [ ] **Deploy to testnet first** and save the new contract address:
  ```bash
  NEW_CONTRACT_ID=$(bash deploy/deploy.sh)
  echo "New contract: $NEW_CONTRACT_ID"
  ```
- [ ] **Run smoke tests** against the new testnet contract:
  ```bash
  bash deploy/smoke_test.sh
  ```
- [ ] **Verify version on-chain:**
  ```bash
  stellar contract invoke --id $NEW_CONTRACT_ID --network testnet -- get_version
  # Expected: "1.x.x" (the new version)
  ```
- [ ] If schema version changed, **run `migrate(admin)`** against the new contract (see [Section 4](#4-how-to-run-migrateadmin)).
- [ ] **Deploy to mainnet** once testnet is verified:
  ```bash
  STELLAR_NETWORK=mainnet STELLAR_IDENTITY=prod-deployer bash deploy/deploy.sh
  ```
- [ ] **Record the new contract address** in `deploy/deployments.json` with a `deployed_at` timestamp.

### Post-migration (after deployment)

- [ ] **Update all environment variables** (`NEXT_PUBLIC_CONTRACT_ID`, `CONTRACT_ID`, etc.) to point to the new contract address.
- [ ] **Restart the backend** and verify the indexer picks up events from the new contract.
- [ ] **Rebuild and redeploy the frontend** with the new contract ID.
- [ ] **Verify the frontend connects** to the new contract and can simulate a `get_subscription` call.
- [ ] **Update backend polling** to start from the new contract's deployment ledger.
- [ ] **Monitor for 24 hours** — watch for `NoActiveSubscription` errors that could indicate a missed migration step.
- [ ] **Announce the new contract address** to any external integrators.
- [ ] **Tag the release** in git: `git tag v1.x.x && git push origin v1.x.x`.

---

## 4. How to Run `migrate(admin)`

`migrate(admin)` is a contract entry point that rewrites existing `SubscriptionData` entries from an old schema version to the current schema version. It must be called after deploying a new contract version that increments `CURRENT_SCHEMA_VERSION`.

> **When is `migrate(admin)` needed?**
> Only when `CURRENT_SCHEMA_VERSION` increases (i.e. a new field was appended to `SubscriptionData`). For patch bumps or minor bumps that add only new entry points or events, no migration is needed.

### Authorization

`migrate(admin)` requires the **admin signature** — the account that called `init(admin)` when the contract was first deployed.

### Running via Stellar CLI

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_IDENTITY \
  --network testnet \
  -- migrate \
  --admin $ADMIN_ADDRESS
```

Replace `$ADMIN_IDENTITY` with the Stellar CLI identity alias for the admin key, and `$ADMIN_ADDRESS` with the admin's Stellar public key (`G...`).

### Running via TypeScript SDK

```typescript
import {
  Contract,
  Address,
  TransactionBuilder,
  Networks,
  SorobanRpc,
} from "@stellar/stellar-sdk";

async function runMigration(
  contractId: string,
  adminKeypair: Keypair,
  rpcUrl: string,
  networkPassphrase: string,
) {
  const server = new SorobanRpc.Server(rpcUrl);
  const contract = new Contract(contractId);
  const account = await server.getAccount(adminKeypair.publicKey());

  const tx = new TransactionBuilder(account, {
    fee: "10000",
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        "migrate",
        new Address(adminKeypair.publicKey()).toScVal(),
      )
    )
    .setTimeout(60)
    .build();

  // Simulate first to confirm success and get resource limits
  const sim = await server.simulateTransaction(tx);
  if (!SorobanRpc.Api.isSimulationSuccess(sim)) {
    throw new Error(`Migration simulation failed: ${JSON.stringify(sim)}`);
  }

  // Assemble, sign, and submit
  const assembled = SorobanRpc.assembleTransaction(tx, sim).build();
  assembled.sign(adminKeypair);

  const result = await server.sendTransaction(assembled);
  console.log("Migration submitted:", result.hash);

  // Poll until confirmed
  let status = await server.getTransaction(result.hash);
  while (status.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
    await new Promise((r) => setTimeout(r, 2000));
    status = await server.getTransaction(result.hash);
  }

  if (status.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    console.log("Migration completed successfully.");
  } else {
    throw new Error(`Migration failed: ${JSON.stringify(status)}`);
  }
}
```

### What `migrate(admin)` does internally

1. Reads `CURRENT_SCHEMA_VERSION` from the deployed contract.
2. Queries the on-chain schema version stored in instance storage (`DataKey::SchemaVersion`).
3. If the stored version equals `CURRENT_SCHEMA_VERSION`, exits early (idempotent — safe to run multiple times).
4. Iterates over all `DataKey::Subscription(subscriber, merchant)` entries in persistent storage.
5. For each entry, deserializes using the **old** schema and re-serializes using the **new** schema, populating any new fields with their default values.
6. Updates the stored schema version to `CURRENT_SCHEMA_VERSION`.

> **Cost note:** Migration touches every active subscription entry. On a contract with thousands of subscribers, this may exceed a single transaction's instruction budget. In that case, run migration in batches by passing an optional `batch_size` and `cursor` argument (see `docs/contract-api.md` for the full parameter reference).

### Verifying migration completed

After the transaction confirms, verify the on-chain schema version matches the expected value:

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --network testnet \
  -- get_schema_version
# Expected: 2  (or whatever the new CURRENT_SCHEMA_VERSION is)
```

---

## 5. Frontend and Backend Compatibility Matrix

### Frontend (`frontend/src/lib/transaction_builder.ts`)

| Contract version | Frontend version | Compatible? | Notes |
|---|---|---|---|
| `1.0.0` | `1.0.x` | ✅ Yes | Baseline |
| `1.1.0` (new entry point added) | `1.0.x` | ✅ Yes | New entry point ignored by old frontend |
| `1.1.0` (optional param appended to `subscribe`) | `1.0.x` | ✅ Yes | Old frontend omits new param; contract uses default |
| `1.1.0` (new field on `SubscriptionData`) | `1.0.x` | ✅ Yes | Old frontend ignores unknown fields in `scValToNative` result |
| `2.0.0` (breaking change) | `1.x.x` | ❌ No | Must upgrade frontend to `2.x.x` before using new contract |

**Required frontend action after each contract version bump:**

| Bump type | Action |
|---|---|
| Patch (`1.0.0 → 1.0.1`) | None — update `NEXT_PUBLIC_CONTRACT_ID` in `.env.local` |
| Minor (`1.0.0 → 1.1.0`) | Update `NEXT_PUBLIC_CONTRACT_ID`; optionally expose new features in UI |
| Major (`1.x.x → 2.0.0`) | Update `NEXT_PUBLIC_CONTRACT_ID` **and** update `buildAndSubmitSubscribe` and any other affected builders |

### Backend (event indexer and REST API)

| Contract version | Backend version | Compatible? | Notes |
|---|---|---|---|
| `1.0.0` | `1.0.x` | ✅ Yes | Baseline |
| `1.1.0` (new event type) | `1.0.x` | ✅ Yes | Backend ignores unknown event topics; no data loss |
| `1.1.0` (new `SubscriptionData` field) | `1.0.x` | ✅ Yes | Backend reads known fields; ignores new ones |
| `2.0.0` (changed event topic structure) | `1.x.x` | ❌ No | Backend will misparse events; must upgrade before switching contract |

**Required backend action after each contract version bump:**

| Bump type | Action |
|---|---|
| Patch | Update `CONTRACT_ID` env var; restart indexer |
| Minor | Update `CONTRACT_ID`; restart indexer; no code changes required |
| Major | Update `CONTRACT_ID` **and** deploy new backend version that handles new event/entry-point schemas |

### Summary table

| Change type | Frontend code change? | Backend code change? | `migrate(admin)` needed? |
|---|---|---|---|
| New entry point added | No | No | No |
| New optional param on `subscribe` | No | No | No |
| New `SubscriptionData` field appended | No | No | **Yes** |
| New event type | No | No | No |
| New error code | No | No | No |
| Breaking change (major bump) | **Yes** | **Yes** | **Yes** (if schema changed) |

---

## 6. How to Verify Migration Success

After running the migration and updating all services, verify each layer independently.

### Step 1 — Verify on-chain schema version

```bash
stellar contract invoke \
  --id $CONTRACT_ID --network testnet \
  -- get_schema_version
# Must equal CURRENT_SCHEMA_VERSION
```

### Step 2 — Verify contract version string

```bash
stellar contract invoke \
  --id $CONTRACT_ID --network testnet \
  -- get_version
# Must equal the new CONTRACT_VERSION (e.g. "1.1.0")
```

### Step 3 — Smoke-test a subscription read

Pick a known active subscription and confirm it returns the expected shape with the new fields populated:

```bash
stellar contract invoke \
  --id $CONTRACT_ID --network testnet \
  -- get_subscription \
  --subscriber $KNOWN_SUBSCRIBER \
  --merchant   $KNOWN_MERCHANT \
  --token      $TOKEN_ADDRESS
# Must return SubscriptionData with all fields present (new fields at defaults)
```

### Step 4 — Verify frontend connects to new contract

```bash
# In frontend/.env.local, confirm:
NEXT_PUBLIC_CONTRACT_ID=<new address>

# Restart dev server and check browser console — no "contract_not_found" errors
npm run dev
```

Open the browser DevTools console. A successful connection logs the version string from `get_version`. Errors at this step indicate the wrong contract ID.

### Step 5 — Verify backend indexer

```bash
# Check indexer health endpoint
curl http://localhost:3001/health
# Expected: { "status": "ok", "contractId": "<new address>", "schemaVersion": 2 }
```

Confirm the indexer is processing new events from the new contract address and storing them with the correct schema.

### Step 6 — Run smoke tests

```bash
bash deploy/smoke_test.sh
```

The smoke test suite covers `subscribe`, `execute_payment`, `cancel`, and `get_subscription` against the deployed contract. All assertions must pass.

### Step 7 — Monitor error rates (24h window)

Watch the following signals for 24 hours after deployment:

| Signal | Healthy value | Investigation trigger |
|---|---|---|
| `NoActiveSubscription` (error 4) rate | Baseline (same as before migration) | Spike > 2× baseline |
| `execute_payment` success rate | ≥ 99% | Drop below 95% |
| Backend indexer lag | < 10 ledgers behind tip | Lag > 100 ledgers |
| Frontend form submission errors | 0 per hour | Any submission error post-migration |

---

## 7. Adding a New Entry Point (checklist)

Follow this checklist when adding a new entry point without breaking existing clients:

1. **Add the function at the bottom** of `#[contractimpl] impl SubscriptionProtocol` in `contracts/subscription/src/lib.rs`. Never reorder existing functions.
2. **Use a new, distinct function name.** Never overload an existing entry point.
3. **Append new parameters after all existing ones** if extending an existing function signature. Never insert parameters in the middle.
4. **Register new error codes** with unused numbers (currently ≥ 18). Never reuse a retired code.
5. **Emit new events** using a new `Symbol` topic discriminant.
6. **Increment `CONTRACT_VERSION`** — minor bump for new entry points.
7. **Update `docs/contract-api.md`** with full parameter table, error cases, and examples.
8. **Update `CHANGELOG.md`** under `[Unreleased]`.

---

## 8. Adding a New Field to `SubscriptionData`

`SubscriptionData` is stored as XDR. Soroban serializes `#[contracttype]` structs by **field order**, so only append-only additions are safe.

1. **Append the new field at the end** of the `SubscriptionData` struct in `contracts/subscription/src/storage.rs`.
2. **Increment `CURRENT_SCHEMA_VERSION`** (e.g. `1 → 2`).
3. **Increment `CONTRACT_VERSION`** with a minor bump (e.g. `1.0.0 → 1.1.0`).
4. **Implement `migrate(admin)`** to read existing entries and rewrite them with the new field populated with a sensible default.
5. **Write upgrade regression tests** under `#[cfg(feature = "upgrade-test")]` that:
   - Store a subscription using the old schema.
   - Call `migrate(admin)`.
   - Assert the subscription is still readable with the new schema.
6. **Run `make test-upgrade`** to verify regression tests pass.
7. **For a fresh deployment** (new contract, no existing state): no migration is needed.

---

## 9. Off-Chain Version Check

Call the read-only version helpers before submitting any transaction to confirm client–contract compatibility:

```typescript
import { Contract, SorobanRpc, scValToNative } from "@stellar/stellar-sdk";

async function assertCompatibleVersion(
  contractId: string,
  rpcUrl: string,
  networkPassphrase: string,
) {
  const server = new SorobanRpc.Server(rpcUrl);
  const contract = new Contract(contractId);
  const account = await server.getAccount(anyPublicKey);

  const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase })
    .addOperation(contract.call("get_version"))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!SorobanRpc.Api.isSimulationSuccess(sim) || !sim.result) {
    throw new Error("Could not read contract version.");
  }

  const version = String(scValToNative(sim.result.retval));
  const [major] = version.split(".").map(Number);

  if (major !== 1) {
    throw new Error(
      `Unsupported contract version: ${version}. This client requires v1.x.x. ` +
      `Please upgrade to the compatible client version.`
    );
  }

  console.log(`Contract version verified: ${version}`);
}
```

Call this function during app initialization (before the user submits their first transaction) and in your backend's health check on startup.

---

## 10. Version History

| Version | Schema version | Release date | Notes |
|---|---|---|---|
| `1.0.0` | `1` | 2026-06 | Initial release |

For the full changelog, see [CHANGELOG.md](../CHANGELOG.md).

---

## See Also

- [Contract API Reference](./contract-api.md) — full entry point documentation
- [Storage TTL Guide](./storage-ttl.md) — TTL constants, extension logic, cost implications
- [Operations Guide](./operations.md) — TTL monitoring, alert thresholds, runbooks
- [Release Process](./release-process.md) — how to cut a release and publish artifacts
- [Security Model](./security.md) — authorization model and upgrade security considerations
