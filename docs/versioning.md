# SorobanPay — Contract Versioning and Migration Guide

This document covers how SorobanPay versions its smart contract, when and why version
numbers change, and how to safely migrate on-chain subscribers to a new contract
deployment.

---

## Table of Contents

1. [Versioning rules](#1-versioning-rules)
2. [Version constants](#2-version-constants)
3. [Step-by-step migration checklist](#3-step-by-step-migration-checklist)
4. [How to run `migrate(admin)`](#4-how-to-run-migrateadmin)
5. [Frontend and backend compatibility matrix](#5-frontend-and-backend-compatibility-matrix)
6. [How to verify migration success](#6-how-to-verify-migration-success)
7. [Emergency rollback](#7-emergency-rollback)
8. [Appendix — semantic version quick reference](#8-appendix--semantic-version-quick-reference)

---

## 1. Versioning rules

SorobanPay follows **Semantic Versioning 2.0.0** (`MAJOR.MINOR.PATCH`) for the smart
contract. Each component signals a specific type of change to integrators.

### 1.1 Patch bump (`1.0.0 → 1.0.1`)

Increment `PATCH` for bug fixes that do not change any public interface.

**Examples:**
- Fix an off-by-one in a validation check.
- Correct a typo in an emitted event symbol.
- Improve an error message without changing the error code.

**Migration required?** No. Because Soroban contracts are immutable once deployed, a
patch fix always requires a fresh deployment to a new address. However, no subscriber
data migration is needed — existing `SubscriptionData` entries remain valid under the
new contract.

**Client action:** Update `NEXT_PUBLIC_CONTRACT_ID` / `CONTRACT_ID` to the new
address. No code changes needed in the frontend or backend.

---

### 1.2 Minor bump (`1.0.0 → 1.1.0`)

Increment `MINOR` for additive, backwards-compatible changes.

**Examples that trigger a minor bump:**
- Adding a new entry point (e.g., `pause`, `resume`, `batch_execute_payment`).
- Adding optional parameters at the end of an existing entry point.
- Adding new fields at the end of `SubscriptionData`.
- Emitting new event types (off-chain consumers must ignore unknown topics gracefully).
- Adding new error codes (codes 1–17 are stable; new codes use numbers ≥ 18).

**Migration required?** New entry points and new event types need no migration.
New fields on `SubscriptionData` require a schema version bump and a `migrate(admin)`
call if existing persistent entries must be updated to include the new field's default
value (see [§4](#4-how-to-run-migrateadmin)).

**Client action:** No breaking changes; existing clients continue working. Opt-in to
new features when ready.

---

### 1.3 Major bump (`1.x.x → 2.0.0`)

Increment `MAJOR` for any breaking change to the public contract interface.

**Examples that trigger a major bump:**
- Removing or renaming an existing entry point.
- Changing the type, position, or count of parameters in an existing entry point.
- Removing or reassigning an error code (codes 1–17 are permanently reserved).
- Changing the topic structure of an existing event.
- Changing the storage key scheme in a way that invalidates existing persistent entries.
- Removing fields from `SubscriptionData`.

**Migration required?** Yes — always. All subscribers must re-subscribe to the new
contract. There is no in-place upgrade path on Soroban.

**Client action:** Update to the new contract address. Review the [compatibility
matrix](#5-frontend-and-backend-compatibility-matrix) for required code changes.

---

### 1.4 Schema version (`STORAGE_VERSION`)

The **storage schema version** is a separate monotonically increasing integer stored
in contract instance storage under `MetaKey::StorageVersion`. It tracks the on-disk
layout of `SubscriptionData` and `DataKey`.

| Constant | Location | Purpose |
|---|---|---|
| `STORAGE_VERSION` | `contracts/subscription/src/storage.rs` | On-chain schema version integer |
| `CONTRACT_VERSION` | `contracts/subscription/src/storage.rs` | Semver string (`"1.0.0"`) |

Rules:
- Bump `STORAGE_VERSION` by 1 whenever `SubscriptionData` gains or loses a field.
- Never reuse a value — old values are permanently recorded in migration logic.
- A `STORAGE_VERSION` bump always accompanies at least a `MINOR` semver bump.
- Version 1 corresponds to the initial layout: `token`, `amount`, `interval`,
  `next_payment`, `is_paused`.

---

## 2. Version constants

```rust
// contracts/subscription/src/storage.rs

/// Contract semantic version: MAJOR.MINOR.PATCH
pub const CONTRACT_VERSION: &str = "1.0.0";
pub const VERSION_MAJOR: u32 = 1;
pub const VERSION_MINOR: u32 = 0;
pub const VERSION_PATCH: u32 = 0;

/// Human-readable contract identifier
pub const CONTRACT_NAME: &str = "SorobanPay-SubscriptionProtocol";

/// On-chain storage schema version (monotonically increasing integer)
pub const STORAGE_VERSION: u32 = 1;
```

To query the version from off-chain systems before any client interaction:

```typescript
import { Contract, SorobanRpc, scValToNative } from "@stellar/stellar-sdk";

const server = new SorobanRpc.Server(rpcUrl);
const contract = new Contract(contractId);

// Simulate a version() call — no signing required
const account = await server.getAccount(anyPublicKey);
const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase })
  .addOperation(contract.call("get_version"))
  .setTimeout(30)
  .build();

const sim = await server.simulateTransaction(tx);
const version = scValToNative(sim.result?.retval);
// Expected: "1.0.0"

const [major] = String(version).split(".").map(Number);
if (major !== 1) {
  throw new Error(`Unsupported contract version: ${version}. This client requires v1.x.x.`);
}
```

---

## 3. Step-by-step migration checklist

Use this checklist for every contract deployment that touches the on-chain schema or
breaks the existing public interface.

### Pre-migration

- [ ] **1. Read the current version on-chain.**  
  Call `get_version()` against the live contract and record the result.

- [ ] **2. Read the current schema version.**  
  Call `get_schema_version()` and record the result.

- [ ] **3. Snapshot all active subscriptions.**  
  Query your off-chain database (or use the `getEvents()` API) to enumerate every
  active `(subscriber, merchant)` pair. Store the snapshot in a timestamped backup.

  ```bash
  psql "$DATABASE_URL" -c "COPY (SELECT subscriber, merchant, token, amount, interval FROM subscriptions WHERE status = 'active') TO '/tmp/subscriptions-snapshot-$(date +%Y%m%d).csv' CSV HEADER;"
  ```

- [ ] **4. Verify the new contract builds cleanly.**

  ```bash
  make build
  make test
  make lint
  ```

- [ ] **5. Deploy to testnet first.**  
  Always run the full migration procedure on testnet before touching mainnet.

  ```bash
  CONTRACT_ID_NEW=$(STELLAR_NETWORK=testnet bash deploy/deploy.sh)
  echo "New testnet contract: $CONTRACT_ID_NEW"
  ```

- [ ] **6. Run `migrate(admin)` on testnet** (if `STORAGE_VERSION` bumped).  
  See [§4](#4-how-to-run-migrateadmin) for exact commands.

- [ ] **7. Verify testnet migration.**  
  See [§6](#6-how-to-verify-migration-success) for the full verification checklist.

### Mainnet migration

- [ ] **8. Deploy to mainnet.**

  ```bash
  STELLAR_NETWORK=mainnet STELLAR_IDENTITY=prod-deployer bash deploy/deploy.sh
  ```

  Copy the printed contract address — this is `CONTRACT_ID_NEW`.

- [ ] **9. Run `migrate(admin)` on mainnet** (if `STORAGE_VERSION` bumped).  
  Use the admin identity configured during `init`. Never run `migrate` with a
  non-admin key.

- [ ] **10. Update all environment variables.**

  | File / service | Variable | New value |
  |---|---|---|
  | `frontend/.env.local` | `NEXT_PUBLIC_CONTRACT_ID` | `CONTRACT_ID_NEW` |
  | Backend `configmap.yaml` | `CONTRACT_ID` | `CONTRACT_ID_NEW` |
  | Indexer env | `CONTRACT_ID` | `CONTRACT_ID_NEW` |
  | Webhook worker env | `CONTRACT_ID` | `CONTRACT_ID_NEW` |

- [ ] **11. Rebuild and redeploy the frontend.**

  ```bash
  cd frontend && npm run build
  # Deploy to your hosting provider (Vercel, Netlify, etc.)
  ```

- [ ] **12. Restart all backend services.**

  ```bash
  kubectl rollout restart deployment/sorobanpay-api -n sorobanpay
  kubectl rollout restart deployment/sorobanpay-indexer -n sorobanpay
  kubectl rollout restart deployment/sorobanpay-webhook-worker -n sorobanpay
  ```

- [ ] **13. Verify the mainnet migration.**  
  Follow the full verification checklist in [§6](#6-how-to-verify-migration-success).

- [ ] **14. Update `deployments.json`.**

  ```json
  // deploy/deployments.json
  {
    "mainnet": {
      "contract_id": "<CONTRACT_ID_NEW>",
      "deployed_at": "2026-10-20T14:00:00Z",
      "deployed_by": "prod-deployer",
      "contract_version": "1.1.0",
      "schema_version": 2
    }
  }
  ```

- [ ] **15. Update `CHANGELOG.md`** — move `[Unreleased]` entries under a new version
  heading.

- [ ] **16. Tag the release.**

  ```bash
  git tag -a v1.1.0 -m "Contract v1.1.0 — <summary of changes>"
  git push upstream v1.1.0
  ```

### Post-migration (major version only)

For major version bumps that break existing `SubscriptionData`, subscribers stored
under the old contract will not be visible to the new contract. Communicate the
migration to subscribers via your application layer:

- [ ] **17. Notify subscribers** that they must re-subscribe to the new contract
  address. This is an application-layer concern — the contract cannot initiate
  re-subscription on behalf of subscribers.

- [ ] **18. Deprecate the old contract.** Stop the indexer from indexing the old
  contract address. Keep the old contract's data in your database under a `deprecated`
  flag for audit purposes.

- [ ] **19. Set a sunset date.** Announce the date after which the old contract address
  will no longer be supported by the frontend. Give subscribers at least 30 days
  notice.

---

## 4. How to run `migrate(admin)`

`migrate(admin)` initialises or upgrades the on-chain storage schema. It reads the
current `STORAGE_VERSION` from instance storage and runs incremental migration steps
up to the compiled-in `STORAGE_VERSION`.

### When to call it

Call `migrate(admin)` whenever `STORAGE_VERSION` has been bumped in a new deployment.
For the initial deployment (version 0 → 1), `migrate` is called automatically by
`init(admin)`.

For subsequent schema bumps (e.g., version 1 → 2 after adding fields to
`SubscriptionData`), you must call `migrate(admin)` manually after deploying the new
contract.

### Authorization

`migrate` requires the **admin** signature — the same identity used in `init(admin)`.
The admin is set at deployment time by `deploy.sh` and is stored in the contract's
instance storage.

### Using the Stellar CLI

```bash
# Set environment variables
export CONTRACT_ID=<YOUR_NEW_CONTRACT_ADDRESS>
export ADMIN_IDENTITY=alice           # or your mainnet admin identity
export STELLAR_NETWORK=testnet        # or mainnet

# 1. Check the current schema version before migrating
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network "$STELLAR_NETWORK" \
  -- get_schema_version

# Expected output: 1   (the old version, before migration)

# 2. Run migrate(admin)
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$ADMIN_IDENTITY" \
  --network "$STELLAR_NETWORK" \
  -- migrate \
  --admin "$(stellar keys address $ADMIN_IDENTITY)"

# Expected output: the migration outcome — e.g., "Migrated from version 1 to 2"
# or "AlreadyCurrent" if the schema is already up-to-date.

# 3. Verify the schema version after migrating
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network "$STELLAR_NETWORK" \
  -- get_schema_version

# Expected output: 2   (the new version)
```

### Using the JavaScript SDK

```typescript
import {
  Contract,
  Keypair,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  Address,
} from "@stellar/stellar-sdk";

const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET;
const CONTRACT_ID = process.env.CONTRACT_ID!;
const ADMIN_SECRET = process.env.ADMIN_SECRET!; // never log this

async function runMigration() {
  const server = new SorobanRpc.Server(RPC_URL, { allowHttp: false });
  const adminKeypair = Keypair.fromSecret(ADMIN_SECRET);
  const adminAddress = adminKeypair.publicKey();

  const account = await server.getAccount(adminAddress);
  const contract = new Contract(CONTRACT_ID);

  // Step 1 — check current schema version
  const versionBeforeTx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("get_schema_version"))
    .setTimeout(30)
    .build();

  const versionBeforeSim = await server.simulateTransaction(versionBeforeTx);
  const versionBefore = scValToNative(versionBeforeSim.result?.retval);
  console.log(`Schema version before migration: ${versionBefore}`);

  // Step 2 — build and submit migrate(admin) transaction
  const migrateTx = new TransactionBuilder(account, {
    fee: "1000000", // 0.1 XLM max fee
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "migrate",
        new Address(adminAddress).toScVal(),
      )
    )
    .setTimeout(30)
    .build();

  // Simulate first to get resource estimates
  const migrateSim = await server.simulateTransaction(migrateTx);
  if (SorobanRpc.Api.isSimulationError(migrateSim)) {
    throw new Error(`Migration simulation failed: ${migrateSim.error}`);
  }

  // Assemble, sign, and submit
  const prepared = SorobanRpc.assembleTransaction(migrateTx, migrateSim).build();
  prepared.sign(adminKeypair);
  const sendResult = await server.sendTransaction(prepared);

  if (sendResult.status === "ERROR") {
    throw new Error(`Migration send failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  // Poll for confirmation
  let result;
  do {
    await new Promise((r) => setTimeout(r, 2000));
    result = await server.getTransaction(sendResult.hash);
  } while (result.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND);

  if (result.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Migration transaction failed: ${JSON.stringify(result)}`);
  }

  console.log("✅ Migration succeeded. Tx hash:", sendResult.hash);

  // Step 3 — verify new schema version
  const versionAfterTx = new TransactionBuilder(
    await server.getAccount(adminAddress),
    { fee: "100", networkPassphrase: NETWORK_PASSPHRASE }
  )
    .addOperation(contract.call("get_schema_version"))
    .setTimeout(30)
    .build();

  const versionAfterSim = await server.simulateTransaction(versionAfterTx);
  const versionAfter = scValToNative(versionAfterSim.result?.retval);
  console.log(`Schema version after migration: ${versionAfter}`);
}

runMigration().catch(console.error);
```

### Idempotency

`migrate` is idempotent. Calling it on a contract that is already at the target
`STORAGE_VERSION` returns `AlreadyCurrent` without modifying any storage. It is safe
to run `migrate` multiple times as a precaution.

### Error cases

| Error | Cause | Resolution |
|---|---|---|
| `Unauthorized` | Signing key is not the admin | Use the admin identity that was passed to `init(admin)` |
| `DowngradeRejected` | On-chain schema version is newer than compiled code | You are running an older binary against a newer deployed contract. Deploy the latest version of the contract first. |
| `UnknownVersion` | Migration loop hit a version with no handler | This indicates a development bug — open an issue. |

---

## 5. Frontend and backend compatibility matrix

### Contract interface stability in v1.x.x

The following surfaces are **guaranteed stable** across all v1.x.x releases:

| Surface | Stability |
|---|---|
| Entry point names (`subscribe`, `execute_payment`, `cancel`, `batch_execute_payment`, `get_subscription`) | Stable — never removed or renamed in v1 |
| Parameter order for all existing entry points | Stable — positional args will not shift |
| Parameter types for all existing entry points | Stable — `Address`, `i128`, `u64`, `bool` are locked |
| Error codes 1–17 | Stable — codes will not be reassigned |
| Event topics for `subscribe`, `executed`, `cancel`, `payment_transfer_failure` | Stable — topic 0 discriminant and order are locked |
| `SubscriptionData` field names returned by `get_subscription` | Stable — fields may be added but never removed |

### Client impact by change type

| Change type | Frontend impact | Backend / indexer impact | Required action |
|---|---|---|---|
| Patch fix (new contract address, same interface) | None to logic; update `CONTRACT_ID` env var | None to logic; update `CONTRACT_ID` env var | Update env vars + redeploy |
| New entry point added | None — existing calls unaffected | None — new entry point can be ignored | Update env vars; add UI when ready |
| New optional parameter appended to an existing entry point | None — positional call with original args still valid | None | No change required |
| New event type emitted | None | Indexer must handle unknown event topics gracefully (ignore) | Ensure indexer does not crash on unknown topics |
| New field added to `SubscriptionData` | May need to handle new field if surfaced in UI | Off-chain schema may need a new column | Optional; update when consuming new field |
| Parameter type changed (major bump) | **Breaking** — ScVal encoding must be updated | **Breaking** — event payload decoding must be updated | Update client code before switching contract |
| Parameter removed (major bump) | **Breaking** — call must omit the removed arg | **Breaking** | Update client code before switching contract |
| Entry point removed (major bump) | **Breaking** — call will fail | **Breaking** | Remove usage before switching contract |
| Error code reassigned (major bump) | **Breaking** — error handling logic may misidentify errors | **Breaking** | Update error handling before switching contract |
| Storage key scheme changed (major bump) | No direct impact | **Breaking** — existing indexed events may not map to new storage keys | Re-index from genesis on new contract |

### Minimum client versions

| SorobanPay Contract | Minimum `@stellar/stellar-sdk` | Minimum frontend Next.js | Minimum backend Node.js |
|---|---|---|---|
| v1.0.0 | 11.x | 14.x | 18.x |
| v1.1.x | 11.x | 14.x | 18.x |
| v2.0.0 | TBD (see release notes) | TBD | TBD |

### Verifying compatibility at runtime

Before submitting any transaction, verify the contract version matches what the client
expects:

```typescript
// frontend/src/lib/transaction_builder.ts (or equivalent)
async function assertCompatibleContract(
  server: SorobanRpc.Server,
  contractId: string,
  account: Account,
  networkPassphrase: string,
): Promise<void> {
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase })
    .addOperation(contract.call("get_version"))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (!SorobanRpc.Api.isSimulationSuccess(sim) || !sim.result) {
    throw new Error("Could not read contract version. Is CONTRACT_ID correct?");
  }

  const version = scValToNative(sim.result.retval) as string;
  const [major] = version.split(".").map(Number);
  if (major !== 1) {
    throw new Error(
      `Unsupported contract major version: ${version}. ` +
      `This client requires v1.x.x. Please update the application.`
    );
  }
}
```

---

## 6. How to verify migration success

Run this verification checklist after every migration, on both testnet and mainnet.

### 6.1 Verify the contract version

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network "$STELLAR_NETWORK" \
  -- get_version
# Expected: "1.1.0"   (or whatever the new version is)
```

### 6.2 Verify the schema version

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network "$STELLAR_NETWORK" \
  -- get_schema_version
# Expected: 2   (or whatever the new STORAGE_VERSION is)
```

### 6.3 Read an existing subscription

Pick a known active subscription from your snapshot (pre-migration). Verify it is
readable under the new contract. A `None` result indicates the entry was not migrated
or the contract address is wrong.

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network "$STELLAR_NETWORK" \
  -- get_subscription \
  --subscriber "<KNOWN_SUBSCRIBER_ADDRESS>" \
  --merchant   "<KNOWN_MERCHANT_ADDRESS>" \
  --token      "<TOKEN_ADDRESS>"
# Expected: SubscriptionData struct with all fields populated
```

### 6.4 Execute a test payment

Create a test subscription and execute a payment in your test environment:

```bash
# Create subscription
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source alice \
  --network "$STELLAR_NETWORK" \
  -- subscribe \
  --subscriber "$(stellar keys address alice)" \
  --merchant   "$(stellar keys address bob)" \
  --token      "$TOKEN_ADDRESS" \
  --amount     1 \
  --interval   86400

# Execute payment (will succeed if enough time has passed)
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source bob \
  --network "$STELLAR_NETWORK" \
  -- execute_payment \
  --subscriber "$(stellar keys address alice)" \
  --merchant   "$(stellar keys address bob)" \
  --token      "$TOKEN_ADDRESS"
# Expected: payment executed, `executed` event emitted
```

### 6.5 Verify the frontend loads

1. Update `NEXT_PUBLIC_CONTRACT_ID` in `frontend/.env.local`.
2. Run `npm run dev` (or check the production URL).
3. Connect Freighter and confirm:
   - No "Contract not configured" warning card is shown.
   - The subscription form renders.
   - A simulated `subscribe` call succeeds (green success card).

### 6.6 Verify the backend health endpoint

```bash
curl -s "https://api.example.com/health" | jq .
# Expected:
# {
#   "status": "ok",
#   "rpc": "reachable",
#   "contract": "resolved",
#   "version": "1.1.0"
# }
```

### 6.7 Verify the indexer is indexing the new contract

Confirm the indexer's cursor in `indexer_state` has been reset or is advancing
against the new contract address:

```bash
psql "$DATABASE_URL" -c "SELECT contract_id, cursor FROM indexer_state ORDER BY updated_at DESC LIMIT 5;"
# Expected: new contract address is present with a recent cursor
```

### 6.8 Verify the deployment record

```bash
cat deploy/deployments.json | jq .mainnet
# Expected: contract_id, deployed_at, contract_version, schema_version all updated
```

---

## 7. Emergency rollback

If the migration reveals a critical bug, roll back to the previous contract address
without any on-chain operation — the previous contract is still live and immutable.

```bash
# Revert env vars to previous contract address
export CONTRACT_ID_PREV="<OLD_CONTRACT_ADDRESS>"

# Frontend: restore .env.local from backup
cp frontend/.env.local.testnet.bak frontend/.env.local
# Set NEXT_PUBLIC_CONTRACT_ID=$CONTRACT_ID_PREV and rebuild

# Backend: update configmap and restart
kubectl set env deployment/sorobanpay-api CONTRACT_ID="$CONTRACT_ID_PREV" -n sorobanpay
kubectl set env deployment/sorobanpay-indexer CONTRACT_ID="$CONTRACT_ID_PREV" -n sorobanpay
kubectl rollout restart deployment/sorobanpay-api -n sorobanpay
kubectl rollout restart deployment/sorobanpay-indexer -n sorobanpay
```

Because Soroban contracts are immutable, rolling back to a previous contract address
is always safe. The old contract's state was never modified.

---

## 8. Appendix — semantic version quick reference

| Version component | When to bump | Example trigger |
|---|---|---|
| `PATCH` | Bug fix, no interface change | Fix off-by-one in validation |
| `MINOR` | Additive change, backwards compatible | Add new entry point |
| `MAJOR` | Breaking change | Rename an entry point |
| `STORAGE_VERSION` | `SubscriptionData` layout changed | Add new field |

### Decision tree

```
Is there a breaking change to an existing entry point, event, or error code?
  ├── Yes → MAJOR bump (v2.0.0); full subscriber re-migration required
  └── No → Is there a new entry point, new optional param, or new SubscriptionData field?
              ├── Yes → MINOR bump (v1.1.0)
              │           └── Did SubscriptionData gain a field?
              │               ├── Yes → also bump STORAGE_VERSION; run migrate(admin)
              │               └── No  → no migration needed
              └── No → PATCH bump (v1.0.1); no migration needed
```

---

## See Also

- [Contract API Reference](./contract-api.md) — full entry point parameter reference
- [Storage TTL Guide](./storage-ttl.md) — subscription lifetime and TTL management
- [Release Process](./release-process.md) — release notes template and tagging checklist
- [Changelog](../CHANGELOG.md) — version history
- `contracts/subscription/src/storage.rs` — version constants and migration logic
- `deploy/deployments.json` — per-network deployment address registry
