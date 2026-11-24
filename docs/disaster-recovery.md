# Disaster Recovery Guide (RTO and RPO Objectives)

This guide defines the comprehensive Disaster Recovery (DR) plan for SorobanPay. It establishes measurable Recovery Time Objectives (RTO) and Recovery Point Objectives (RPO), delineates authoritative business records from rebuildable index data, defines strict restoration ordering, and details tested procedures for recovering from database corruption, indexer state loss, and RPC provider outages.

---

## 1. Measurable Recovery Objectives (RTO & RPO)

Recovery objectives are partitioned by architectural tier and linked directly to tested recovery procedures:

| Subsystem / Data Tier | RTO (Target) | RPO (Target) | Backup Dependency | Restoration Mechanism |
|---|---|---|---|---|
| **Authoritative Business Records** (Merchants, Subscriptions, API Keys, Webhook Endpoints) | **$\le$ 30 minutes** | **$\le$ 5 minutes** | Continuous PostgreSQL WAL archiving + Hourly Differential Snaps + Daily Full Dump | Point-In-Time Recovery (PITR) to target timestamp or snapshot restore via `pg_restore`. |
| **Rebuildable Indexer State** (Contract Events, Payment Receipts, Analytics Rollups) | **$\le$ 2 hours** | **0 (Zero Loss)** | On-chain Soroban Ledger Event Stream (Stellar blockchain consensus) | Event stream replay from last validated checkpoint cursor via `npm run indexer:replay`. |
| **Volatile Cache & Queues** (Redis Sessions, Notification Queue, Webhook Outbox) | **$\le$ 15 minutes** | **$\le$ 15 minutes** | Redis AOF (Append-Only File) + Postgres Outbox Table fallback | Redis AOF reload; unprocessed webhook deliveries reconstructed from Postgres `WebhookDelivery` log. |
| **Application & Worker Pods** (API Gateway, Event Indexer, Webhook Worker) | **$\le$ 5 minutes** | **0 (Zero)** | Git immutable container digests + Kustomize / Helm manifests | Container redeployment across standby Kubernetes cluster nodes. |

---

## 2. Data Classification: Authoritative vs. Rebuildable

A critical architectural principle of SorobanPay is distinguishing data whose source of truth is our database from data whose source of truth is the Stellar blockchain:

```
+---------------------------------------------------------------------------------------------------+
| AUTHORITATIVE BUSINESS RECORDS (Must be backed up & restored from PITR)                           |
| - Merchant profiles & authentication credentials (Merchant, User)                                 |
| - Off-chain subscription metadata & customer notes (SubscriptionMetadata)                        |
| - Webhook endpoint URLs & signing secrets (WebhookEndpoint)                                       |
| - API keys, tenant scopes, and access tokens (ApiKey)                                             |
+---------------------------------------------------------------------------------------------------+

+---------------------------------------------------------------------------------------------------+
| REBUILDABLE INDEX DATA (Source of truth is on-chain Soroban smart contract)                       |
| - Processed contract event logs (ContractEvent)                                                   |
| - Subscription state snapshots derived from on-chain events (Subscription)                        |
| - Historical payment execution records (PaymentExecution, PaymentReceipt)                         |
| - Daily/monthly revenue aggregations (MerchantAnalyticsRollup)                                    |
| - Indexer checkpoint cursor (IndexerCursor)                                                       |
+---------------------------------------------------------------------------------------------------+
```

### Key Operational Invariant
If indexer state or historical payment projections are corrupted or lost, **do not panic or delay traffic for full ledger rebuilds**. The authoritative business records can be restored immediately to serve customer traffic, while indexer event replay runs concurrently in the background.

---

## 3. Restoration Ordering & Dependency Flow

Recovery must follow a strict dependency sequence to avoid race conditions, split-brain writes, or outbox flooding:

```
   [Step 1: Infrastructure & Storage Provisioning]
                    |
                    v
   [Step 2: Restore Authoritative Postgres Database (PITR)]
                    |
                    v
   [Step 3: Schema & Migration Integrity Check (`prisma migrate status`)]
                    |
                    v
   [Step 4: Restore Redis Cache & Initialize Webhook Outbox]
                    |
                    v
   [Step 5: Determine Indexer Cursor & Begin On-Chain Event Replay]
                    |
                    v
   [Step 6: Pre-Traffic Verification & Balance Reconciliation]
                    |
                    v
   [Step 7: Ingress Cutover & Traffic Restoration]
```

### Detailed Execution Sequence

#### Step 1: Ingress Isolation
Ensure public ingress traffic is held in maintenance mode (`HTTP 503 Maintenance`) to prevent incoming writes while restoration is underway:
```bash
kubectl patch ingress sorobanpay-ingress --type merge -p '{"spec":{"rules":[{"http":{"paths":[{"path":"/","pathType":"Prefix","backend":{"service":{"name":"maintenance-service","port":{"number":80}}}}]}}]}}'
```

#### Step 2: Restore Authoritative Postgres Database
Restore the database to the nearest safe timestamp prior to the corruption/disaster event:
```bash
# Example: Restore from latest logical backup
createdb -h "$PGHOST" -U "$PGUSER" sorobanpay_recovery
pg_restore -h "$PGHOST" -U "$PGUSER" -d sorobanpay_recovery --clean --if-exists /backups/sorobanpay_pitr.dump
```

#### Step 3: Schema & Migration Integrity Verification
Assert that the restored database schema matches the running release version:
```bash
npx prisma migrate status
```
*If unapplied migrations exist, execute `npx prisma migrate deploy` before launching services.*

#### Step 4: Indexer Replay from Safe Checkpoint
1. Query the last confirmed ledger sequence recorded in the restored database:
   ```sql
   SELECT MAX(ledger_sequence) AS last_ledger FROM contract_events;
   ```
2. Initiate indexer catch-up replay from `last_ledger + 1` against the primary/fallback RPC provider:
   ```bash
   npm run indexer:replay -- --from-ledger "$LAST_LEDGER" --to-ledger "latest"
   ```

#### Step 5: Pre-Traffic Verification Checklist
Before re-enabling ingress traffic, operators must confirm:
- [ ] Database connection pool latency < 50ms.
- [ ] Redis ping responds with `PONG`.
- [ ] RPC provider `/health` check responds with status `healthy`.
- [ ] Indexer ledger lag is $\le$ 2 ledgers.
- [ ] Synthetic subscription query returns expected merchant data.
- [ ] Webhook retry queue is un-quarantined.

#### Step 6: Traffic Cutover
Re-route ingress from the maintenance service back to `sorobanpay-backend`.

---

## 4. Tested Backup & Recovery Procedures

### Continuous Backup Automation
- **Logical Backup (Daily)**: `pg_dump -Fc -Z 6 "$DATABASE_URL" > /backups/daily_$(date +%Y%m%d).dump`
- **WAL Archiving**: Continuous streaming to encrypted S3/GCS bucket with 30-day retention.
- **Automated Restore Drill**: Scheduled bi-weekly drill in staging verifying restore under 20 minutes.

### Recovery from RPC Provider Total Outage
If the primary Soroban RPC provider suffers a prolonged outage:
1. Follow [docs/rpc-failover-operations.md](./rpc-failover-operations.md) to evaluate candidate backup providers.
2. Verify backup node ledger height parity against Stellar consensus.
3. Update `RPC_URL` and `SOROBAN_RPC_URL` in Kubernetes secrets or deployment environment.
4. Execute rolling restart: `kubectl rollout restart deployment/sorobanpay-backend`.
