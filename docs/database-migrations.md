# Database Migration Compatibility and Rollout Matrix

This document defines the schema migration lifecycle for SorobanPay's PostgreSQL database (managed via Prisma). It establishes the compatibility matrix for supported upgrade paths, identifies incompatible downgrade cases, defines backup expectations, and specifies pre-deploy and post-deploy verification commands for release checklists.

---

## 1. Migration Compatibility & Rollout Matrix

To ensure zero-downtime deployments and prevent service disruption across multi-instance backend rollouts, all schema changes must follow the **Expand-and-Contract (Two-Phase) Rollout Pattern**.

### Rollout Lifecycle Phases

```
+------------------------------------------------------------------------------------------------+
| PHASE 1: PRE-DEPLOY (EXPAND)                                                                   |
| - Apply backward-compatible schema changes (add nullable column, add new table, add index)     |
| - MUST be non-breaking to currently running N-1 application instances                          |
+------------------------------------------------------------------------------------------------+
                                               |
                                               v
+------------------------------------------------------------------------------------------------+
| PHASE 2: APPLICATION DEPLOYMENT                                                                |
| - Deploy version N application code across Kubernetes pods via rolling update                  |
| - App begins writing to new schema structures (dual-write if transitioning fields)              |
+------------------------------------------------------------------------------------------------+
                                               |
                                               v
+------------------------------------------------------------------------------------------------+
| PHASE 3: POST-DEPLOY (CONTRACT / CLEANUP)                                                      |
| - Executed only after release is stable and rollback window has expired                        |
| - Apply destructive operations (drop deprecated column, drop old table, add NOT NULL)          |
+------------------------------------------------------------------------------------------------+
```

### Compatibility Matrix

| Schema Operation | Safe Pre-Deploy? | Safe Post-Deploy? | Supported Upgrade Path | Downgrade / Rollback Compatibility |
|---|---|---|---|---|
| **Add New Table** | ✅ Yes | N/A | Supported (Any `vX` $\rightarrow$ `vX+1`) | ✅ Compatible (N-1 app ignores new table) |
| **Add Nullable Column** | ✅ Yes | N/A | Supported (Any `vX` $\rightarrow$ `vX+1`) | ✅ Compatible (N-1 app ignores new column) |
| **Add Column with `DEFAULT`** | ✅ Yes | N/A | Supported (Any `vX` $\rightarrow$ `vX+1`) | ✅ Compatible (N-1 app ignores new column) |
| **Add `NOT NULL` without `DEFAULT`** | ❌ **FORBIDDEN** | ⚠️ Safe only after backfill | Requires 2 releases: Add nullable $\rightarrow$ Backfill $\rightarrow$ Add constraint | ❌ **INCOMPATIBLE** (N-1 inserts fail constraint) |
| **Rename Column** | ❌ **FORBIDDEN** in 1 step | N/A | Add new col $\rightarrow$ Dual-write $\rightarrow$ Backfill $\rightarrow$ Drop old | ❌ **INCOMPATIBLE** (N-1 queries old column name) |
| **Drop Column / Table** | ❌ **FORBIDDEN** | ✅ Yes (after 1 full release cycle) | Deprecate in `vN` $\rightarrow$ Stop reading/writing $\rightarrow$ Drop in `vN+1` | ❌ **INCOMPATIBLE DOWNGRADE** (Requires restoring DB backup) |
| **Change Column Data Type** | ❌ **FORBIDDEN** | N/A | Add new type col $\rightarrow$ Dual-write $\rightarrow$ Drop old col | ❌ **INCOMPATIBLE** (Serialization mismatch) |
| **Add Index (`CONCURRENTLY`)** | ✅ Yes | ✅ Yes | Supported | ✅ Compatible |

---

## 2. Constraints on Destructive Changes

### Strict Incompatible Downgrade Cases
The following operations destroy backward compatibility and make immediate application rollback impossible without database restoration:
1. **Dropping a Column Still Referenced by N-1 Application Pods**:
   - *Impact*: Pods running the previous version throw SQL `column does not exist` errors.
   - *Constraint*: Columns marked for deletion must remain in the database for at least one full minor release cycle after all application references are removed.
2. **Adding a `NOT NULL` Constraint to an Existing Table without Backfilling**:
   - *Impact*: Any in-flight transaction or N-1 pod executing an insert without providing the field fails immediately.
3. **Shortening Column Width or Restricting Enum Variants**:
   - *Impact*: Incompatible data rejection and truncated records.

### PostgreSQL Locking & Zero-Downtime Guardrails
To prevent locking production tables and blocking merchant requests:
- **Lock Timeout**: All migration scripts must set a maximum lock acquisition timeout:
  ```sql
  SET lock_timeout = '2s';
  SET statement_timeout = '30s';
  ```
- **Index Creation**: All index creations on production tables must use `CREATE INDEX CONCURRENTLY` to avoid taking an `EXCLUSIVE` lock.

---

## 3. Backup Expectations

Before applying any schema migration in production or staging, operators must verify the following backup criteria:

| Backup Type | Requirement | Verification Command | Retention Window |
|---|---|---|---|
| **Pre-Migration Snapshot** | Mandatory full logical dump immediately prior to migration | `pg_dump -Fc -Z 6 -d "$DATABASE_URL" -f "pre_mig_$(date +%s).dump"` | 7 days minimum |
| **Point-In-Time Recovery (PITR)** | Continuous WAL archiving enabled and active | Check archive status: `SELECT pg_wal_lsn_diff(pg_current_wal_lsn(), last_archived_lsn) FROM pg_stat_archiver;` | 30 days |
| **Volume Snapshot** | Cloud provider disk snapshot (EBS / GCE Persistent Disk) | Snapshot completed within 1 hour prior to deploy window | 14 days |

---

## 4. Release Checklist & Migration Verification Commands

This checklist must be linked and executed during every production deployment.

### Pre-Deployment Checklist (Phase 1)
- [ ] **1. Create Pre-Migration Backup**:
  ```bash
  pg_dump -Fc -Z 6 "$DATABASE_URL" > /backups/sorobanpay_pre_deploy_$(date +%Y%m%d_%H%M%S).dump
  ```
- [ ] **2. Inspect Pending Migrations**:
  ```bash
  npx prisma migrate status
  ```
  *Verify that all pending migrations are classified as Phase 1 (additive/non-breaking).*
- [ ] **3. Check Active Table Locks & Connections**:
  ```bash
  psql "$DATABASE_URL" -c "
    SELECT pid, now() - query_start AS duration, query, state
    FROM pg_stat_activity
    WHERE state != 'idle' AND query NOT LIKE '%pg_stat_activity%'
    ORDER BY duration DESC LIMIT 5;"
  ```
- [ ] **4. Apply Pre-Deploy Migrations**:
  ```bash
  npx prisma migrate deploy
  ```
- [ ] **5. Validate Migration Status**:
  ```bash
  npx prisma migrate status
  # Output must assert: "Database schema is up to date!"
  ```

### Deployment (Phase 2)
- [ ] **6. Roll Out Application Code**:
  ```bash
  kubectl rollout restart deployment/sorobanpay-backend
  kubectl rollout status deployment/sorobanpay-backend --timeout=300s
  ```
- [ ] **7. Verify Health & Telemetry**:
  ```bash
  curl -fsS "https://api.sorobanpay.com/health/ready" | jq .
  ```

### Rollback Runbook (If Application Deployment Fails)
If version N application pods fail health checks or error rates spike:
1. **Rollback Application Pods**:
   ```bash
   kubectl rollout undo deployment/sorobanpay-backend
   ```
2. **Schema State During Rollback**:
   - Because Phase 1 migrations were strictly additive (columns added were nullable or had defaults), the N-1 application pods will operate normally against the migrated schema.
   - **DO NOT** attempt to drop newly created columns while N-1 pods are running.
3. **If Destructive Incompatible Migration Was Inadvertently Applied**:
   - Stop application traffic immediately (`503 Maintenance Mode`).
   - Restore database from the pre-migration dump:
     ```bash
     pg_restore --clean --if-exists -d "$DATABASE_URL" /backups/sorobanpay_pre_deploy_<timestamp>.dump
     ```
   - Re-route application traffic once restore is verified.
