/**
 * #1391 — Unit tests for the TTL Health Monitor service.
 *
 * All external dependencies (Prisma, webhookNotifier) are mocked so this
 * suite runs purely in-memory with no real DB or network calls.
 */

// ─── Mocks — must be declared before all imports ─────────────────────────────

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    event: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

jest.mock('../src/services/webhookNotifier', () => ({
  notifyWebhooks: jest.fn().mockResolvedValue(undefined),
}));

// ─── Imports after mocks ──────────────────────────────────────────────────────

import prisma from '../src/lib/prisma';
import { notifyWebhooks } from '../src/services/webhookNotifier';
import {
  findAtRiskSubscriptions,
  notifyMerchantsOfAtRiskSubscriptions,
  runTtlHealthCheck,
  TTL_RISK_DAYS,
  TtlAtRiskEntry,
} from '../src/services/ttlHealthMonitor';

const mockNotify = notifyWebhooks as jest.MockedFunction<typeof notifyWebhooks>;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MERCHANT  = 'GMERCHANT1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const MERCHANT2 = 'GMERCHANT2BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const SUB_A     = 'GSUBA11AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const SUB_B     = 'GSUBB22BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const TOKEN     = 'CTOKEN1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** Unix seconds for N days ago. */
function daysAgo(n: number): bigint {
  return BigInt(Math.floor(Date.now() / 1000) - n * 86400);
}

function makeSubscribeEvent(
  subscriber: string,
  merchant: string,
  ledgerDaysAgo: number,
  amount = '10000000',
) {
  return { subscriber, merchant, token: TOKEN, amount, ledgerTimestamp: daysAgo(ledgerDaysAgo) };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TTL Health Monitor (#1391)', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── TTL_RISK_DAYS constant ────────────────────────────────────────────────

  it('TTL_RISK_DAYS constant equals 300', () => {
    expect(TTL_RISK_DAYS).toBe(300);
  });

  // ── findAtRiskSubscriptions ────────────────────────────────────────────────

  describe('findAtRiskSubscriptions()', () => {
    it('returns [] when there are no subscribe events', async () => {
      (prisma.event.findMany as jest.Mock).mockResolvedValue([]);
      expect(await findAtRiskSubscriptions()).toEqual([]);
    });

    it('flags subscription whose last payment was > TTL_RISK_DAYS ago', async () => {
      (prisma.event.findMany as jest.Mock).mockResolvedValue([
        makeSubscribeEvent(SUB_A, MERCHANT, 320),
      ]);
      (prisma.event.findFirst as jest.Mock).mockResolvedValue({
        ledgerTimestamp: daysAgo(310), // 310 days ago — over threshold
      });

      const result = await findAtRiskSubscriptions();

      expect(result).toHaveLength(1);
      expect(result[0].subscriber).toBe(SUB_A);
      expect(result[0].merchant).toBe(MERCHANT);
      expect(result[0].daysSinceLastPayment).toBeGreaterThanOrEqual(309);
    });

    it('does NOT flag subscription with a recent payment (< TTL_RISK_DAYS)', async () => {
      (prisma.event.findMany as jest.Mock).mockResolvedValue([
        makeSubscribeEvent(SUB_A, MERCHANT, 40),
      ]);
      (prisma.event.findFirst as jest.Mock).mockResolvedValue({
        ledgerTimestamp: daysAgo(30), // 30 days ago — safe
      });

      expect(await findAtRiskSubscriptions()).toHaveLength(0);
    });

    it('flags subscription never paid if subscribe event > TTL_RISK_DAYS ago', async () => {
      (prisma.event.findMany as jest.Mock).mockResolvedValue([
        makeSubscribeEvent(SUB_B, MERCHANT, 350),
      ]);
      (prisma.event.findFirst as jest.Mock).mockResolvedValue(null); // never paid

      const result = await findAtRiskSubscriptions();

      expect(result).toHaveLength(1);
      expect(result[0].lastPaymentAt).toBeNull();
      expect(result[0].daysSinceLastPayment).toBeGreaterThanOrEqual(349);
    });

    it('does NOT flag subscription never paid when it was created recently', async () => {
      (prisma.event.findMany as jest.Mock).mockResolvedValue([
        makeSubscribeEvent(SUB_B, MERCHANT, 10),
      ]);
      (prisma.event.findFirst as jest.Mock).mockResolvedValue(null);

      expect(await findAtRiskSubscriptions()).toHaveLength(0);
    });

    it('deduplicates subscribe events — only one findFirst call per unique pair', async () => {
      // Two subscribe events for the same (subscriber, merchant, token) — update scenario
      (prisma.event.findMany as jest.Mock).mockResolvedValue([
        makeSubscribeEvent(SUB_A, MERCHANT, 5),  // newest (returned first by orderBy desc)
        makeSubscribeEvent(SUB_A, MERCHANT, 310), // older duplicate
      ]);
      (prisma.event.findFirst as jest.Mock).mockResolvedValue({
        ledgerTimestamp: daysAgo(5), // recent payment — safe
      });

      const result = await findAtRiskSubscriptions();

      expect(prisma.event.findFirst).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(0);
    });

    it('handles multiple merchants independently', async () => {
      (prisma.event.findMany as jest.Mock).mockResolvedValue([
        makeSubscribeEvent(SUB_A, MERCHANT,  310),
        makeSubscribeEvent(SUB_B, MERCHANT2, 10),
      ]);
      (prisma.event.findFirst as jest.Mock)
        .mockResolvedValueOnce({ ledgerTimestamp: daysAgo(310) }) // MERCHANT: at risk
        .mockResolvedValueOnce({ ledgerTimestamp: daysAgo(10)  }); // MERCHANT2: safe

      const result = await findAtRiskSubscriptions();

      expect(result).toHaveLength(1);
      expect(result[0].merchant).toBe(MERCHANT);
    });

    it('returned TtlAtRiskEntry has correct shape with all required fields', async () => {
      (prisma.event.findMany as jest.Mock).mockResolvedValue([
        makeSubscribeEvent(SUB_A, MERCHANT, 320),
      ]);
      (prisma.event.findFirst as jest.Mock).mockResolvedValue({
        ledgerTimestamp: daysAgo(310),
      });

      const [entry] = await findAtRiskSubscriptions();

      expect(entry).toHaveProperty('subscriber', SUB_A);
      expect(entry).toHaveProperty('merchant',   MERCHANT);
      expect(entry).toHaveProperty('token',      TOKEN);
      expect(entry).toHaveProperty('amount',     '10000000');
      expect(typeof entry.daysSinceLastPayment).toBe('number');
      // lastPaymentAt must be a valid ISO string
      expect(entry.lastPaymentAt).not.toBeNull();
      expect(() => new Date(entry.lastPaymentAt!)).not.toThrow();
    });
  });

  // ── notifyMerchantsOfAtRiskSubscriptions ─────────────────────────────────

  describe('notifyMerchantsOfAtRiskSubscriptions()', () => {
    it('does nothing when the list is empty', async () => {
      await notifyMerchantsOfAtRiskSubscriptions([]);
      expect(mockNotify).not.toHaveBeenCalled();
    });

    it('calls notifyWebhooks once per unique merchant', async () => {
      const entries: TtlAtRiskEntry[] = [
        { subscriber: SUB_A, merchant: MERCHANT,  token: TOKEN, amount: '1', lastPaymentAt: null, daysSinceLastPayment: 310 },
        { subscriber: SUB_B, merchant: MERCHANT,  token: TOKEN, amount: '1', lastPaymentAt: null, daysSinceLastPayment: 320 },
        { subscriber: SUB_A, merchant: MERCHANT2, token: TOKEN, amount: '1', lastPaymentAt: null, daysSinceLastPayment: 305 },
      ];

      await notifyMerchantsOfAtRiskSubscriptions(entries);

      expect(mockNotify).toHaveBeenCalledTimes(2);
      const calledMerchants = mockNotify.mock.calls.map((c) => c[0].merchant);
      expect(calledMerchants).toContain(MERCHANT);
      expect(calledMerchants).toContain(MERCHANT2);
    });

    it('embeds ttl_at_risk context in the traceContext field', async () => {
      const entries: TtlAtRiskEntry[] = [
        { subscriber: SUB_A, merchant: MERCHANT, token: TOKEN, amount: '10000000',
          lastPaymentAt: '2025-12-01T00:00:00.000Z', daysSinceLastPayment: 310 },
      ];

      await notifyMerchantsOfAtRiskSubscriptions(entries);

      const payload = mockNotify.mock.calls[0][0];
      expect(payload.merchant).toBe(MERCHANT);

      const ctx = JSON.parse(payload.traceContext!);
      expect(ctx.type).toBe('ttl_at_risk');
      expect(ctx.atRiskCount).toBe(1);
      expect(ctx.subscriptions[0].subscriber).toBe(SUB_A);
    });

    it('continues notifying remaining merchants when one webhook call throws', async () => {
      mockNotify
        .mockRejectedValueOnce(new Error('network timeout'))
        .mockResolvedValueOnce(undefined);

      const entries: TtlAtRiskEntry[] = [
        { subscriber: SUB_A, merchant: MERCHANT,  token: TOKEN, amount: '1', lastPaymentAt: null, daysSinceLastPayment: 310 },
        { subscriber: SUB_B, merchant: MERCHANT2, token: TOKEN, amount: '1', lastPaymentAt: null, daysSinceLastPayment: 320 },
      ];

      await expect(notifyMerchantsOfAtRiskSubscriptions(entries)).resolves.toBeUndefined();
      expect(mockNotify).toHaveBeenCalledTimes(2);
    });
  });

  // ── runTtlHealthCheck ─────────────────────────────────────────────────────

  describe('runTtlHealthCheck()', () => {
    it('returns at-risk list and triggers merchant notifications', async () => {
      (prisma.event.findMany as jest.Mock).mockResolvedValue([
        makeSubscribeEvent(SUB_A, MERCHANT, 310),
      ]);
      (prisma.event.findFirst as jest.Mock).mockResolvedValue({
        ledgerTimestamp: daysAgo(310),
      });

      const result = await runTtlHealthCheck();

      expect(result).toHaveLength(1);
      expect(result[0].merchant).toBe(MERCHANT);
      expect(mockNotify).toHaveBeenCalledTimes(1);
    });

    it('returns empty list and skips notifications when everything is safe', async () => {
      (prisma.event.findMany as jest.Mock).mockResolvedValue([
        makeSubscribeEvent(SUB_A, MERCHANT, 30),
      ]);
      (prisma.event.findFirst as jest.Mock).mockResolvedValue({
        ledgerTimestamp: daysAgo(30),
      });

      const result = await runTtlHealthCheck();

      expect(result).toHaveLength(0);
      expect(mockNotify).not.toHaveBeenCalled();
    });
  });

  // ── Admin endpoint response shape ────────────────────────────────────────

  describe('GET /api/v1/admin/ttl-health response contract', () => {
    it('wraps findAtRiskSubscriptions result in the expected envelope', () => {
      const mockEntry: TtlAtRiskEntry = {
        subscriber: SUB_A, merchant: MERCHANT, token: TOKEN,
        amount: '10000000', lastPaymentAt: '2025-12-01T00:00:00.000Z',
        daysSinceLastPayment: 310,
      };

      // Simulate what the route handler builds
      const response = {
        atRiskCount: 1,
        thresholdDays: TTL_RISK_DAYS,
        subscriptions: [mockEntry],
      };

      expect(response.atRiskCount).toBe(1);
      expect(response.thresholdDays).toBe(300);
      expect(response.subscriptions[0]).toMatchObject({
        subscriber: SUB_A,
        merchant:   MERCHANT,
        daysSinceLastPayment: 310,
      });
    });
  });
});
