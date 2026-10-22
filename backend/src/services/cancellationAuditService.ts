/**
 * #1382 — Cancellation audit trail service.
 *
 * Persists every on-chain `cancel` event to the `CancellationAudit` table.
 * Records are immutable audit entries — they are never deleted until the
 * configured retention policy elapses (AUDIT_RETENTION_YEARS, default: 7).
 *
 * Design notes:
 *   - Writes are idempotent: upsert on (network, transactionHash) ensures
 *     duplicate inserts from retries or re-processing are safe.
 *   - Reason text is validated to ≤ 1000 characters server-side.
 *   - pruneExpiredAuditRecords() is intended to run as a scheduled job
 *     (e.g., weekly cron) — never call it per-request.
 */

import prisma from '../lib/prisma';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CancellationAuditInput {
  network: string;
  contractId: string;
  subscriberAddress: string;
  merchantAddress: string;
  tokenAddress?: string;
  amount?: string;
  intervalSeconds?: bigint;
  nextPaymentAt?: Date;
  ledger: bigint;
  transactionHash: string;
  reason?: string;
  source?: string;
}

export interface CancellationAuditRecord {
  id: string;
  network: string;
  contractId: string;
  subscriberAddress: string;
  merchantAddress: string;
  tokenAddress: string | null;
  amount: string | null;
  intervalSeconds: bigint | null;
  nextPaymentAt: Date | null;
  cancelledAt: Date;
  ledger: bigint;
  transactionHash: string;
  reason: string | null;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListCancellationsOptions {
  merchantAddress?: string;
  subscriberAddress?: string;
  network?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export interface ListCancellationsResult {
  data: CancellationAuditRecord[];
  total: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// recordCancellation
// ---------------------------------------------------------------------------

/**
 * Write a cancellation audit record.
 *
 * Idempotent: if a record with the same (network, transactionHash) already
 * exists, returns the existing record without error or side effects.
 *
 * @param input Cancellation event details
 * @returns The created or existing CancellationAuditRecord
 */
export async function recordCancellation(
  input: CancellationAuditInput,
): Promise<CancellationAuditRecord> {
  const {
    network,
    contractId,
    subscriberAddress,
    merchantAddress,
    tokenAddress,
    amount,
    intervalSeconds,
    nextPaymentAt,
    ledger,
    transactionHash,
    reason,
    source = 'event',
  } = input;

  // Validate reason length before hitting the DB
  if (reason !== undefined && reason !== null && reason.length > 1000) {
    throw new Error('reason must not exceed 1000 characters');
  }

  // Upsert: create on first write, no-op on duplicate transactionHash
  const record = await (prisma as any).cancellationAudit.upsert({
    where: { network_tx_hash: { network, transactionHash } },
    create: {
      network,
      contractId,
      subscriberAddress,
      merchantAddress,
      tokenAddress:    tokenAddress    ?? null,
      amount:          amount          ?? null,
      intervalSeconds: intervalSeconds ?? null,
      nextPaymentAt:   nextPaymentAt   ?? null,
      ledger,
      transactionHash,
      reason:          reason          ?? null,
      source,
    },
    update: {}, // Audit records are immutable — ignore conflicts
  });

  return record as CancellationAuditRecord;
}

// ---------------------------------------------------------------------------
// listCancellations
// ---------------------------------------------------------------------------

/**
 * Return a paginated, filterable list of cancellation audit records.
 * Records are ordered by cancelledAt descending (newest first).
 */
export async function listCancellations(
  options: ListCancellationsOptions = {},
): Promise<ListCancellationsResult> {
  const {
    merchantAddress,
    subscriberAddress,
    network,
    from,
    to,
    limit  = 50,
    offset = 0,
  } = options;

  const where: Record<string, unknown> = {};

  if (merchantAddress)   where.merchantAddress   = merchantAddress;
  if (subscriberAddress) where.subscriberAddress = subscriberAddress;
  if (network)           where.network           = network;
  if (from || to) {
    where.cancelledAt = {
      ...(from && { gte: from }),
      ...(to   && { lte: to   }),
    };
  }

  const cappedLimit = Math.min(Math.max(1, limit), 200);

  const [data, total] = await (prisma as any).$transaction([
    (prisma as any).cancellationAudit.findMany({
      where,
      orderBy: { cancelledAt: 'desc' },
      take: cappedLimit,
      skip: Math.max(0, offset),
    }),
    (prisma as any).cancellationAudit.count({ where }),
  ]);

  return {
    data:   data as CancellationAuditRecord[],
    total:  total as number,
    limit:  cappedLimit,
    offset: Math.max(0, offset),
  };
}

// ---------------------------------------------------------------------------
// pruneExpiredAuditRecords
// ---------------------------------------------------------------------------

/**
 * Delete cancellation audit records older than the retention period.
 * Run as a scheduled maintenance job — never call per-request.
 *
 * @param retentionYears Years to keep records (default: AUDIT_RETENTION_YEARS env or 7)
 * @returns Number of records deleted
 */
export async function pruneExpiredAuditRecords(
  retentionYears?: number,
): Promise<number> {
  const years =
    retentionYears ??
    parseInt(process.env.AUDIT_RETENTION_YEARS ?? '7', 10);

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - years);

  const result = await (prisma as any).cancellationAudit.deleteMany({
    where: { cancelledAt: { lt: cutoff } },
  });

  return (result as { count: number }).count;
}
