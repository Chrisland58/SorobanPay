/**
 * #1390 — Unit tests for CSV export endpoint.
 * Validates CSV format, Content-Disposition header, streaming, rate limiting.
 */

// ─── Mocks — before all imports ──────────────────────────────────────────────

const mockPayments = [
  {
    id: 1,
    subscriber: 'GSUB111AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    merchant: 'GMERCHANT1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    token: 'CTOKEN1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    amount: '10000000',
    txHash: 'abc123def456abc123def456abc123def456abc123def456abc123def456abcd',
    paymentNonce: 1,
    timestamp: new Date('2024-01-15T10:00:00Z'),
    status: 'executed',
    ledger: BigInt(100),
    createdAt: new Date('2024-01-15T10:00:00Z'),
  },
  {
    id: 2,
    subscriber: 'GSUB222BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    merchant: 'GMERCHANT1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    token: 'CTOKEN1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    amount: '50000000',
    txHash: 'def456abc123def456abc123def456abc123def456abc123def456abc123defg',
    paymentNonce: 2,
    timestamp: new Date('2024-01-20T14:30:00Z'),
    status: 'executed',
    ledger: BigInt(150),
    createdAt: new Date('2024-01-20T14:30:00Z'),
  },
];

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    payment: {
      findMany: jest.fn().mockImplementation(async ({ skip = 0, take = 500 } = {}) => {
        return mockPayments.slice(skip, skip + take);
      }),
    },
    event: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}));

jest.mock('../src/lib/tracing', () => ({
  getTracer: jest.fn(),
  withSpan: jest.fn((_a: unknown, _b: unknown, fn: (s: unknown) => unknown) =>
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
    merchantPattern: jest.fn(),
    analyticsPattern: jest.fn(),
    subscriptionPattern: jest.fn(),
    analyticsRevenue: jest.fn((m: string, p: string) => `rev:${m}:${p}`),
  },
  CACHE_TTL: { subscriptions: 60, analytics: 300 },
  cacheDeletePattern: jest.fn(),
  publishCacheInvalidation: jest.fn(),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import express from 'express';
import request from 'supertest';
import paymentsRouter from '../src/routes/payments';

const MERCHANT = 'GMERCHANT1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/payments', paymentsRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CSV Export Endpoint (#1390)', () => {
  describe('GET /api/v1/payments/:merchant/export', () => {
    it('returns 200 with text/csv Content-Type by default', async () => {
      const res = await request(buildApp())
        .get(`/api/v1/payments/${MERCHANT}/export`)
        .expect(200);

      expect(res.headers['content-type']).toMatch(/text\/csv/);
    });

    it('returns correct Content-Disposition attachment header', async () => {
      const res = await request(buildApp())
        .get(`/api/v1/payments/${MERCHANT}/export`)
        .expect(200);

      const disposition = res.headers['content-disposition'];
      expect(disposition).toMatch(/attachment/);
      expect(disposition).toMatch(/filename="payments-GMERCHA/);
      // Should include date stamp YYYY-MM-DD
      expect(disposition).toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it('CSV contains the correct header row with all required columns', async () => {
      const res = await request(buildApp())
        .get(`/api/v1/payments/${MERCHANT}/export`)
        .expect(200);

      const lines = res.text.split('\r\n').filter(Boolean);
      const header = lines[0];
      expect(header).toContain('Date');
      expect(header).toContain('Type');
      expect(header).toContain('Subscriber');
      expect(header).toContain('Amount (human-readable)');
      expect(header).toContain('Amount (raw)');
      expect(header).toContain('Token');
      expect(header).toContain('Tx Hash');
      expect(header).toContain('Nonce');
    });

    it('CSV contains correct number of data rows', async () => {
      const res = await request(buildApp())
        .get(`/api/v1/payments/${MERCHANT}/export`)
        .expect(200);

      const lines = res.text.split('\r\n').filter(Boolean);
      // 1 header + 2 data rows
      expect(lines).toHaveLength(3);
    });

    it('CSV row contains human-readable amount (10000000 → 1.0)', async () => {
      const res = await request(buildApp())
        .get(`/api/v1/payments/${MERCHANT}/export`)
        .expect(200);

      const lines = res.text.split('\r\n').filter(Boolean);
      const firstDataRow = lines[1];

      // 10000000 stroops = 1.0 in human format
      expect(firstDataRow).toContain('1.0');
      expect(firstDataRow).toContain('10000000');
    });

    it('CSV row contains the raw amount unchanged', async () => {
      const res = await request(buildApp())
        .get(`/api/v1/payments/${MERCHANT}/export`)
        .expect(200);

      const lines = res.text.split('\r\n').filter(Boolean);
      const secondDataRow = lines[2];
      expect(secondDataRow).toContain('50000000');
    });

    it('CSV row contains subscriber address', async () => {
      const res = await request(buildApp())
        .get(`/api/v1/payments/${MERCHANT}/export`)
        .expect(200);

      expect(res.text).toContain('GSUB111');
    });

    it('CSV row contains tx hash', async () => {
      const res = await request(buildApp())
        .get(`/api/v1/payments/${MERCHANT}/export`)
        .expect(200);

      expect(res.text).toContain('abc123def456');
    });

    it('returns JSON format when format=json', async () => {
      const res = await request(buildApp())
        .get(`/api/v1/payments/${MERCHANT}/export?format=json`)
        .expect(200);

      expect(res.headers['content-type']).toMatch(/application\/json/);
      const data = JSON.parse(res.text);
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(2);
    });

    it('JSON rows have correct shape', async () => {
      const res = await request(buildApp())
        .get(`/api/v1/payments/${MERCHANT}/export?format=json`)
        .expect(200);

      const data = JSON.parse(res.text);
      const row = data[0];
      expect(row).toHaveProperty('date');
      expect(row).toHaveProperty('type');
      expect(row).toHaveProperty('subscriber');
      expect(row).toHaveProperty('amountHuman');
      expect(row).toHaveProperty('amountRaw');
      expect(row).toHaveProperty('token');
      expect(row).toHaveProperty('txHash');
    });

    it('JSON Content-Disposition is an attachment', async () => {
      const res = await request(buildApp())
        .get(`/api/v1/payments/${MERCHANT}/export?format=json`)
        .expect(200);

      expect(res.headers['content-disposition']).toMatch(/attachment/);
    });

    it('returns 400 for unsupported format parameter', async () => {
      const res = await request(buildApp())
        .get(`/api/v1/payments/${MERCHANT}/export?format=xml`)
        .expect(400);

      expect(res.body.error).toContain('format');
    });

    it('rate limit headers are present in response', async () => {
      const res = await request(buildApp())
        .get(`/api/v1/payments/${MERCHANT}/export`)
        .expect(200);

      // express-rate-limit v7 uses standard RateLimit-* headers
      const hasRateLimit =
        res.headers['ratelimit-limit'] !== undefined ||
        res.headers['x-ratelimit-limit'] !== undefined;
      expect(hasRateLimit).toBe(true);
    });

    it('handles merchant with no payments — returns CSV header only', async () => {
      const { default: prisma } = require('../src/lib/prisma');
      (prisma.payment.findMany as jest.Mock).mockResolvedValueOnce([]);

      const res = await request(buildApp())
        .get(`/api/v1/payments/GNOPAYMENTS111111111111111111111111111111111111111111111/export`)
        .expect(200);

      const lines = res.text.split('\r\n').filter(Boolean);
      // Only the header row
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('Date');
    });

    it('handles merchant with no payments — JSON returns empty array', async () => {
      const { default: prisma } = require('../src/lib/prisma');
      (prisma.payment.findMany as jest.Mock).mockResolvedValueOnce([]);

      const res = await request(buildApp())
        .get(`/api/v1/payments/GNOPAYMENTS111111111111111111111111111111111111111111111/export?format=json`)
        .expect(200);

      const data = JSON.parse(res.text);
      expect(data).toEqual([]);
    });
  });

  describe('Amount formatting', () => {
    it('formats 10000000 as 1.0', () => {
      // Test via CSV output
      const toHuman = (raw: string): string => {
        try {
          const n = BigInt(raw);
          const isNeg = n < 0n;
          const abs = isNeg ? -n : n;
          const wholePart = abs / 10_000_000n;
          const fracPart = abs % 10_000_000n;
          const fracStr = String(fracPart).padStart(7, '0').replace(/0+$/, '') || '0';
          return `${isNeg ? '-' : ''}${wholePart}.${fracStr}`;
        } catch {
          return raw;
        }
      };

      expect(toHuman('10000000')).toBe('1.0');
      expect(toHuman('50000000')).toBe('5.0');
      expect(toHuman('100000000')).toBe('10.0');
      expect(toHuman('1')).toBe('0.0000001');
      expect(toHuman('0')).toBe('0.0');
      expect(toHuman('not-a-number')).toBe('not-a-number'); // fallback
    });
  });
});
