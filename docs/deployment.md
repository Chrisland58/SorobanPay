# Deployment Guide

This document covers production deployment of a platform built on SorobanPay.

## Pre-launch checklist

Before going live on Stellar **Mainnet**, complete every item in this checklist.

### Smart contract

- [ ] Run `make build` and verify the WASM compiles without errors.
- [ ] Run `make test` — all contract unit tests must pass.
- [ ] Run `make coverage` — line coverage must be ≥ 95% (enforced by CI).
- [ ] Run `bash scripts/integration-test.sh` — full subscribe → execute → cancel lifecycle must pass.
- [ ] Deploy to **Testnet** first and exercise the full user flow manually.
- [ ] Capture the deployed contract address and set it in `frontend/.env.local` as `NEXT_PUBLIC_CONTRACT_ID`.

### Frontend

- [ ] Run `npm run test:ci` in `frontend/` — all tests must pass, coverage must be ≥ 80%.
- [ ] Run `npm run type-check` — no TypeScript errors.
- [ ] Run `npm run build` — Next.js production build must succeed.
- [ ] Set all three environment variables in production:
  - `NEXT_PUBLIC_CONTRACT_ID`
  - `NEXT_PUBLIC_RPC_URL` (use a reliable mainnet RPC endpoint)
  - `NEXT_PUBLIC_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015`
- [ ] Verify Freighter connects and a test subscription can be signed on Mainnet.

### Security

- [ ] Review [docs/security.md](./security.md) — ensure all secrets are managed correctly.
- [ ] Ensure `NEXT_PUBLIC_` variables do NOT contain private keys or secrets.
- [ ] Rotate any testnet keys before mainnet deployment.

### Legal & compliance

> These two documents are **templates only** — not legal advice.
> Consult a qualified lawyer before publishing.

- [ ] Customise and publish a **Privacy Policy** for your platform.
  Template: [docs/templates/privacy-policy.md](./templates/privacy-policy.md)
- [ ] Customise and publish **Terms of Service** for your platform.
  Template: [docs/templates/terms-of-service.md](./templates/terms-of-service.md)
- [ ] Fill in all `[PLACEHOLDER]` sections in both documents.
- [ ] Have both documents reviewed by legal counsel.
- [ ] Link both documents from your product's footer or onboarding flow.
- [ ] Confirm your data retention schedule matches the Privacy Policy
  (see BE-71 backend implementation).

### Monitoring

- [ ] Set up Codecov coverage badges (see README for badge links).
- [ ] Configure alerts for RPC endpoint availability.
- [ ] Set up error tracking (e.g. Sentry) for the frontend.

---

## Deploying the contract

See [README.md → Deployment](../README.md#deployment) for full instructions.

```bash
# Testnet
stellar keys generate alice --network testnet
stellar keys fund alice --network testnet
CONTRACT_ID=$(bash deploy/deploy.sh)
echo "Contract: $CONTRACT_ID"

# Mainnet
STELLAR_NETWORK=mainnet STELLAR_IDENTITY=my-mainnet-id bash deploy/deploy.sh
```

## Environment variables reference

### `deploy/deploy.sh` variables

These variables control the deployment script. Set them before running `bash deploy/deploy.sh`.

| Variable | Default | Required | Allowed values | Description |
|----------|---------|----------|---------------|-------------|
| `STELLAR_NETWORK` | `testnet` | No | `testnet`, `mainnet` | Target Stellar network. Determines the RPC endpoint and network passphrase automatically — do not set `RPC_URL` or `PASSPHRASE` directly. |
| `STELLAR_IDENTITY` | `alice` | No | Any registered identity alias | Stellar CLI identity alias that signs and pays fees for the deploy transaction. Must be pre-created with `stellar keys generate` and funded. |

**Derived values** (set internally by the script — do not override):

| Derived variable | Testnet value | Mainnet value |
|-----------------|--------------|--------------|
| `RPC_URL` | `https://soroban-testnet.stellar.org` | `https://mainnet.stellar.validationcloud.io/v1/<key>` |
| `PASSPHRASE` | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |

**Quick examples:**

```bash
# Testnet (all defaults)
bash deploy/deploy.sh

# Testnet — capture contract address
CONTRACT_ID=$(bash deploy/deploy.sh)

# Mainnet — explicit identity
STELLAR_NETWORK=mainnet STELLAR_IDENTITY=my-mainnet-id bash deploy/deploy.sh

# Mainnet — capture contract address
CONTRACT_ID=$(STELLAR_NETWORK=mainnet STELLAR_IDENTITY=my-mainnet-id bash deploy/deploy.sh)
echo "Deployed: $CONTRACT_ID"
```

### Frontend (`frontend/.env.local`) variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_CONTRACT_ID` | ✅ | Deployed contract address (`C…`) from `deploy.sh` stdout |
| `NEXT_PUBLIC_RPC_URL` | ✅ | Soroban RPC endpoint (must match the network Freighter is on) |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | ✅ | Stellar network passphrase — must match Freighter's selected network |

Copy `frontend/.env.example` to `frontend/.env.local` and fill in the values above. See [README.md → Frontend → Configure environment variables](../README.md#2-configure-environment-variables) for the full setup walkthrough.

---

## Contract Deployment Runbook

This runbook covers every step needed to deploy, initialize, configure, verify,
upgrade, and roll back the `SubscriptionProtocol` contract on testnet and mainnet.
Follow each phase in order and complete every check before proceeding.

---

### Phase 0 — Prerequisites

Confirm all tools are installed and at the correct versions before proceeding.

```bash
# Rust stable toolchain and WASM target
rustup show            # must include stable
rustup target list --installed | grep wasm32-unknown-unknown

# If not installed:
rustup target add wasm32-unknown-unknown

# Stellar CLI — must be ≥ 21.x (deploy.sh pins 21.3.0)
stellar --version
# Expected: stellar 21.x.y

# If not installed:
cargo install --locked stellar-cli --features opt

# Node.js ≥ 18 (for TTL scripts and smoke tests)
node --version   # must be ≥ v18.0.0
```

---

### Phase 1 — Build and Test

Always build from a clean state and run the full test suite before deploying.

```bash
# 1. Clean previous build artifacts
make clean

# 2. Compile contract to WASM (release profile)
make build
# Expected: contracts/target/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm

# 3. Verify the WASM artifact exists and is non-zero
ls -lh contracts/target/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm
# Expected: file size > 0

# 4. Run all unit and property tests
make test
# Expected: test result: ok. N passed; 0 failed.

# 5. Enforce coverage threshold (≥ 95%)
make coverage
# Expected: Coverage: XX.XX% >= 95.00% — OK
```

**Do not proceed if any step above exits non-zero.**

---

### Phase 2 — Testnet Deployment

#### 2.1 Create and fund the deploy identity

```bash
# Create a new identity (one-time per environment)
stellar keys generate alice --network testnet

# Fund via Friendbot (testnet only — free)
stellar keys fund alice --network testnet

# Confirm the identity is funded
stellar keys address alice --network testnet
# Expected: GABC...ALICE  (Stellar public key, starts with G)
```

#### 2.2 Deploy

```bash
# Deploy to testnet and capture the contract address
CONTRACT_ID=$(bash deploy/deploy.sh)
echo "Deployed contract: $CONTRACT_ID"
```

All diagnostic output goes to stderr. `CONTRACT_ID` receives only the contract
address on stdout — a `C`-prefixed Stellar contract ID (56 characters).

Expected stderr output:

```
Network:             testnet
Identity:            alice
RPC URL:             https://soroban-testnet.stellar.org
Stellar CLI version: 21.3.0
Building contract...
Deploying contract...
```

Expected stdout:

```
CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

#### 2.3 Initialize — set admin and amount cap

After deploy the contract is live but has no admin set. Call `init(admin)` before
creating any subscriptions. Optionally set a per-deployment amount cap with
`set_max_amount`.

```bash
ADMIN_ADDRESS=$(stellar keys address alice --network testnet)

# Initialize the contract with the admin key
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source alice \
  --network testnet \
  -- init \
  --admin "$ADMIN_ADDRESS"
# Expected: no output (void return)

# Optional: set a per-subscription amount cap (in token base units)
# Example: cap at 1,000 USDC (7 decimals → 10_000_000_000 base units)
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source alice \
  --network testnet \
  -- set_max_amount \
  --amount 10000000000
# Expected: no output (void return)
```

#### 2.4 Configure the frontend

```bash
cd frontend
cp .env.example .env.local

# Set the three required variables:
# NEXT_PUBLIC_CONTRACT_ID  — the C... address from step 2.2
# NEXT_PUBLIC_RPC_URL      — https://soroban-testnet.stellar.org
# NEXT_PUBLIC_NETWORK_PASSPHRASE — Test SDF Network ; September 2015
```

Edit `frontend/.env.local`:

```env
NEXT_PUBLIC_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
NEXT_PUBLIC_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
```

#### 2.5 Verify the testnet deployment

```bash
# 1. Smoke test — basic subscribe → execute → cancel lifecycle
bash deploy/smoke_test.sh
# Expected: all three operations succeed, no ContractError returned

# 2. Check that get_subscription works (read-only, no auth)
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source alice \
  --network testnet \
  -- get_subscription \
  --subscriber "$ADMIN_ADDRESS" \
  --merchant   "$ADMIN_ADDRESS"
# Expected: error NoActiveSubscription (code 4) — confirms contract is live and callable

# 3. Run the full integration test suite
bash scripts/integration-test.sh
# Expected: all scenarios PASS
```

#### 2.6 Save the deployment record

`deploy/deploy.sh` writes to `deploy/deployments.json`. Commit this file:

```bash
git add deploy/deployments.json
git commit -m "chore: record testnet deployment $(date -u +%Y-%m-%d)"
```

---

### Phase 3 — Production (Mainnet) Deployment

**Do not deploy to mainnet until testnet verification is complete.**

#### 3.1 Create and fund the mainnet identity

```bash
# Generate a dedicated mainnet deploy identity (one-time)
stellar keys generate my-mainnet-id --network mainnet

# Print the public key and fund it with real XLM
stellar keys address my-mainnet-id --network mainnet
# Expected: GXYZ...PROD  — send at least 2 XLM to this address
# Minimum: 1 XLM base reserve + ~0.1 XLM for deployment fees
```

Mainnet has no Friendbot. You must transfer XLM from an exchange or funded wallet.

#### 3.2 Deploy to mainnet

```bash
CONTRACT_ID=$(STELLAR_NETWORK=mainnet STELLAR_IDENTITY=my-mainnet-id bash deploy/deploy.sh)
echo "Mainnet contract: $CONTRACT_ID"
```

If the RPC node is unavailable or rate-limited:
- Retry once after 60 seconds — the script is idempotent at the deploy step.
- Check RPC connectivity: `curl -s https://mainnet.stellar.validationcloud.io/v1/.../getHealth | jq .`

#### 3.3 Initialize on mainnet

```bash
ADMIN_ADDRESS=$(stellar keys address my-mainnet-id --network mainnet)

stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source my-mainnet-id \
  --network mainnet \
  -- init \
  --admin "$ADMIN_ADDRESS"
```

#### 3.4 Configure mainnet frontend environment

```env
NEXT_PUBLIC_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
NEXT_PUBLIC_RPC_URL=https://mainnet.stellar.validationcloud.io/v1/<YOUR_KEY>
NEXT_PUBLIC_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
```

#### 3.5 Verify the mainnet deployment

```bash
# Check contract version (if get_version is implemented)
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source my-mainnet-id \
  --network mainnet \
  -- get_version
# Expected: version string, e.g. "1.0.0"

# Confirm the contract is visible in Stellar Expert
echo "https://stellar.expert/explorer/public/contract/$CONTRACT_ID"
```

Open the URL in a browser and confirm the contract entry exists.

---

### Phase 4 — Contract Upgrades

SorobanPay contract upgrades must satisfy backward compatibility constraints to
protect stored subscriptions.

#### Allowed in an upgrade

- Adding new `#[contractimpl]` entry points (existing entry points are unaffected).
- Adding optional fields to storage structs with a default value.
- Bumping constants that do not affect existing stored data.
- Fixing bugs within an existing function body (same signature, same storage keys).

#### Not allowed without migration

- Removing or renaming existing entry points.
- Changing the type or key structure of `DataKey::Subscription` (breaks reads).
- Removing fields from `SubscriptionData` without a migration step.

#### Upgrade regression tests

Before deploying an upgraded WASM, run the two-phase upgrade regression suite:

```bash
make test-upgrade
# Runs contracts/subscription/src/test_upgrade.rs under the --features upgrade-test flag
# Expected: test result: ok. N passed; 0 failed.
```

These tests verify that subscriptions stored under the old schema are still
readable and payable after the new WASM is deployed.

#### Upgrade process

```bash
# 1. Build the new WASM
make build

# 2. Run upgrade tests
make test-upgrade

# 3. Deploy the new WASM as an upgrade (admin only)
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source my-mainnet-id \
  --network mainnet \
  -- upgrade \
  --new_wasm_hash <NEW_WASM_HASH>
# The new WASM hash is obtained from the upload step before invoking upgrade.

# 4. Verify get_version returns the new version
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source my-mainnet-id \
  --network mainnet \
  -- get_version
```

---

### Phase 5 — Rollback Limits and Failure Recovery

#### What can be rolled back

| Scenario | Rollback approach |
|---|---|
| WASM upgrade failed mid-flight | Re-run `upgrade` with the previous WASM hash |
| Frontend misconfiguration | Update `NEXT_PUBLIC_CONTRACT_ID` in `.env.local` and redeploy frontend |
| Wrong `init` admin | Cannot undo — deploy a new contract instance |
| Wrong `set_max_amount` | Call `set_max_amount` again with the correct value (admin only) |

#### What cannot be rolled back

- **Initial deployment** — a deployed contract's address is permanent. If the wrong
  WASM was deployed, deploy a fresh contract and migrate users to the new address.
- **Subscription data** — on-chain persistent storage entries cannot be reverted by
  the contract. Reconcile via the off-chain reconciler (see [§8](#8-reconciliation-operations)).

#### Partial deployment recovery

If `deploy.sh` exits mid-run:

1. Check `deploy/deployments.json` — if a contract address was written, the WASM
   was uploaded and deployed successfully.
2. If the file is empty or missing, re-run `bash deploy/deploy.sh` — the build step
   is idempotent and the deploy step will create a fresh contract.
3. If a contract address was written but `init` was never called, call `init` now
   (it is a one-time call; calling it twice returns `AlreadyInitialized`).

#### Deployment failure table

| Symptom | Likely cause | Fix |
|---|---|---|
| `ERROR: Contract build failed` | Rust toolchain or `wasm32` target missing | `rustup target add wasm32-unknown-unknown` |
| `ERROR: WASM artifact not found` | `make build` produced no output | Check Cargo errors; re-run `make build` |
| `ERROR: Contract deployment failed` | Identity not funded or CLI misconfigured | Fund the account; verify with `stellar keys address <id>` |
| `ERROR: Unknown STELLAR_NETWORK value` | Typo in `STELLAR_NETWORK` | Allowed values: `testnet` or `mainnet` only |
| Empty `CONTRACT_ID` returned | RPC unreachable or rate-limited | Retry after 60 s; check RPC URL connectivity |
| `AlreadyInitialized` on `init` | `init` was already called | No action needed — the contract is initialized |
| Transaction fee too low (mainnet) | Surge pricing | Re-run; the Stellar CLI auto-adjusts fees |
| `AmountExceedsLimit` on `subscribe` | `set_max_amount` is too low | Call `set_max_amount` with a higher value |

---

### Phase 6 — Post-Deployment Checklist

```
[ ] Contract address recorded in deploy/deployments.json and committed
[ ] frontend/.env.local set with correct CONTRACT_ID, RPC_URL, NETWORK_PASSPHRASE
[ ] init() called and confirmed (no AlreadyInitialized error)
[ ] smoke_test.sh passed against the deployed contract
[ ] scripts/integration-test.sh passed
[ ] Monitoring alerts configured (RPC reachability, /health endpoint)
[ ] Grafana dashboard imported and showing data
[ ] deploy/deployments.json committed and pushed to repository
[ ] Contract address published to team / documentation
```

---

### See Also

- [README.md → Deployment](../README.md#deployment) — environment variable reference
- [docs/security.md](./security.md) — key management and secret rotation guidance
- [docs/operations.md](./operations.md) — TTL management, observability, and reconciliation
- `deploy/deploy.sh` — deployment script source
- `deploy/smoke_test.sh` — smoke test suite
- `scripts/integration-test.sh` — full lifecycle integration tests
- `contracts/subscription/src/test_upgrade.rs` — upgrade regression tests
