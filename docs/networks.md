# SorobanPay — Testnet vs. Mainnet Configuration Guide

This page is the single source of truth for every value that changes when you move SorobanPay from testnet to mainnet. Bookmark it before you deploy.

---

## 1. Side-by-Side Comparison Table

| Setting | Testnet | Mainnet |
|---|---|---|
| **RPC URL** | `https://soroban-testnet.stellar.org` | `https://mainnet.stellar.validationcloud.io/v1/<API_KEY>` |
| **Network passphrase** | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |
| **Horizon URL** | `https://horizon-testnet.stellar.org` | `https://horizon.stellar.org` |
| **Friendbot** | ✅ Available at `https://friendbot.stellar.org` | ❌ Does not exist |
| **Native token (XLM)** | Free (Friendbot) | Real value — costs real money |
| **Base fee (typical)** | 100 stroops (0.00001 XLM) | 100–50,000+ stroops (network-dependent) |
| **Ledger close time** | ~5 seconds (may vary more) | ~5 seconds |
| **Contract addresses** | Separate set per deploy | Separate set per deploy |
| **Data persistence** | Periodically reset | Permanent |
| **Soroban resource limits** | Same as mainnet | Same as testnet |
| **SEP-41 USDC contract** | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7EJJUD` |

---

## 2. Environment Variable Checklist

All variables that change between environments are listed here. Check every one before deploying.

### Frontend (`frontend/.env.local`)

> See [`frontend/.env.example`](../frontend/.env.example) for the template.  
> For a full network configuration reference, see this file: `docs/networks.md`

| Variable | Testnet value | Mainnet value |
|---|---|---|
| `NEXT_PUBLIC_RPC_URL` | `https://soroban-testnet.stellar.org` | `https://mainnet.stellar.validationcloud.io/v1/<API_KEY>` |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |
| `NEXT_PUBLIC_CONTRACT_ID` | Your testnet contract address (starts with `C`) | Your mainnet contract address (starts with `C`) |

### Deployment script (`deploy/deploy.sh`)

| Variable | Testnet value | Mainnet value |
|---|---|---|
| `STELLAR_NETWORK` | `testnet` | `mainnet` |
| `STELLAR_IDENTITY` | `alice` (default) | Your funded mainnet identity alias |

The deploy script reads these from environment variables. The RPC URL and passphrase are selected automatically based on `STELLAR_NETWORK`.

### Backend API (if applicable)

| Variable | Testnet value | Mainnet value |
|---|---|---|
| `RPC_URL` | `https://soroban-testnet.stellar.org` | `https://mainnet.stellar.validationcloud.io/v1/<API_KEY>` |
| `NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |
| `CONTRACT_ID` | Testnet contract address | Mainnet contract address |
| `HORIZON_URL` | `https://horizon-testnet.stellar.org` | `https://horizon.stellar.org` |

---

## 3. Common Mistakes

These are mistakes that real developers have made. Learn from them.

### Mistake 1 — Using the testnet passphrase with the mainnet RPC

**What happens**: Transactions are constructed and signed correctly, but the network rejects them silently or returns a cryptic `tx_bad_auth` error. The transaction appears to submit but never lands.

**Why**: The network passphrase is part of the transaction signature hash. If you sign with the wrong passphrase, the signature is invalid on the target network — even if every other field is correct.

**How to catch it**: Always log and compare `NETWORK_PASSPHRASE` alongside `RPC_URL` at startup:

```javascript
console.log("Network:", process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE);
console.log("RPC:    ", process.env.NEXT_PUBLIC_RPC_URL);
```

If one looks like testnet and the other like mainnet, stop and fix before proceeding.

**Fix**: Set both `NEXT_PUBLIC_RPC_URL` and `NEXT_PUBLIC_NETWORK_PASSPHRASE` together. They must always be a matching pair.

---

### Mistake 2 — Freighter set to the wrong network

**What happens**: Freighter is connected to testnet but your app is configured for mainnet (or vice versa). Transactions succeed in Freighter but fail on-chain, or Freighter refuses to sign because the network doesn't match.

**How to catch it**: After connecting the wallet, verify the network in your app:

```javascript
import { getNetwork, getNetworkDetails } from "@stellar/freighter-api";

const networkDetails = await getNetworkDetails();
console.log("Freighter network:", networkDetails.network);
console.log("Freighter passphrase:", networkDetails.networkPassphrase);

const expectedPassphrase = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE;
if (networkDetails.networkPassphrase !== expectedPassphrase) {
  throw new Error(
    `Freighter is connected to the wrong network. ` +
    `Expected: "${expectedPassphrase}", ` +
    `got: "${networkDetails.networkPassphrase}". ` +
    `Please switch networks in the Freighter extension.`
  );
}
```

**Fix**: In Freighter, click the network pill (top-right), and select the correct network. If switching to mainnet, make sure you have real XLM for fees.

---

### Mistake 3 — Calling Friendbot on mainnet

**What happens**: Your setup script or CI pipeline tries to fund an account with `https://friendbot.stellar.org?addr=<YOUR_MAINNET_ADDRESS>` and gets a 404 or timeout. Worse, the script silently continues, and the mainnet identity has zero balance, causing all transactions to fail with `tx_insufficient_balance`.

**Why**: Friendbot only exists on testnet. It funds accounts with free test XLM. On mainnet, accounts must be funded by a real XLM transfer.

**Fix**: Guard any Friendbot call with an environment check:

```bash
if [ "$STELLAR_NETWORK" = "testnet" ]; then
  stellar keys fund "$IDENTITY" --network testnet
else
  echo "ERROR: Cannot use Friendbot on mainnet. Fund the identity manually." >&2
  exit 1
fi
```

To fund a mainnet account, acquire XLM from an exchange or a trusted wallet and send it to your identity's public key using:

```bash
stellar keys show "$IDENTITY"   # prints your public key
# Then send ≥ 2 XLM to that address from your exchange/wallet
```

---

### Mistake 4 — Using the testnet contract address on mainnet

**What happens**: The frontend successfully connects to mainnet Freighter and submits transactions, but every contract call returns `contract_not_found`. You spend hours debugging the SDK version before realizing the contract ID is wrong.

**Why**: Contract addresses are unique per deployment and per network. Deploying to testnet and mainnet produces two different contract addresses.

**Fix**: Store and manage contract IDs per environment:

```bash
# After testnet deploy
TESTNET_CONTRACT_ID=$(STELLAR_NETWORK=testnet bash deploy/deploy.sh)

# After mainnet deploy
MAINNET_CONTRACT_ID=$(STELLAR_NETWORK=mainnet STELLAR_IDENTITY=prod-deployer bash deploy/deploy.sh)
```

Then reference the correct one in your environment files (see Section 4).

---

### Mistake 5 — Hardcoding the RPC URL in source code

**What happens**: You ship to production with the testnet RPC URL baked into the JavaScript bundle. Subscriptions appear to work during QA (testnet) but all mainnet users see silent failures.

**Fix**: Never hardcode network URLs. Always read from environment variables with an explicit fallback that fails loudly:

```typescript
// frontend/src/constants/network.ts
if (!process.env.NEXT_PUBLIC_CONTRACT_ID) {
  throw new Error(
    "NEXT_PUBLIC_CONTRACT_ID is not set. Copy frontend/.env.example to frontend/.env.local and fill in the values."
  );
}
```

---

## 4. Network Switching Guide

Follow these steps in order when switching a running deployment from testnet to mainnet.

### Step 1 — Deploy the contract to mainnet

```bash
# Create and fund a mainnet identity (one-time)
stellar keys generate prod-deployer
# Fund via exchange or wallet — send ≥ 10 XLM to:
stellar keys show prod-deployer

# Deploy
STELLAR_NETWORK=mainnet STELLAR_IDENTITY=prod-deployer bash deploy/deploy.sh
```

Copy the contract address printed to stdout. This is your `MAINNET_CONTRACT_ID`.

### Step 2 — Update the frontend environment file

```bash
cp frontend/.env.local frontend/.env.local.testnet.bak  # keep a backup
```

Edit `frontend/.env.local`:

```env
# Mainnet configuration — see docs/networks.md for all values
NEXT_PUBLIC_CONTRACT_ID=C<YOUR_MAINNET_CONTRACT_ID>
NEXT_PUBLIC_RPC_URL=https://mainnet.stellar.validationcloud.io/v1/<YOUR_API_KEY>
NEXT_PUBLIC_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
```

### Step 3 — Rebuild the frontend

```bash
cd frontend
npm run build
npm start
# or re-deploy to your hosting provider (Vercel, etc.)
```

### Step 4 — Update backend environment variables

Update all backend services that read `RPC_URL`, `NETWORK_PASSPHRASE`, `CONTRACT_ID`, and `HORIZON_URL` to their mainnet values (see the checklist in Section 2).

Restart all backend processes after updating environment variables.

### Step 5 — Verify the deployment

```bash
# Confirm the correct contract is live on mainnet
stellar contract info \
  --id "$MAINNET_CONTRACT_ID" \
  --rpc-url "https://mainnet.stellar.validationcloud.io/v1/<API_KEY>" \
  --network-passphrase "Public Global Stellar Network ; September 2015"
```

Open the frontend, connect Freighter (set to Mainnet), and attempt a test subscription with a small amount.

### Step 6 — Update monitoring

- Update your TTL health check script to point to the mainnet RPC URL and mainnet contract ID.
- Update any webhook endpoints to the production backend URL.

---

## 5. Contract Address Management

Maintain separate contract IDs per environment. Never reuse a testnet contract address on mainnet or vice versa.

### Recommended structure

```
.env.testnet    # testnet values (safe to commit if no secrets)
.env.mainnet    # mainnet values — DO NOT COMMIT (contains API keys)
.env.local      # symlink or copy of the active environment
```

Add `.env.mainnet` and `.env.local` to `.gitignore`:

```gitignore
# .gitignore
frontend/.env.local
frontend/.env.mainnet
.env.mainnet
```

### Track deployed addresses

Keep a non-secret record of deployed contract addresses in a committed file:

```json
// deployments.json (commit this)
{
  "testnet": {
    "contract_id": "CTESTNET...ADDRESS",
    "deployed_at": "2026-07-01T10:00:00Z",
    "deployed_by": "alice"
  },
  "mainnet": {
    "contract_id": "CMAINNET...ADDRESS",
    "deployed_at": "2026-07-26T14:00:00Z",
    "deployed_by": "prod-deployer"
  }
}
```

This file contains no secrets (contract IDs are public on-chain) and gives you an auditable record of when each version was deployed.

### Upgrading the contract

Soroban does not support in-place contract upgrades without a dedicated upgrade entry point. To upgrade:

1. Deploy a new contract version — this produces a **new contract address**.
2. Update all environment variables to the new address.
3. Migrate any off-chain subscription index to reference the new contract.
4. Communicate the contract address change to integrators.

Keep old contract addresses in `deployments.json` with a `deprecated_at` field for auditability.

---

## 6. How to verify you're on the correct network

Run these checks any time you suspect a network mismatch between your environment
variables, Freighter, and the deployed contract.

### 6.1 Verify the RPC endpoint

```bash
# Should return 200 OK and a JSON health status
curl -s -X POST \
  -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
  "$RPC_URL" | jq .result
# Testnet expected: {"status":"healthy"}
# Mainnet expected: {"status":"healthy"}
# Wrong URL / offline: connection error or non-JSON response
```

### 6.2 Verify the network passphrase

The passphrase is embedded in every signed transaction. Use this quick check to
confirm your configured passphrase matches the target network:

```typescript
import { Networks } from "@stellar/stellar-sdk";

const configured = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE;
const testnet  = Networks.TESTNET;  // "Test SDF Network ; September 2015"
const mainnet  = Networks.PUBLIC;   // "Public Global Stellar Network ; September 2015"

if (configured === testnet) {
  console.log("✅ Configured for TESTNET");
} else if (configured === mainnet) {
  console.log("✅ Configured for MAINNET");
} else {
  console.error("❌ UNKNOWN passphrase — check NEXT_PUBLIC_NETWORK_PASSPHRASE");
}
```

### 6.3 Verify Freighter is on the correct network

```typescript
import { getNetworkDetails } from "@stellar/freighter-api";

const details = await getNetworkDetails();
const expected = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE;

if (details.networkPassphrase !== expected) {
  alert(
    `Freighter is on the wrong network.\n` +
    `Expected: ${expected}\n` +
    `Freighter: ${details.networkPassphrase}\n\n` +
    `Please switch networks in the Freighter extension.`
  );
}
```

### 6.4 Verify the contract is deployed on this network

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --network "$STELLAR_NETWORK" \
  -- get_version
# Expected: "1.0.0" (or whatever the deployed version is)
# Wrong network / wrong address: "ERROR: contract not found" or RPC error
```

### 6.5 Check the deployed address registry

```bash
cat deploy/deployments.json | jq ".${STELLAR_NETWORK}.contract_id"
# Expected: your contract address for that network
# Mismatch: CONTRACT_ID env var doesn't match what was deployed
```

### Quick-reference checklist

| Check | Command / tool | Expected result |
|---|---|---|
| RPC reachable | `curl ... getHealth` | `{"status":"healthy"}` |
| Network passphrase | SDK `Networks.*` comparison | Matches `NEXT_PUBLIC_NETWORK_PASSPHRASE` |
| Freighter network | `getNetworkDetails()` | Passphrase matches env var |
| Contract deployed | `stellar contract invoke ... get_version` | Version string returned |
| Contract address correct | `deploy/deployments.json` | Address matches `CONTRACT_ID` env var |

---

## 7. Mainnet funding instructions

Mainnet requires **real XLM**. There is no Friendbot; every account must be funded
by an existing funded account or by purchasing XLM on an exchange.

### Minimum balance requirements

| Use | Minimum XLM | Reason |
|---|---|---|
| Identity (deployer) account | 2 XLM | 1 XLM base reserve + 1 XLM for transaction fees and contract upload |
| Subscriber account | 0.5 XLM | Transaction fee per `subscribe` + `execute_payment` call |
| Merchant account | 0.5 XLM | Transaction fee per `execute_payment` |

> These are minimums. For production, fund deployer accounts with at least 10 XLM
> to cover multiple deployments, fee spikes, and unexpected transactions.

### Step 1 — Create a Stellar mainnet identity

```bash
# Generate a new keypair (one-time, per role)
stellar keys generate prod-deployer
stellar keys generate prod-subscriber  # for testing subscriber flows

# Print the public key to fund it
stellar keys show prod-deployer
# Output: G<56-character Stellar public key>
```

### Step 2 — Acquire XLM

Purchase XLM from a regulated exchange (Coinbase, Kraken, Binance, etc.) or have
another funded account send XLM to your public key. The minimum to activate an
account is **1 XLM** (the Stellar base reserve).

> **Security:** Never share your secret key. The public key (starting with `G`) is
> safe to share and is what you send XLM to.

### Step 3 — Send XLM to your identity

From an exchange withdrawal or another wallet, send XLM to the public key printed
in Step 1. Wait for the transaction to confirm on-chain (usually within 5 seconds).

### Step 4 — Verify the account is funded

```bash
# Check via Stellar CLI
stellar account info "$(stellar keys show prod-deployer)" --network mainnet

# Or via Horizon REST API
curl "https://horizon.stellar.org/accounts/$(stellar keys show prod-deployer)" | jq .balances
# Expected: at least one entry with asset_type "native" and balance >= "1.0000000"
```

### Step 5 — Verify on Stellar Expert

Paste your public key into [Stellar Expert](https://stellar.expert/explorer/public)
(mainnet explorer) and confirm the account is active with sufficient XLM balance.

### Funding via Friendbot — testnet only

On testnet you can skip the above entirely and use Friendbot:

```bash
stellar keys fund "$IDENTITY" --network testnet
# Or via curl:
curl "https://friendbot.stellar.org?addr=$(stellar keys show $IDENTITY)"
```

Friendbot funds with 10,000 XLM on testnet. **Friendbot does not exist on mainnet.**

---

## See Also

- [Storage TTL Management Guide](./operations.md) — alert thresholds, TTL detection scripts
- [Versioning and Migration Guide](./versioning.md) — updating contract addresses after a new deployment
- [Backend API Cookbook](./api-cookbook.md) — recipes for all API operations
- `deploy/deploy.sh` — network-aware deployment script
- `deploy/deployments.json` — per-network contract address registry
- `frontend/.env.example` — environment variable template
- [Stellar Documentation — Networks](https://developers.stellar.org/docs/learn/fundamentals/networks)
- [Stellar Expert (mainnet explorer)](https://stellar.expert/explorer/public)
- [Freighter API](https://docs.freighter.app)
