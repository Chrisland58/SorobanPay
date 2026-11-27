# Indexer Backlog Catch-Up & Checkpoint Load Testing

This document describes the reproducible load-testing methodology, performance baselines, and operational guarantees for the SorobanPay event indexer (`EventIndexer` and `IndexerStateService`).

## Reproducible Workload

- **Test Suite:** [`backend/tests/indexerBacklogLoad.test.ts`](../backend/tests/indexerBacklogLoad.test.ts)
- **Backlog Size:** 300 synthetic contract events (batch-size sweep) and 200 events (interruption/recovery)
- **Batch Sizes Tested:** `25`, `100`, `250`
- **Fault Injection:**
  - Intermittent RPC latency (`10ms` delay injected on every 3rd batch)
  - Simulated mid-catch-up process interruption after 2 batches with a 10-event overlap window on resume
  - Tampered checkpoint checksum verification
  - Simulated RPC `503 Service Unavailable` failure prior to checkpoint commit

## Tracked Metrics & Performance Baseline

| Metric | Description | Baseline / Expectation |
| :--- | :--- | :--- |
| **Time to Catch Up** | Wall-clock duration to drain the backlog | Scales down as batch size increases (`250` < `25` due to fewer RPC/checkpoint cycles) |
| **Throughput** | Events processed per second (`events / durationMs * 1000`) | Positive monotonic improvement with larger batch sizes under intermittent latency |
| **Memory Use** | `process.memoryUsage().heapUsed` delta across catch-up | Bounded heap growth; no unbounded in-memory event accumulation |
| **Database Writes** | Total `markEventProcessed` + `saveCheckpoint` + `saveState` calls | Strictly fewer total writes at batch size `250` vs `25` |
| **Checkpoint Correctness** | `sequence`, `cursor`, `ledger`, `eventCount`, and checksum validity | 100% match with last processed event; tampered checksums rejected (`null`) |

## Interruption & Deduplication Guarantees

1. **Zero Lost Events:** Checkpoints are persisted only after all events in a batch are processed. On restart, `recoverFromCheckpoint` resumes from the last committed cursor.
2. **Zero Duplicate Events:** `isDuplicateEvent` and `markEventProcessed` ensure that even when resuming with an overlap window, already-committed events are skipped idempotently.

## Running the Load Tests

```bash
npx jest backend/tests/indexerBacklogLoad.test.ts
```
