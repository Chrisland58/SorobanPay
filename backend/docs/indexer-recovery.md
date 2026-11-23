# Event Indexer Recovery Guide

This runbook describes how to diagnose and recover the EventIndexer after a crash, gap, or data corruption. It distinguishes read-only diagnosis from state-changing recovery, and provides a step-by-step procedure with expected console output.

---

## Checkpoint Semantics

The indexer does not write an explicit cursor to a separate table. Its checkpoint is derived from the data it has already stored: the highest `ledgerTimestamp` value in the `Event` table represents the last ledger that was fully processed.

```sql
SELECT MAX("ledgerTimestamp") FROM "Event";
```

### Safe replay bound

Replaying from exactly `MAX(ledgerTimestamp)` is not safe because events on the final ledger may have been partially processed when the indexer crashed. To guarantee all events on that ledger are re-processed, subtract a small buffer:

```
safeReplayLedger = MAX(ledgerTimestamp) - REPLAY_BUFFER
```

**REPLAY_BUFFER = 2 ledgers** (the default used by `getSafeReplayLedger()`). This covers any in-flight events that were fetched but not yet written.

The `EventIndexer` class exposes this calculation directly:

```typescript
const checkpoint = await indexer.getCheckpoint();         // reads MAX(ledgerTimestamp)
const replayFrom = indexer.getSafeReplayLedger(checkpoint); // checkpoint - 2
```

### Duplicate safety

Replaying events from an earlier ledger is safe because `processEvent` checks for an existing record before inserting:

```typescript
const existingEvent = await prisma.event.findFirst({
  where: {
    type, subscriber, merchant, token, amount,
    ledgerTimestamp: BigInt(event.ledger),
  },
});
if (existingEvent) return; // skip duplicate
```

Any event that was already stored will be silently skipped on replay.

### Normal operation

During normal operation `fetchAndStoreEvents()` is called with no argument. It resolves `startLedger` automatically from `getCheckpoint()` and subtracts the buffer, so a process restart after a crash requires no operator intervention.

```
Indexer boot
  └─ getCheckpoint()          → 1050
  └─ getSafeReplayLedger(1050)→ 1048
  └─ fetchAndStoreEvents(1048)→ fetches ledgers 1048..latestLedger
       └─ duplicate events on 1048–1050: skipped
       └─ new events on 1051+: stored
```

---

## Read-only Diagnosis

Run these queries first. They change no data.

### 1. Find the checkpoint

```sql
SELECT MAX("ledgerTimestamp") AS checkpoint FROM "Event";
```

Expected output when healthy:

```
 checkpoint
------------
      1050
(1 row)
```

A `NULL` result means no events have ever been stored — the indexer may never have run, or the table was truncated.

### 2. Count stored events by type

```sql
SELECT type, COUNT(*) FROM "Event" GROUP BY type ORDER BY type;
```

Expected output on testnet after a few subscription cycles:

```
   type    | count
-----------+-------
 executed  |    42
 subscribed|    18
(2 rows)
```

A suspiciously low `executed` count relative to `subscribed` can indicate a gap.

### 3. Identify ledger gaps

```sql
SELECT "ledgerTimestamp", COUNT(*) AS event_count
FROM "Event"
GROUP BY "ledgerTimestamp"
ORDER BY "ledgerTimestamp";
```

Look for a jump in `ledgerTimestamp` values. A gap between consecutive rows indicates the indexer missed a range of ledgers.

### 4. Spot malformed records

```sql
SELECT * FROM "Event"
WHERE type IS NULL
   OR subscriber IS NULL OR subscriber = ''
   OR merchant  IS NULL OR merchant  = ''
   OR amount    IS NULL OR amount    = '';
```

Rows returned here have incomplete data and should be deleted before replay.

---

## State-changing Recovery

> **Warning**: the steps below modify or delete data. Take a database snapshot before proceeding.

### Step 1 — DIAGNOSE (read-only)

```sql
SELECT MAX("ledgerTimestamp") AS checkpoint FROM "Event";
```

Note the checkpoint value. Call it `C`.

### Step 2 — IDENTIFY

```sql
-- Check for gaps or malformed rows using the queries in the section above.
SELECT * FROM "Event" WHERE type IS NULL OR subscriber IS NULL;
```

If no malformed rows exist and there are no ledger gaps, the indexer may only need a restart — proceed to Step 4.

### Step 3 — RECOVER (delete malformed records)

Delete only the rows identified as malformed. Do not delete healthy rows:

```sql
DELETE FROM "Event"
WHERE type IS NULL OR subscriber IS NULL OR subscriber = '';
```

Confirm the deletion count and verify no healthy rows were removed:

```sql
SELECT COUNT(*) FROM "Event";
```

### Step 4 — REPLAY

Compute the safe replay ledger:

```
safeReplayLedger = C - 2
```

Then restart the indexer. Because `fetchAndStoreEvents()` auto-resolves `startLedger` from `getCheckpoint()`, restarting the Node process is usually sufficient. To trigger replay manually in a REPL or migration script:

```typescript
import { EventIndexer } from './src/services/eventIndexer';

const indexer = new EventIndexer(
  process.env.SOROBAN_RPC_URL!,
  process.env.CONTRACT_ID!,
);

const checkpoint = await indexer.getCheckpoint();
const replayFrom = indexer.getSafeReplayLedger(checkpoint);

console.log(`Replaying from ledger ${replayFrom} (checkpoint was ${checkpoint})`);
await indexer.fetchAndStoreEvents(replayFrom);
```

### Step 5 — VERIFY

After replay completes, confirm counts look reasonable:

```sql
SELECT type, COUNT(*) FROM "Event" GROUP BY type ORDER BY type;
SELECT MAX("ledgerTimestamp") AS new_checkpoint FROM "Event";
```

The `new_checkpoint` should be at or above the latest ledger from the RPC server. The event counts should be equal to or greater than their pre-recovery values (never lower, because duplicates are skipped not removed).

---

## Testnet Walkthrough

The following shows what a healthy indexer run looks like on testnet. These are the actual `console.log` lines emitted by `fetchAndStoreEvents`.

```
Replaying from ledger 1048 (checkpoint was 1050)
Found 7 events
Stored event: subscribed for merchant GCMERCHANT...ABCD
Stored event: executed for merchant GCMERCHANT...ABCD
Stored event: executed for merchant GCMERCHANT...ABCD
Stored event: subscribed for merchant GCMERCHANT...EFGH
Events processed successfully
```

Lines that say "Stored event" indicate new records were written. Events on ledgers 1048–1050 that were already in the database produce no output (the `processEvent` method returns early on duplicates without logging).

If the indexer is fully caught up and no new events have occurred since the last run:

```
No new events found
```

---

## Verification Before Resuming Normal Operation

Before re-enabling the cron job or redeploying the indexer:

1. **Confirm checkpoint advances**: wait for one indexer cycle and re-query `MAX("ledgerTimestamp")`. It should be higher than before.
2. **Confirm no duplicate summaries**: run `SELECT merchant, type, DATE("startDate"), COUNT(*) FROM "PayoutSummary" GROUP BY merchant, type, DATE("startDate") HAVING COUNT(*) > 1`. Duplicates here indicate the payout summary generator also needs attention.
3. **Check application logs** for any `Error processing event` lines that might indicate XDR decoding failures on new event shapes after a contract upgrade.
4. **Audit log consistency**: verify that every `executed` event in the `Event` table has a corresponding entry in the audit log (accessible via `GET /api/audit-logs`).

---

## Reference

| Constant | Value | Description |
|---|---|---|
| `REPLAY_BUFFER` | 2 | Ledgers subtracted from checkpoint to form safe replay start |
| Duplicate check fields | `type`, `subscriber`, `merchant`, `token`, `amount`, `ledgerTimestamp` | All six must match for a record to be considered a duplicate |
| Cron schedule | Every 5 minutes | Configured in `src/index.ts` |

See also: [`eventIndexer.ts`](../src/services/eventIndexer.ts), [`schema.prisma`](../prisma/schema.prisma).
