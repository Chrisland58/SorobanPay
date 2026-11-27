# Event Deduplication & Resumable Indexing Architecture

## Problem Statement
The indexer RPC polling loop may deliver identical events multiple times if restarted mid-page or if retries occur.

## Architectural Solution
1. **Natural Key Deduplication**: Payment events rely on unique composite index `events(tx_hash, ledger)` to ensure idempotent upserts (`INSERT ... ON CONFLICT DO NOTHING`).
2. **Generic Event Deduplication**: Generic events without composite keys are tracked in `processed_events(event_hash)`.
3. **Atomic Commit**: Event writes and indexer cursor state are updated in a single transaction.


## End-to-End Event-to-Analytics Reconciliation

Contract `executed` events flow from Soroban RPC through `EventIndexer` persistence into `PayoutSummaryGenerator` merchant analytics.

- **Duplicate delivery**: Replayed or duplicate RPC events are deduplicated before persistence so `payoutSummary.totalAmount` and `payoutSummary.paymentCount` reflect only the canonical event set.
- **Delayed indexing**: Empty poll cycles or late-arriving ledgers do not corrupt cursor state; subsequent batches reconcile into the same daily/weekly merchant summary.
- **Malformed events & batch failures**: Events with invalid or incomplete topics/payloads are skipped without polluting analytics, and non-retryable RPC/batch failures surface in indexer diagnostics without advancing the persisted cursor.
- **Verification**: Covered by `backend/tests/eventReconciliation.e2e.test.ts`.
