/**
 * #712 — Settlement Aggregation Service
 *
 * Aggregates executed payment events into settlement batches grouped by:
 *   - merchant
 *   - currency (token address)
 *   - settlement window (configurable, default 24 h)
 *
 * Supports:
 *   - Net settlement amount calculation (gross − fee)
 *   - Partial settlement handling
 *   - Full status lifecycle: pending → processing → partial | confirmed | failed
 *   - Actionable settlement instruction generation
 *   - Multi-currency net settlement (one batch per currency per merchant per window)
 *   - Confirmation and acknowledgment
 */

import prisma from '../lib/prisma';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SettlementStatus =
  | 'pending'
  | 'processing'
  | 'partial'
  | 'confirmed'
  | 'failed';

export interface SettlementInstruction {
  batchRef: string;
  merchant: string;
  currency: string;
  netAmount: string;
  feeAmount: string;
  grossAmount: string;
  paymentCount: number;
  windowStart: string;
  windowEnd: string;
  payments: Array<{
    transactionHash: string;
    subscriber: string;
    amount: string;
    ledgerTimestamp: string;
  }>;
  generatedAt: string;
}

export interface AggregateOptions {
  /** Window size in seconds. Default: 86 400 (24 h). */
  windowSizeSeconds?: number;
  /** Fee rate as a decimal fraction (e.g. 0.005 for 0.5%). Default: 0. */
  feeRate?: number;
  /** Only aggregate events up to this date. Default: now. */
  upTo?: Date;
}

export interface PartialSettlementOptions {
  /** Amount to mark as paid in this partial settlement (bigint as string). */
  paidAmount: string;
  reason?: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class SettlementAggregator {
  private feeRate: number;
  private windowSizeSeconds: number;

  constructor(opts: Pick<AggregateOptions, 'feeRate' | 'windowSizeSeconds'> = {}) {
    this.feeRate = opts.feeRate ?? 0;
    this.windowSizeSeconds = opts.windowSizeSeconds ?? 86_400;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Scan the `executed` event log and create SettlementBatch records for any
   * payment that hasn't been assigned to a batch yet.
   *
   * Safe to call repeatedly — idempotent via `batchRef` unique constraint.
   */
  async aggregatePendingPayments(opts: AggregateOptions = {}): Promise<number> {
    const windowSec = opts.windowSizeSeconds ?? this.windowSizeSeconds;
    const feeRate = opts.feeRate ?? this.feeRate;
    const upTo = opts.upTo ?? new Date();

    // Fetch all executed events not yet assigned to a settlement payment record
    const existingHashes = (
      await prisma.settlementPayment.findMany({ select: { transactionHash: true } })
    ).map((sp: { transactionHash: string }) => sp.transactionHash);

    const events = await prisma.event.findMany({
      where: {
        type: 'executed',
        ledgerTimestamp: { lte: BigInt(Math.floor(upTo.getTime() / 1000)) },
        ...(existingHashes.length > 0
          ? { NOT: { transactionHash: { in: existingHashes } } }
          : {}),
      },
      orderBy: { ledgerTimestamp: 'asc' },
    });

    // Group events into windows: key = "merchant:currency:windowIndex"
    const groups = new Map<
      string,
      {
        merchant: string;
        currency: string;
        windowStart: Date;
        windowEnd: Date;
        events: typeof events;
      }
    >();

    for (const ev of events) {
      const windowIndex = Math.floor(Number(ev.ledgerTimestamp) / windowSec);
      const windowStart = new Date(windowIndex * windowSec * 1000);
      const windowEnd = new Date((windowIndex + 1) * windowSec * 1000);
      const key = `${ev.merchant}:${ev.token}:${windowIndex}`;

      if (!groups.has(key)) {
        groups.set(key, {
          merchant: ev.merchant,
          currency: ev.token,
          windowStart,
          windowEnd,
          events: [],
        });
      }
      groups.get(key)!.events.push(ev);
    }

    let created = 0;

    for (const [, group] of groups) {
      const gross = group.events.reduce((acc: bigint, ev: { amount: string }) => acc + BigInt(ev.amount), 0n);
      const fee = BigInt(Math.floor(Number(gross) * feeRate));
      const net = gross - fee;
      const batchRef = this.buildBatchRef(group.merchant, group.currency, group.windowStart);

      // Upsert the batch (idempotent)
      const batch = await prisma.settlementBatch.upsert({
        where: { batchRef },
        update: {
          grossAmount: gross.toString(),
          feeAmount: fee.toString(),
          netAmount: net.toString(),
          paymentCount: group.events.length,
          updatedAt: new Date(),
        },
        create: {
          batchRef,
          merchant: group.merchant,
          currency: group.currency,
          windowStart: group.windowStart,
          windowEnd: group.windowEnd,
          grossAmount: gross.toString(),
          feeAmount: fee.toString(),
          netAmount: net.toString(),
          paymentCount: group.events.length,
          status: 'pending',
        },
      });

      // Link payments to the batch
      for (const ev of group.events) {
        await prisma.settlementPayment.upsert({
          where: { transactionHash: ev.transactionHash ?? `${ev.id}` },
          update: {},
          create: {
            batchId: batch.id,
            transactionHash: ev.transactionHash ?? `${ev.id}`,
            subscriber: ev.subscriber,
            merchant: ev.merchant,
            amount: ev.amount,
            currency: ev.token,
            ledgerTimestamp: ev.ledgerTimestamp,
          },
        });
      }

      // Build and cache settlement instructions
      const instruction = await this.buildInstructions(batch.id);
      await prisma.settlementBatch.update({
        where: { id: batch.id },
        data: { instructions: JSON.stringify(instruction) },
      });

      created++;
    }

    return created;
  }

  /**
   * Return all batches for a merchant, optionally filtered by status.
   */
  async getBatchesForMerchant(
    merchant: string,
    status?: SettlementStatus,
  ) {
    return prisma.settlementBatch.findMany({
      where: { merchant, ...(status ? { status } : {}) },
      include: { payments: true, statusHistory: true },
      orderBy: { windowStart: 'desc' },
    });
  }

  /**
   * Transition a batch from pending → processing → confirmed.
   * Validates the transition is legal before persisting.
   */
  async advanceStatus(
    batchRef: string,
    toStatus: SettlementStatus,
    reason?: string,
  ) {
    const batch = await this.getBatchOrThrow(batchRef);
    this.assertTransitionAllowed(batch.status as SettlementStatus, toStatus);

    await prisma.$transaction([
      prisma.settlementBatch.update({
        where: { batchRef },
        data: {
          status: toStatus,
          confirmedAt: toStatus === 'confirmed' ? new Date() : undefined,
          updatedAt: new Date(),
        },
      }),
      prisma.settlementStatusHistory.create({
        data: {
          batchId: batch.id,
          fromStatus: batch.status,
          toStatus,
          reason,
        },
      }),
    ]);

    console.log(`[settlement] batch ${batchRef}: ${batch.status} → ${toStatus}`);
    return prisma.settlementBatch.findUnique({ where: { batchRef } });
  }

  /**
   * Record a partial settlement — part of the net amount has been paid out.
   * Transitions status to "partial" unless the entire amount is now covered.
   */
  async applyPartialSettlement(
    batchRef: string,
    opts: PartialSettlementOptions,
  ) {
    const batch = await this.getBatchOrThrow(batchRef);

    if (!['pending', 'processing', 'partial'].includes(batch.status)) {
      throw new Error(
        `Cannot apply partial settlement to a batch in status "${batch.status}"`,
      );
    }

    const previousPaid = BigInt(batch.partialPaidAmount);
    const newPaid = previousPaid + BigInt(opts.paidAmount);
    const netAmount = BigInt(batch.netAmount);
    const isFullyPaid = newPaid >= netAmount;

    const nextStatus: SettlementStatus = isFullyPaid ? 'confirmed' : 'partial';

    await prisma.$transaction([
      prisma.settlementBatch.update({
        where: { batchRef },
        data: {
          partialPaidAmount: newPaid.toString(),
          status: nextStatus,
          confirmedAt: isFullyPaid ? new Date() : undefined,
          updatedAt: new Date(),
        },
      }),
      prisma.settlementStatusHistory.create({
        data: {
          batchId: batch.id,
          fromStatus: batch.status,
          toStatus: nextStatus,
          reason: opts.reason ?? `Partial payment of ${opts.paidAmount}`,
        },
      }),
    ]);

    return prisma.settlementBatch.findUnique({ where: { batchRef } });
  }

  /**
   * Confirm and acknowledge a batch — final state.
   */
  async confirmBatch(batchRef: string, reason?: string) {
    return this.advanceStatus(batchRef, 'confirmed', reason ?? 'Manual confirmation');
  }

  /**
   * Mark a batch as failed (e.g. bank rejection).
   */
  async failBatch(batchRef: string, reason: string) {
    return this.advanceStatus(batchRef, 'failed', reason);
  }

  /**
   * Generate multi-currency net settlement report for a merchant across all
   * confirmed batches in a date range.
   */
  async getNetSettlementReport(
    merchant: string,
    from: Date,
    to: Date,
  ): Promise<
    Array<{
      currency: string;
      grossAmount: string;
      feeAmount: string;
      netAmount: string;
      batchCount: number;
      paymentCount: number;
    }>
  > {
    const batches = await prisma.settlementBatch.findMany({
      where: {
        merchant,
        status: 'confirmed',
        windowStart: { gte: from },
        windowEnd: { lte: to },
      },
    });

    // Aggregate by currency
    const byCurrency = new Map<
      string,
      { gross: bigint; fee: bigint; net: bigint; batchCount: number; paymentCount: number }
    >();

    for (const b of batches) {
      const cur = b.currency;
      if (!byCurrency.has(cur)) {
        byCurrency.set(cur, { gross: 0n, fee: 0n, net: 0n, batchCount: 0, paymentCount: 0 });
      }
      const agg = byCurrency.get(cur)!;
      agg.gross += BigInt(b.grossAmount);
      agg.fee += BigInt(b.feeAmount);
      agg.net += BigInt(b.netAmount);
      agg.batchCount++;
      agg.paymentCount += b.paymentCount;
    }

    return Array.from(byCurrency.entries()).map(([currency, agg]) => ({
      currency,
      grossAmount: agg.gross.toString(),
      feeAmount: agg.fee.toString(),
      netAmount: agg.net.toString(),
      batchCount: agg.batchCount,
      paymentCount: agg.paymentCount,
    }));
  }

  /**
   * Retrieve the settlement instructions for a batch.
   */
  async getInstructions(batchRef: string): Promise<SettlementInstruction> {
    const batch = await this.getBatchOrThrow(batchRef);

    if (batch.instructions) {
      return JSON.parse(batch.instructions) as SettlementInstruction;
    }

    // Rebuild on demand
    const instruction = await this.buildInstructions(batch.id);
    await prisma.settlementBatch.update({
      where: { id: batch.id },
      data: { instructions: JSON.stringify(instruction) },
    });
    return instruction;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async getBatchOrThrow(batchRef: string) {
    const batch = await prisma.settlementBatch.findUnique({ where: { batchRef } });
    if (!batch) throw new Error(`Settlement batch not found: ${batchRef}`);
    return batch;
  }

  /** Valid status transitions for the settlement lifecycle. */
  private readonly ALLOWED_TRANSITIONS: Record<SettlementStatus, SettlementStatus[]> = {
    pending: ['processing', 'failed'],
    processing: ['partial', 'confirmed', 'failed'],
    partial: ['confirmed', 'failed'],
    confirmed: [],        // terminal
    failed: ['pending'],  // allow retry
  };

  private assertTransitionAllowed(from: SettlementStatus, to: SettlementStatus) {
    const allowed = this.ALLOWED_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new Error(
        `Invalid settlement status transition: ${from} → ${to}. ` +
          `Allowed: ${allowed.join(', ') || 'none (terminal state)'}`,
      );
    }
  }

  private buildBatchRef(merchant: string, currency: string, windowStart: Date): string {
    const date = windowStart.toISOString().slice(0, 10);
    const shortCur = currency.slice(-8);
    const shortMerchant = merchant.slice(0, 8);
    return `SETTLE-${date}-${shortCur}-${shortMerchant}`;
  }

  private async buildInstructions(batchId: number): Promise<SettlementInstruction> {
    const batch = await prisma.settlementBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: { payments: true },
    });

    return {
      batchRef: batch.batchRef,
      merchant: batch.merchant,
      currency: batch.currency,
      netAmount: batch.netAmount,
      feeAmount: batch.feeAmount,
      grossAmount: batch.grossAmount,
      paymentCount: batch.paymentCount,
      windowStart: batch.windowStart.toISOString(),
      windowEnd: batch.windowEnd.toISOString(),
      payments: (batch.payments as Array<{
        transactionHash: string;
        subscriber: string;
        amount: string;
        ledgerTimestamp: bigint;
      }>).map((p) => ({
        transactionHash: p.transactionHash,
        subscriber: p.subscriber,
        amount: p.amount,
        ledgerTimestamp: p.ledgerTimestamp.toString(),
      })),
      generatedAt: new Date().toISOString(),
    };
  }
}
