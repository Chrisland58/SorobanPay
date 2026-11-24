# Production Secret Rotation Runbooks

This guide provides operational runbooks for rotating production secrets and credentials across SorobanPay infrastructure without service interruption or secret exposure. It details secret classes, designated owners, rotation cadences, zero-downtime overlap windows, validation checkpoints, and rollback procedures.

---

## 1. Secret Class Inventory & Ownership

| Secret Identifier | Classification | Component | Designated Owner | Rotation Cadence | Zero-Downtime Overlap Window |
|---|---|---|---|---|---|
| `DATABASE_URL` | High | PostgreSQL DB | Platform / DBA Team | 90 days | **24 hours** (Dual-user overlap) |
| `WEBHOOK_SIGNING_KEY` | High | Webhook Outbox & Merchant Handlers | Integration Eng | 180 days | **48 hours** (Dual-key verification) |
| `JWT_SECRET` | High | Backend Auth & API Gateway | Security Engineering | 90 days | **7 days** (Key-ring token grace) |
| `SOROBAN_RPC_API_KEY` | Medium | RPC Provider Gateway | Infrastructure / SRE | 180 days | **24 hours** (Multi-key quota) |
| `STELLAR_ADMIN_SECRET` | Critical | Contract Governance & Admin | Security Lead / Multisig | 365 days / On Incident | **Atomic** (Contract admin handoff) |

> [!IMPORTANT]
> **Strict Secret Redaction Policy**:
> Runbooks, incident tickets, pull requests, and logs must NEVER contain plaintext secret values. Always use variable placeholders such as `<NEW_DATABASE_PASSWORD>`, `<NEW_WEBHOOK_KEY>`, or secret management reference IDs (`vault:v1/db/password`).

---

## 2. Zero-Downtime Overlap Protocols

To rotate credentials without dropping active transactions or API calls, all rotations utilize overlap windows:

### 1. Dual-User Database Rotation (PostgreSQL)
Rather than changing a password in-place (which terminates active pools), create a secondary database user, grant identical privileges, migrate application pools to the secondary user, verify, and drop the primary user after the overlap window.

### 2. Dual-Key Webhook Verification
Merchants and backend dispatchers support a primary and secondary signing key. Webhooks dispatched during the 48-hour overlap window include the key identifier (`X-SorobanPay-Key-Id: v2`). Recipients verify against either active key until the old key is retired.

### 3. Key-Ring Token Rotation (JWT / API Keys)
The authentication middleware accepts a JSON Web Key Set (JWKS) or array of active signing secrets (`JWT_SECRET_CURRENT`, `JWT_SECRET_PREVIOUS`), signing new tokens with `CURRENT` while validating existing unexpired sessions with `PREVIOUS`.

---

## 3. Step-by-Step Rotation Runbooks

### Runbook A: PostgreSQL Database Credentials (`DATABASE_URL`)

#### Step 1: Pre-Rotation Check
- Verify replication lag is zero and current connection count is within limits:
  ```sql
  SELECT count(*) FROM pg_stat_activity WHERE state != 'idle';
  ```

#### Step 2: Provision Secondary Role
- Create the replacement database user with equivalent privileges:
  ```sql
  CREATE USER sorobanpay_app_v2 WITH ENCRYPTED PASSWORD '<NEW_DATABASE_PASSWORD>';
  GRANT rds_iam, sorobanpay_app_role TO sorobanpay_app_v2;
  ```

#### Step 3: Validation Checkpoint #1 (Canary Probe)
- Verify that the new credentials connect and query successfully before updating workloads:
  ```bash
  psql "postgresql://sorobanpay_app_v2:<NEW_DATABASE_PASSWORD>@$PGHOST:5432/sorobanpay" -c "SELECT 1;"
  ```
  *If canary connection fails: Stop immediately; drop `sorobanpay_app_v2` and investigate.*

#### Step 4: Staged Deployment (Update Kubernetes Secret)
- Update Kubernetes secret and trigger rolling restart:
  ```bash
  kubectl create secret generic backend-db-secret \
    --from-literal=DATABASE_URL="postgresql://sorobanpay_app_v2:<NEW_DATABASE_PASSWORD>@$PGHOST:5432/sorobanpay?pool_timeout=10" \
    --dry-run=client -o yaml | kubectl apply -f -
  kubectl rollout restart deployment/sorobanpay-backend
  ```

#### Step 5: Rollback Checkpoint
- Monitor application error rate for 15 minutes:
  ```bash
  kubectl rollout status deployment/sorobanpay-backend
  # If error rate > 0.1% or connection pool errors spike, execute immediate rollback:
  # kubectl rollout undo deployment/sorobanpay-backend
  ```

#### Step 6: Post-Rotation Cleanup
- After the 24-hour overlap window, confirm zero connections under the old user, then drop it:
  ```sql
  SELECT count(*) FROM pg_stat_activity WHERE usename = 'sorobanpay_app_v1';
  -- When count == 0:
  DROP USER sorobanpay_app_v1;
  ```

---

### Runbook B: Webhook Signing Key (`WEBHOOK_SIGNING_KEY`)

#### Step 1: Pre-Rotation Check
- Confirm that merchant notification webhooks are processing with normal latency (< 1s queue wait).

#### Step 2: Generate Cryptographic Secret
- Generate a high-entropy 256-bit HMAC key:
  ```bash
  NEW_KEY=$(openssl rand -hex 32)
  ```

#### Step 3: Activate Dual-Key Verification Window
- Configure backend with primary and secondary verification keys:
  ```bash
  kubectl set env deployment/sorobanpay-backend \
    WEBHOOK_SIGNING_KEY_CURRENT="$NEW_KEY" \
    WEBHOOK_SIGNING_KEY_PREVIOUS="<OLD_KEY>" \
    WEBHOOK_KEY_ID="v2"
  ```

#### Step 4: Validation Checkpoint
- Dispatch a synthetic webhook test event to an internal echo endpoint:
  ```bash
  curl -s -X POST "https://api.sorobanpay.com/api/webhooks/test-delivery" \
    -H "Authorization: Bearer <API_TOKEN>"
  ```
  *Verify HTTP 200 response with header `X-SorobanPay-Key-Id: v2`.*

#### Step 5: Rollback Checkpoint
- If merchants report signature validation errors:
  ```bash
  kubectl set env deployment/sorobanpay-backend \
    WEBHOOK_SIGNING_KEY_CURRENT="<OLD_KEY>" \
    WEBHOOK_SIGNING_KEY_PREVIOUS="" \
    WEBHOOK_KEY_ID="v1"
  ```

#### Step 6: Post-Rotation Cleanup
- After the 48-hour notification overlap window has elapsed, remove `WEBHOOK_SIGNING_KEY_PREVIOUS`.

---

### Runbook C: Soroban RPC Provider API Key (`SOROBAN_RPC_API_KEY`)

#### Step 1: Provision Secondary Key at Provider
- Generate candidate key `key_v2` in the provider portal (e.g., QuickNode / Blockdaemon).

#### Step 2: Validation Checkpoint #1
- Probe the RPC node using `key_v2`:
  ```bash
  curl -s -X POST "https://soroban-rpc.example.com/v1?api_key=<NEW_RPC_KEY>" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | jq .
  ```
  *Confirm `status: "healthy"`.*

#### Step 3: Staged Deployment
- Update `SOROBAN_RPC_API_KEY` in deployment environment and execute rolling restart.

#### Step 4: Rollback Checkpoint
- Check `sorobanpay_rpc_requests_total{status="401"}` metric. If 401/403 errors occur, revert to `key_v1`.

#### Step 5: Post-Rotation Cleanup
- Revoke `key_v1` in the provider dashboard after 24 hours.

---

### Runbook D: Contract Administrator Key (`STELLAR_ADMIN_SECRET`)

#### Step 1: Pre-Rotation Validation
- Confirm the new administrator Stellar public address has been funded and has a valid sequence:
  ```bash
  soroban config identity address new_admin
  ```

#### Step 2: Two-Step Ownership Handshake
- Transfer administration on-chain:
  ```bash
  soroban contract invoke \
    --id "$CONTRACT_ID" \
    --source admin_current \
    -- transfer_admin \
    --new_admin "$NEW_ADMIN_ADDRESS"
  ```

#### Step 3: Validation Checkpoint
- Query contract state to verify new admin is pending or active:
  ```bash
  soroban contract invoke --id "$CONTRACT_ID" -- source new_admin -- get_admin
  ```

#### Step 4: Rollback Checkpoint
- If the new administrator fails verification prior to acceptance, invoke `cancel_transfer_admin` with current admin.
