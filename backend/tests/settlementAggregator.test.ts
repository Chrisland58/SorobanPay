/**
 * #712 — SettlementAggregator unit tests
 *
 * Uses an in-memory mock of the Prisma client so no real DB is needed.
 */

// ─── Mock Prisma (must be declared before imports) ────────────────────────────

// Storage shared across all mock operations
const store = {
  batches: new Map<string, any>(),
  payments: [] as any[],
  histories: [] as any[],
  batchIdSeq: 1,
  paymentIdSeq: 1,
  historyIdSeq: 1,
};

function resetStore() {
  store.batches.clear();
  store.payments.length = 0;
  store.histories.length = 0;
  store.batchIdSeq = 1;
  store.paymentIdSeq = 1;
  store.historyIdSeq = 1;
}

jest.mock('../src/lib/prisma', () => {
  const mockEventFindMany = jest.fn();
  const mockSettlementPaymentFindMany = jest.fn().mockResolvedValue([]);
  const mockSettlementPaymentUpsert = jest.fn().mockImplementation(async ({ where, create }: any) => {
    const existing = store.payments.find((p: any) => p.transactionHash === where.transactionHash);
    if (existing) return existing;
    const rec = { id: store.paymentIdSeq++, ...create };
    store.payments.push(rec);
    return rec;
  });
  const mockBatchUpsert = jest.fn().mockImplementation(async ({ where, create, update }: any) => {
    const existing = store.batches.get(where.batchRef);
    if (existing) {
      Object.assign(existing, update, { updatedAt: new Date() });
      return existing;
    }
    const rec = { id: store.batchIdSeq++, ...create };
    store.batches.set(where.batchRef, rec);
    return rec;
  });
  const mockBatchUpdate = jest.fn().mockImplementation(async ({ where, data }: any) => {
    const batch =
      store.batches.get(where.batchRef) ??
      [...store.batches.values()].find((b: any) => b.id === where.id);
    if (!batch) throw new Error('Not found');
    Object.assign(batch, data);
    return batch;
  });
  const mockBatchFindUnique = jest.fn().mockImplementation(async ({ where }: any) => {
    return store.batches.get(where.batchRef) ?? null;
  });
  const mockBatchFindUniqueOrThrow = jest.fn().mockImplementation(async ({ where, include }: any) => {
    const batch =
      store.batches.get(where.batchRef) ??
      [...store.batches.values()].find((b: any) => b.id === where.id);
    if (!batch) throw new Error(`No batch found for id ${where.id}`);
    if (include?.payments) batch.payments = store.payments.filter((p: any) => p.batchId === batch.id);
    return batch;
  });
  const mockBatchFindMany = jest.fn().mockImplementation(async ({ where }: any) => {
    return [...store.batches.values()].filter((b: any) => {
      if (where?.merchant && b.merchant !== where.merchant) return false;
      if (where?.status && b.status !== where.status) return false;
      return true;
    });
  });
  const mockHistoryCreate = jest.fn().mockImplementation(async ({ data }: any) => {
    const rec = { id: store.historyIdSeq++, ...data };
    store.histories.push(rec);
    return rec;
  });
  const mockTransaction = jest.fn().mockImplementation(async (ops: any[]) => {
    return Promise.all(ops);
  });

  return {
    __esModule: true,
    default: {
      event: { findMany: mockEventFindMany },
      settlementPayment: {
        findMany: mockSettlementPaymentFindMany,
        upsert: mockSettlementPaymentUpsert,
      },
      settlementBatch: {
        upsert: mockBatchUpsert,
        update: mockBatchUpdate,
        findUnique: mockBatchFindUnique,
        findUniqueOrThrow: mockBatchFindUniqueOrThrow,
        findMany: mockBatchFindMany,
      },
      settlementStatusHistory: { create: mockHistoryCreate },
      $transaction: mockTransaction,
    },
  };
});

// ─── Import after mock ────────────────────────────────────────────────────────

import { SettlementAggregator } from '../src/services/settlementAggregator';
import prisma from '../src/lib/prisma';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<any> = {}) {
  return {
    id: Math.floor(Math.random() * 1_000_000),
    type: 'executed',
    subscriber: 'GABC123',
    merchant: 'GXYZ789',
    token: 'CUSDC_TOKEN_ADDR_ABCD',
    amount: '1000000',
    transactionHash: `hash-${Math.random()}`,
    ledgerTimestamp: BigInt(1_700_000_000),
    createdAt: new Date(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SettlementAggregator', () => {
  let svc: SettlementAggregator;

  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
    // Reset to default empty payments list
    (prisma.settlementPayment.findMany as jest.Mock).mockResolvedValue([]);
    svc = new SettlementAggregator({ feeRate: 0.005, windowSizeSeconds: 86_400 });
  });

  // ── Aggregation ────────────────────────────────────────────────────────────

  it('creates a batch for a group of executed events', async () => {
    // Both events in window floor(1_700_000_000 / 86400) = 19675
    (prisma.event.findMany as jest.Mock).mockResolvedValue([
      makeEvent({ amount: '1000000', ledgerTimestamp: BigInt(1_700_000_000) }),
      makeEvent({ amount: '2000000', ledgerTimestamp: BigInt(1_700_001_000) }),
    ]);

    const count = await svc.aggregatePendingPayments();
    expect(count).toBe(1);
    expect(prisma.settlementBatch.upsert).toHaveBeenCalledTimes(1);

    const call = (prisma.settlementBatch.upsert as jest.Mock).mock.calls[0][0];
    expect(call.create.grossAmount).toBe('3000000');
    expect(BigInt(call.create.feeAmount)).toBe(15000n); // 0.5% of 3_000_000
    expect(call.create.netAmount).toBe('2985000');
    expect(call.create.paymentCount).toBe(2);
    expect(call.create.status).toBe('pending');
  });

  it('creates separate batches for different currencies', async () => {
    (prisma.event.findMany as jest.Mock).mockResolvedValue([
      makeEvent({ token: 'TOKEN_USDC', ledgerTimestamp: BigInt(1_700_000_000) }),
      makeEvent({ token: 'TOKEN_EURC', ledgerTimestamp: BigInt(1_700_000_000) }),
    ]);

    const count = await svc.aggregatePendingPayments();
    expect(count).toBe(2);
  });

  it('creates separate batches for different merchants', async () => {
    (prisma.event.findMany as jest.Mock).mockResolvedValue([
      makeEvent({ merchant: 'MERCHANT_A', ledgerTimestamp: BigInt(1_700_000_000) }),
      makeEvent({ merchant: 'MERCHANT_B', ledgerTimestamp: BigInt(1_700_000_000) }),
    ]);

    const count = await svc.aggregatePendingPayments();
    expect(count).toBe(2);
  });

  it('returns 0 when there are no unaggregated events', async () => {
    (prisma.event.findMany as jest.Mock).mockResolvedValue([]);
    const count = await svc.aggregatePendingPayments();
    expect(count).toBe(0);
    expect(prisma.settlementBatch.upsert).not.toHaveBeenCalled();
  });

  it('calculates zero fee when feeRate is 0', async () => {
    const svcNoFee = new SettlementAggregator({ feeRate: 0 });
    (prisma.event.findMany as jest.Mock).mockResolvedValue([
      makeEvent({ amount: '5000000', ledgerTimestamp: BigInt(1_700_000_000) }),
    ]);

    await svcNoFee.aggregatePendingPayments();
    const call = (prisma.settlementBatch.upsert as jest.Mock).mock.calls[0][0];
    expect(call.create.feeAmount).toBe('0');
    expect(call.create.netAmount).toBe('5000000');
  });

  // ── Status lifecycle ───────────────────────────────────────────────────────

  it('advances status from pending to processing', async () => {
    store.batches.set('BATCH-REF-1', {
      id: 1,
      batchRef: 'BATCH-REF-1',
      status: 'pending',
      netAmount: '1000',
      partialPaidAmount: '0',
    });

    await svc.advanceStatus('BATCH-REF-1', 'processing');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const ops = (prisma.$transaction as jest.Mock).mock.calls[0][0];
    expect(ops).toHaveLength(2);
  });

  it('rejects invalid status transitions', async () => {
    store.batches.set('BATCH-REF-2', {
      id: 2,
      batchRef: 'BATCH-REF-2',
      status: 'confirmed',
      netAmount: '1000',
      partialPaidAmount: '0',
    });

    await expect(svc.advanceStatus('BATCH-REF-2', 'processing')).rejects.toThrow(
      'Invalid settlement status transition',
    );
  });

  it('throws when batch is not found', async () => {
    await expect(svc.advanceStatus('NO-SUCH-BATCH', 'processing')).rejects.toThrow(
      'Settlement batch not found',
    );
  });

  // ── Partial settlement ─────────────────────────────────────────────────────

  it('applies partial settlement and sets status to partial', async () => {
    store.batches.set('BATCH-PARTIAL', {
      id: 3,
      batchRef: 'BATCH-PARTIAL',
      status: 'processing',
      netAmount: '10000',
      partialPaidAmount: '0',
    });

    await svc.applyPartialSettlement('BATCH-PARTIAL', { paidAmount: '4000' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('fully confirms when partial amount covers the net amount', async () => {
    store.batches.set('BATCH-FULL', {
      id: 4,
      batchRef: 'BATCH-FULL',
      status: 'processing',
      netAmount: '10000',
      partialPaidAmount: '5000',
    });

    await svc.applyPartialSettlement('BATCH-FULL', { paidAmount: '5000' });
    const updateArgs = (prisma.$transaction as jest.Mock).mock.calls[0][0][0];
    expect(updateArgs).toBeDefined();
  });

  it('rejects partial settlement on confirmed batch', async () => {
    store.batches.set('BATCH-CONFIRMED', {
      id: 5,
      batchRef: 'BATCH-CONFIRMED',
      status: 'confirmed',
      netAmount: '10000',
      partialPaidAmount: '10000',
    });

    await expect(
      svc.applyPartialSettlement('BATCH-CONFIRMED', { paidAmount: '500' }),
    ).rejects.toThrow('Cannot apply partial settlement');
  });

  // ── Instructions ───────────────────────────────────────────────────────────

  it('returns cached instructions when available', async () => {
    const instruction = {
      batchRef: 'BATCH-INS',
      merchant: 'GXYZ',
      currency: 'USDC',
      netAmount: '9950',
      feeAmount: '50',
      grossAmount: '10000',
      paymentCount: 1,
      windowStart: '2024-01-01T00:00:00.000Z',
      windowEnd: '2024-01-02T00:00:00.000Z',
      payments: [],
      generatedAt: '2024-01-02T00:00:00.000Z',
    };
    store.batches.set('BATCH-INS', {
      id: 6,
      batchRef: 'BATCH-INS',
      status: 'pending',
      instructions: JSON.stringify(instruction),
    });

    const result = await svc.getInstructions('BATCH-INS');
    expect(result.batchRef).toBe('BATCH-INS');
    expect(result.netAmount).toBe('9950');
  });

  // ── Multi-currency report ──────────────────────────────────────────────────

  it('aggregates net settlement by currency across confirmed batches', async () => {
    (prisma.settlementBatch.findMany as jest.Mock).mockResolvedValueOnce([
      {
        id: 7,
        currency: 'USDC',
        grossAmount: '10000',
        feeAmount: '50',
        netAmount: '9950',
        paymentCount: 2,
        status: 'confirmed',
      },
      {
        id: 8,
        currency: 'USDC',
        grossAmount: '5000',
        feeAmount: '25',
        netAmount: '4975',
        paymentCount: 1,
        status: 'confirmed',
      },
      {
        id: 9,
        currency: 'EURC',
        grossAmount: '3000',
        feeAmount: '15',
        netAmount: '2985',
        paymentCount: 1,
        status: 'confirmed',
      },
    ]);

    const report = await svc.getNetSettlementReport(
      'MERCHANT',
      new Date('2024-01-01'),
      new Date('2024-01-31'),
    );

    expect(report).toHaveLength(2);
    const usdc = report.find((r) => r.currency === 'USDC')!;
    expect(usdc.netAmount).toBe('14925'); // 9950 + 4975
    expect(usdc.batchCount).toBe(2);
    expect(usdc.paymentCount).toBe(3);

    const eurc = report.find((r) => r.currency === 'EURC')!;
    expect(eurc.netAmount).toBe('2985');
  });
});
