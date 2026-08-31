/**
 * #735 — Analytics and event tracking service.
 *
 * Features:
 *   - Track key user interactions as events
 *   - Page view and navigation tracking
 *   - Custom business events with properties
 *   - User property tracking
 *   - User segmentation support
 *   - Privacy-first design (GDPR compliant): no PII without consent
 *   - Dashboard aggregation queries
 */

import { createHash } from 'crypto';
import prisma from '../lib/prisma';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrackEventOptions {
  eventName: string;
  userId?: string;
  anonymousId?: string;
  sessionId?: string;
  properties?: Record<string, unknown>;
  page?: string;
  referrer?: string;
  userAgent?: string;
  ip?: string;
  consentGiven?: boolean;
}

export interface PageViewOptions {
  page: string;
  userId?: string;
  anonymousId?: string;
  sessionId?: string;
  referrer?: string;
  userAgent?: string;
  ip?: string;
  consentGiven?: boolean;
}

export interface ConsentOptions {
  userId?: string;
  anonymousId?: string;
  analytics: boolean;
  marketing: boolean;
  functional?: boolean;
  ip?: string;
  userAgent?: string;
}

export interface DashboardStats {
  totalEvents: number;
  uniqueUsers: number;
  pageViews: number;
  topPages: Array<{ page: string; views: number }>;
  topEvents: Array<{ eventName: string; count: number }>;
  dailyTrend: Array<{ date: string; count: number }>;
  consentRate: number;
}

// ---------------------------------------------------------------------------
// Privacy helpers
// ---------------------------------------------------------------------------

/**
 * Hash an IP address for privacy (GDPR: IP is personal data).
 * Uses SHA-256; irreversible.
 */
function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

/**
 * Strip PII from properties when consent is not given.
 * Removes known PII fields: email, phone, name, address, etc.
 */
function sanitizeProperties(
  properties: Record<string, unknown>,
  consentGiven: boolean,
): Record<string, unknown> {
  if (consentGiven) return properties;

  const PII_FIELDS = new Set([
    'email', 'phone', 'name', 'firstName', 'lastName', 'first_name', 'last_name',
    'address', 'city', 'state', 'zip', 'zipCode', 'country', 'dateOfBirth', 'dob',
    'ssn', 'passport', 'nationalId', 'creditCard', 'cardNumber',
  ]);

  const safe: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(properties)) {
    if (!PII_FIELDS.has(key.toLowerCase())) {
      safe[key] = val;
    }
  }
  return safe;
}

// ---------------------------------------------------------------------------
// Consent management
// ---------------------------------------------------------------------------

/**
 * Record user consent choices (GDPR consent layer).
 */
export async function recordConsent(options: ConsentOptions): Promise<number> {
  const ipHash = options.ip ? hashIp(options.ip) : null;

  const record = await prisma.consentRecord.create({
    data: {
      userId:      options.userId ?? null,
      anonymousId: options.anonymousId ?? null,
      analytics:   options.analytics,
      marketing:   options.marketing,
      functional:  options.functional ?? true,
      ipHash,
      userAgent:   options.userAgent ?? null,
    },
  });

  console.log(`[analytics] Consent recorded: id=${record.id} analytics=${options.analytics} marketing=${options.marketing}`);
  return record.id;
}

/**
 * Get the latest consent record for a user or anonymous session.
 */
export async function getConsent(userId?: string, anonymousId?: string) {
  if (!userId && !anonymousId) return null;

  return prisma.consentRecord.findFirst({
    where: {
      ...(userId ? { userId } : {}),
      ...(anonymousId && !userId ? { anonymousId } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Check whether analytics tracking is permitted for a user/session.
 */
export async function hasAnalyticsConsent(userId?: string, anonymousId?: string): Promise<boolean> {
  const record = await getConsent(userId, anonymousId);
  return record?.analytics ?? false;
}

// ---------------------------------------------------------------------------
// Core tracking
// ---------------------------------------------------------------------------

/**
 * Track any named event. PII is stripped if consent is not given.
 */
export async function trackEvent(options: TrackEventOptions): Promise<number> {
  const {
    eventName, userId, anonymousId, sessionId,
    properties = {}, page, referrer, userAgent, ip,
    consentGiven = false,
  } = options;

  // Consent check: if no explicit consent, verify stored consent
  let effectiveConsent = consentGiven;
  if (!effectiveConsent) {
    effectiveConsent = await hasAnalyticsConsent(userId, anonymousId);
  }

  const safeProps = sanitizeProperties(properties, effectiveConsent);
  const ipHash    = ip ? hashIp(ip) : null;

  const event = await prisma.analyticsEvent.create({
    data: {
      eventName,
      userId:       userId ?? null,
      anonymousId:  anonymousId ?? null,
      sessionId:    sessionId ?? null,
      properties:   Object.keys(safeProps).length > 0 ? JSON.stringify(safeProps) : null,
      page:         page ?? null,
      referrer:     referrer ?? null,
      userAgent:    userAgent ?? null,
      ipHash,
      consentGiven: effectiveConsent,
    },
  });

  return event.id;
}

/**
 * Track a page view.
 */
export async function trackPageView(options: PageViewOptions): Promise<number> {
  return trackEvent({
    eventName:   'page_view',
    userId:      options.userId,
    anonymousId: options.anonymousId,
    sessionId:   options.sessionId,
    page:        options.page,
    referrer:    options.referrer,
    userAgent:   options.userAgent,
    ip:          options.ip,
    consentGiven: options.consentGiven,
    properties:  { path: options.page },
  });
}

// ---------------------------------------------------------------------------
// Standard business events
// ---------------------------------------------------------------------------

export async function trackSubscriptionCreated(
  userId: string, merchant: string, amount: string, token: string,
): Promise<void> {
  await trackEvent({
    eventName: 'subscription_created',
    userId,
    properties: { merchant, amount, token },
    consentGiven: true,
  });
}

export async function trackPaymentExecuted(
  userId: string, merchant: string, amount: string, txHash: string,
): Promise<void> {
  await trackEvent({
    eventName: 'payment_executed',
    userId,
    properties: { merchant, amount, txHash },
    consentGiven: true,
  });
}

export async function trackPaymentFailed(
  userId: string, merchant: string, amount: string,
): Promise<void> {
  await trackEvent({
    eventName: 'payment_failed',
    userId,
    properties: { merchant, amount },
    consentGiven: true,
  });
}

export async function trackSubscriptionCancelled(
  userId: string, merchant: string,
): Promise<void> {
  await trackEvent({
    eventName: 'subscription_cancelled',
    userId,
    properties: { merchant },
    consentGiven: true,
  });
}

export async function trackWalletConnected(
  userId?: string, anonymousId?: string, walletType = 'freighter',
): Promise<void> {
  await trackEvent({
    eventName: 'wallet_connected',
    userId,
    anonymousId,
    properties: { walletType },
  });
}

// ---------------------------------------------------------------------------
// Dashboard aggregations
// ---------------------------------------------------------------------------

/**
 * Get analytics dashboard statistics for a date range.
 */
export async function getDashboardStats(
  startDate: Date = new Date(Date.now() - 30 * 24 * 3600_000),
  endDate: Date = new Date(),
): Promise<DashboardStats> {
  const [
    totalEvents,
    consentCount,
    pageViews,
    topPagesRaw,
    topEventsRaw,
    dailyRaw,
  ] = await Promise.all([
    // Total events in range
    prisma.analyticsEvent.count({
      where: { createdAt: { gte: startDate, lte: endDate } },
    }),

    // Consent rate
    prisma.analyticsEvent.count({
      where: { createdAt: { gte: startDate, lte: endDate }, consentGiven: true },
    }),

    // Total page views
    prisma.analyticsEvent.count({
      where: { eventName: 'page_view', createdAt: { gte: startDate, lte: endDate } },
    }),

    // Top pages (group by page)
    prisma.analyticsEvent.groupBy({
      by: ['page'],
      where: { eventName: 'page_view', page: { not: null }, createdAt: { gte: startDate, lte: endDate } },
      _count: { page: true },
      orderBy: { _count: { page: 'desc' } },
      take: 10,
    }),

    // Top events (group by eventName)
    prisma.analyticsEvent.groupBy({
      by: ['eventName'],
      where: { createdAt: { gte: startDate, lte: endDate } },
      _count: { eventName: true },
      orderBy: { _count: { eventName: 'desc' } },
      take: 10,
    }),

    // Daily trend — raw events grouped by date
    prisma.$queryRaw`
      SELECT DATE("createdAt")::text AS date, COUNT(*)::bigint AS count
      FROM "AnalyticsEvent"
      WHERE "createdAt" >= ${startDate} AND "createdAt" <= ${endDate}
      GROUP BY DATE("createdAt")
      ORDER BY DATE("createdAt")
    ` as Promise<Array<{ date: string; count: bigint }>>,
  ]);

  // Count unique users (non-null userId or anonymousId)
  const uniqueUsersResult = await prisma.analyticsEvent.groupBy({
    by: ['userId'],
    where: {
      userId: { not: null },
      createdAt: { gte: startDate, lte: endDate },
    },
    _count: true,
  });
  const uniqueUsers = uniqueUsersResult.length;

  const topPages = topPagesRaw.map((r: { page: string | null; _count: { page: number } }) => ({
    page: r.page ?? '/',
    views: r._count.page,
  }));

  const topEvents = topEventsRaw.map((r: { eventName: string; _count: { eventName: number } }) => ({
    eventName: r.eventName,
    count: r._count.eventName,
  }));

  const dailyTrend = (dailyRaw as Array<{ date: string; count: bigint }>).map(r => ({
    date: r.date,
    count: Number(r.count),
  }));

  const consentRate = totalEvents > 0 ? Math.round((consentCount / totalEvents) * 100) : 0;

  return {
    totalEvents,
    uniqueUsers,
    pageViews,
    topPages,
    topEvents,
    dailyTrend,
    consentRate,
  };
}

/**
 * Get event count per name for a specific user (user behaviour profile).
 */
export async function getUserEventProfile(userId: string) {
  return prisma.analyticsEvent.groupBy({
    by: ['eventName'],
    where: { userId },
    _count: { eventName: true },
    orderBy: { _count: { eventName: 'desc' } },
  });
}

/**
 * Get recent events for a user (last N events).
 */
export async function getRecentEventsForUser(userId: string, limit = 50) {
  return prisma.analyticsEvent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true, eventName: true, page: true, properties: true, createdAt: true,
    },
  });
}
