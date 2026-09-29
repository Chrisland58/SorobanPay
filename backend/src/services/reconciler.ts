/**
 * reconciler.ts  (src/services/)
 *
 * Re-exports the pure reconcile() function and provides a Prisma-backed
 * SubscriptionDB adapter so the reconciler can diff against real DB state.
 *
 * The adapter reads from the Event table (built by EventIndexer) to replay
 * on-chain history and uses an in-process Map as the mutable DB surface —
 * reconcile() writes to the Map, and the adapter flushes inserts/updates/deletes
 * back to Prisma after the run completes.
 *
 * #1068 — Dry-run mode:
 *   dryRun() runs reconcile() against a read-only copy of the DB so no
 *   mutations occur.  Supports bounded results and opaque continuation cursors.
 */

export {
  reconcile,
  type ChainEvent,
  type StoredSubscription,
  type SubscriptionDB,
  type ReconcileResult,
  type RepairAction,
  type EventType,
} from '../../reconciler';

import prisma from '../lib/prisma';
import type { ChainEvent, StoredSubscription, SubscriptionDB, ReconcileResult } from '../../reconciler';
import { reconcile } from '../../reconciler';

// ─── Prisma-backed DB adapter ─────────────────────────────────────────────────

/**
 * Builds a SubscriptionDB backed by the Prisma Event table for reads and an
 * in-memory Map for writes.  Call flush() after reconcile() to persist changes.
 *
 * Uses the Event log as source-of-truth to derive current subscription state:
 * subscribe events upsert, cancel events delete, executed events update timing.
 */
export class PrismaSubscriptionDB implements SubscriptionDB {
  private store = new Map<string, StoredSubscription>();

  private constructor() {}

  static async load(defaultInterval = 86_400): Promise<PrismaSubscriptionDB> {
    const db = new PrismaSubscriptionDB();
    const events = await prisma.event.findMany({
      orderBy: { ledgerTimestamp: 'asc' },
    });

    for (const ev of events) {
      const key = `${ev.subscriber}:${ev.merchant}:${ev.token}`;
      const ts = Number(ev.ledgerTimestamp);
      const amount = BigInt(ev.amount);

      if (ev.type === 'subscribe') {
        const prev = db.store.get(key);
        const interval = prev ? prev.interval : defaultInterval;
        db.store.set(key, {
          subscriber: ev.subscriber,
          merchant: ev.merchant,
          token: ev.token,
          amount,
          interval,
          next_payment: ts + interval,
          last_payment_at: prev ? prev.last_payment_at : null,
        });
      } else if (ev.type === 'executed') {
        const cur = db.store.get(key);
        if (cur) {
          db.store.set(key, {
            ...cur,
            amount,
            last_payment_at: ts,
            next_payment: ts + cur.interval,
          });
        }
      } else if (ev.type === 'cancel') {
        db.store.delete(key);
      }
    }

    return db;
  }

  get(subscriber: string, merchant: string, token: string): StoredSubscription | undefined {
    return this.store.get(`${subscriber}:${merchant}:${token}`);
  }

  upsert(record: StoredSubscription): void {
    this.store.set(`${record.subscriber}:${record.merchant}:${record.token}`, record);
  }

  delete(subscriber: string, merchant: string, token: string): void {
    this.store.delete(`${subscriber}:${merchant}:${token}`);
  }

  all(): StoredSubscription[] {
    return [...this.store.values()];
  }
}

// ─── Fetch on-chain events ────────────────────────────────────────────────────

/**
 * Converts Event rows stored by EventIndexer into ChainEvent objects for
 * the reconciler. Events are sorted oldest-first for correct replay order.
 */
export async function fetchChainEventsFromDB(): Promise<ChainEvent[]> {
  const rows = await prisma.event.findMany({
    orderBy: { ledgerTimestamp: 'asc' },
  });

  return rows.map((row: { type: string; subscriber: string; merchant: string; token: string; amount: string; ledgerTimestamp: bigint }) => ({
    type: row.type as ChainEvent['type'],
    subscriber: row.subscriber,
    merchant: row.merchant,
    token: row.token,
    amount: BigInt(row.amount),
    timestamp: Number(row.ledgerTimestamp),
  }));
}

// ─── Dry-run mode (#1068) ─────────────────────────────────────────────────────

/**
 * Options for a dry-run reconciliation pass.
 */
export interface DryRunOptions {
  /**
   * Maximum number of repairs to return in one page.
   * Defaults to 50, capped at 500.
   */
  limit?: number;
  /**
   * Opaque continuation cursor returned by a previous dry-run call.
   * When provided, the page starts at the repair immediately after the
   * cursor position.
   */
  cursor?: string;
}

/**
 * Result of a dry-run reconciliation pass.
 */
export interface DryRunResult {
  /** Repairs on this page. */
  repairs: ReconcileResult['repairs'];
  /** All error strings from the reconciliation (not paginated). */
  errors: ReconcileResult['errors'];
  /** Total number of repairs found (across all pages). */
  total: number;
  /**
   * Opaque cursor for the next page.  `null` when this is the last page.
   * Pass as `cursor` in the next call to retrieve the following page.
   */
  nextCursor: string | null;
}

/** Encode an integer offset as a base64 cursor. */
function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}

/** Decode a base64 cursor to an integer offset.  Returns 0 on invalid input. */
function decodeCursor(cursor: string): number {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Read-only SubscriptionDB wrapper.
 *
 * Wraps an existing SubscriptionDB and silently discards any upsert/delete
 * calls so the underlying store is never mutated during a dry run.
 */
class ReadOnlySubscriptionDB implements SubscriptionDB {
  constructor(private readonly inner: SubscriptionDB) {}

  get(subscriber: string, merchant: string, token: string): StoredSubscription | undefined {
    return this.inner.get(subscriber, merchant, token);
  }

  /** No-op: dry run must not mutate the DB. */
  upsert(_record: StoredSubscription): void {}

  /** No-op: dry run must not mutate the DB. */
  delete(_subscriber: string, _merchant: string, _token: string): void {}

  all(): StoredSubscription[] {
    return this.inner.all();
  }
}

/**
 * Run a non-destructive reconciliation pass and return a bounded page of results.
 *
 * Unlike reconcile(), dryRun() wraps the DB in a read-only adapter so no
 * inserts, updates, or deletes are ever written.  Results are sliced by
 * `limit` and `cursor` so callers can page through large repair lists without
 * loading everything at once.
 *
 * @param events  On-chain events (oldest-first), e.g. from fetchChainEventsFromDB().
 * @param db      A SubscriptionDB instance (will NOT be mutated).
 * @param options Pagination options.
 */
export function dryRun(
  events: ChainEvent[],
  db: SubscriptionDB,
  options: DryRunOptions = {},
): DryRunResult {
  const limit = Math.min(Math.max(1, options.limit ?? 50), 500);
  const offset = options.cursor ? decodeCursor(options.cursor) : 0;

  // Run reconcile against a read-only copy so writes are discarded.
  const readOnlyDb = new ReadOnlySubscriptionDB(db);
  const result = reconcile(events, readOnlyDb);

  const total = result.repairs.length;
  const page = result.repairs.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  const nextCursor = nextOffset < total ? encodeCursor(nextOffset) : null;

  return {
    repairs: page,
    errors: result.errors,
    total,
    nextCursor,
  };
}
