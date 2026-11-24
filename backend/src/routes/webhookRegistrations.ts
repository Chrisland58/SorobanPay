/**
 * backend/src/routes/webhookRegistrations.ts
 *
 * Merchant webhook registration endpoints for SorobanPay (#1376).
 *
 * Routes:
 *   POST   /api/v1/webhook-registrations          — register a new webhook endpoint
 *   GET    /api/v1/webhook-registrations/:merchant — list webhooks for a merchant
 *   DELETE /api/v1/webhook-registrations/:id       — remove a webhook registration
 *
 * Auth: requireMerchant middleware (JWT Bearer token)
 * URL validation: HEAD request confirms the endpoint is reachable before saving
 *
 * Security model:
 *   - Each webhook gets a randomly generated 32-byte HMAC signing secret, returned
 *     once on creation and never again (not included in GET responses).
 *   - Ownership is enforced: a merchant can only read or delete their own webhooks.
 *   - Duplicate (merchant, url) pairs are rejected with 409 Conflict.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import prisma from '../lib/prisma';
import { requireMerchant } from '../middleware/merchantAuth';

const router = Router();

// ─── Valid event types ────────────────────────────────────────────────────────

export const VALID_EVENT_TYPES = [
  'payment.executed',
  'payment.failed',
  'subscription.cancelled',
  'subscription.created',
  'subscription.updated',
] as const;

export type EventType = typeof VALID_EVENT_TYPES[number];

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const createWebhookSchema = z.object({
  url: z.string().url({ message: 'url must be a valid HTTP/HTTPS URL' }),
  events: z
    .array(z.enum(VALID_EVENT_TYPES))
    .min(1, { message: 'At least one event type is required' })
    .default(['payment.executed', 'payment.failed']),
  active: z.boolean().default(true),
});

// ─── URL reachability check ───────────────────────────────────────────────────

/**
 * Sends a HEAD request to verify the URL is reachable.
 * Resolves true if the endpoint responds with any HTTP status (even 4xx).
 * Resolves false on connection error or timeout (5 s).
 */
export function checkUrlReachable(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 5000);

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      clearTimeout(timeout);
      resolve(false);
      return;
    }

    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const req = lib.request(
      {
        method: 'HEAD',
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        timeout: 5000,
      },
      () => {
        clearTimeout(timeout);
        resolve(true);
      },
    );

    req.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });

    req.on('timeout', () => {
      clearTimeout(timeout);
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

// ─── POST /api/v1/webhook-registrations ──────────────────────────────────────

/**
 * Register a new merchant webhook endpoint.
 *
 * Body:
 *   url    {string}   HTTPS/HTTP endpoint URL
 *   events {string[]} Event types to subscribe to
 *   active {boolean}  Whether the webhook is active (default: true)
 *
 * The merchant address is taken from the verified JWT (res.locals.merchantAddress).
 * A signing secret is auto-generated and returned once on creation only.
 * URL reachability is validated with a HEAD request before saving.
 */
router.post('/', requireMerchant, async (req: Request, res: Response): Promise<void> => {
  const merchantAddress = res.locals.merchantAddress as string;

  const parsed = createWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid request body',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { url, events, active } = parsed.data;

  // Validate URL reachability via HEAD request
  const reachable = await checkUrlReachable(url);
  if (!reachable) {
    res.status(422).json({
      error: 'URL is not reachable',
      code: 'URL_UNREACHABLE',
      detail:
        'A HEAD request to the provided URL timed out or was refused. ' +
        'Ensure the endpoint is publicly accessible before registering.',
    });
    return;
  }

  // Generate a per-webhook HMAC signing secret (32 random bytes → 64 hex chars)
  const secret = crypto.randomBytes(32).toString('hex');

  try {
    const webhook = await prisma.webhookEndpoint.create({
      data: {
        merchant: merchantAddress,
        url,
        events: events.join(','),
        active,
        secret,
      },
    });

    res.status(201).json({
      id: webhook.id,
      merchant: webhook.merchant,
      url: webhook.url,
      events: webhook.events.split(',') as EventType[],
      active: webhook.active,
      secret, // returned only on creation; never included in GET responses
      createdAt: webhook.createdAt,
    });
  } catch (err: unknown) {
    // Prisma unique constraint violation: (merchant, url) already registered
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      res.status(409).json({
        error: 'A webhook for this URL is already registered for this merchant',
        code: 'WEBHOOK_ALREADY_EXISTS',
      });
      return;
    }
    console.error('[webhook-registrations] create error:', err);
    res.status(500).json({ error: 'Failed to register webhook' });
  }
});

// ─── GET /api/v1/webhook-registrations/:merchant ─────────────────────────────

/**
 * List all webhook registrations for a merchant.
 *
 * The requesting JWT must belong to the merchant in the path parameter.
 * Secrets are intentionally omitted from list responses.
 */
router.get('/:merchant', requireMerchant, async (req: Request, res: Response): Promise<void> => {
  const merchantAddress = res.locals.merchantAddress as string;
  const requestedMerchant = req.params['merchant'];

  // Enforce that a merchant can only list their own webhooks
  if (merchantAddress !== requestedMerchant) {
    res.status(403).json({
      error: 'Forbidden: you can only list webhooks for your own merchant address',
      code: 'FORBIDDEN',
    });
    return;
  }

  try {
    const webhooks = await prisma.webhookEndpoint.findMany({
      where: { merchant: merchantAddress },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        merchant: true,
        url: true,
        events: true,
        active: true,
        createdAt: true,
        // secret intentionally omitted from list responses
      },
    });

    res.json({
      merchant: merchantAddress,
      total: webhooks.length,
      webhooks: webhooks.map((w) => ({
        ...w,
        events: w.events.split(',') as EventType[],
      })),
    });
  } catch (err) {
    console.error('[webhook-registrations] list error:', err);
    res.status(500).json({ error: 'Failed to list webhooks' });
  }
});

// ─── DELETE /api/v1/webhook-registrations/:id ────────────────────────────────

/**
 * Remove a webhook registration by ID.
 *
 * The authenticated merchant must own the webhook being deleted.
 * Returns 204 No Content on success, 404 if not found or not owned by this merchant.
 */
router.delete('/:id', requireMerchant, async (req: Request, res: Response): Promise<void> => {
  const merchantAddress = res.locals.merchantAddress as string;
  const idParam = parseInt(req.params['id'] ?? '', 10);

  if (isNaN(idParam) || idParam <= 0) {
    res.status(400).json({ error: 'Invalid webhook ID', code: 'INVALID_ID' });
    return;
  }

  try {
    // Verify ownership before deletion to prevent cross-merchant deletion
    const existing = await prisma.webhookEndpoint.findFirst({
      where: { id: idParam, merchant: merchantAddress },
    });

    if (!existing) {
      res.status(404).json({
        error: 'Webhook not found or does not belong to this merchant',
        code: 'NOT_FOUND',
      });
      return;
    }

    await prisma.webhookEndpoint.delete({ where: { id: idParam } });

    res.status(204).send();
  } catch (err) {
    console.error('[webhook-registrations] delete error:', err);
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

export default router;
