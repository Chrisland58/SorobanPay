/**
 * #735 — Analytics and event tracking API routes.
 *
 * Routes:
 *   POST  /api/v1/analytics/events          — Track a custom event
 *   POST  /api/v1/analytics/pageview        — Track a page view
 *   POST  /api/v1/analytics/consent         — Record GDPR consent
 *   GET   /api/v1/analytics/consent         — Get consent for user/session
 *   GET   /api/v1/analytics/dashboard       — Aggregated dashboard stats
 *   GET   /api/v1/analytics/users/:userId   — User event profile
 *   GET   /api/v1/analytics/users/:userId/events — Recent events for user
 */

import { Router, Request, Response } from 'express';
import {
  trackEvent,
  trackPageView,
  recordConsent,
  getConsent,
  getDashboardStats,
  getUserEventProfile,
  getRecentEventsForUser,
} from '../services/analyticsService';

const router = Router();

// ---------------------------------------------------------------------------
// Track custom event
// ---------------------------------------------------------------------------

/**
 * POST /events
 * Body: { eventName, userId?, anonymousId?, sessionId?, properties?, page?, referrer? }
 * Headers: User-Agent used for tracking
 */
router.post('/events', async (req: Request, res: Response) => {
  const {
    eventName, userId, anonymousId, sessionId,
    properties, page, referrer, consentGiven,
  } = req.body ?? {};

  if (!eventName || typeof eventName !== 'string') {
    return res.status(400).json({ error: 'eventName is required' });
  }

  if (!userId && !anonymousId) {
    return res.status(400).json({ error: 'Either userId or anonymousId is required' });
  }

  try {
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '');
    const userAgent = String(req.headers['user-agent'] ?? '');

    const eventId = await trackEvent({
      eventName, userId, anonymousId, sessionId,
      properties, page, referrer,
      userAgent, ip,
      consentGiven: Boolean(consentGiven),
    });

    return res.status(201).json({ success: true, eventId });
  } catch (err) {
    console.error('[analytics route] track event error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Track page view
// ---------------------------------------------------------------------------

/**
 * POST /pageview
 * Body: { page, userId?, anonymousId?, sessionId?, referrer? }
 */
router.post('/pageview', async (req: Request, res: Response) => {
  const { page, userId, anonymousId, sessionId, referrer, consentGiven } = req.body ?? {};

  if (!page || typeof page !== 'string') {
    return res.status(400).json({ error: 'page is required' });
  }

  try {
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '');
    const userAgent = String(req.headers['user-agent'] ?? '');

    const eventId = await trackPageView({
      page, userId, anonymousId, sessionId, referrer,
      userAgent, ip,
      consentGiven: Boolean(consentGiven),
    });

    return res.status(201).json({ success: true, eventId });
  } catch (err) {
    console.error('[analytics route] page view error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Consent management (GDPR)
// ---------------------------------------------------------------------------

/**
 * POST /consent
 * Body: { userId?, anonymousId?, analytics, marketing, functional? }
 *
 * Must be called before tracking PII-containing events.
 */
router.post('/consent', async (req: Request, res: Response) => {
  const { userId, anonymousId, analytics, marketing, functional } = req.body ?? {};

  if (typeof analytics !== 'boolean' || typeof marketing !== 'boolean') {
    return res.status(400).json({ error: 'analytics and marketing (boolean) are required' });
  }

  if (!userId && !anonymousId) {
    return res.status(400).json({ error: 'Either userId or anonymousId is required' });
  }

  try {
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '');
    const userAgent = String(req.headers['user-agent'] ?? '');

    const consentId = await recordConsent({
      userId, anonymousId, analytics, marketing,
      functional: functional ?? true,
      ip, userAgent,
    });

    return res.status(201).json({
      success: true,
      consentId,
      message: 'Consent recorded',
    });
  } catch (err) {
    console.error('[analytics route] consent error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /consent?userId=&anonymousId=
 */
router.get('/consent', async (req: Request, res: Response) => {
  const { userId, anonymousId } = req.query;

  if (!userId && !anonymousId) {
    return res.status(400).json({ error: 'userId or anonymousId query param required' });
  }

  try {
    const record = await getConsent(
      userId as string | undefined,
      anonymousId as string | undefined,
    );

    if (!record) {
      return res.status(404).json({ error: 'No consent record found' });
    }

    return res.json({
      id:          record.id,
      analytics:   record.analytics,
      marketing:   record.marketing,
      functional:  record.functional,
      createdAt:   record.createdAt,
      updatedAt:   record.updatedAt,
    });
  } catch (err) {
    console.error('[analytics route] consent get error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/**
 * GET /dashboard?startDate=&endDate=
 * Returns aggregated analytics for the given date range (default: last 30 days).
 */
router.get('/dashboard', async (req: Request, res: Response) => {
  let startDate: Date | undefined;
  let endDate: Date | undefined;

  if (req.query.startDate) {
    startDate = new Date(String(req.query.startDate));
    if (isNaN(startDate.getTime())) {
      return res.status(400).json({ error: 'Invalid startDate' });
    }
  }

  if (req.query.endDate) {
    endDate = new Date(String(req.query.endDate));
    if (isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid endDate' });
    }
  }

  try {
    const stats = await getDashboardStats(startDate, endDate);
    return res.json(stats);
  } catch (err) {
    console.error('[analytics route] dashboard error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// User profiles
// ---------------------------------------------------------------------------

/**
 * GET /users/:userId
 * Returns event counts per name for a user.
 */
router.get('/users/:userId', async (req: Request, res: Response) => {
  const userId = String(req.params.userId);

  try {
    const profile = await getUserEventProfile(userId);
    return res.json({ userId, events: profile.map((p: { eventName: string; _count: { eventName: number } }) => ({ eventName: p.eventName, count: p._count.eventName })) });
  } catch (err) {
    console.error('[analytics route] user profile error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /users/:userId/events?limit=50
 */
router.get('/users/:userId/events', async (req: Request, res: Response) => {
  const userId = String(req.params.userId);
  const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 200);

  try {
    const events = await getRecentEventsForUser(userId, limit);
    return res.json({ userId, count: events.length, events });
  } catch (err) {
    console.error('[analytics route] user events error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
