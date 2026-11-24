-- #1382: Cancellation audit trail
-- Adds the cancellation_audits table for recording every on-chain cancel event.
-- Retention period is configurable via AUDIT_RETENTION_YEARS (default: 7 years).

CREATE TABLE IF NOT EXISTS cancellation_audits (
  id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  network             TEXT        NOT NULL,
  contract_id         TEXT        NOT NULL,
  subscriber_address  TEXT        NOT NULL,
  merchant_address    TEXT        NOT NULL,
  token_address       TEXT,
  amount              TEXT,
  interval_seconds    BIGINT,
  next_payment_at     TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ledger              BIGINT      NOT NULL,
  transaction_hash    TEXT        NOT NULL,
  reason              TEXT,
  source              TEXT        NOT NULL DEFAULT 'event',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cancellation_audit_network_known
    CHECK (network IN ('testnet', 'mainnet')),
  CONSTRAINT cancellation_audit_reason_length
    CHECK (reason IS NULL OR char_length(reason) <= 1000),
  CONSTRAINT cancellation_audit_interval_positive
    CHECK (interval_seconds IS NULL OR interval_seconds > 0),
  CONSTRAINT cancellation_audit_amount_numeric
    CHECK (amount IS NULL OR amount ~ '^[0-9]+$')
);

-- Idempotency: unique per (network, transaction_hash)
CREATE UNIQUE INDEX IF NOT EXISTS cancellation_audit_network_tx_hash_idx
  ON cancellation_audits (network, transaction_hash);

-- Merchant dashboard query index
CREATE INDEX IF NOT EXISTS cancellation_audit_merchant_idx
  ON cancellation_audits (merchant_address, cancelled_at DESC);

-- Subscriber query index
CREATE INDEX IF NOT EXISTS cancellation_audit_subscriber_idx
  ON cancellation_audits (subscriber_address, cancelled_at DESC);

-- Contract-scoped lookup index
CREATE INDEX IF NOT EXISTS cancellation_audit_contract_pair_idx
  ON cancellation_audits (network, contract_id, subscriber_address, merchant_address);
