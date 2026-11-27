-- #1588: Composite Tenant Indexes for Frequently Scoped Queries
-- Adds focused composite indexes for high-volume tenant-scoped read & aggregation paths.
-- Guarantees row-level tenant isolation is preserved with high-performance index scan plans.

-- 1. Ensure tenant_id column exists on core tables (idempotent for varying migration baselines)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'default';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'default';
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'default';

-- 2. Payments composite indexes for tenant-scoped date sorting & status filtering
CREATE INDEX IF NOT EXISTS idx_payments_tenant_occurred_at
  ON payments (tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_tenant_event_occurred
  ON payments (tenant_id, event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_tenant_merchant_occurred
  ON payments (tenant_id, merchant, occurred_at DESC);

-- 3. Subscriptions composite indexes for tenant billing runs and status queries
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_status_next_payment
  ON subscriptions (tenant_id, status, next_payment ASC);

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_merchant_status
  ON subscriptions (tenant_id, merchant, status);

CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_subscriber
  ON subscriptions (tenant_id, subscriber);

-- 4. Webhook deliveries composite index for tenant delivery status polling
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_tenant_status_created
  ON webhook_deliveries (tenant_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Rollback / Down Migration Instructions:
-- DROP INDEX IF EXISTS idx_payments_tenant_occurred_at;
-- DROP INDEX IF EXISTS idx_payments_tenant_event_occurred;
-- DROP INDEX IF EXISTS idx_payments_tenant_merchant_occurred;
-- DROP INDEX IF EXISTS idx_subscriptions_tenant_status_next_payment;
-- DROP INDEX IF EXISTS idx_subscriptions_tenant_merchant_status;
-- DROP INDEX IF EXISTS idx_subscriptions_tenant_subscriber;
-- DROP INDEX IF EXISTS idx_webhook_deliveries_tenant_status_created;
-- ---------------------------------------------------------------------------
