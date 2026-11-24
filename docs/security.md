# SorobanPay Security Reference

This document is the authoritative security reference for SorobanPay. It covers the on-chain security model, authorization audit, token allowance emergency procedures, protocol abuse prevention, circuit breaker runbook, backend secrets management, known limitations, and dependency auditing.

---

## Table of Contents

1. [Contract Security Model](#1-contract-security-model)
2. [Authorization Audit](#2-authorization-audit)
3. [Token Allowance Emergency Stop](#3-token-allowance-emergency-stop)
4. [Protocol Fee Abuse Prevention](#4-protocol-fee-abuse-prevention)
5. [Circuit Breaker Runbook](#5-circuit-breaker-runbook)
6. [Backend Secrets Management](#6-backend-secrets-management)
7. [Frontend Security](#7-frontend-security)
8. [Known Limitations and Mitigations](#8-known-limitations-and-mitigations)
9. [Dependency Security](#9-dependency-security)
10. [Security Disclosure Policy](#10-security-disclosure-policy)
11. [Pre-Deployment Security Checklist](#11-pre-deployment-security-checklist)

---

## 1. Contract Security Model

### Non-custodial design

SorobanPay never holds token balances. All payment transfers go directly from `subscriber → merchant` via SEP-41 `transfer()`. The contract has:

- No treasury address
- No escrow wallet
- No upgrade authority over token contracts
- No stored session credentials

A compromised contract cannot drain funds it does not hold. A compromised backend cannot move funds because it never submits token transfers. Subscribers retain full custody between payment windows.

### Per-invocation authorization

Every entry point that mutates state calls `require_auth()` as its **first statement**, before any storage reads, external calls, or logic.

| Entry point | Authenticating address | What they authorize |
|-------------|----------------------|---------------------|
| `subscribe` | `subscriber` | Create or overwrite the subscription record |
| `execute_payment` | `merchant` | Collect the next due payment |
| `execute_payment_batch` | `merchant` | Collect payments for a batch of subscribers |
| `cancel` | `subscriber` | Remove the subscription record |
| `get_subscription` | *(none — read-only)* | No state change |
| `version` | *(none — read-only)* | No state change |
| `contract_name` | *(none — read-only)* | No state change |

`require_auth()` is enforced by the Soroban host, not by application logic. A missing or invalid signature causes the entire transaction to fail before any contract code runs.

### Allowance model

Subscribers grant a SEP-41 token allowance to the contract address:

```bash
stellar contract invoke \
  --id <TOKEN_CONTRACT_ID> \
  --source alice \
  --network testnet \
  -- approve \
  --from <subscriber-address> \
  --spender <contract-address> \
  --amount <max-amount> \
  --expiration_ledger <ledger>
```

The contract's `execute_payment` then calls `token.transfer(subscriber, merchant, amount)`. Key properties:

- **Revoking the allowance** (`approve(contract_address, 0, 0)`) prevents all future payments immediately — subscribers have a unilateral emergency stop that does not require interacting with the subscription contract at all.
- **Reducing the allowance** below the subscription amount causes `execute_payment` to fail with a token panic and revert.
- The contract does **not** require an allowance equal to all future payments — only enough for the next interval. Subscribers should grant `amount * N` for approximately `N` intervals of protection.

### Time-lock enforcement

`execute_payment` checks `now >= next_payment` using the Soroban ledger timestamp set by validators — it cannot be manipulated by the transaction submitter.

```rust
if now < data.next_payment {
    return Err(ContractError::PaymentNotDue);
}
```

Merchants cannot front-run or double-collect payments within the same billing window.

### Input validation

`subscribe` validates all inputs before touching storage:

| Check | Error | Condition |
|-------|-------|-----------|
| Self-subscription | `SelfSubscription` (10) | `subscriber == merchant` |
| Positive amount | `AmountMustBePositive` (1) | `amount <= 0` |
| Amount ceiling | `AmountTooLarge` (9) | `amount > 10^18` |
| Interval floor | `IntervalTooShort` (2) | `interval < 86400` (1 day) |
| Interval ceiling | `IntervalTooLong` (3) | `interval > 31536000` (365 days) |
| Invalid token | `InvalidTokenAddress` (11) | `token` equals the contract's own address |
| Timestamp validity | `InvalidTimestamp` (8) | Ledger timestamp is 0 or would overflow `u64` |

### Storage TTL and expiry

Persistent entries have a TTL. Expired entries return `None` on read — functionally identical to a cancelled subscription. `execute_payment` on an expired entry returns `NoActiveSubscription`. The TTL is extended on every `subscribe` and every successful `execute_payment`. See [README Storage TTL section](../README.md#storage-ttl) for full lifecycle details.

---

## 2. Authorization Audit

### Auth matrix

| Entry point | Required signer | Auth position | Attack if wrong signer allowed |
|-------------|----------------|---------------|-------------------------------|
| `subscribe` | `subscriber` | First statement | Merchant cannot create subscriptions on behalf of users without their key |
| `execute_payment` | `merchant` | First statement | Random address cannot trigger transfers; subscriber cannot impersonate merchant |
| `execute_payment_batch` | `merchant` | First statement | Only the declared merchant can batch-collect; one merchant cannot collect on behalf of another |
| `cancel` | `subscriber` | First statement | Merchant cannot cancel a user's subscription unilaterally |

### Why `execute_payment` is merchant-authorized

This is a deliberate design choice. The merchant bears responsibility for collecting on schedule:

1. The subscriber does not need to be online to approve each individual collection (recurring billing model).
2. The subscriber's auth (token allowance) is a separate, out-of-band authorization that limits total transfer scope.
3. Merchants sign with their own key, creating an auditable on-chain record of who collected what and when.

### Why `subscribe` is subscriber-authorized

The subscriber's signature on `subscribe` is the primary consent signal. By signing this transaction, the subscriber:

1. Agrees to the specific amount, interval, token, and merchant.
2. Authorizes the contract to record this agreement.
3. Does **not** pre-authorize any token transfers — the SEP-41 allowance is a separate approval step.

This two-step consent model means revoking either the subscription (`cancel`) or the token allowance immediately stops future payments.

### `require_auth` placement rule

As a contributor, always call `require_auth()` as the **first statement** in any entry point:

```rust
// ✅ CORRECT — auth before any state reads
pub fn subscribe(env: Env, subscriber: Address, ...) -> Result<(), ContractError> {
    subscriber.require_auth();   // ← MUST be first
    // ... validation and storage writes below
}

// ❌ WRONG — state read before auth could be exploited
pub fn subscribe(env: Env, subscriber: Address, ...) -> Result<(), ContractError> {
    let existing = env.storage().persistent().get(&key);  // state read BEFORE auth
    subscriber.require_auth();
    // ...
}
```

---

## 3. Token Allowance Emergency Stop

A subscriber can immediately stop all future payments without touching the subscription contract by revoking the SEP-41 token allowance.

### Via Stellar CLI

```bash
stellar contract invoke \
  --id <TOKEN_CONTRACT_ID> \
  --source alice \
  --network mainnet \
  -- approve \
  --from <subscriber-address> \
  --spender <subscription-contract-address> \
  --amount 0 \
  --expiration_ledger 0
```

This immediately sets the allowance to zero. Any subsequent `execute_payment` call will fail with a token panic (allowance insufficient) — the transaction reverts and no funds move.

### Via TypeScript

```typescript
import { Contract, nativeToScVal, Address, Networks, TransactionBuilder, SorobanRpc } from "@stellar/stellar-sdk";
import Stellar from "@stellar/stellar-sdk";

const server = new SorobanRpc.Server("https://mainnet.stellar.validationcloud.io/v1/<KEY>");
const tokenContract = new Contract(tokenContractId);
const subscriberKeypair = Stellar.Keypair.fromSecret(subscriberSecret);
const subscriberAccount = await server.getAccount(subscriberKeypair.publicKey());

const tx = new TransactionBuilder(subscriberAccount, {
  fee: "100000",
  networkPassphrase: Networks.PUBLIC,
})
  .addOperation(
    tokenContract.call(
      "approve",
      new Address(subscriberKeypair.publicKey()).toScVal(),
      new Address(subscriptionContractId).toScVal(),
      nativeToScVal(0n, { type: "i128" }),    // amount: 0
      nativeToScVal(0, { type: "u32" }),       // expiration_ledger: 0
    )
  )
  .setTimeout(30)
  .build();

const sim = await server.simulateTransaction(tx);
const preparedTx = SorobanRpc.assembleTransaction(tx, sim).build();
preparedTx.sign(subscriberKeypair);
const result = await server.sendTransaction(preparedTx);
console.log("Allowance revoked. Tx hash:", result.hash);
```

### Effect on active subscriptions

Revoking the allowance does **not** remove the subscription record from the contract. If a subscriber later re-approves the allowance, payments can resume. To terminate the subscription record entirely, call `cancel` in addition to revoking the allowance.

---

## 4. Protocol Fee Abuse Prevention

SorobanPay v1.0.0 does not implement protocol fees. This section documents the analysis for when/if fees are added.

### Potential fee vectors

| Vector | Risk | Mitigation |
|--------|------|-----------|
| Merchant sets an unreasonably high `amount` | Subscriber is overcharged relative to their expectation | Subscriber must sign `subscribe` — they approve the exact amount |
| Merchant calls `execute_payment` before interval elapses | Double-collection | `PaymentNotDue` error enforced by on-chain timestamp; contract reverts |
| Merchant batch-collects the same subscriber twice | Double-collection in one tx | `next_payment` is advanced atomically on first success; second attempt hits `PaymentNotDue` |
| Backend operator submits payments on behalf of a different merchant | Unauthorized collection | Auth check requires actual merchant signature; operator cannot forge |
| Subscriber sets interval to minimum (1 day) with large amount | Rapid drain | Amount is bounded by `AmountTooLarge`; interval is bounded by `IntervalTooShort`/`IntervalTooLong`; subscriber signed |

### Amount ceiling rationale

`MAX_AMOUNT = 1_000_000_000_000_000_000` (10¹⁸ stroops) exists to:

- Stay well below `i64::MAX ≈ 9.2 × 10¹⁸`, preventing downstream arithmetic overflow.
- Prevent accidental fat-finger amounts that would drain a subscriber in a single interval.
- Keep values human-readable (10¹² XLM equivalent — far beyond any realistic use case).

---

## 5. Circuit Breaker Runbook

A "circuit breaker" for SorobanPay means stopping all payment collection and communicating clearly while a fix is prepared. The contract is non-upgradeable once deployed, so the primary levers are:

1. **Subscriber action:** Revoke token allowance (see Section 3).
2. **Backend action:** Stop the `PaymentScheduler`.
3. **Merchant action:** Stop calling `execute_payment`.
4. **Protocol action:** Deploy a new contract version.

### Severity levels

| Level | Criteria | Target response time | Public disclosure |
|-------|----------|---------------------|-----------------|
| Critical | Funds at risk, active exploitation | < 1 hour | After mitigation deployed |
| High | Auth bypass, data integrity compromise | < 4 hours | After fix deployed |
| Medium | DoS, information leak, stale data | < 24 hours | Alongside fix |
| Low | Edge case, no immediate risk | Next planned release | Alongside release |

### Phase 1 — Detect and assess (target: 15 minutes)

1. Identify the affected entry point(s) and nature of the issue: logic bug, state corruption, dependency vulnerability, or infrastructure failure.
2. Determine scope: single subscription pair, all subscriptions for a token, or protocol-wide.
3. Open a private incident channel with core contributors (Slack / Discord / email).
4. **Do not disclose publicly** until mitigations are in place, unless subscriber data is at immediate risk.

### Phase 2 — Stop new payments (target: 30 minutes)

**Disable the backend PaymentScheduler:**

```bash
# Fly.io
flyctl secrets unset OPERATOR_SECRET
flyctl restart

# Render — remove OPERATOR_SECRET in Settings → Environment → manual deploy

# Docker Compose
docker compose stop backend
# Remove OPERATOR_SECRET from docker-compose.yml, then:
docker compose up -d backend

# Kubernetes
kubectl set env deployment/backend OPERATOR_SECRET="" -n sorobanpay
kubectl rollout restart deployment/backend -n sorobanpay
kubectl rollout status deployment/backend -n sorobanpay
```

**Notify merchants with direct integrations:**

Contact all merchants integrating `execute_payment` directly (via webhook, email, or community channels) to pause automated collection scripts immediately.

**Publish subscriber self-service emergency stop:**

Post the allowance revocation command (see Section 3) in your status page, Discord, and Twitter/X:

> ⚠️ If you are a SorobanPay subscriber and want to immediately stop all pending payments, run the following command to revoke the contract allowance: [link to Section 3]

### Phase 3 — Investigate and fix (target: 24 hours for Critical/High)

1. Reproduce the issue in a local test environment: `make test`.
2. Write a failing test that captures the bug **before** writing the fix.
3. Implement the fix.
4. Code review: get sign-off from at least two contributors who did not author the patch.
5. Deploy to testnet and confirm the failing test now passes.
6. Run the full test suite: `make test`.

### Phase 4 — Deploy new contract (for on-chain bugs)

Soroban contracts are immutable once deployed. A bug fix requires deploying a new contract instance and migrating.

```bash
# Build new WASM
make build

# Deploy to mainnet
STELLAR_NETWORK=mainnet STELLAR_IDENTITY=my-mainnet-id bash deploy/deploy.sh
# Capture the new contract address
NEW_CONTRACT_ID=CNEW...
```

**Migration checklist:**

- [ ] Announce new contract address across all channels (status page, Discord, Telegram, email list).
- [ ] Update `NEXT_PUBLIC_CONTRACT_ID` in frontend `.env.local` and redeploy the frontend.
- [ ] Update `CONTRACT_ID` in backend environment variables and restart.
- [ ] Notify all merchants they must update their integration to the new contract address.
- [ ] Inform subscribers they must create new subscriptions on the new contract — existing subscriptions on the old contract are not portable.
- [ ] Monitor the new contract for 24 hours before declaring the incident closed.

### Phase 5 — Post-incident (within 72 hours)

1. Write a post-mortem: timeline, root cause, impact assessment, and remediation steps.
2. Publish a public summary (may omit sensitive technical details until patched).
3. Update this runbook with any new lessons learned.
4. File a CVE if the vulnerability affects a shared dependency.
5. Update the CHANGELOG.

---

## 6. Backend Secrets Management

### Never commit secrets

Ensure `.gitignore` (already present) excludes:

```
.env
.env.local
.env.production
*.pem
*.key
```

Use a pre-commit hook to catch accidental staging of secret files:

```bash
#!/bin/sh
# .git/hooks/pre-commit  — chmod +x this file
STAGED=$(git diff --cached --name-only)
if echo "$STAGED" | grep -qE '^(backend/\.env|\.env\.local|\.env\.production)$'; then
  echo "ERROR: Secret file staged. Unstage with: git reset HEAD <file>"
  exit 1
fi
# Optional deeper scanning with gitleaks
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks protect --staged --no-banner
fi
```

### Secrets reference

| Variable | Sensitivity | Notes |
|----------|-------------|-------|
| `DATABASE_URL` | 🔴 High | Contains credentials; never log the full URL |
| `RPC_URL` | 🟡 Medium | High if it embeds a paid-provider API key (e.g., ValidationCloud) |
| `NETWORK_PASSPHRASE` | 🟢 Low | Public Stellar constant; still env-configurable |
| `CONTRACT_ID` | 🟢 Low | Public on-chain address |
| `WEBHOOK_SECRET` | 🔴 High | HMAC-SHA256 key; exposure allows forged webhooks |
| `OPERATOR_SECRET` | ⛔ Privileged | Stellar keypair for `PaymentScheduler`; see warning below |
| `PORT` | 🟢 Low | Server port; no security impact |

### ⛔ `OPERATOR_SECRET` — handle with extreme care

`OPERATOR_SECRET` is a Stellar secret key (`S…`) used by the optional `PaymentScheduler` to submit `execute_payment` transactions. If compromised:

- The attacker can collect payments for any subscription where the operator's address is the declared merchant.
- They cannot steal funds held by the contract (there are none) or modify subscription records.

**Never** set `OPERATOR_SECRET` unless the `PaymentScheduler` is actively needed. When not set, the scheduler is disabled and the backend is fully read-only.

### Local development

```bash
cd backend
cp .env.example .env
# Edit .env — fill in DATABASE_URL, RPC_URL, CONTRACT_ID
# Never commit .env
```

### Platform deployments (Railway / Render / Fly.io)

Set variables in the platform's environment dashboard. No secret-store SDK required.

**Fly.io:**

```bash
flyctl secrets set DATABASE_URL="postgresql://user:pass@host:5432/db"
flyctl secrets set WEBHOOK_SECRET="$(openssl rand -hex 32)"
# Only if PaymentScheduler is needed:
# flyctl secrets set OPERATOR_SECRET="S..."
```

**Render:** Settings → Environment → Add Environment Variable → mark as Secret.

### AWS Secrets Manager

```typescript
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

async function loadSecrets() {
  const client = new SecretsManagerClient({ region: "us-east-1" });
  const { SecretString } = await client.send(
    new GetSecretValueCommand({ SecretId: "sorobanpay/backend/prod" })
  );
  if (!SecretString) throw new Error("Secret not found");

  const secrets = JSON.parse(SecretString);
  process.env.DATABASE_URL   = secrets.DATABASE_URL;
  process.env.WEBHOOK_SECRET = secrets.WEBHOOK_SECRET;
  // Assign others before starting the server
}

await loadSecrets();
```

Store all secrets as a JSON object in one Secrets Manager entry. Enable automatic rotation for `DATABASE_URL` using the built-in RDS Lambda rotator.

### External Secrets Operator (Kubernetes)

For Kubernetes workloads, use the [External Secrets Operator](https://external-secrets.io) to sync secrets from AWS Secrets Manager, HashiCorp Vault, or GCP Secret Manager into native Kubernetes Secrets:

```yaml
# external-secret.yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: sorobanpay-backend
  namespace: sorobanpay
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secretsmanager
    kind: ClusterSecretStore
  target:
    name: sorobanpay-backend-secrets
    creationPolicy: Owner
  data:
    - secretKey: DATABASE_URL
      remoteRef:
        key: sorobanpay/backend/prod
        property: DATABASE_URL
    - secretKey: WEBHOOK_SECRET
      remoteRef:
        key: sorobanpay/backend/prod
        property: WEBHOOK_SECRET
```

### Sealed Secrets (Kubernetes air-gapped / GitOps)

For GitOps workflows where secrets must be stored in Git:

```bash
# Install kubeseal CLI
# Encrypt the secret
kubectl create secret generic sorobanpay-backend \
  --from-literal=DATABASE_URL="postgresql://..." \
  --dry-run=client -o yaml | \
  kubeseal --controller-name=sealed-secrets \
           --controller-namespace=kube-system \
           --format yaml > sealed-secret.yaml

# Commit sealed-secret.yaml to Git (the encrypted blob is safe to commit)
# The Sealed Secrets controller decrypts it at runtime
```

### HashiCorp Vault

```bash
# Store secrets
vault kv put secret/sorobanpay/backend \
  DATABASE_URL="postgresql://..." \
  WEBHOOK_SECRET="..."

# Retrieve via Vault Agent sidecar or node-vault in app startup
```

### Docker secrets (Compose / Swarm)

```yaml
# docker-compose.yml
secrets:
  webhook_secret:
    external: true
  db_url:
    external: true

services:
  backend:
    image: sorobanpay-backend:latest
    secrets:
      - webhook_secret
      - db_url
    environment:
      WEBHOOK_SECRET_FILE: /run/secrets/webhook_secret
      DATABASE_URL_FILE: /run/secrets/db_url
```

Read in the application:

```typescript
import { readFileSync } from "fs";

function readSecret(envKey: string, fileEnvKey: string): string {
  const filePath = process.env[fileEnvKey];
  if (filePath) return readFileSync(filePath, "utf-8").trim();
  return process.env[envKey] ?? "";
}

const webhookSecret = readSecret("WEBHOOK_SECRET", "WEBHOOK_SECRET_FILE");
const databaseUrl   = readSecret("DATABASE_URL",   "DATABASE_URL_FILE");
```

### Key rotation procedure

**`DATABASE_URL` password rotation:**

1. Create a new database user with identical privileges.
2. Update the secret in your store (AWS Secrets Manager, Vault, or platform dashboard).
3. Trigger a rolling restart (`flyctl restart` / `kubectl rollout restart`).
4. Verify connectivity via `GET /health`.
5. Drop the old database user.
6. Expected downtime: **zero** (rolling restart).

**`WEBHOOK_SECRET` rotation:**

1. Generate a new secret: `openssl rand -hex 32`.
2. Update both the backend environment and any webhook senders at the same time.
3. During the transition window, accept both old and new signatures:
   ```typescript
   import { createHmac, timingSafeEqual } from "crypto";

   function verifySignature(payload: string, signature: string, secrets: string[]): boolean {
     return secrets.some((secret) => {
       const expected = createHmac("sha256", secret).update(payload).digest("hex");
       return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
     });
   }
   ```
4. Remove the old secret after all senders have switched.

**`OPERATOR_SECRET` rotation:**

1. Generate a new Stellar keypair: `stellar keys generate new-operator --network mainnet`.
2. Fund the new account with enough XLM for fees.
3. Update `OPERATOR_SECRET` in the secret store and redeploy.
4. Retire the old key (zero balance or remove from any multisig configs).

---

## 7. Frontend Security

### Content Security Policy

Configure CSP headers in `next.config.mjs` to restrict resource loading:

```javascript
// next.config.mjs
const cspHeader = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "connect-src 'self' https://soroban-testnet.stellar.org https://mainnet.stellar.validationcloud.io https://horizon-testnet.stellar.org https://horizon.stellar.org",
  "frame-ancestors 'none'",
].join("; ");

export default {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: cspHeader },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};
```

> `unsafe-eval` is required for certain Stellar SDK WASM operations. Remove it once upstream resolves this requirement.

### Wallet signing security

Freighter's security model ensures the user's secret key **never leaves the extension**. The frontend receives a signed XDR envelope, not the private key. A compromised frontend can display misleading UI but cannot forge signatures.

**Transaction construction guidelines for contributors:**

1. Always use `simulateTransaction` before prompting for a signature.
2. Never modify a transaction after simulation and before signing.
3. Display decoded transaction details (`merchant`, `amount`, `token`, `interval`) so users can verify before signing.
4. Set `timebounds` (e.g., 5 minutes) to prevent replay of stale signed transactions.

### Form input validation

The frontend validates inputs in `frontend/lib/validation.ts` before constructing transactions:

- Stellar address format (`StrKey.isValidEd25519PublicKey`)
- Amount bounds (positive, not exceeding `MAX_AMOUNT`)
- Interval bounds (86400–31536000 seconds)
- Token address format

Client-side validation is UX only — the contract enforces all constraints independently on-chain.

### Freighter phishing guidance

Instruct users:

- Only install Freighter from the official [Chrome Web Store](https://chrome.google.com/webstore/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk) or [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/freighter/).
- Verify the URL before connecting.
- SorobanPay will **never** ask for your seed phrase.

---

## 8. Known Limitations and Mitigations

### No MEV protection

**Limitation:** Payment collection transactions are visible in the mempool before inclusion. A validator could theoretically front-run `execute_payment`, though there is no direct financial incentive: the transfer always goes to the declared merchant, not to the transaction submitter.

**Risk level:** Low.

### Trust assumptions on RPC nodes

**Limitation:** Both frontend and backend depend on Soroban RPC nodes. A malicious RPC could return stale event data or drop broadcast transactions.

**Mitigation:**
- Use multiple RPC endpoints (primary + fallback) in the backend.
- The contract enforces all critical invariants on-chain — a lying RPC cannot forge payment events.
- For critical operations, verify transaction inclusion by querying the ledger directly.

### Subscription entry expiry

**Limitation:** If a subscription's TTL expires after ~365 days with no successful payments, the entry is garbage-collected. A subsequent `execute_payment` returns `NoActiveSubscription`, surprising merchants who expected stale subscriptions to be permanently collectable.

**Mitigation:** The backend `Reconciler` detects subscriptions without recent successful payments and alerts merchants. See [docs/architecture.md](architecture.md).

### No multisig for `execute_payment`

**Limitation:** `execute_payment` only requires a single signature from the declared `merchant`. A compromised merchant key allows an attacker to collect all due payments.

**Mitigation:** Use a Stellar multisig account as the merchant address:

```bash
stellar account set-options \
  --source merchant \
  --network mainnet \
  --master-weight 1 \
  --low-threshold 2 \
  --med-threshold 2 \
  --high-threshold 2 \
  --signer "SIGNER_KEY_2:1"
```

### No on-chain subscription pause

**Limitation:** There is no contract-level pause mechanism. The `is_paused` field in `SubscriptionData` is not currently read by `execute_payment`.

**Mitigation:** Subscribers can achieve a pause-equivalent by revoking the token allowance. Merchants can stop calling `execute_payment`. A future contract version may implement on-chain pause semantics.

### Backend is a single point of failure for analytics

**Limitation:** If the backend goes down, the contract continues to function correctly — subscriptions can still be collected by merchants calling `execute_payment` directly. However, the merchant dashboard, payout summaries, and webhook notifications will be unavailable.

**Mitigation:** Use health monitoring on `/health` and configure alerting for indexer lag. See [docs/architecture.md](architecture.md) for HA deployment options.

---

## 9. Dependency Security

### Rust / Cargo (contract)

Audit Cargo dependencies:

```bash
cargo install cargo-audit
cd contracts/subscription
cargo audit
```

Add to CI:

```yaml
- name: Cargo audit
  run: cargo audit
  working-directory: contracts/subscription
```

Key contract dependencies:

| Crate | Purpose |
|-------|---------|
| `soroban-sdk` | Soroban environment, types, storage |
| `soroban-token-sdk` | SEP-41 token client (via `token::Client`) |

All Cargo dependency versions are pinned. The `Cargo.lock` is committed for reproducible builds.

### npm (backend + frontend)

```bash
# Backend
cd backend && npm audit --audit-level=high

# Frontend
cd frontend && npm audit --audit-level=high
```

In CI:

```yaml
- name: npm audit (backend)
  run: npm audit --audit-level=high
  working-directory: backend

- name: npm audit (frontend)
  run: npm audit --audit-level=high
  working-directory: frontend
```

### Dependabot

Enable Dependabot in `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /backend
    schedule:
      interval: weekly
    open-pull-requests-limit: 5

  - package-ecosystem: npm
    directory: /frontend
    schedule:
      interval: weekly
    open-pull-requests-limit: 5

  - package-ecosystem: cargo
    directory: /contracts/subscription
    schedule:
      interval: weekly
    open-pull-requests-limit: 3
```

### Supply chain integrity

- Do not use `latest` tags in Docker images — pin to a specific digest.
- Verify Stellar SDK releases against the [js-stellar-sdk changelog](https://github.com/stellar/js-stellar-sdk/releases) before upgrading.
- For the contract, always review `soroban-sdk` release notes before bumping — breaking changes to host function interfaces can silently alter contract behaviour.

---

## 10. Security Disclosure Policy

SorobanPay uses **coordinated responsible disclosure**. If you discover a security vulnerability:

1. **Do not open a public GitHub issue.**
2. Report via **GitHub Security Advisories**:
   - Repository → Security → Advisories → New Draft Advisory.
   - Include: affected component, description, reproduction steps, potential impact, and suggested mitigations.
3. You will receive acknowledgment within **72 hours**.
4. We will work with you to validate the issue and coordinate a disclosure timeline of **90 days** from initial report (shorter for Critical severity).
5. Once a fix is released, you will be credited (with your consent) in the release notes and the advisory.

For questions about this policy, reach out via GitHub Discussions.

---

## 11. Pre-Deployment Security Checklist

- [ ] `.env` and secret files excluded from version control (`.gitignore` configured)
- [ ] No real values in `backend/.env.example`
- [ ] Production secrets stored in a secret manager or platform dashboard — not in environment files committed to Git
- [ ] `DATABASE_URL` uses a dedicated application user — not a superuser
- [ ] `WEBHOOK_SECRET` set to a random 32-byte hex value (`openssl rand -hex 32`)
- [ ] `OPERATOR_SECRET` omitted unless `PaymentScheduler` is actively needed
- [ ] Pre-commit hook or `gitleaks` configured to prevent accidental secret commits
- [ ] `cargo audit` passing in CI
- [ ] `npm audit --audit-level=high` passing in CI for both backend and frontend
- [ ] CSP headers configured in `next.config.mjs`
- [ ] Merchant production accounts use multisig (2-of-N) rather than a single key
- [ ] Frontend `timebounds` set on all transactions to prevent replay
- [ ] Security advisory channel tested (can create a draft GitHub Security Advisory)
- [ ] Incident response contacts identified and available
