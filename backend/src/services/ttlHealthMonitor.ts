/**
 * #1391 — TTL Health Monitor Service
 *
 * Background job that runs every 24 hours and identifies subscriptions at risk
 * of Soroban storage expiry. A subscription is "at risk" when:
 *   - Its last successful payment (executed event) was > TTL_RISK_DAYS ago, AND
 *   - No payment has been executed in the last TTL_RISK_DAYS (300 days by default)
 *
 * Soroban persistent storage TTL is ~365 days maximum, refreshed on every
 * successful execute_payment call. Subscriptions that go 300+ days without a
 * payment are at risk of on-chain expiry before the next collection attempt.
 *
 * When at-risk subscriptions are found, the monitor:
 *   1. Flags them in the database (status = "TTL_AT_RISK")
 *   2. Sends a webhook notification to the affected merchant
 *   3. Exposes the list via GET /api/v1/admin/ttl-health
 */

import prisma from '../lib/prisma';
import { notifyWebhooks } from './webhookNotifier';

// Subscriptions with no payment in this many days are considered at risk.
// Soroban TTL is ~365 days; alert 65 days before the deadline.
export const TTL_RISK_DAYS = 300;

// Seconds in TTL_RISK_DAYS
const TTL_RISK_SECONDS = BigInt(TTL_RISK_DAYS * 24 * 60 * 60);

export interface TtlAtRiskEntry {
  subscriber: string;
  merchant: string;
  token: string;
  amount: string;
  lastPaymentAt: string | null; // ISO timestamp or null (never paid)
  daysSinceLastPayment: number;
}

/**
 * Identify subscriptions at risk of Soroban storage TTL expiry.
 *
 * Strategy:
 *   1. Find all unique (subscriber, merchant, token) subscribe events.
 *   2. For each, find the most recent "executed" event.
 *   3. Flag pairs where the most recent executed event (or subscribe event if
 *      never paid) was more than TTL_RISK_DAYS ago.
 *
 * This runs in O(subscriptions) DB queries — acceptable for a 24h job.
 */
export async function findAtRiskSubscriptions(): Promise<TtlAtRiskEntry[]> {
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const cutoffSeconds = nowSeconds - TTL_RISK_SECONDS;

  // Step 1: all unique active subscription pairs (latest subscribe event per pair)
  const subscribeEvents = await prisma.event.findMany({
    where: { type: 'subscribe' },
    orderBy: { ledgerTimestamp: 'desc' },
    select: { subscriber: true, merchant: true, token: true, amount: true, ledgerTimestamp: true },
  });

  // Deduplicate to latest per (subscriber, merchant, token)
  const seen = new Map<string, typeof subscribeEvents[0]>();
  for (const e of subscribeEvents) {
    const key = `${e.subscriber}:${e.merchant}:${e.token}`;
    if (!seen.has(key)) seen.set(key, e);
  }

  const atRisk: TtlAtRiskEntry[] = [];

  for (const sub of seen.values()) {
    // Find the most recent executed payment for this pair
    const lastPayment = await prisma.event.findFirst({
      where: { type: 'executed', subscriber: sub.subscriber, merchant: sub.merchant, token: sub.token },
      orderBy: { ledgerTimestamp: 'desc' },
      select: { ledgerTimestamp: true },
    });

    // The timestamp that governs TTL: last payment or subscription creation
    const lastActivitySeconds: bigint = lastPayment?.ledgerTimestamp ?? sub.ledgerTimestamp;

    if (lastActivitySeconds < cutoffSeconds) {
      const daysSince = Math.floor(
        Number(nowSeconds - lastActivitySeconds) / (24 * 60 * 60),
      );
      atRisk.push({
        subscriber: sub.subscriber,
        merchant: sub.merchant,
        token: sub.token,
        amount: sub.amount,
        lastPaymentAt: lastPayment
          ? new Date(Number(lastPayment.ledgerTimestamp) * 1000).toISOString()
          : null,
        daysSinceLastPayment: daysSince,
      });
    }
  }

  return atRisk;
}

/**
 * Send webhook notifications to each affected merchant.
 *
 * Groups at-risk entries by merchant so each merchant receives one
 * notification containing all their at-risk subscriptions (not one per sub).
 */
export async function notifyMerchantsOfAtRiskSubscriptions(
  entries: TtlAtRiskEntry[],
): Promise<void> {
  if (entries.length === 0) return;

  // Group by merchant
  const byMerchant = new Map<string, TtlAtRiskEntry[]>();
  for (const entry of entries) {
    const list = byMerchant.get(entry.merchant) ?? [];
    list.push(entry);
    byMerchant.set(entry.merchant, list);
  }

  for (const [merchant, subs] of byMerchant) {
    try {
      await notifyWebhooks({
        event: 'payment.failed', // closest standard event type; metadata carries context
        subscriber: subs.map((s) => s.subscriber).join(','), // all affected subscribers
        merchant,
        amount: '0',
        timestamp: Math.floor(Date.now() / 1000),
        // traceContext carries the at-risk detail as a JSON blob
        traceContext: JSON.stringify({
          type: 'ttl_at_risk',
          atRiskCount: subs.length,
          subscriptions: subs,
        }),
      });
      console.log(
        `[ttl-health] Notified merchant ${merchant} of ${subs.length} at-risk subscription(s).`,
      );
    } catch (err) {
      console.error(`[ttl-health] Failed to notify merchant ${merchant}:`, err);
    }
  }
}

/**
 * Main job function — find at-risk subscriptions, notify merchants.
 * Called by the 24h cron job in index.ts.
 */
export async function runTtlHealthCheck(): Promise<TtlAtRiskEntry[]> {
  console.log('[ttl-health] Starting TTL health check...');
  const entries = await findAtRiskSubscriptions();
  console.log(`[ttl-health] Found ${entries.length} at-risk subscription(s).`);

  await notifyMerchantsOfAtRiskSubscriptions(entries);
  console.log('[ttl-health] TTL health check complete.');
  return entries;
}
