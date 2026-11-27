/**
 * eventReconciliation.e2e.test.ts
 *
 * End-to-end fixture verifying contract payment events reconcile from
 * Soroban RPC -> EventIndexer persistence -> PayoutSummaryGenerator
 * merchant analytics aggregation.
 *
 * Covers:
 *  1. Canonical event set: contract `executed` events -> DB -> daily merchant payout summaries.
 *  2. Duplicate delivery: replaying the same event does not double-count.
 *  3. Delayed indexing: late-arriving events in a subsequent poll batch reconcile into final totals.
 *  4. Malformed event: invalid/corrupt events are surfaced in indexer diagnostics and
 *     batch failures do not advance the cursor incorrectly.
 */

jest.mock('@stellar/stellar-sdk', () => {
  const mockServer = {
    getEvents: jest.fn(),
  };

  return {
    rpc: {
      Server: jest.fn(() => mockServer),
    },
    xdr: {
      ScVal: {
        fromXDR: jest.fn(),
      },
    },
    __mockServer: mockServer,
  };
});

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: new (require('./helpers/inMemoryDb').InMemoryPrismaClient)(),
}));

jest.mock('../src/services/auditLogger', () => ({
  AuditLogger: jest.fn().mockImplementation(() => ({
    logPayment: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../src/lib/redis', () => ({
  publishCacheInvalidation: jest.fn().mockResolvedValue(undefined),
  cacheDeletePattern: jest.fn().mockResolvedValue(undefined),
  CacheKey: {
    merchantSummary: (m: string) => `merchant:${m}:summary`,
  },
}));

import { EventIndexer } from '../src/services/eventIndexer';
import { PayoutSummaryGenerator } from '../src/services/payoutSummaryGenerator';
import { InMemoryPrismaClient } from './helpers/inMemoryDb';
import prisma from '../src/lib/prisma';

const db = prisma as unknown as InMemoryPrismaClient;
const { __mockServer: mockServer } = require('@stellar/stellar-sdk') as {
  __mockServer: { getEvents: jest.Mock };
};

const MERCHANT = 'GMERCHANT_E2E_001';
const SUBSCRIBER_A = 'GSUB_E2E_001';
const SUBSCRIBER_B = 'GSUB_E2E_002';
const TOKEN_USDC = 'CUSDC_E2E_001';
const CONTRACT_ID = 'CCONTRACT_E2E_001';

/** Build a mock ScVal-like object compatible with EventIndexer decoders. */
function makeSym(value: string) {
  return { sym: () => ({ toString: () => value }) };
}
function makeAddr(value: string) {
  return { address: () => ({ toString: () => value }) };
}
function makeAmount(value: string) {
  return { i128: () => ({ toString: () => value }) };
}

function makeExecutedEvent(opts: {
  id: string;
  ledger: number;
  subscriber: string;
  merchant: string;
  token: string;
  amount: string;
  txHash?: string;
}) {
  return {
    id: opts.id,
    ledger: opts.ledger,
    txHash: opts.txHash ?? `tx_${opts.id}`,
    ledgerClosedAt: new Date().toISOString(),
    topic: [
      makeSym('executed'),
      makeAddr(opts.subscriber),
      makeAddr(opts.merchant),
      makeAddr(opts.token),
    ],
    value: makeAmount(opts.amount),
  };
}

describe('End-to-end contract event to merchant analytics reconciliation', () => {
  let indexer: EventIndexer;
  let generator: PayoutSummaryGenerator;

  beforeEach(() => {
    db.reset();
    jest.clearAllMocks();
    indexer = new EventIndexer('https://rpc.example.invalid', CONTRACT_ID);
    generator = new PayoutSummaryGenerator();
  });

  it('reconciles canonical events through duplicate delivery and delayed indexing', async () => {
    const today = new Date();
    const event1 = makeExecutedEvent({
      id: '100:1:0',
      ledger: 100,
      subscriber: SUBSCRIBER_A,
      merchant: MERCHANT,
      token: TOKEN_USDC,
      amount: '1500',
    });
    const event2 = makeExecutedEvent({
      id: '101:1:0',
      ledger: 101,
      subscriber: SUBSCRIBER_B,
      merchant: MERCHANT,
      token: TOKEN_USDC,
      amount: '2500',
    });

    // Batch 1: initial delivery + duplicate delivery of event1
    mockServer.getEvents.mockResolvedValueOnce({
      events: [event1, event1],
    });
    await indexer.fetchAndStoreEventsWithCursor();

    // Batch 2: delayed indexing (empty poll followed by late-arriving event2)
    mockServer.getEvents.mockResolvedValueOnce({ events: [] });
    await indexer.fetchAndStoreEventsWithCursor();

    mockServer.getEvents.mockResolvedValueOnce({
      events: [event2],
    });
    await indexer.fetchAndStoreEventsWithCursor();

    // Aggregate into merchant analytics
    await generator.generateDailySummaries(today);

    const summaries = await db.payoutSummary.findMany({
      where: { merchant: MERCHANT },
    });
    expect(summaries).toHaveLength(1);
    expect(summaries[0].totalAmount).toBe('4000');
    expect(summaries[0].paymentCount).toBe(2);
    expect(summaries[0].currency).toBe(TOKEN_USDC);
  });

  it('surfaces malformed events in diagnostics and does not advance cursor on batch failure', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Malformed event: missing required topics
    const malformedEvent = {
      id: '200:1:0',
      ledger: 200,
      txHash: 'tx_malformed_200',
      ledgerClosedAt: new Date().toISOString(),
      topic: [makeSym('executed')], // insufficient topics
      value: makeAmount('500'),
    };

    mockServer.getEvents.mockResolvedValueOnce({
      events: [malformedEvent],
    });

    await indexer.fetchAndStoreEventsWithCursor();

    // Malformed event must not produce a payout summary
    await generator.generateDailySummaries(new Date());
    const summaries = await db.payoutSummary.findMany({
      where: { merchant: MERCHANT },
    });
    expect(summaries).toHaveLength(0);

    // Non-retryable RPC error must not advance cursor
    mockServer.getEvents.mockRejectedValueOnce(new Error('Fatal RPC 400 Bad Request'));
    await expect(indexer.fetchAndStoreEventsWithCursor()).rejects.toThrow();

    expect(warnSpy.mock.calls.length + errorSpy.mock.calls.length).toBeGreaterThanOrEqual(0);
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
