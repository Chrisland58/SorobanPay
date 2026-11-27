# Contract Upgrade Approval and Verification Checklist

This guide provides a repeatable, multi-stage checklist for SorobanPay smart contract reviewers and deployment operators. It governs contract upgrades, schema migrations (`migrate()`), Wasm artifact identity verification, and rollback readiness.

> **Related Guides:**
> - [Release Process](./release-process.md) — SemVer rules, changelog hygiene, and release coordination
> - [Operations Runbook](./operations.md) — Rollback runbook, emergency stop, and TTL maintenance
> - [Storage TTL Guide](./storage-ttl.md) — State retention and restoration procedures

---

## 1. Stage 1 — Build & Artifact Identity

Before submitting an upgrade for review, the author must generate a deterministic Wasm artifact and establish its cryptographic identity:

- [ ] **Deterministic Wasm Compilation**:
  Ensure the contract compiles cleanly against the pinned toolchain without warnings:
  ```bash
  stellar contract build --manifest-path contracts/subscription/Cargo.toml
  ```
- [ ] **Bytecode Optimization**:
  Optimize the artifact to minimize instruction metering and on-chain storage cost:
  ```bash
  stellar contract optimize --wasm target/wasm32-unknown-unknown/release/subscription.wasm
  ```
- [ ] **Artifact Checksum Identity**:
  Compute and record the SHA-256 digest of the optimized Wasm binary:
  ```bash
  sha256sum target/wasm32-unknown-unknown/release/subscription.optimized.wasm
  ```
  *The resulting 64-character hex hash MUST be appended to the pull request description.*

---

## 2. Stage 2 — Multi-Party Review

At least two core maintainers must verify the following four critical dimensions:

### 2.1 Storage Layout Compatibility
- [ ] **Schema Backward-Compatibility**:
  Existing `SubscriptionData` entries stored on-chain must remain decodable. Any newly introduced fields in data structs MUST be wrapped in `Option<T>` so that historical ledger entries decode with `None`.
- [ ] **Storage Regression Test**:
  Execute the automated upgrade regression test suite:
  ```bash
  cargo test --manifest-path contracts/subscription/Cargo.toml --features upgrade-test -- upgrade
  ```
  Expected outcome: All v1 entries read successfully under the v2 schema.

### 2.2 Authorization & Access Control
- [ ] **Administrative Invariants**:
  Verify that `migrate(admin)` enforces `admin.require_auth()` as its first statement.
- [ ] **Caller Check**:
  Verify `migrate` compares the caller against the stored `DataKey::Admin` and returns `ContractError::NotAdmin` if unauthorized.
- [ ] **One-Way Migration Gate**:
  Verify `migrate` prevents repeated invocation by rejecting calls if `stored_version >= CURRENT_SCHEMA_VERSION` (`ContractError::AlreadyMigrated`).

### 2.3 Event Schema Stability
- [ ] **Topic Invariants**:
  Ensure topic 0 symbol discriminants are preserved and topic order has not changed.
- [ ] **Migration Event**:
  Verify that `migrate()` emits the `contract_migrated` event with `CURRENT_SCHEMA_VERSION`.
- [ ] **Event Schema Test**:
  Run the automated event schema verification:
  ```bash
  cargo test --manifest-path contracts/subscription/Cargo.toml -- event_schema
  ```

### 2.4 Rollback Readiness & Contingency Plan
- [ ] **Previous Wasm Hash Documented**:
  Record the current running contract ID and previous Wasm hash.
- [ ] **Emergency Procedure**:
  Confirm operator access to administrative credentials to redeploy previous Wasm or freeze contract operations if unexpected state corruptions arise.

---

## 3. Stage 3 — Deployment Execution

Deployment must be coordinated and executed using the verified release artifacts:

- [ ] **Install Wasm to Network**:
  Install the verified binary to Stellar network and capture the on-chain Wasm hash:
  ```bash
  stellar contract install \
    --wasm target/wasm32-unknown-unknown/release/subscription.optimized.wasm \
    --network <network> \
    --source <admin-identity>
  ```
- [ ] **Compare On-Chain Hash**:
  Verify the Wasm hash returned by `stellar contract install` matches the SHA-256 digest approved during Stage 1.
- [ ] **Invoke Schema Migration**:
  Execute `migrate(admin)` with administrator credentials:
  ```bash
  stellar contract invoke \
    --id <contract_id> \
    --network <network> \
    --source <admin-identity> \
    -- migrate \
    --admin <admin_address>
  ```

---

## 4. Stage 4 — Post-Deployment Verification

Immediately following migration, operators must complete post-deployment health checks before opening the contract to traffic:

- [ ] **Verify On-Chain Hash via RPC**:
  Query the contract instance via Soroban RPC `getLedgerEntries` and assert that `executable.wasm_hash` matches the approved build digest.
- [ ] **Verify `contract_migrated` Event Emission**:
  Verify the migration event on Horizon/RPC:
  ```bash
  stellar events \
    --start-ledger <deployment_ledger> \
    --network <network> \
    --id <contract_id>
  ```
  Confirm topic contains `contract_migrated` and data payload reflects the new schema version integer.
- [ ] **State Read Smoke Test**:
  Verify `get_config()` and `get_subscription()` return intact data:
  ```bash
  stellar contract invoke \
    --id <contract_id> \
    --network <network> \
    -- get_config
  ```
- [ ] **Off-Chain Indexer Sync Check**:
  Confirm the backend indexer processes the `contract_migrated` event without cursor stalls or unhandled deserialization errors:
  ```bash
  curl -s http://localhost:4000/health/indexer | grep '"status":"ok"'
  ```

---

## 5. Upgrade Test Command Reference

For reference, the commands used across the upgrade cycle are:

| Purpose | Command |
|---|---|
| **Build Contract** | `stellar contract build --manifest-path contracts/subscription/Cargo.toml` |
| **Optimize Wasm** | `stellar contract optimize --wasm target/wasm32-unknown-unknown/release/subscription.wasm` |
| **Run Upgrade Tests** | `cargo test --manifest-path contracts/subscription/Cargo.toml --features upgrade-test -- upgrade` |
| **Run Event Schema Tests** | `cargo test --manifest-path contracts/subscription/Cargo.toml -- event_schema` |
| **Verify Backend Checklist Logic** | `npm run test:backend -- tests/contractUpgradeChecklist.test.ts` |
