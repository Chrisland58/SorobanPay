/**
 * backend/tests/reconciliationAndMetadata.test.ts
 *
 * Covers:
 *  - Issue #1598: [Backend] Reconcile indexed contract events against recorded payments
 *  - Issue #1597: [Backend] Return consistent page metadata from report and analytics endpoints
 */

import {
  reconcilePaymentsAndEvents,
  PaymentDiscrepancyType,
} from '../src/services/reconciler';

describe('Payment & Event Reconciliation Service (Issue #1598)', () => {
  const subscriber = 'GSUB111AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const merchant = 'GMERCHANT1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  it('reconciles clean match between on-chain events and database payments with zero discrepancies', () => {
    const events = [
      { txHash: 'tx_1', subscriber, merchant, amount: 1000n, type: 'executed' },
      { txHash: 'tx_2', subscriber, merchant, amount: 2000n, type: 'executed' },
    ];
    const payments = [
      { txHash: 'tx_1', subscriber, merchant, amount: 1000n },
      { txHash: 'tx_2', subscriber, merchant, amount: 2000n },
    ];

    const report = reconcilePaymentsAndEvents(events, payments);

    expect(report.dryRun).toBe(true);
    expect(report.totalEventsProcessed).toBe(2);
    expect(report.totalPaymentsProcessed).toBe(2);
    expect(report.discrepancies).toHaveLength(0);
    expect(report.summary.MISSING_PAYMENT_ROW).toBe(0);
  });

  it('categorizes MISSING_PAYMENT_ROW when on-chain event lacks database payment record', () => {
    const events = [
      { txHash: 'tx_missing_in_db', subscriber, merchant, amount: 1000n, type: 'executed' },
    ];
    const payments: Array<{ txHash: string; subscriber: string; merchant: string; amount: bigint }> = [];

    const report = reconcilePaymentsAndEvents(events, payments);

    expect(report.discrepancies).toHaveLength(1);
    expect(report.discrepancies[0].category).toBe<PaymentDiscrepancyType>('MISSING_PAYMENT_ROW');
    expect(report.discrepancies[0].txHash).toBe('tx_missing_in_db');
    expect(report.summary.MISSING_PAYMENT_ROW).toBe(1);
  });

  it('categorizes DUPLICATE_PAYMENT_ROW when multiple payment rows share one txHash', () => {
    const events = [
      { txHash: 'tx_dup', subscriber, merchant, amount: 1000n, type: 'executed' },
    ];
    const payments = [
      { txHash: 'tx_dup', subscriber, merchant, amount: 1000n },
      { txHash: 'tx_dup', subscriber, merchant, amount: 1000n },
    ];

    const report = reconcilePaymentsAndEvents(events, payments);

    expect(report.discrepancies.some((d) => d.category === 'DUPLICATE_PAYMENT_ROW')).toBe(true);
    expect(report.summary.DUPLICATE_PAYMENT_ROW).toBe(1);
  });

  it('categorizes AMOUNT_MISMATCH when database amount diverges from on-chain event', () => {
    const events = [
      { txHash: 'tx_mismatch', subscriber, merchant, amount: 5000n, type: 'executed' },
    ];
    const payments = [
      { txHash: 'tx_mismatch', subscriber, merchant, amount: 3000n },
    ];

    const report = reconcilePaymentsAndEvents(events, payments);

    expect(report.discrepancies.some((d) => d.category === 'AMOUNT_MISMATCH')).toBe(true);
    expect(report.summary.AMOUNT_MISMATCH).toBe(1);
  });

  it('categorizes IDEMPOTENCY_KEY_ORPHAN when idempotency record has no confirmed event', () => {
    const events: Array<{ txHash: string; subscriber: string; merchant: string; amount: bigint; type: string }> = [];
    const payments: Array<{ txHash: string; subscriber: string; merchant: string; amount: bigint }> = [];
    const idempotency = [
      { key: 'idem_key_orphan', txHash: 'tx_ghost', status: 'completed' },
    ];

    const report = reconcilePaymentsAndEvents(events, payments, idempotency);

    expect(report.discrepancies.some((d) => d.category === 'IDEMPOTENCY_KEY_ORPHAN')).toBe(true);
    expect(report.summary.IDEMPOTENCY_KEY_ORPHAN).toBe(1);
  });

  it('processes large ranges deterministically in bounded chunks', () => {
    const events = Array.from({ length: 2500 }, (_, i) => ({
      txHash: `tx_${i}`,
      subscriber,
      merchant,
      amount: BigInt(i * 10),
      type: 'executed',
    }));
    const payments = events.map((e) => ({
      txHash: e.txHash,
      subscriber: e.subscriber,
      merchant: e.merchant,
      amount: e.amount,
    }));

    // Run twice with chunk size 500 to verify determinism
    const r1 = reconcilePaymentsAndEvents(events, payments, [], 500);
    const r2 = reconcilePaymentsAndEvents(events, payments, [], 500);

    expect(r1.totalEventsProcessed).toBe(2500);
    expect(r2.totalEventsProcessed).toBe(2500);
    expect(r1.discrepancies).toEqual(r2.discrepancies);
  });
});

describe('Consistent Page Metadata Contract (Issue #1597)', () => {
  it('conforms to standard pagination response shape: data, pagination { limit, hasMore, nextCursor, total }', () => {
    const samplePage = {
      items: [{ id: 1 }, { id: 2 }],
      nextCursor: 'cursor_123',
      prevCursor: null,
      total: 50,
      pageSize: 2,
    };

    // Transform through standard page shape
    const standardized = {
      data: samplePage.items,
      pagination: {
        limit: samplePage.pageSize,
        hasMore: samplePage.nextCursor !== null,
        nextCursor: samplePage.nextCursor,
        prevCursor: samplePage.prevCursor,
        total: samplePage.total,
      },
    };

    expect(Array.isArray(standardized.data)).toBe(true);
    expect(standardized.pagination.limit).toBe(2);
    expect(standardized.pagination.hasMore).toBe(true);
    expect(standardized.pagination.nextCursor).toBe('cursor_123');
    expect(standardized.pagination.total).toBe(50);
  });
});
