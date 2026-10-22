-- Migration: canonical schema for all five core tables (#1379)
-- Generated: 2024-10-21
--
-- Fully idempotent: uses IF NOT EXISTS / IF EXISTS guards throughout.
-- Safe to apply on top of any earlier partial schema without errors.
--
-- Tables covered:
--   1. Subscription       (new columns: interval, nextPayment, overdueSince)
--   2. Payment            (new columns: eventType, paymentNonce)
--   3. IndexerState       (new column: lastIndexedLedger; renamed from lastCursor)
--   4. WebhookEndpoint    (indexes added)
--   5. WebhookDelivery    (new columns: status, attempts, lastAttemptAt; indexes added)

-- ─── 1. Subscription ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Subscription" (
  "id"           SERIAL PRIMARY KEY,
  "subscriber"   TEXT NOT NULL,
  "merchant"     TEXT NOT NULL,
  "token"        TEXT NOT NULL DEFAULT '',
  "amount"       TEXT NOT NULL DEFAULT '0',
  "interval"     BIGINT NOT NULL DEFAULT 0,
  "nextPayment"  BIGINT NOT NULL DEFAULT 0,
  "status"       TEXT NOT NULL DEFAULT 'ACTIVE',
  "overdueSince" TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Subscription_subscriber_merchant_token_key"
    UNIQUE ("subscriber", "merchant", "token")
);

-- Add columns that may be absent from earlier partial migrations
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "interval"     BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "nextPayment"  BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "overdueSince" TIMESTAMP(3);
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "token"        TEXT NOT NULL DEFAULT '';
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "amount"       TEXT NOT NULL DEFAULT '0';

CREATE INDEX IF NOT EXISTS "Subscription_merchant_idx"        ON "Subscription" ("merchant");
CREATE INDEX IF NOT EXISTS "Subscription_subscriber_idx"      ON "Subscription" ("subscriber");
CREATE INDEX IF NOT EXISTS "Subscription_status_idx"          ON "Subscription" ("status");
CREATE INDEX IF NOT EXISTS "Subscription_merchant_status_idx" ON "Subscription" ("merchant", "status");
CREATE INDEX IF NOT EXISTS "Subscription_nextPayment_idx"     ON "Subscription" ("nextPayment");

-- ─── 2. Payment ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Payment" (
  "id"           SERIAL PRIMARY KEY,
  "subscriber"   TEXT NOT NULL,
  "merchant"     TEXT NOT NULL,
  "token"        TEXT NOT NULL,
  "amount"       TEXT NOT NULL,
  "eventType"    TEXT NOT NULL DEFAULT 'executed',
  "txHash"       TEXT NOT NULL UNIQUE,
  "paymentNonce" INTEGER NOT NULL DEFAULT 0,
  "timestamp"    TIMESTAMP(3) NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "eventType"    TEXT NOT NULL DEFAULT 'executed';
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "paymentNonce" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "Payment_merchant_idx"            ON "Payment" ("merchant");
CREATE INDEX IF NOT EXISTS "Payment_subscriber_idx"          ON "Payment" ("subscriber");
CREATE INDEX IF NOT EXISTS "Payment_merchant_timestamp_idx"  ON "Payment" ("merchant", "timestamp");
CREATE INDEX IF NOT EXISTS "Payment_subscriber_merchant_idx" ON "Payment" ("subscriber", "merchant");
CREATE INDEX IF NOT EXISTS "Payment_timestamp_idx"           ON "Payment" ("timestamp");

-- ─── 3. IndexerState ──────────────────────────────────────────────────────────
-- Singleton row (id = 1). Renamed lastCursor → cursor, added lastIndexedLedger.

CREATE TABLE IF NOT EXISTS "IndexerState" (
  "id"                INT PRIMARY KEY DEFAULT 1,
  "cursor"            TEXT,
  "lastIndexedLedger" INTEGER NOT NULL DEFAULT 0,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add lastIndexedLedger if coming from an earlier schema that only had cursor
ALTER TABLE "IndexerState" ADD COLUMN IF NOT EXISTS "lastIndexedLedger" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "IndexerState" ADD COLUMN IF NOT EXISTS "cursor"            TEXT;

-- Rename legacy column if it exists (lastCursor → cursor)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'IndexerState' AND column_name = 'lastCursor'
  ) THEN
    ALTER TABLE "IndexerState" RENAME COLUMN "lastCursor" TO "cursor";
  END IF;
END$$;

-- Rename legacy column if it exists (lastProcessedLedger → lastIndexedLedger)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'IndexerState' AND column_name = 'lastProcessedLedger'
  ) THEN
    ALTER TABLE "IndexerState" RENAME COLUMN "lastProcessedLedger" TO "lastIndexedLedger";
  END IF;
END$$;

-- Ensure the singleton row exists
INSERT INTO "IndexerState" ("id", "lastIndexedLedger")
VALUES (1, 0)
ON CONFLICT ("id") DO NOTHING;

-- ─── 4. WebhookEndpoint ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "WebhookEndpoint" (
  "id"        SERIAL PRIMARY KEY,
  "merchant"  TEXT NOT NULL,
  "url"       TEXT NOT NULL,
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "secret"    TEXT,
  "events"    TEXT NOT NULL DEFAULT 'payment.executed,payment.failed',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookEndpoint_merchant_url_key" UNIQUE ("merchant", "url")
);

CREATE INDEX IF NOT EXISTS "WebhookEndpoint_merchant_idx" ON "WebhookEndpoint" ("merchant");
CREATE INDEX IF NOT EXISTS "WebhookEndpoint_active_idx"   ON "WebhookEndpoint" ("active");

-- ─── 5. WebhookDelivery ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "WebhookDelivery" (
  "id"            SERIAL PRIMARY KEY,
  "webhookId"     INTEGER REFERENCES "WebhookEndpoint"("id") ON DELETE SET NULL,
  "eventId"       TEXT NOT NULL,
  "deliveryId"    TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  "url"           TEXT NOT NULL,
  "merchant"      TEXT NOT NULL,
  "event"         TEXT NOT NULL,
  "payload"       TEXT NOT NULL,
  "statusCode"    INTEGER NOT NULL DEFAULT 0,
  "status"        TEXT NOT NULL DEFAULT 'pending',
  "attempts"      INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "success"       BOOLEAN NOT NULL DEFAULT false,
  "error"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "WebhookDelivery" ADD COLUMN IF NOT EXISTS "status"        TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "WebhookDelivery" ADD COLUMN IF NOT EXISTS "attempts"      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WebhookDelivery" ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "WebhookDelivery_eventId_idx"          ON "WebhookDelivery" ("eventId");
CREATE INDEX IF NOT EXISTS "WebhookDelivery_merchant_idx"         ON "WebhookDelivery" ("merchant");
CREATE INDEX IF NOT EXISTS "WebhookDelivery_merchant_status_idx"  ON "WebhookDelivery" ("merchant", "status");
CREATE INDEX IF NOT EXISTS "WebhookDelivery_merchant_created_idx" ON "WebhookDelivery" ("merchant", "createdAt");
CREATE INDEX IF NOT EXISTS "WebhookDelivery_webhookId_idx"        ON "WebhookDelivery" ("webhookId");
