/**
 * BE-75 — Admin dashboard backend routes.
 *
 * All routes require a valid admin JWT (role=admin).
 * Mount at: /api/v1/admin
 *
 * Endpoints:
 *   GET /indexer   — indexer lag, last cursor, events processed today
 *   GET /webhooks  — total deliveries, failure rate, pending retries
 *   GET /errors    — paginated error log
 *   GET /metrics   — Prometheus-format system metrics
 */
import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { requireAdmin } from '../middleware/adminAuth';
import {
  getPrometheusMetrics,
  incrementCounter,
  setGauge,
} from '../services/metricsService';

const router = Router();

// All admin routes require admin JWT
router.use(requireAdmin);

// ---------------------------------------------------------------------------
// GET /api/v1/admin/indexer
// ---------------------------------------------------------------------------
/**
 * Returns indexer health metrics:
 *   - lastCursor         — the last persisted RPC event cursor
 *   - lastPollAt         — timestamp of the last successful poll
 *   - eventsProcessedToday — count of events stored today
 *   - lagSeconds         — estimated seconds behind the chain tip
 *     (null if lastPollAt is unavailable)
 */
router.get('/indexer', async (_req: Request, res: Response) => {
  try {
    const [stateRow, todayCount] = await Promise.all([
      prisma.$queryRaw<Array<{ key: string; value: string; updated_at: Date }>>`
        SELECT key, value, updated_at
        FROM indexer_state
        WHERE key IN ('last_event_cursor', 'last_poll_at')
      `.catch(() => [] as Array<{ key: string; value: string; updated_at: Date }>),

      prisma.event.count({
        where: {
          createdAt: {
            gte: new Date(new Date().setUTCHours(0, 0, 0, 0)),
          },
        },
      }),
    ]);

    const stateMap = Object.fromEntries(
      (stateRow as Array<{ key: string; value: string; updated_at: Date }>).map(
        (r) => [r.key, { value: r.value, updatedAt: r.updated_at }],
      ),
    );

    const lastPollEntry = stateMap['last_poll_at'];
    const lagSeconds = lastPollEntry
      ? Math.floor((Date.now() - new Date(lastPollEntry.value).getTime()) / 1000)
      : null;

    // Update Prometheus gauge
    if (lagSeconds !== null) setGauge('indexer_lag_seconds', lagSeconds);

    res.json({
      lastCursor: stateMap['last_event_cursor']?.value ?? null,
      lastPollAt: lastPollEntry?.value ?? null,
      eventsProcessedToday: todayCount,
      lagSeconds,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch indexer metrics' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/webhooks
// ---------------------------------------------------------------------------
/**
 * Returns webhook delivery metrics:
 *   - totalDeliveries       — all-time delivery count
 *   - successCount          — successful deliveries (2xx)
 *   - failureCount          — failed deliveries (non-2xx or network error)
 *   - failureRate           — failureCount / totalDeliveries (0–1)
 *   - pendingRetries        — deliveries that failed on last attempt but have attempts < MAX
 *   - last24hDeliveries     — deliveries in the last 24 hours
 *   - last24hFailures       — failures in the last 24 hours
 */
router.get('/webhooks', async (_req: Request, res: Response) => {
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [total, successCount, last24h, last24hFail, pendingRetries] = await Promise.all([
      prisma.webhookDelivery.count(),
      prisma.webhookDelivery.count({ where: { success: true } }),
      prisma.webhookDelivery.count({ where: { createdAt: { gte: since24h } } }),
      prisma.webhookDelivery.count({ where: { success: false, createdAt: { gte: since24h } } }),
      // Pending retries: failed deliveries where this event has fewer than 5 attempts total
      prisma.$queryRaw<Array<{ cnt: bigint }>>`
        SELECT COUNT(*) as cnt FROM (
          SELECT event_id
          FROM webhook_deliveries
          GROUP BY event_id
          HAVING MAX(attempt) < 5 AND bool_or(success) = false
        ) sub
      `.catch(() => [{ cnt: BigInt(0) }]),
    ]);

    const failureCount = total - successCount;
    const failureRate = total > 0 ? failureCount / total : 0;
    const pendingRetriesCount = Number((pendingRetries as Array<{ cnt: bigint }>)[0]?.cnt ?? 0);

    // Update Prometheus counters
    incrementCounter('webhook_delivery_total', { status: 'success' }, successCount);
    incrementCounter('webhook_delivery_total', { status: 'failure' }, failureCount);

    res.json({
      totalDeliveries: total,
      successCount,
      failureCount,
      failureRate: Math.round(failureRate * 10000) / 10000,
      pendingRetries: pendingRetriesCount,
      last24hDeliveries: last24h,
      last24hFailures: last24hFail,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch webhook metrics' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/errors
// ---------------------------------------------------------------------------
/**
 * Returns paginated webhook delivery error log.
 * Query params:
 *   limit  — records per page (default 50, max 200)
 *   offset — pagination offset (default 0)
 *   since  — ISO 8601 date string; only return errors after this time
 */
router.get('/errors', async (req: Request, res: Response) => {
  const limit  = Math.min(parseInt((req.query.limit  as string) ?? '50', 10), 200);
  const offset = Math.max(parseInt((req.query.offset as string) ?? '0',  10), 0);
  const since  = req.query.since ? new Date(req.query.since as string) : undefined;

  if (since && isNaN(since.getTime())) {
    return res.status(400).json({ error: 'since must be a valid ISO 8601 date' });
  }

  try {
    const where = {
      success: false,
      ...(since && { createdAt: { gte: since } }),
    };

    const [errors, total] = await prisma.$transaction([
      prisma.webhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          eventId: true,
          deliveryId: true,
          url: true,
          merchant: true,
          event: true,
          statusCode: true,
          attempt: true,
          error: true,
          createdAt: true,
        },
      }),
      prisma.webhookDelivery.count({ where }),
    ]);

    res.json({
      data: errors,
      meta: { total, limit, offset },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch error log' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/metrics  (Prometheus format)
// ---------------------------------------------------------------------------
/**
 * Returns current system metrics in Prometheus text exposition format.
 * Designed to be scraped by an internal Prometheus instance.
 *
 * Note: if you want unauthenticated scraping (for internal network only),
 * mount GET /metrics without requireAdmin in index.ts.
 */
router.get('/metrics', (_req: Request, res: Response) => {
  res.set('Content-Type', 'text/plain; version=0.0.4');
  res.send(getPrometheusMetrics());
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/subscriptions — #1381
// ---------------------------------------------------------------------------
/**
 * Returns paginated subscriptions across ALL merchants for admin monitoring.
 *
 * Query params:
 *   status     {string}  — filter by ACTIVE | PAUSED | OVERDUE | CANCELLED | EXPIRED
 *   merchant   {string}  — filter by merchant address
 *   subscriber {string}  — filter by subscriber address
 *   token      {string}  — filter by token contract address
 *   from       {string}  — ISO 8601 date; subscriptions created at or after
 *   to         {string}  — ISO 8601 date; subscriptions created at or before
 *   page       {number}  — 1-indexed page number (default: 1)
 *   pageSize   {number}  — records per page (default: 50, max: 200)
 *
 * Rate limit: 20 req/min (enforced by the postRateLimiter applied at the
 * application level — admin routes share the global selectiveRateLimiter).
 *
 * Response 200:
 *   { data: Subscription[], meta: { total, page, pageSize, totalPages } }
 * Response 400: invalid query params
 * Response 401: missing or invalid JWT
 * Response 403: token valid but role !== 'admin'
 */
router.get('/subscriptions', async (req: Request, res: Response) => {
  const page     = Math.max(1,   parseInt((req.query.page     as string) ?? '1',   10));
  const pageSize = Math.min(200, Math.max(1, parseInt((req.query.pageSize as string) ?? '50', 10)));

  // Optional filters
  const statusFilter     = req.query.status     as string | undefined;
  const merchantFilter   = req.query.merchant   as string | undefined;
  const subscriberFilter = req.query.subscriber as string | undefined;
  const tokenFilter      = req.query.token      as string | undefined;
  const fromParam        = req.query.from        as string | undefined;
  const toParam          = req.query.to          as string | undefined;

  // Validate status filter
  const VALID_STATUSES = ['ACTIVE', 'PAUSED', 'OVERDUE', 'CANCELLED', 'EXPIRED'];
  if (statusFilter && !VALID_STATUSES.includes(statusFilter.toUpperCase())) {
    return res.status(400).json({
      error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
    });
  }

  // Validate date filters
  let fromDate: Date | undefined;
  let toDate: Date | undefined;
  if (fromParam) {
    fromDate = new Date(fromParam);
    if (isNaN(fromDate.getTime())) {
      return res.status(400).json({ error: 'from must be a valid ISO 8601 date' });
    }
  }
  if (toParam) {
    toDate = new Date(toParam);
    if (isNaN(toDate.getTime())) {
      return res.status(400).json({ error: 'to must be a valid ISO 8601 date' });
    }
  }

  try {
    const where: Record<string, unknown> = {};

    if (statusFilter)     where.status     = statusFilter.toUpperCase();
    if (merchantFilter)   where.merchant   = merchantFilter;
    if (subscriberFilter) where.subscriber = subscriberFilter;
    if (tokenFilter)      where.token      = tokenFilter;
    if (fromDate || toDate) {
      where.createdAt = {
        ...(fromDate && { gte: fromDate }),
        ...(toDate   && { lte: toDate   }),
      };
    }

    const skip = (page - 1) * pageSize;

    const [data, total] = await prisma.$transaction([
      prisma.subscription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip,
      }),
      prisma.subscription.count({ where }),
    ]);

    const totalPages = Math.ceil(total / pageSize);

    return res.json({
      data,
      meta: { total, page, pageSize, totalPages },
    });
  } catch (_err) {
    return res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/admin/subscriptions/:id — #1381
// ---------------------------------------------------------------------------
/**
 * Returns a single subscription by database ID for admin inspection.
 *
 * Response 200: Subscription object
 * Response 400: non-numeric id
 * Response 404: subscription not found
 */
router.get('/subscriptions/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'id must be a numeric value' });
  }

  try {
    const subscription = await prisma.subscription.findUnique({ where: { id } });
    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }
    return res.json(subscription);
  } catch (_err) {
    return res.status(500).json({ error: 'Failed to fetch subscription' });
  }
});

export default router;

