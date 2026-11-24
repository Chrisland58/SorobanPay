# Local Testnet Workflow for End-to-End Subscription Development

This guide provides a comprehensive, executable, step-by-step path for contributors to set up local dependencies, build and deploy the smart contract to the Stellar Testnet, launch the backend and frontend services, connect Freighter wallet, execute an end-to-end subscription flow in the browser, and manage local state resets.

---

## 1. Prerequisites and Tooling Verification

Before starting, verify that your development machine has the required tools installed. No undocumented personal environment state or proprietary keys are required.

| Tool | Required Version | Verification Command | Installation Link / Command |
|---|---|---|---|
| **Rust** | `>= 1.76.0` (stable) | `rustc --version` | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| **wasm32 Target** | `wasm32-unknown-unknown` | `rustup target list \| grep installed` | `rustup target add wasm32-unknown-unknown` |
| **Stellar CLI** | `>= 21.0.0` | `stellar --version` | `cargo install --locked stellar-cli --features opt` |
| **Node.js** | `>= 18.0.0` | `node --version` | https://nodejs.org or `nvm install 18` |
| **npm** | `>= 9.0.0` | `npm --version` | Bundled with Node.js |
| **Docker & Compose** | `>= 24.0.0` | `docker compose version` | https://docs.docker.com/get-docker/ |
| **GNU Make** | `>= 3.81` | `make --version` | Standard Unix package or Xcode CLI tools |
| **Freighter Wallet** | Latest | Browser extension | https://www.freighter.app |

> [!NOTE]
> Windows contributors should use WSL2 (Windows Subsystem for Linux - Ubuntu 22.04+) or ensure bash and make are available on PATH.

---

## 2. Clean Checkout and Dependency Setup

Clone the repository and enter the workspace:

```bash
git clone https://github.com/Chrisland58/SorobanPay.git
cd SorobanPay
```

Install workspace dependencies for both the frontend and backend:

```bash
# Frontend dependencies
cd frontend && npm install && cd ..

# Backend dependencies
cd backend && npm install && cd ..
```

---

## 3. Starting Local Dependencies (PostgreSQL & Redis)

SorobanPay requires PostgreSQL for relational persistence (subscriptions, plans, indexer checkpoints, and audit logs) and Redis for task queues (BullMQ payment retries and webhooks) and caching.

Start the background services via Docker Compose:

```bash
# Start PostgreSQL and Redis in detached mode
docker compose up -d postgres redis
```

### Health Verification Checkpoint

Verify that both containers report `healthy` before moving forward:

```bash
docker compose ps
```

Expected output:
```text
NAME                  IMAGE               COMMAND                  SERVICE             STATUS
sorobanpay-postgres   postgres:16-alpine  "docker-entrypoint.s…"   postgres            running (healthy)
sorobanpay-redis      redis:7-alpine      "docker-entrypoint.s…"   redis               running (healthy)
```

Direct container connectivity check:
```bash
# Verify PostgreSQL
docker exec sorobanpay-postgres pg_isready -U sorobanpay -d sorobanpay

# Verify Redis
docker exec sorobanpay-redis redis-cli ping
```

---

## 4. Environment Variables Configuration

SorobanPay uses decoupled environment templates across the root (Docker), backend, and frontend layers.

### Environment Variable Matrix

| Layer | File | Key Variables | Description | Testnet Default |
|---|---|---|---|---|
| **Root** | `.env` | `POSTGRES_USER`, `DATABASE_URL`, `RPC_URL`, `NETWORK_PASSPHRASE` | Base Docker stack orchestration | `RPC_URL=https://soroban-testnet.stellar.org` |
| **Backend** | `backend/.env` | `DATABASE_URL`, `REDIS_URL`, `RPC_URL`, `NETWORK_PASSPHRASE`, `CONTRACT_ID`, `PORT` | API server & indexer runtime configuration | `PORT=3001`<br>`CONTRACT_ID=C...` (populated after deploy) |
| **Frontend** | `frontend/.env.local` | `NEXT_PUBLIC_STELLAR_NETWORK`, `NEXT_PUBLIC_CONTRACT_ID`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_NETWORK_PASSPHRASE` | Client-side RPC & wallet connectivity | `NEXT_PUBLIC_STELLAR_NETWORK=testnet`<br>`NEXT_PUBLIC_CONTRACT_ID=C...` |

### Copy Configuration Files

```bash
# Root docker environment
cp .env.example .env

# Backend runtime environment
cp backend/.env.example backend/.env

# Frontend runtime environment
cp frontend/.env.example frontend/.env.local
```

> [!IMPORTANT]
> The network passphrase **must strictly match** across all layers:
> `Test SDF Network ; September 2015`

---

## 5. Stellar Testnet Identity and Funding

The Stellar CLI needs a funded account to sign deployment transactions and contract invocations.

### 5.1 Generate Testnet Keypair

```bash
# Generate a dedicated local development keypair named 'alice'
stellar keys generate alice --network testnet
```

### 5.2 Fund Keypair via Friendbot

```bash
# Request free testnet XLM from the Stellar Friendbot
stellar keys fund alice --network testnet
```

### 5.3 Retrieve Public Address

```bash
ALICE_ADDRESS=$(stellar keys address alice)
echo "Alice Address: $ALICE_ADDRESS"
```

---

## 6. Smart Contract Compilation, Deployment & Initialization

### 6.1 Compile WASM Artifact

Compile the Soroban subscription contract with size-optimization flags:

```bash
make build
```

This generates:
`contracts/target/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm`

### 6.2 Deploy to Testnet

Run the automated deploy script using identity `alice`:

```bash
CONTRACT_ID=$(STELLAR_IDENTITY=alice STELLAR_NETWORK=testnet bash deploy/deploy.sh)
echo "Deployed Contract ID: $CONTRACT_ID"
```

### 6.3 Initialize Protocol Invariants

Initialize the deployed contract with `alice` as the administrator:

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source alice \
  --network testnet \
  -- initialize \
  --admin "$ALICE_ADDRESS"
```

### 6.4 Propagate Contract ID to Environment Files

Update both the backend and frontend configuration files with the new `CONTRACT_ID`:

```bash
# Update backend/.env
sed -i.bak "s|^CONTRACT_ID=.*|CONTRACT_ID=\"$CONTRACT_ID\"|" backend/.env

# Update frontend/.env.local
sed -i.bak "s|^NEXT_PUBLIC_CONTRACT_ID=.*|NEXT_PUBLIC_CONTRACT_ID=$CONTRACT_ID|" frontend/.env.local
```

*(On Windows PowerShell, manually open `backend/.env` and `frontend/.env.local` to paste the `$CONTRACT_ID` value, or use `(Get-Content ...) -replace ... | Set-Content`)*.

---

## 7. Backend Migration and Fixture Seeding

Apply Prisma migrations to the local PostgreSQL instance and seed test merchant accounts:

```bash
cd backend

# Run Prisma schema migrations
npx prisma migrate deploy

# Seed fixture merchants and subscription plans
npx ts-node ../scripts/seed-local-db.ts

# Return to root
cd ..
```

### Start Backend Development Server

```bash
cd backend
npm run dev
```

The REST API and health server will be available at **`http://localhost:3001`**.
Verify backend health in a new terminal:
```bash
curl -s http://localhost:3001/health
```

---

## 8. Freighter Wallet Setup

1. **Install Extension**: Install Freighter from [freighter.app](https://www.freighter.app/).
2. **Switch to Testnet**:
   - Open Freighter popup.
   - Click the network selector in the upper right.
   - Select **Testnet** (RPC: `https://soroban-testnet.stellar.org`, Passphrase: `Test SDF Network ; September 2015`).
3. **Fund Wallet Account**:
   - Copy your Freighter public key (`G...`).
   - Visit [Stellar Laboratory Friendbot](https://laboratory.stellar.org/#account-creator?network=test) and paste your address to fund it with 10,000 test XLM.

---

## 9. Launching Frontend and Executing End-to-End Flow

### 9.1 Start Frontend Dev Server

In a new terminal window:
```bash
cd frontend
npm run dev
```

The application opens at **`http://localhost:3000`**.

### 9.2 Execute Browser Transaction Flow

1. **Connect Wallet**:
   - Navigate to `http://localhost:3000`.
   - Click **Connect Freighter Wallet** in the top navigation.
   - Freighter will prompt for permission to connect to `localhost:3000`. Click **Approve**.
   - The badge will switch to **Connected** with your truncated public key.
2. **Fill Subscription Form**:
   - **Merchant Address**: Use the seeded merchant address `GMERCHANT0000000000000000000000000000000000000000000001` or any funded testnet `G...` address.
   - **Token Contract Address**: Enter a testnet token contract address (e.g., testnet native XLM token contract `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`).
   - **Amount**: Enter the payment amount in base units (e.g. `10000000` for 1.0 unit with 7 decimals).
   - **Billing Interval**: Enter interval in seconds (e.g., `2592000` for 30 days).
3. **Authorize and Submit**:
   - Click **Authorize Subscription**.
   - Review details in the summary modal and click **Confirm and Sign**.
   - The Freighter wallet pop-up will request your transaction signature. Click **Sign**.
4. **Transaction Confirmation**:
   - The UI displays a live transaction progress bar (`Submitting -> Confirming -> Finalized`).
   - On completion, the **Success Card** displays the transaction hash.
   - Click the Stellar Expert link to view the transaction on the testnet explorer.

---

## 10. Local Environment Reset Behavior

During active development and testing, you may need to reset state to verify boundary behavior or clean up obsolete records.

### Reset Options

| Goal | Command | Scope | Preserves Data? |
|---|---|---|---|
| **Clean Reset and Re-seed** | `bash scripts/seed-and-reset.sh` | Truncates events, subscriptions, webhooks; flushes Redis; re-seeds fixture merchants. | Preserves schema & tables |
| **Reset Only** | `bash scripts/seed-and-reset.sh --reset-only` | Truncates database tables and resets indexer cursor without re-seeding. | Leaves database empty |
| **Seed Only** | `bash scripts/seed-and-reset.sh --seed-only` | Appends fixture merchants without wiping existing records. | Yes |
| **Hard Docker Volume Wipe** | `docker compose down -v` | **Destructive**: Removes `sorobanpay-pgdata` and `sorobanpay-redisdata` volumes. | **No** (Complete wipe) |

---

## 11. Troubleshooting Checkpoints

### Checkpoint 1: RPC Connection or Timeout Failures
- **Symptom**: `Request failed with status code 504` or `fetch failed: https://soroban-testnet.stellar.org`.
- **Diagnostic**: Run `curl -s -X POST https://soroban-testnet.stellar.org -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'`.
- **Fix**: Stellar testnet may experience temporary rate-limiting or reset windows. Wait 30 seconds or configure an alternate testnet RPC in `.env.local` / `backend/.env`.

### Checkpoint 2: Missing or Unfunded Testnet Identity
- **Symptom**: `HostError: Error(AccountNotFound)` during deploy or invoke.
- **Diagnostic**: Run `stellar keys address <identity>` and check balance with `curl "https://horizon-testnet.stellar.org/accounts/<address>"`.
- **Fix**: Re-fund via Friendbot: `stellar keys fund <identity> --network testnet`.

### Checkpoint 3: Network Passphrase Mismatch
- **Symptom**: `txBAD_AUTH` or `transaction rejected - wrong network`.
- **Diagnostic**: Verify Freighter is set to **Testnet** and `.env.local` contains:
  `NEXT_PUBLIC_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"`.
- **Fix**: Ensure both Freighter and your configuration use the official testnet passphrase.

### Checkpoint 4: Contract Configuration Error Card in Frontend
- **Symptom**: Browser renders `ContractConfigError: NEXT_PUBLIC_CONTRACT_ID is not configured`.
- **Diagnostic**: Inspect `frontend/.env.local` to verify `NEXT_PUBLIC_CONTRACT_ID` starts with `C` and is 56 characters long.
- **Fix**: Re-deploy the contract (`CONTRACT_ID=$(bash deploy/deploy.sh)`) and update `frontend/.env.local`. Restart the Next.js dev server.

### Checkpoint 5: Database Connection Refused (ECONNREFUSED 5432)
- **Symptom**: Backend crashes on start with `Can't reach database server at localhost:5432`.
- **Diagnostic**: Run `docker compose ps` to check container status.
- **Fix**: Start PostgreSQL: `docker compose up -d postgres`. Wait until `(healthy)` is reported before starting the backend.
