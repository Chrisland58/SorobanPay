/**
 * webhookNotifier.test.ts  — BE-53
 *
 * Unit tests for webhook event-type filtering.
 * Verifies:
 *  - Events in the filter list are delivered normally (allow case)
 *  - Events NOT in the filter list are silently skipped (deny case)
 *  - An empty/null filter means all events are delivered
 *  - Delivery records are only created for eligible endpoints
 */

import { notifyWebhooks, isEventAllowed, WebhookPayload } from '../src/services/webhookNotifier';
import { InMemoryPrismaClient } from './helpers/inMemoryDb';

// ── Mock prisma with in-memory client ─────────────────────────────────────────
jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: new (require('./helpers/inMemoryDb').InMemoryPrismaClient)(),
}));

import prisma from '../src/lib/prisma';
const db = prisma as unknown as InMemoryPrismaClient;

// ── Stub global fetch ─────────────────────────────────────────────────────────
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

const MERCHANT = 'GMERCHANT0000001';

const executedPayload: WebhookPayload = {
  event: 'payment.executed',
  subscriber: 'GSUB001',
  merchant: MERCHANT,
  amount: '1000',
  timestamp: Date.now(),
};

const failedPayload: WebhookPayload = {
  event: 'payment.failed',
  subscriber: 'GSUB001',
  merchant: MERCHANT,
  amount: '500',
  timestamp: Date.now(),
};

beforeEach(() => {
  db.reset();
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, status: 200 });
});

// ── isEventAllowed unit tests ─────────────────────────────────────────────────

describe('isEventAllowed()', () => {
  it('returns true when events filter is empty string (allow all)', () => {
    expect(isEventAllowed('', 'payment.executed')).toBe(true);
  });

  it('returns true when events filter is null (allow all)', () => {
    expect(isEventAllowed(null, 'payment.executed')).toBe(true);
  });

  it('returns true when events filter is undefined (allow all)', () => {
    expect(isEventAllowed(undefined, 'payment.failed')).toBe(true);
  });

  it('returns true when event type is in the filter list', () => {
    expect(isEventAllowed('payment.executed,payment.failed', 'payment.executed')).toBe(true);
    expect(isEventAllowed('payment.executed,payment.failed', 'payment.failed')).toBe(true);
  });

  it('returns false when event type is NOT in the filter list', () => {
    expect(isEventAllowed('payment.failed', 'payment.executed')).toBe(false);
  });

  it('trims whitespace around event names in the list', () => {
    expect(isEventAllowed(' payment.executed , payment.failed ', 'payment.executed')).toBe(true);
  });

  it('returns false for an event type not in a single-item list', () => {
    expect(isEventAllowed('payment.executed', 'payment.failed')).toBe(false);
  });
});

// ── notifyWebhooks integration tests ─────────────────────────────────────────

describe('notifyWebhooks() — BE-53 event filtering', () => {
  it('delivers to an endpoint with no event filter (allow all)', async () => {
    db.seedEndpoints([
      { merchant: MERCHANT, url: 'https://ep1.test/hook', active: true, events: '' },
    ]);

    await notifyWebhooks(executedPayload);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('https://ep1.test/hook', expect.any(Object));
  });

  it('delivers when event type matches the filter (allow case)', async () => {
    db.seedEndpoints([
      { merchant: MERCHANT, url: 'https://ep2.test/hook', active: true, events: 'payment.executed' },
    ]);

    await notifyWebhooks(executedPayload);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('https://ep2.test/hook', expect.any(Object));
  });

  it('skips delivery when event type is NOT in the filter (deny case)', async () => {
    db.seedEndpoints([
      // Only subscribed to payment.failed; should NOT receive payment.executed
      { merchant: MERCHANT, url: 'https://ep3.test/hook', active: true, events: 'payment.failed' },
    ]);

    await notifyWebhooks(executedPayload);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('delivers only to matching endpoints when multiple endpoints exist', async () => {
    db.seedEndpoints([
      // Subscribed to all events
      { merchant: MERCHANT, url: 'https://all.test/hook', active: true, events: '' },
      // Subscribed only to payment.failed — should be skipped for payment.executed
      { merchant: MERCHANT, url: 'https://failed-only.test/hook', active: true, events: 'payment.failed' },
      // Subscribed to both
      { merchant: MERCHANT, url: 'https://both.test/hook', active: true, events: 'payment.executed,payment.failed' },
    ]);

    await notifyWebhooks(executedPayload);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const calledUrls = mockFetch.mock.calls.map((c: any[]) => c[0]);
    expect(calledUrls).toContain('https://all.test/hook');
    expect(calledUrls).toContain('https://both.test/hook');
    expect(calledUrls).not.toContain('https://failed-only.test/hook');
  });

  it('does not deliver to inactive endpoints regardless of filter', async () => {
    db.seedEndpoints([
      { merchant: MERCHANT, url: 'https://inactive.test/hook', active: false, events: 'payment.executed' },
    ]);

    await notifyWebhooks(executedPayload);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('delivers payment.failed to endpoint filtered for payment.failed', async () => {
    db.seedEndpoints([
      { merchant: MERCHANT, url: 'https://failed.test/hook', active: true, events: 'payment.failed' },
    ]);

    await notifyWebhooks(failedPayload);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('https://failed.test/hook', expect.any(Object));
  });

  it('records a WebhookDelivery only for delivered events', async () => {
    db.seedEndpoints([
      { merchant: MERCHANT, url: 'https://ep-allow.test/hook', active: true, events: 'payment.executed' },
      { merchant: MERCHANT, url: 'https://ep-deny.test/hook', active: true, events: 'payment.failed' },
    ]);

    await notifyWebhooks(executedPayload);

    const deliveries = await db.webhookDelivery.findMany();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].url).toBe('https://ep-allow.test/hook');
    expect(deliveries[0].success).toBe(true);
  });
});
