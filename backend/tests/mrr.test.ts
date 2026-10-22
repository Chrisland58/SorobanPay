/**
 * Unit tests for MRR analytics helpers (#1378).
 *
 * All tests use known datasets and injected mock DB clients — no real database
 * or network connectivity is required.
 */

import {
  normaliseToMonthly,
  inferInterval,
  getCachedMrr,
  mrrCache,
  MRR_CACHE_TTL_MS,
  computeMrr,
  MrrResponse,
} from '../src/routes/mrr';

const MONTH_S = 2_592_000;
const WEEK_S  =   604_800;
const YEAR_S  = 31_536_000;

// ─── normaliseToMonthly ───────────────────────────────────────────────────────

describe('normaliseToMonthly', () => {
  it('returns amount unchanged for a monthly interval (2 592 000 s)', () => {
    expect(normaliseToMonthly(1000n, MONTH_S)).toBe(1000n);
  });

  it('pro-rates weekly payments (604 800 s) correctly', () => {
    // weekly amount 100 → monthly ≈ 100 × 2_592_000 / 604_800 = 428 (integer division)
    expect(normaliseToMonthly(100n, WEEK_S)).toBe(428n);
  });

  it('pro-rates annual payments (31 536 000 s) correctly', () => {
    // annual amount 12 000 → monthly ≈ 12000 × 2592000 / 31536000 = 982 (integer division)
    expect(normaliseToMonthly(12_000n, YEAR_S)).toBe(982n);
  });

  it('returns amount unchanged when interval is 0 (default monthly)', () => {
    expect(normaliseToMonthly(500n, 0)).toBe(500n);
  });

  it('returns amount unchanged when interval is negative (guard)', () => {
    expect(normaliseToMonthly(500n, -1)).toBe(500n);
  });

  it('handles large BigInt amounts without overflow', () => {
    const amount = 10n ** 18n; // 1 × 10^18 stroops (max contract amount)
    expect(normaliseToMonthly(amount, MONTH_S)).toBe(amount);
  });

  it('pro-rates bi-weekly (1 209 600 s) correctly', () => {
    // bi-weekly amount 50 → monthly = 50 × 2592000 / 1209600 = 107 (integer)
    expect(normaliseToMonthly(50n, 1_209_600)).toBe(107n);
  });
});

// ─── inferInterval ────────────────────────────────────────────────────────────

describe('inferInterval', () => {
  it('returns default monthly (2 592 000 s) for an empty array', () => {
    expect(inferInterval([])).toBe(MONTH_S);
  });

  it('returns default monthly for a single timestamp', () => {
    expect(inferInterval([Date.now()])).toBe(MONTH_S);
  });

  it('infers a monthly interval from two monthly timestamps', () => {
    const now = Date.now();
    const t1  = now - MONTH_S * 1000;
    const result = inferInterval([t1, now]);
    // Should be very close to 30 days in seconds
    expect(result).toBeGreaterThan(2_500_000);
    expect(result).toBeLessThan(2_700_000);
  });

  it('infers a weekly interval from four weekly timestamps', () => {
    const now  = Date.now();
    const WEEK_MS = WEEK_S * 1000;
    const timestamps = [now - 3 * WEEK_MS, now - 2 * WEEK_MS, now - WEEK_MS, now];
    const result = inferInterval(timestamps);
    expect(result).toBeGreaterThan(600_000);
    expect(result).toBeLessThan(620_000);
  });

  it('uses the median gap (not the mean) — resistant to outliers', () => {
    const now = Date.now();
    // Three gaps: ~1 day, ~7 days, ~1 day  →  median = ~1 day
    const DAY_MS = 86_400_000;
    const timestamps = [
      now - 9  * DAY_MS,
      now - 8  * DAY_MS,  // gap: 1 day
      now - 1  * DAY_MS,  // gap: 7 days (outlier)
      now,                  // gap: 1 day
    ];
    const result = inferInterval(timestamps);
    // Median of [86400, 604800, 86400] sorted → [86400, 86400, 604800] → 86400
    expect(result).toBeGreaterThan(80_000);
    expect(result).toBeLessThan(100_000);
  });
});

// ─── Cache ────────────────────────────────────────────────────────────────────

describe('getCachedMrr', () => {
  const MERCHANT = 'GMERCHANTTEST00000000000000000000000000000000000000000001';
  const SAMPLE: MrrResponse = {
    merchant: MERCHANT,
    tokens: [{ token: 'CABC', mrr_amount: '1000', active_subscriptions: 1, currency_symbol: '' }],
    computed_at: new Date().toISOString(),
    cache_hit: false,
  };

  beforeEach(() => mrrCache.clear());

  it('returns null when no entry exists', () => {
    expect(getCachedMrr(MERCHANT)).toBeNull();
  });

  it('returns data with cache_hit=true within TTL', () => {
    mrrCache.set(MERCHANT, { data: SAMPLE, cachedAt: Date.now() });
    const result = getCachedMrr(MERCHANT);
    expect(result).not.toBeNull();
    expect(result!.cache_hit).toBe(true);
    expect(result!.merchant).toBe(MERCHANT);
  });

  it('returns null and removes stale entry after TTL expires', () => {
    mrrCache.set(MERCHANT, {
      data: SAMPLE,
      cachedAt: Date.now() - MRR_CACHE_TTL_MS - 1000, // 1 s past TTL
    });
    expect(getCachedMrr(MERCHANT)).toBeNull();
    expect(mrrCache.has(MERCHANT)).toBe(false);
  });

  it('cache_hit is false on the original response stored in cache', () => {
    mrrCache.set(MERCHANT, { data: SAMPLE, cachedAt: Date.now() });
    const result = getCachedMrr(MERCHANT);
    // The stored data has cache_hit=false; getCachedMrr must set it to true
    expect(result!.cache_hit).toBe(true);
  });
});

// ─── computeMrr ───────────────────────────────────────────────────────────────

describe('computeMrr', () => {
  const MERCHANT   = 'GMERCHANT001AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const TOKEN_A    = 'CUSDC000000000000000000000000000000000000000000000001';
  const TOKEN_B    = 'CXLM0000000000000000000000000000000000000000000000002';
  const SUB1       = 'GSUB10000000000000000000000000000000000000000000000001';
  const SUB2       = 'GSUB20000000000000000000000000000000000000000000000002';
  const SUB3       = 'GSUB30000000000000000000000000000000000000000000000003';
  const nowSeconds = Math.floor(Date.now() / 1000);

  function makeEvent(
    subscriber: string,
    token: string,
    amount: string,
    offsetSeconds: number,
  ) {
    return {
      subscriber,
      merchant: MERCHANT,
      token,
      amount,
      ledgerTimestamp: BigInt(nowSeconds - offsetSeconds),
      type: 'executed',
    };
  }

  it('returns empty tokens array when no executed payments exist', async () => {
    const db = { event: { findMany: jest.fn().mockResolvedValue([]) } } as any;
    const result = await computeMrr(MERCHANT, db);
    expect(result.merchant).toBe(MERCHANT);
    expect(result.tokens).toHaveLength(0);
    expect(result.cache_hit).toBe(false);
    expect(typeof result.computed_at).toBe('string');
  });

  it('computes MRR correctly for a single monthly subscriber', async () => {
    const events = [
      makeEvent(SUB1, TOKEN_A, '1000', MONTH_S),     // one month ago
      makeEvent(SUB1, TOKEN_A, '1000', 0),            // now
    ];
    const db = { event: { findMany: jest.fn().mockResolvedValue(events) } } as any;
    const result = await computeMrr(MERCHANT, db);

    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0].token).toBe(TOKEN_A);
    expect(result.tokens[0].active_subscriptions).toBe(1);
    // interval ≈ MONTH_S → normalised monthly = 1000
    const mrr = BigInt(result.tokens[0].mrr_amount);
    expect(mrr).toBeGreaterThan(900n);
    expect(mrr).toBeLessThan(1100n);
  });

  it('pro-rates a weekly subscriber to monthly correctly', async () => {
    const events = [
      makeEvent(SUB1, TOKEN_A, '100', 3 * WEEK_S),
      makeEvent(SUB1, TOKEN_A, '100', 2 * WEEK_S),
      makeEvent(SUB1, TOKEN_A, '100', WEEK_S),
      makeEvent(SUB1, TOKEN_A, '100', 0),
    ];
    const db = { event: { findMany: jest.fn().mockResolvedValue(events) } } as any;
    const result = await computeMrr(MERCHANT, db);

    expect(result.tokens).toHaveLength(1);
    // weekly 100 → monthly ≈ 428 (integer)
    const mrr = BigInt(result.tokens[0].mrr_amount);
    expect(mrr).toBeGreaterThan(400n);
    expect(mrr).toBeLessThan(450n);
  });

  it('groups subscriptions by token and returns separate entries', async () => {
    const events = [
      makeEvent(SUB1, TOKEN_A, '500', MONTH_S),
      makeEvent(SUB1, TOKEN_A, '500', 0),
      makeEvent(SUB2, TOKEN_B, '200', MONTH_S),
      makeEvent(SUB2, TOKEN_B, '200', 0),
    ];
    const db = { event: { findMany: jest.fn().mockResolvedValue(events) } } as any;
    const result = await computeMrr(MERCHANT, db);

    expect(result.tokens).toHaveLength(2);
    const tokenA = result.tokens.find((t) => t.token === TOKEN_A);
    const tokenB = result.tokens.find((t) => t.token === TOKEN_B);
    expect(tokenA).toBeDefined();
    expect(tokenB).toBeDefined();
    expect(tokenA!.active_subscriptions).toBe(1);
    expect(tokenB!.active_subscriptions).toBe(1);
  });

  it('accumulates MRR from multiple subscribers on the same token', async () => {
    const events = [
      makeEvent(SUB1, TOKEN_A, '300', MONTH_S),
      makeEvent(SUB1, TOKEN_A, '300', 0),
      makeEvent(SUB2, TOKEN_A, '700', MONTH_S),
      makeEvent(SUB2, TOKEN_A, '700', 0),
    ];
    const db = { event: { findMany: jest.fn().mockResolvedValue(events) } } as any;
    const result = await computeMrr(MERCHANT, db);

    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0].active_subscriptions).toBe(2);
    // 300 + 700 = 1000 (both monthly)
    const mrr = BigInt(result.tokens[0].mrr_amount);
    expect(mrr).toBeGreaterThan(900n);
    expect(mrr).toBeLessThan(1100n);
  });

  it('handles three tokens and three subscribers correctly', async () => {
    const TOKEN_C = 'CSTR0000000000000000000000000000000000000000000000003';
    const events = [
      makeEvent(SUB1, TOKEN_A, '1000', MONTH_S),
      makeEvent(SUB1, TOKEN_A, '1000', 0),
      makeEvent(SUB2, TOKEN_B, '500',  MONTH_S),
      makeEvent(SUB2, TOKEN_B, '500',  0),
      makeEvent(SUB3, TOKEN_C, '250',  MONTH_S),
      makeEvent(SUB3, TOKEN_C, '250',  0),
    ];
    const db = { event: { findMany: jest.fn().mockResolvedValue(events) } } as any;
    const result = await computeMrr(MERCHANT, db);

    expect(result.tokens).toHaveLength(3);
    expect(result.tokens.every((t) => t.active_subscriptions === 1)).toBe(true);
  });

  it('uses the most recent payment amount (not oldest) as subscription amount', async () => {
    // Subscriber upgraded from 100 → 500; MRR should reflect 500
    const events = [
      makeEvent(SUB1, TOKEN_A, '100', 2 * MONTH_S),
      makeEvent(SUB1, TOKEN_A, '500', MONTH_S),
      makeEvent(SUB1, TOKEN_A, '500', 0),
    ];
    const db = { event: { findMany: jest.fn().mockResolvedValue(events) } } as any;
    const result = await computeMrr(MERCHANT, db);

    const mrr = BigInt(result.tokens[0].mrr_amount);
    expect(mrr).toBeGreaterThan(400n); // based on 500, not 100
  });
});
