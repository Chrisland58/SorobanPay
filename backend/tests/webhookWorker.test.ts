/**
 * #1388 — Unit tests for WebhookNotifier service.
 * Covers: HMAC signing, event ID derivation, delivery, retry logic, event filtering.
 */

// ─── Mocks — must be before all imports ──────────────────────────────────────

jest.mock('../src/lib/tracing', () => ({
  getTracer: jest.fn(),
  withSpan: jest.fn((_tracer: unknown, _name: unknown, fn: (span: unknown) => unknown) =>
    fn({ setAttributes: jest.fn() }),
  ),
  SpanKind: { CLIENT: 0 },
  initTracing: jest.fn(),
}));

// Webhook deliveries store
const deliveryLog: unknown[] = [];

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    webhookEndpoint: {
      findMany: jest.fn(),
    },
    webhookDelivery: {
      create: jest.fn().mockImplementation(async (args: { data: unknown }) => {
        deliveryLog.push(args.data);
        return args.data;
      }),
    },
  },
}));

// Mock webhookQueue
const mockEnqueueWebhookDelivery = jest.fn().mockResolvedValue(undefined);
const mockGetWebhookQueue = jest.fn().mockReturnValue(null); // null = no queue (fallback to direct)

jest.mock('../src/services/webhookQueue', () => ({
  enqueueWebhookDelivery: mockEnqueueWebhookDelivery,
  getWebhookQueue: mockGetWebhookQueue,
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// ─── Import after mocks ───────────────────────────────────────────────────────

import prisma from '../src/lib/prisma';
import {
  signPayload,
  deriveEventId,
  notifyWebhooks,
  isEventAllowed,
} from '../src/services/webhookNotifier';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOkResponse(status = 200): Response {
  return { ok: status >= 200 && status < 300, status } as Response;
}

function makeEndpoint(overrides: Partial<{
  id: number;
  url: string;
  secret: string | null;
  events: string;
  active: boolean;
  merchant: string;
}> = {}) {
  return {
    id: 1,
    url: 'https://example.com/webhook',
    secret: 'test-secret',
    events: '',
    active: true,
    merchant: 'GMERCHANT1',
    ...overrides,
  };
}

function makePayload(overrides: Partial<{
  event: 'payment.executed' | 'payment.failed' | 'subscription.cancelled';
  subscriber: string;
  merchant: string;
  amount: string;
  txHash: string;
  eventIndex: number;
  timestamp: number;
}> = {}) {
  return {
    event: 'payment.executed' as const,
    subscriber: 'GSUB1',
    merchant: 'GMERCHANT1',
    amount: '10000000',
    txHash: 'abc123def456',
    eventIndex: 0,
    timestamp: 1700000000,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WebhookNotifier (#1388)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    deliveryLog.length = 0;
    mockGetWebhookQueue.mockReturnValue(null); // default: no queue
    mockFetch.mockResolvedValue(makeOkResponse(200));
  });

  // ── signPayload ────────────────────────────────────────────────────────────

  describe('signPayload', () => {
    it('returns a sha256= prefixed HMAC signature', () => {
      const body = JSON.stringify({ event: 'payment.executed' });
      const sig = signPayload(body, 'my-secret');

      expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    });

    it('produces the same signature for the same inputs', () => {
      const body = '{"event":"test"}';
      const sig1 = signPayload(body, 'secret');
      const sig2 = signPayload(body, 'secret');
      expect(sig1).toBe(sig2);
    });

    it('produces different signatures for different secrets', () => {
      const body = '{"event":"test"}';
      const sig1 = signPayload(body, 'secret-A');
      const sig2 = signPayload(body, 'secret-B');
      expect(sig1).not.toBe(sig2);
    });

    it('produces different signatures for different bodies', () => {
      const sig1 = signPayload('body-A', 'secret');
      const sig2 = signPayload('body-B', 'secret');
      expect(sig1).not.toBe(sig2);
    });
  });

  // ── deriveEventId ──────────────────────────────────────────────────────────

  describe('deriveEventId', () => {
    it('returns a 64-character hex string', () => {
      const id = deriveEventId('txhash123', 0);
      expect(id).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is stable for the same txHash + eventIndex', () => {
      const id1 = deriveEventId('txhash123', 0);
      const id2 = deriveEventId('txhash123', 0);
      expect(id1).toBe(id2);
    });

    it('differs for different event indices', () => {
      const id1 = deriveEventId('txhash123', 0);
      const id2 = deriveEventId('txhash123', 1);
      expect(id1).not.toBe(id2);
    });

    it('differs for different txHashes', () => {
      const id1 = deriveEventId('hash-A', 0);
      const id2 = deriveEventId('hash-B', 0);
      expect(id1).not.toBe(id2);
    });
  });

  // ── isEventAllowed ─────────────────────────────────────────────────────────

  describe('isEventAllowed', () => {
    it('allows any event when events filter is empty string', () => {
      expect(isEventAllowed('', 'payment.executed')).toBe(true);
      expect(isEventAllowed('', 'payment.failed')).toBe(true);
    });

    it('allows any event when events filter is null', () => {
      expect(isEventAllowed(null, 'payment.executed')).toBe(true);
    });

    it('allows any event when events filter is undefined', () => {
      expect(isEventAllowed(undefined, 'payment.executed')).toBe(true);
    });

    it('allows matching event in comma-separated list', () => {
      expect(isEventAllowed('payment.executed,payment.failed', 'payment.executed')).toBe(true);
    });

    it('denies non-matching event', () => {
      expect(isEventAllowed('payment.executed', 'payment.failed')).toBe(false);
    });

    it('handles whitespace in filter list', () => {
      expect(isEventAllowed('payment.executed , payment.failed', 'payment.failed')).toBe(true);
    });
  });

  // ── notifyWebhooks ─────────────────────────────────────────────────────────

  describe('notifyWebhooks', () => {
    it('delivers to a single active endpoint', async () => {
      (mockPrisma.webhookEndpoint.findMany as jest.Mock).mockResolvedValueOnce([
        makeEndpoint(),
      ]);

      await notifyWebhooks(makePayload());

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe('https://example.com/webhook');
    });

    it('does NOT deliver when endpoint.events filter excludes the event type', async () => {
      (mockPrisma.webhookEndpoint.findMany as jest.Mock).mockResolvedValueOnce([
        makeEndpoint({ events: 'subscription.cancelled' }),
      ]);

      await notifyWebhooks(makePayload({ event: 'payment.executed' }));

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('delivers to multiple endpoints', async () => {
      (mockPrisma.webhookEndpoint.findMany as jest.Mock).mockResolvedValueOnce([
        makeEndpoint({ id: 1, url: 'https://ep1.example.com/wh' }),
        makeEndpoint({ id: 2, url: 'https://ep2.example.com/wh' }),
      ]);

      await notifyWebhooks(makePayload());

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('includes X-SorobanPay-Signature header when endpoint has a secret', async () => {
      (mockPrisma.webhookEndpoint.findMany as jest.Mock).mockResolvedValueOnce([
        makeEndpoint({ secret: 'my-webhook-secret' }),
      ]);

      await notifyWebhooks(makePayload());

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers['X-SorobanPay-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    });

    it('does NOT include X-SorobanPay-Signature when endpoint has no secret', async () => {
      (mockPrisma.webhookEndpoint.findMany as jest.Mock).mockResolvedValueOnce([
        makeEndpoint({ secret: null }),
      ]);

      await notifyWebhooks(makePayload());

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers['X-SorobanPay-Signature']).toBeUndefined();
    });

    it('includes stable X-SorobanPay-Event-ID derived from txHash + eventIndex', async () => {
      (mockPrisma.webhookEndpoint.findMany as jest.Mock).mockResolvedValueOnce([
        makeEndpoint(),
      ]);

      const txHash = 'stable-tx-hash';
      const eventIndex = 0;
      await notifyWebhooks(makePayload({ txHash, eventIndex }));

      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      const expectedId = deriveEventId(txHash, eventIndex);
      expect(headers['X-SorobanPay-Event-ID']).toBe(expectedId);
    });

    it('logs delivery to webhookDelivery table on success', async () => {
      (mockPrisma.webhookEndpoint.findMany as jest.Mock).mockResolvedValueOnce([
        makeEndpoint(),
      ]);

      await notifyWebhooks(makePayload());

      expect(mockPrisma.webhookDelivery.create).toHaveBeenCalledTimes(1);
      const delivery = deliveryLog[0] as Record<string, unknown>;
      expect(delivery.success).toBe(true);
    });

    it('retries on non-2xx response and logs failure', async () => {
      (mockPrisma.webhookEndpoint.findMany as jest.Mock).mockResolvedValueOnce([
        makeEndpoint(),
      ]);

      // All 5 attempts return 503
      mockFetch.mockResolvedValue(makeOkResponse(503));

      await notifyWebhooks(makePayload());

      // Should have attempted MAX_ATTEMPTS (5) times
      expect(mockFetch).toHaveBeenCalledTimes(5);
      expect(deliveryLog.length).toBe(5);
      const lastDelivery = deliveryLog[deliveryLog.length - 1] as Record<string, unknown>;
      expect(lastDelivery.success).toBe(false);
    });

    it('stops retrying after first success', async () => {
      (mockPrisma.webhookEndpoint.findMany as jest.Mock).mockResolvedValueOnce([
        makeEndpoint(),
      ]);

      // First attempt fails, second succeeds
      mockFetch
        .mockResolvedValueOnce(makeOkResponse(500))
        .mockResolvedValueOnce(makeOkResponse(200));

      await notifyWebhooks(makePayload());

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const successDelivery = deliveryLog[deliveryLog.length - 1] as Record<string, unknown>;
      expect(successDelivery.success).toBe(true);
    });

    it('logs error delivery when fetch throws', async () => {
      (mockPrisma.webhookEndpoint.findMany as jest.Mock).mockResolvedValueOnce([
        makeEndpoint(),
      ]);

      mockFetch.mockRejectedValue(new Error('Network error'));

      await notifyWebhooks(makePayload());

      expect(deliveryLog.length).toBe(5); // all 5 retries
      const errorDelivery = deliveryLog[0] as Record<string, unknown>;
      expect(errorDelivery.success).toBe(false);
      expect(errorDelivery.error).toContain('Network error');
    });

    it('enqueues via BullMQ queue when queue is available', async () => {
      const mockQueue = { add: jest.fn() };
      mockGetWebhookQueue.mockReturnValueOnce(mockQueue);

      (mockPrisma.webhookEndpoint.findMany as jest.Mock).mockResolvedValueOnce([
        makeEndpoint(),
      ]);

      await notifyWebhooks(makePayload());

      expect(mockEnqueueWebhookDelivery).toHaveBeenCalledTimes(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('falls back to direct delivery when no queue available', async () => {
      mockGetWebhookQueue.mockReturnValue(null);

      (mockPrisma.webhookEndpoint.findMany as jest.Mock).mockResolvedValueOnce([
        makeEndpoint(),
      ]);

      await notifyWebhooks(makePayload());

      expect(mockFetch).toHaveBeenCalled();
      expect(mockEnqueueWebhookDelivery).not.toHaveBeenCalled();
    });

    it('does nothing when no endpoints are registered', async () => {
      (mockPrisma.webhookEndpoint.findMany as jest.Mock).mockResolvedValueOnce([]);

      await notifyWebhooks(makePayload());

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
