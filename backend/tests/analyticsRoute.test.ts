/**
 * #1388 — Unit tests for analytics route MRR calculation accuracy.
 * Tests MRR computation, revenue totals, subscriber counts, and period filtering.
 */

// ─── In-memory event store ────────────────────────────────────────────────────

type MockEvent = {
  id: number;
  type: string;
  subscriber: string;
  merchant: string;
  token: string;
  amount: string;
  ledgerTimestamp: bigint;
  createdAt: Date;
};

let mockEventStore: MockEvent[] = [];

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    event: {
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return mockEventStore.filter((e) => {
          let match = true;
          if (where.merchant && e.merchant !== where.merchant) match = false;
          if (where.ledgerTimestamp) {
            const filter = where.ledgerTimestamp as Record<string, bigint>;
            if (filter.gte !== undefined && e.ledgerTimestamp < filter.gte) match = false;
          }
          return match;
        });
      }),
    },
  },
}));

jest.mock('../src/lib/tracing', () => ({
  getTracer: jest.fn(),
  withSpan: jest.fn((_a: unknown, _b: unknown, fn: (span: unknown) => unknown) =>
    fn({ setAttributes: jest.fn() }),
  ),
  SpanKind: { CLIENT: 0 },
  initTracing: jest.fn(),
}));

jest.mock('../src/lib/redis', () => ({
  cacheGet: jest.fn().mockResolvedValue(null),
  cacheSet: jest.fn().mockResolvedValue(undefined),
  CacheKey: {
    merchantSubscriptions: jest.fn((m: string) => `sub:${m}`),
    analyticsRevenue: jest.fn((m: string, p: string) => `rev:${m}:${p}`),
    merchantPattern: jest.fn(),
    analyticsPattern: jest.fn(),
    subscriptionPattern: jest.fn(),
  },
  CACHE_TTL: { subscriptions: 60, analytics: 300 },
  cacheDeletePattern: jest.fn(),
  publishCacheInvalidation: jest.fn(),
}));

import express from 'express';
import request from 'supertest';
import analyticsRouter from '../src/routes/analytics';

const app = express();
app.use(express.json());
app.use('/api/v1/analytics', analyticsRouter);

// Helper: timestamp (seconds) for a specific date
function ts(dateStr: string): bigint {
  return BigInt(Math.floor(new Date(dateStr).getTime() / 1000));
}

let eventIdCounter = 1;
function makeEvent(overrides: Partial<MockEvent>): MockEvent {
  return {
    id: eventIdCounter++,
    type: 'executed',
    subscriber: 'GSUB1',
    merchant: 'GMERCHANT1',
    token: 'CTOKEN1',
    amount: '10000000',
    ledgerTimestamp: ts('2024-06-15'),
    createdAt: new Date('2024-06-15'),
    ...overrides,
  };
}

describe('Analytics Route — MRR Calculation (#1388)', () => {
  beforeEach(() => {
    mockEventStore = [];
    eventIdCounter = 1;
    jest.clearAllMocks();
  });

  it('returns 400 when merchant query param is missing', async () => {
    const res = await request(app).get('/api/v1/analytics/revenue').expect(400);
    expect(res.body.error).toContain('merchant');
  });

  it('returns 400 for invalid period parameter', async () => {
    const res = await request(app)
      .get('/api/v1/analytics/revenue?merchant=GMERCHANT1&period=weekly')
      .expect(400);
    expect(res.body.error).toContain('period');
  });

  it('returns 200 with expected shape', async () => {
    const res = await request(app)
      .get('/api/v1/analytics/revenue?merchant=GMERCHANT1')
      .expect(200);

    expect(res.body).toHaveProperty('period');
    expect(res.body).toHaveProperty('merchant');
    expect(res.body).toHaveProperty('mrr');
    expect(res.body).toHaveProperty('totalRevenue');
    expect(res.body).toHaveProperty('activeSubscribers');
    expect(res.body).toHaveProperty('successRate');
    expect(res.body).toHaveProperty('executedCount');
    expect(res.body).toHaveProperty('failureCount');
    expect(Array.isArray(res.body.mrr)).toBe(true);
  });

  it('computes correct MRR for 3 executed events in different months', async () => {
    // Jan: 10_000_000 + 20_000_000 = 30_000_000
    // Feb: 50_000_000
    mockEventStore = [
      makeEvent({ amount: '10000000', ledgerTimestamp: ts('2024-01-10') }),
      makeEvent({ amount: '20000000', ledgerTimestamp: ts('2024-01-20') }),
      makeEvent({ amount: '50000000', ledgerTimestamp: ts('2024-02-15') }),
    ];

    const res = await request(app)
      .get('/api/v1/analytics/revenue?merchant=GMERCHANT1&period=all')
      .expect(200);

    const mrr: Array<{ month: string; revenue: string; paymentCount: number }> = res.body.mrr;
    const jan = mrr.find((m) => m.month === '2024-01');
    const feb = mrr.find((m) => m.month === '2024-02');

    expect(jan).toBeDefined();
    expect(jan?.revenue).toBe('30000000');
    expect(jan?.paymentCount).toBe(2);
    expect(feb).toBeDefined();
    expect(feb?.revenue).toBe('50000000');
    expect(feb?.paymentCount).toBe(1);
  });

  it('computes correct totalRevenue as sum of all executed amounts', async () => {
    mockEventStore = [
      makeEvent({ amount: '100' }),
      makeEvent({ amount: '200' }),
      makeEvent({ amount: '700' }),
    ];

    const res = await request(app)
      .get('/api/v1/analytics/revenue?merchant=GMERCHANT1&period=all')
      .expect(200);

    expect(res.body.totalRevenue).toBe('1000');
  });

  it('returns successRate of 100 when no events exist', async () => {
    const res = await request(app)
      .get('/api/v1/analytics/revenue?merchant=GMERCHANT1&period=all')
      .expect(200);

    expect(res.body.successRate).toBe(100);
    expect(res.body.executedCount).toBe(0);
    expect(res.body.failureCount).toBe(0);
  });

  it('computes successRate correctly when some payments fail', async () => {
    mockEventStore = [
      makeEvent({ type: 'executed' }),
      makeEvent({ type: 'executed' }),
      makeEvent({ type: 'payment_transfer_failure' }),
    ];

    const res = await request(app)
      .get('/api/v1/analytics/revenue?merchant=GMERCHANT1&period=all')
      .expect(200);

    // 2 executed / (2 + 1) total = 66.67 → rounds to 67
    expect(res.body.successRate).toBe(67);
    expect(res.body.executedCount).toBe(2);
    expect(res.body.failureCount).toBe(1);
  });

  it('counts unique activeSubscribers from subscribe events', async () => {
    mockEventStore = [
      makeEvent({ type: 'subscribe', subscriber: 'GSUB_A' }),
      makeEvent({ type: 'subscribe', subscriber: 'GSUB_A' }), // duplicate, same subscriber
      makeEvent({ type: 'subscribe', subscriber: 'GSUB_B' }),
      makeEvent({ type: 'executed', subscriber: 'GSUB_A' }),
    ];

    const res = await request(app)
      .get('/api/v1/analytics/revenue?merchant=GMERCHANT1&period=all')
      .expect(200);

    expect(res.body.activeSubscribers).toBe(2); // GSUB_A and GSUB_B
  });

  it('period=30d excludes events older than 30 days', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const recent = BigInt(nowSec - 10 * 24 * 60 * 60);  // 10 days ago
    const old = BigInt(nowSec - 40 * 24 * 60 * 60);     // 40 days ago

    mockEventStore = [
      makeEvent({ amount: '1000', ledgerTimestamp: recent }),
      makeEvent({ amount: '9999', ledgerTimestamp: old }),
    ];

    const res = await request(app)
      .get('/api/v1/analytics/revenue?merchant=GMERCHANT1&period=30d')
      .expect(200);

    expect(res.body.totalRevenue).toBe('1000');
    expect(res.body.executedCount).toBe(1);
  });

  it('period=all includes all events regardless of age', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const veryOld = BigInt(nowSec - 400 * 24 * 60 * 60);

    mockEventStore = [
      makeEvent({ amount: '500', ledgerTimestamp: veryOld }),
      makeEvent({ amount: '500' }),
    ];

    const res = await request(app)
      .get('/api/v1/analytics/revenue?merchant=GMERCHANT1&period=all')
      .expect(200);

    expect(res.body.totalRevenue).toBe('1000');
    expect(res.body.executedCount).toBe(2);
  });

  it('MRR entries are sorted chronologically', async () => {
    mockEventStore = [
      makeEvent({ amount: '100', ledgerTimestamp: ts('2024-03-01') }),
      makeEvent({ amount: '200', ledgerTimestamp: ts('2024-01-01') }),
      makeEvent({ amount: '300', ledgerTimestamp: ts('2024-02-01') }),
    ];

    const res = await request(app)
      .get('/api/v1/analytics/revenue?merchant=GMERCHANT1&period=all')
      .expect(200);

    const months = res.body.mrr.map((m: { month: string }) => m.month);
    expect(months).toEqual(['2024-01', '2024-02', '2024-03']);
  });
});
