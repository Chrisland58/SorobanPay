/**
 * backend/src/routes/mrr.ts
 *
 * MRR (Monthly Recurring Revenue) analytics endpoint (#1378).
 *
 * GET /api/v1/analytics/mrr/:merchant
 *
 * Calculates MRR per token for a merchant based on executed payment history.
 *
 * MRR formula:
 *   For each active subscription:
 *     monthly_contribution = amount / (interval_seconds / 2_592_000)
 *   Where 2_592_000 = 30 days in seconds (one calendar month).
 *   MRR = sum of monthly_contribution across all active subscriptions, grouped by token.
 *
 * Since the payment interval is not stored in the database, it is inferred from
 * the median gap between consecutive executed payments per (subscriber, token) pair.
 * When only one payment exists for a pair, the interval defaults to monthly.
 *
 * Caching: results are cached in-memory for 5 minutes per merchant address.
 *
 * Auth: requireMerchant — the JWT merchant address must match the :merchant param.
 */

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { requireMerchant } from '../middleware/merchantAuth';

// ─── Constants ────────────────────────────────────────────────────────────────

export const MRR_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TokenMrr {
  token: string;
  mrr_amount: string;         // BigInt as string, in token's smallest unit (stroops)
  active_subscriptions: number;
  currency_symbol: string;    // empty — clients resolve via SEP-41 token metadata
}

export interface MrrResponse {
  merchant: string;
  tokens: TokenMrr[];
  computed_at: string;
  cache_hit: boolean;
}

interface MrrCacheEntry {
  data: MrrResponse;
  cachedAt: number;
}

// ─── In-memory cache ─────────────────────────────────────────────────────────

/** In-memory MRR cache keyed by merchant address */
export const mrrCache = new Map<string, MrrCacheEntry>();

/**
 * Returns the cached MRR for a merchant if present and within TTL.
 * Evicts the stale entry and returns null if expired.
 */
export function getCachedMrr(merchant: string): MrrResponse | null {
  const entry = mrrCache.get(merchant);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > MRR_CACHE_TTL_MS) {
    mrrCache.delete(merchant);
    return null;
  }
  return { ...entry.data, cache_hit: true };
}

// ─── MRR computation helpers ──────────────────────────────────────────────────

/**
 * Normalises a payment amount to a monthly equivalent given the interval in seconds.
 *
 * monthly = amount × 2_592_000 / interval
 *
 * Uses integer BigInt arithmetic to avoid floating-point loss.
 * interval ≤ 0 is treated as monthly (returns amount unchanged).
 */
export function normaliseToMonthly(amount: bigint, intervalSeconds: number): bigint {
  if (intervalSeconds <= 0) return amount;
  const MONTH_SECONDS = 2_592_000n;
  return (amount * MONTH_SECONDS) / BigInt(intervalSeconds);
}

/**
 * Infers the payment interval (in seconds) from a list of ledger timestamps (ms).
 *
 * Computes the median gap between consecutive sorted timestamps.
 * Returns 2_592_000 (30 days) when fewer than two timestamps are present
 * (single payment → assume monthly billing).
 */
export function inferInterval(timestampsMs: number[]): number {
  if (timestampsMs.length < 2) return 2_592_000; // default: monthly
  const sorted = [...timestampsMs].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(Math.round((sorted[i] - sorted[i - 1]) / 1000));
  }
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)]; // median gap in seconds
}

/**
 * Core MRR computation for a merchant.
 *
 * Queries executed payments in the last 60 days, groups them by
 * (subscriber, token), infers each subscription's interval, and sums
 * the pro-rated monthly contributions grouped by token.
 *
 * @param merchant  Stellar merchant address
 * @param db        Injectable Prisma client (for unit testing without a real DB)
 */
export async function computeMrr(
  merchant: string,
  db: typeof prisma = prisma,
): Promise<MrrResponse> {
  const sixtDaysAgoSeconds = BigInt(Math.floor((Date.now() - SIXTY_DAYS_MS) / 1000));

  const recentPayments = await db.event.findMany({
    where: {
      merchant,
      type: 'executed',
      ledgerTimestamp: { gte: sixtDaysAgoSeconds },
    },
    orderBy: { ledgerTimestamp: 'asc' },
  });

  // Group by (subscriber, token) to reconstruct per-subscription payment history
  type SubKey = string; // `${subscriber}|${token}`
  const groups = new Map<
    SubKey,
    { subscriber: string; token: string; amounts: bigint[]; timestampsMs: number[] }
  >();

  for (const p of recentPayments) {
    const key: SubKey = `${p.subscriber}|${p.token}`;
    const amount = BigInt(p.amount ?? '0');
    const tsMs = Number(p.ledgerTimestamp) * 1000;

    const existing = groups.get(key);
    if (existing) {
      existing.amounts.push(amount);
      existing.timestampsMs.push(tsMs);
    } else {
      groups.set(key, {
        subscriber: p.subscriber,
        token: p.token,
        amounts: [amount],
        timestampsMs: [tsMs],
      });
    }
  }

  // Aggregate MRR per token
  const tokenMrr = new Map<string, { mrr: bigint; count: number }>();

  for (const group of groups.values()) {
    const { token, amounts, timestampsMs } = group;
    // Use the most recent payment amount as the current subscription amount
    const latestAmount = amounts[amounts.length - 1];
    const interval = inferInterval(timestampsMs);
    const monthlyContribution = normaliseToMonthly(latestAmount, interval);

    const existing = tokenMrr.get(token) ?? { mrr: 0n, count: 0 };
    tokenMrr.set(token, {
      mrr: existing.mrr + monthlyContribution,
      count: existing.count + 1,
    });
  }

  const tokens: TokenMrr[] = Array.from(tokenMrr.entries()).map(([token, data]) => ({
    token,
    mrr_amount: data.mrr.toString(),
    active_subscriptions: data.count,
    // currency_symbol not available from the contract address alone;
    // clients should resolve this from the SEP-41 token metadata endpoint.
    currency_symbol: '',
  }));

  return {
    merchant,
    tokens,
    computed_at: new Date().toISOString(),
    cache_hit: false,
  };
}

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

/**
 * GET /api/v1/analytics/mrr/:merchant
 *
 * Returns MRR grouped by token for the specified merchant.
 * Results are cached for 5 minutes per merchant address.
 *
 * Response shape:
 * {
 *   merchant: string,
 *   tokens: Array<{
 *     token: string,
 *     mrr_amount: string,
 *     active_subscriptions: number,
 *     currency_symbol: string
 *   }>,
 *   computed_at: string,
 *   cache_hit: boolean
 * }
 */
router.get('/:merchant', requireMerchant, async (req: Request, res: Response): Promise<void> => {
  const merchantAddress = res.locals.merchantAddress as string;
  const requestedMerchant = req.params['merchant'];

  // Enforce that a merchant can only query their own MRR
  if (merchantAddress !== requestedMerchant) {
    res.status(403).json({
      error: 'Forbidden: you can only query MRR for your own merchant address',
      code: 'FORBIDDEN',
    });
    return;
  }

  // Return cached result if fresh
  const cached = getCachedMrr(merchantAddress);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const result = await computeMrr(merchantAddress);

    // Store in cache for 5 minutes
    mrrCache.set(merchantAddress, { data: result, cachedAt: Date.now() });

    res.json(result);
  } catch (err) {
    console.error('[mrr] computeMrr error:', err);
    res.status(500).json({ error: 'Failed to compute MRR' });
  }
});

export default router;
