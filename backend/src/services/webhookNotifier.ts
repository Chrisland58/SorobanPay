import prisma from '../lib/prisma';

export type WebhookEventType = 'payment.executed' | 'payment.failed';

export interface WebhookPayload {
  event: WebhookEventType;
  subscriber: string;
  merchant: string;
  amount: string;
  txHash?: string;
  timestamp: number;
}

const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 60_000, 300_000]; // exponential back-off

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
 * BE-53: Endpoints whose `events` filter does NOT include the current event
 * type are silently skipped.
 * Failed deliveries are retried up to MAX_ATTEMPTS times with back-off.
 */
export async function notifyWebhooks(payload: WebhookPayload): Promise<void> {
  const endpoints = await (prisma as any).webhookEndpoint.findMany({
    where: { merchant: payload.merchant, active: true },
  });

  // BE-53: Filter endpoints by their configured event types before dispatching
  const eligibleEndpoints = endpoints.filter((ep: { events?: string }) =>
    isEventAllowed(ep.events, payload.event),
  );

  await Promise.all(eligibleEndpoints.map((ep: { url: string }) => deliverWithRetry(ep.url, payload)));
}

async function deliverWithRetry(url: string, payload: WebhookPayload): Promise<void> {
  const body = JSON.stringify(payload);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      await (prisma as any).webhookDelivery.create({
        data: {
          url,
          merchant: payload.merchant,
          event: payload.event,
          payload: body,
          statusCode: res.status,
          attempt: attempt + 1,
          success: res.ok,
        },
      });

      if (res.ok) return;

      console.warn(`[webhook] attempt ${attempt + 1} → ${url} returned ${res.status}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[webhook] attempt ${attempt + 1} → ${url} error: ${msg}`);

      await (prisma as any).webhookDelivery.create({
        data: {
          url,
          merchant: payload.merchant,
          event: payload.event,
          payload: body,
          statusCode: 0,
          attempt: attempt + 1,
          success: false,
          error: msg,
        },
      });
    }
  }

  console.error(`[webhook] all ${MAX_ATTEMPTS} attempts exhausted for ${url}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Export for unit testing
export { isEventAllowed };
