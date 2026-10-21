/**
 * #1388 — Unit tests for EventIndexer service.
 * Covers: event polling, cursor management, event decoding, deduplication.
 */

// ─── Mocks — must be declared before any imports ─────────────────────────────

jest.mock('../src/lib/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../src/lib/tracing', () => ({
  getTracer: jest.fn(),
  withSpan: jest.fn((_tracer: unknown, _name: unknown, fn: (span: unknown) => unknown) =>
    fn({ setAttributes: jest.fn() }),
  ),
  SpanKind: { CLIENT: 0 },
  initTracing: jest.fn(),
}));

jest.mock('../src/lib/redis', () => ({
  cacheGet: jest.fn().mockResolvedValue(null),
  cacheSet: jest.fn().mockResolvedValue(undefined),
  cacheDeletePattern: jest.fn().mockResolvedValue(undefined),
  publishCacheInvalidation: jest.fn().mockResolvedValue(undefined),
  CacheKey: {
    merchantPattern: jest.fn((m: string) => `merchant:${m}:*`),
    analyticsPattern: jest.fn((m: string) => `analytics:${m}:*`),
    subscriptionPattern: jest.fn((s: string, m: string) => `sub:${s}:${m}`),
    merchantSubscriptions: jest.fn((m: string) => `sub:merchant:${m}`),
    analyticsRevenue: jest.fn((m: string, p: string) => `rev:${m}:${p}`),
  },
  CACHE_TTL: { subscriptions: 60, analytics: 300 },
}));

jest.mock('../src/services/retryQueue', () => ({
  enqueueRetries: jest.fn().mockResolvedValue([]),
}));

jest.mock('../src/services/emailService', () => ({
  sendPaymentFailureEmail: jest.fn().mockResolvedValue(undefined),
  sendCancellationEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/subscriptionStateService', () => ({
  applyEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/auditLogger', () => ({
  AuditLogger: jest.fn().mockImplementation(() => ({
    logPayment: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../src/lib/backoff', () => ({
  withBackoff: jest.fn().mockImplementation((fn: () => unknown) => fn()),
  isRpcRetryable: jest.fn().mockReturnValue(false),
}));

// ─── Mock indexerStateService ─────────────────────────────────────────────────
const mockGetLastCursor = jest.fn().mockResolvedValue(null);
const mockGetLastProcessedLedger = jest.fn().mockResolvedValue(0);
const mockSaveState = jest.fn().mockResolvedValue(undefined);

jest.mock('../src/services/indexerStateService', () => ({
  indexerStateService: {
    getLastCursor: mockGetLastCursor,
    getLastProcessedLedger: mockGetLastProcessedLedger,
    saveState: mockSaveState,
    clearState: jest.fn().mockResolvedValue(undefined),
  },
}));

// ─── Mock Stellar SDK ─────────────────────────────────────────────────────────
let mockGetEventsResponse: { events: unknown[] } = { events: [] };

class MockScVal {
  constructor(
    private _type: string,
    private _value: string,
  ) {}
  sym() {
    return { toString: () => this._value };
  }
  address() {
    return { toString: () => this._value };
  }
  i128() {
    if (this._type === 'amount') return { toString: () => this._value };
    throw new Error('not i128');
  }
  u64() {
    return { toString: () => this._value };
  }
}

const mockGetEvents = jest.fn().mockImplementation(async () => mockGetEventsResponse);

jest.mock('@stellar/stellar-sdk', () => ({
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      getEvents: mockGetEvents,
    })),
  },
  xdr: {
    ScVal: {
      scvLedgerKeyContractInstance: jest.fn(),
    },
  },
}));

// ─── Mock Prisma ──────────────────────────────────────────────────────────────
const storedEvents: Record<string, unknown>[] = [];
const storedPayments: Record<string, unknown>[] = [];

const mockPrisma = {
  event: {
    findFirst: jest.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      return (
        storedEvents.find((e) => {
          return (
            (!where.type || e.type === where.type) &&
            (!where.subscriber || e.subscriber === where.subscriber) &&
            (!where.merchant || e.merchant === where.merchant) &&
            (!where.token || e.token === where.token) &&
            (!where.amount || e.amount === where.amount) &&
            (!where.ledgerTimestamp || e.ledgerTimestamp === where.ledgerTimestamp)
          );
        }) ?? null
      );
    }),
    create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      storedEvents.push(data);
      return data;
    }),
    findMany: jest.fn().mockImplementation(async () => storedEvents),
  },
  payment: {
    upsert: jest.fn().mockResolvedValue({}),
    findMany: jest.fn().mockResolvedValue([]),
  },
  auditLog: {
    create: jest.fn().mockResolvedValue({}),
  },
};

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

// ─── Import after all mocks ───────────────────────────────────────────────────
import { EventIndexer } from '../src/services/eventIndexer';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeScVal(type: string, value: string) {
  return new MockScVal(type, value);
}

function makeEvent(opts: {
  type: string;
  subscriber: string;
  merchant: string;
  token?: string;
  amount?: string;
  ledger?: number;
  id?: string;
}) {
  return {
    id: opts.id ?? `${opts.ledger ?? 1}:0:0`,
    ledger: opts.ledger ?? 1,
    topic: [
      makeScVal('symbol', opts.type),
      makeScVal('address', opts.subscriber),
      makeScVal('address', opts.merchant),
      ...(opts.token ? [makeScVal('address', opts.token)] : []),
    ],
    value: makeScVal('amount', opts.amount ?? '1000'),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('EventIndexer (#1388)', () => {
  let indexer: EventIndexer;

  beforeEach(() => {
    storedEvents.length = 0;
    storedPayments.length = 0;
    jest.clearAllMocks();
    mockGetEventsResponse = { events: [] };
    indexer = new EventIndexer('http://localhost:8000', 'CTEST123');
  });

  // ── fetchAndStoreEvents ────────────────────────────────────────────────────

  describe('fetchAndStoreEvents', () => {
    it('stores a subscribe event from RPC', async () => {
      mockGetEventsResponse = {
        events: [
          makeEvent({
            type: 'subscribe',
            subscriber: 'GSUB1',
            merchant: 'GMERCHANT1',
            token: 'CTOKEN1',
            amount: '1000',
            ledger: 10,
          }),
        ],
      };

      await indexer.fetchAndStoreEvents(1);

      expect(mockPrisma.event.create).toHaveBeenCalledTimes(1);
      const created = storedEvents[0] as Record<string, unknown>;
      expect(created.type).toBe('subscribe');
      expect(created.subscriber).toBe('GSUB1');
      expect(created.merchant).toBe('GMERCHANT1');
    });

    it('stores an executed event from RPC', async () => {
      mockGetEventsResponse = {
        events: [
          makeEvent({
            type: 'executed',
            subscriber: 'GSUB2',
            merchant: 'GMERCHANT2',
            token: 'CTOKEN2',
            amount: '5000',
            ledger: 20,
          }),
        ],
      };

      await indexer.fetchAndStoreEvents(1);

      expect(storedEvents[0]).toMatchObject({ type: 'executed', amount: '5000' });
    });

    it('does NOT store cancel events (unsupported storage type)', async () => {
      mockGetEventsResponse = {
        events: [
          makeEvent({
            type: 'cancel',
            subscriber: 'GSUB3',
            merchant: 'GMERCHANT3',
            ledger: 30,
          }),
        ],
      };

      await indexer.fetchAndStoreEvents(1);

      expect(mockPrisma.event.create).not.toHaveBeenCalled();
    });

    it('does NOT store payment_transfer_failure events', async () => {
      mockGetEventsResponse = {
        events: [
          makeEvent({
            type: 'payment_transfer_failure',
            subscriber: 'GSUB4',
            merchant: 'GMERCHANT4',
            ledger: 40,
          }),
        ],
      };

      await indexer.fetchAndStoreEvents(1);

      expect(mockPrisma.event.create).not.toHaveBeenCalled();
    });

    it('skips unknown event types', async () => {
      mockGetEventsResponse = {
        events: [
          makeEvent({
            type: 'unknown_event',
            subscriber: 'GSUB5',
            merchant: 'GMERCHANT5',
            ledger: 50,
          }),
        ],
      };

      await indexer.fetchAndStoreEvents(1);

      expect(mockPrisma.event.create).not.toHaveBeenCalled();
    });

    it('deduplicates events: second call with same event does not create duplicate', async () => {
      const event = makeEvent({
        type: 'subscribe',
        subscriber: 'GSUB6',
        merchant: 'GMERCHANT6',
        token: 'CTOKEN6',
        amount: '2000',
        ledger: 60,
      });

      mockGetEventsResponse = { events: [event] };

      await indexer.fetchAndStoreEvents(1);

      // Simulate findFirst returning the existing event on second call
      mockPrisma.event.findFirst.mockResolvedValueOnce(storedEvents[0]);

      await indexer.fetchAndStoreEvents(1);

      expect(mockPrisma.event.create).toHaveBeenCalledTimes(1);
    });

    it('handles empty events response gracefully', async () => {
      mockGetEventsResponse = { events: [] };

      await expect(indexer.fetchAndStoreEvents(1)).resolves.not.toThrow();
      expect(mockPrisma.event.create).not.toHaveBeenCalled();
    });

    it('handles RPC error gracefully', async () => {
      mockGetEvents.mockRejectedValueOnce(new Error('RPC connection refused'));

      await expect(indexer.fetchAndStoreEvents(1)).rejects.toThrow();
    });

    it('upserts a Payment record for executed events', async () => {
      mockGetEventsResponse = {
        events: [
          makeEvent({
            type: 'executed',
            subscriber: 'GSUB7',
            merchant: 'GMERCHANT7',
            token: 'CTOKEN7',
            amount: '9999',
            ledger: 70,
            id: '70:0:0',
          }),
        ],
      };

      await indexer.fetchAndStoreEvents(1);

      expect(mockPrisma.payment.upsert).toHaveBeenCalledTimes(1);
    });
  });

  // ── fetchAndStoreEventsWithCursor ──────────────────────────────────────────

  describe('fetchAndStoreEventsWithCursor', () => {
    it('loads the saved cursor and passes it to getEvents', async () => {
      mockGetLastCursor.mockResolvedValueOnce('100:0:0');
      mockGetLastProcessedLedger.mockResolvedValueOnce(100);
      mockGetEventsResponse = { events: [] };

      await indexer.fetchAndStoreEventsWithCursor();

      // withBackoff is mocked to call fn immediately
      expect(mockGetEvents).toHaveBeenCalled();
    });

    it('saves the cursor after processing a batch of events', async () => {
      mockGetLastCursor.mockResolvedValueOnce(null);
      mockGetLastProcessedLedger.mockResolvedValueOnce(0);

      const event = makeEvent({
        type: 'subscribe',
        subscriber: 'GSUB_CURSOR',
        merchant: 'GMERCHANT_CURSOR',
        token: 'CTOKEN_CURSOR',
        amount: '100',
        ledger: 200,
        id: '200:0:0',
      });

      mockGetEventsResponse = { events: [event] };

      await indexer.fetchAndStoreEventsWithCursor();

      expect(mockSaveState).toHaveBeenCalledWith('200:0:0', 200);
    });

    it('does not save cursor when no events returned', async () => {
      mockGetLastCursor.mockResolvedValueOnce('50:0:0');
      mockGetLastProcessedLedger.mockResolvedValueOnce(50);
      mockGetEventsResponse = { events: [] };

      await indexer.fetchAndStoreEventsWithCursor();

      expect(mockSaveState).not.toHaveBeenCalled();
    });
  });

  // ── startPolling / stopPolling ─────────────────────────────────────────────

  describe('startPolling / stopPolling', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('stops polling after stopPolling() is called', async () => {
      mockGetEventsResponse = { events: [] };

      // Start polling with a long interval so it doesn't fire multiple times
      indexer.startPolling(60_000);

      // Allow the initial tick to run
      await Promise.resolve();
      await Promise.resolve();

      indexer.stopPolling();

      const callsBefore = mockGetEvents.mock.calls.length;

      // Advance timer — should not trigger another tick
      jest.advanceTimersByTime(120_000);

      // Allow any microtasks to settle
      await Promise.resolve();

      // Call count should not have increased
      expect(mockGetEvents.mock.calls.length).toBe(callsBefore);
    });

    it('calls fetchAndStoreEventsWithCursor on each tick', async () => {
      mockGetEventsResponse = { events: [] };

      const spy = jest.spyOn(indexer, 'fetchAndStoreEventsWithCursor').mockResolvedValue(undefined);

      indexer.startPolling(1_000);

      // Initial tick
      await Promise.resolve();
      await Promise.resolve();

      indexer.stopPolling();

      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  });

  // ── Event decoding ─────────────────────────────────────────────────────────

  describe('event decoding edge cases', () => {
    it('stores event with empty token when token topic missing', async () => {
      mockGetEventsResponse = {
        events: [
          {
            id: '300:0:0',
            ledger: 300,
            topic: [
              makeScVal('symbol', 'subscribe'),
              makeScVal('address', 'GSUB8'),
              makeScVal('address', 'GMERCHANT8'),
              // no token topic
            ],
            value: makeScVal('amount', '500'),
          },
        ],
      };

      await indexer.fetchAndStoreEvents(1);

      expect(storedEvents[0]).toMatchObject({ token: '' });
    });

    it('stores event with empty amount when value is unparseable', async () => {
      const badScVal = {
        sym: () => { throw new Error(); },
        address: () => { throw new Error(); },
        i128: () => { throw new Error(); },
        u64: () => { throw new Error(); },
      };

      mockGetEventsResponse = {
        events: [
          {
            id: '400:0:0',
            ledger: 400,
            topic: [
              makeScVal('symbol', 'executed'),
              makeScVal('address', 'GSUB9'),
              makeScVal('address', 'GMERCHANT9'),
              makeScVal('address', 'CTOKEN9'),
            ],
            value: badScVal,
          },
        ],
      };

      await indexer.fetchAndStoreEvents(1);

      expect(storedEvents[0]).toMatchObject({ amount: '' });
    });

    it('skips event with fewer than 2 topics', async () => {
      mockGetEventsResponse = {
        events: [
          {
            id: '500:0:0',
            ledger: 500,
            topic: [makeScVal('symbol', 'subscribe')],
            value: makeScVal('amount', '100'),
          },
        ],
      };

      await indexer.fetchAndStoreEvents(1);

      expect(mockPrisma.event.create).not.toHaveBeenCalled();
    });
  });
});
