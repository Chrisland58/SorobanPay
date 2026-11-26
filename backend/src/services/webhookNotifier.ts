import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import prisma from '../lib/prisma';
import { getTracer, withSpan, SpanKind } from '../lib/tracing';
import { enqueueWebhookDelivery, getWebhookQueue } from './webhookQueue'; // BE-53

export type WebhookEventType = 'payment.executed' | 'payment.failed' | 'subscription.cancelled';
export type WebhookSchemaVersion = 'v1' | 'v2';

export interface WebhookPayload {
  event: WebhookEventType;
  subscriber: string;
  merchant: string;
  amount: string;
  txHash?: string;
  /** Zero-based index of this event within its transaction. Used to build the stable Event ID. */
  eventIndex?: number;
  timestamp: number;
  /** Optional: trace context to link webhook span to originating event span */
  traceContext?: string;
}

export interface FormattedWebhookV1 {
  event: WebhookEventType;
  subscriber: string;
  merchant: string;
  amount: string;
  txHash?: string;
  eventIndex?: number;
  timestamp: number;
  eventId: string;
  traceContext?: string;
}

export interface FormattedWebhookV2 {
  schemaVersion: 'v2';
  id: string;
  type: WebhookEventType;
  createdAt: string;
  data: {
    subscriber: string;
    merchant: string;
    amount: string;
    txHash?: string;
    eventIndex?: number;
  };
  metadata: {
    timestamp: number;
    traceContext?: string;
  };
}

export type FormattedWebhookPayload = FormattedWebhookV1 | FormattedWebhookV2;

/**
 * Format webhook payload according to specified schema version (#1586).
 * Ensures backward-compatible v1 flat payload or structured v2 schema.
 */
export function formatWebhookPayload(
  payload: WebhookPayload,
  eventId: string,
  schemaVersion: WebhookSchemaVersion = 'v1',
): FormattedWebhookPayload {
  if (schemaVersion === 'v2') {
    return {
      schemaVersion: 'v2',
      id: eventId,
      type: payload.event,
      createdAt: new Date(payload.timestamp * 1000).toISOString(),
      data: {
        subscriber: payload.subscriber,
        merchant: payload.merchant,
        amount: payload.amount,
        txHash: payload.txHash,
        eventIndex: payload.eventIndex,
      },
      metadata: {
        timestamp: payload.timestamp,
        traceContext: payload.traceContext,
      },
    };
  }

  return {
    ...payload,
    eventId,
  };
}

const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 60_000, 300_000];

const WEBHOOK_TRACER = 'sorobanpay.webhook-notifier';

/**
 * Derive a stable Event ID from a transaction hash and event index.
 *
 * The Event ID is constant across all retry attempts for the same on-chain
 * event. Merchant endpoints use this as their idempotency key to safely
 * deduplicate retries.
 *
 * Format (Issue #822): sha256(txHash + eventIndex), hex-encoded — matches the
 * `WebhookDelivery.eventId` field comment in schema.prisma exactly, so it's
 * reproducible by anyone re-deriving it off-chain from (txHash, eventIndex)
 * alone, with no separator convention to get wrong.
 */
export function deriveEventId(txHash: string, eventIndex: number): string {
  return createHash('sha256')
    .update(txHash + eventIndex.toString())
    .digest('hex');
}

/**
 * Generate the HMAC-SHA256 signature for a webhook payload body.
 * Merchants can verify this signature using their endpoint secret.
 *
 * Signature format: "sha256=<hex_digest>"
 */
export { signPayload, verifyWebhookSignature } from './webhookSignature';

/**
 * BE-53: Check whether an endpoint's event filter list includes the given
 * event type.
 *
 * The `events` field on WebhookEndpoint is a comma-separated list of event
 * type strings, e.g. "payment.executed,payment.failed".  An empty string
 * (or null/undefined) means "deliver all event types".
 */
function isEventAllowed(endpointEvents: string | null | undefined, eventType: string): boolean {
  // No filter configured → deliver everything
  if (!endpointEvents || endpointEvents.trim() === '') return true;

  const allowed = endpointEvents
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  return allowed.includes(eventType);
}

/**
 * Deliver a webhook notification to all registered endpoints for the merchant.
 *
 * BE-53: When the BullMQ webhook queue is available (Redis connected), jobs are
 * enqueued with 3-attempt exponential backoff (1m, 5m, 30m).
 * Falls back to direct synchronous delivery when Redis is unavailable.
 */
export async function notifyWebhooks(payload: WebhookPayload): Promise<void> {
  const endpoints = await (prisma as any).webhookEndpoint.findMany({
    where: { merchant: payload.merchant, active: true },
  });

  const eventId = payload.txHash
    ? deriveEventId(payload.txHash, payload.eventIndex ?? 0)
    : randomUUID();

  const queue = getWebhookQueue();

  const applicableEndpoints = endpoints.filter((ep: { id: number; url: string; secret: string | null; events: string }) => {
    if (!ep.events) return true; // Default to all if not set
    const configuredEvents = ep.events.split(',').map((e) => e.trim());
    return configuredEvents.includes(payload.event);
  });

  await Promise.all(
    applicableEndpoints.map((ep: { id: number; url: string; secret: string | null }) => {
      if (queue) {
        // BE-53: Enqueue via BullMQ for reliable delivery with backoff
        return enqueueWebhookDelivery({ endpointId: ep.id, payload, eventId });
      }
      // Fallback: synchronous direct delivery (original behaviour)
      return deliverWithRetry(ep, payload, eventId);
    }),
  );
}

async function deliverWithRetry(
  endpoint: { id: number; url: string; secret: string | null; schemaVersion?: WebhookSchemaVersion },
  payload: WebhookPayload,
  eventId: string,
): Promise<void> {
  const schemaVersion: WebhookSchemaVersion = endpoint.schemaVersion ?? 'v1';
  const formattedPayload = formatWebhookPayload(payload, eventId, schemaVersion);
  const body = JSON.stringify(formattedPayload);

  await withSpan(
    WEBHOOK_TRACER,
    'webhook.deliver',
    async (deliverySpan) => {
      deliverySpan.setAttributes({
        'webhook.url': endpoint.url,
        'webhook.merchant': payload.merchant,
        'webhook.event': payload.event,
        'webhook.event_id': eventId,
        'webhook.schema_version': schemaVersion,
        'webhook.max_attempts': MAX_ATTEMPTS,
      });

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);

        // A fresh Delivery ID is generated for every attempt.
        const deliveryId = randomUUID();

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          // Stable across retries — merchant's idempotency key
          'X-SorobanPay-Event-ID': eventId,
          // Explicit schema version for consumer deserialization (#1586)
          'X-SorobanPay-Schema-Version': schemaVersion,
          // Unique per attempt — for request tracing / deduplication on our side
          'X-SorobanPay-Delivery-ID': deliveryId,
          'X-SorobanPay-Timestamp': String(Math.floor(Date.now() / 1000)),
        };

        // Add HMAC signature if the endpoint has a secret configured.
        if (endpoint.secret) {
          headers['X-SorobanPay-Signature'] = signPayload(body, endpoint.secret);
        }

        try {
          const res = await fetch(endpoint.url, {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(10_000),
          });

          await prisma.webhookDelivery.create({
            data: {
              eventId,
              deliveryId,
              url: endpoint.url,
              merchant: payload.merchant,
              event: payload.event,
              payload: body,
              statusCode: res.status,
              attempt: attempt + 1,
              success: res.ok,
              endpointId: endpoint.id,
            },
          });

          deliverySpan.setAttributes({
            'webhook.attempt': attempt + 1,
            'webhook.delivery_id': deliveryId,
            'webhook.status_code': res.status,
            'webhook.success': res.ok,
          });

          if (res.ok) return;

          console.warn(
            `[webhook] attempt ${attempt + 1}/${MAX_ATTEMPTS} → ${endpoint.url} returned ${res.status} ` +
            `(event_id=${eventId}, delivery_id=${deliveryId})`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(
            `[webhook] attempt ${attempt + 1}/${MAX_ATTEMPTS} → ${endpoint.url} error: ${msg} ` +
            `(event_id=${eventId}, delivery_id=${deliveryId})`,
          );

          deliverySpan.setAttributes({
            'webhook.attempt': attempt + 1,
            'webhook.delivery_id': deliveryId,
            'webhook.error': msg,
          });

          await prisma.webhookDelivery.create({
            data: {
              eventId,
              deliveryId,
              url: endpoint.url,
              merchant: payload.merchant,
              event: payload.event,
              payload: body,
              statusCode: 0,
              attempt: attempt + 1,
              success: false,
              error: msg,
              endpointId: endpoint.id,
            },
          });
        }
      }

      console.error(
        `[webhook] all ${MAX_ATTEMPTS} attempts exhausted for ${endpoint.url} (event_id=${eventId})`,
      );
    },
    { kind: SpanKind.CLIENT },
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Export for unit testing
export { isEventAllowed };
