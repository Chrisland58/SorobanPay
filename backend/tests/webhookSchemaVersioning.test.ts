import {
  formatWebhookPayload,
  WebhookPayload,
  FormattedWebhookV1,
  FormattedWebhookV2,
} from '../src/services/webhookNotifier';
import { signPayload, verifyWebhookSignature } from '../src/services/webhookSignature';

describe('Webhook Schema Versioning (#1586)', () => {
  const samplePayload: WebhookPayload = {
    event: 'payment.executed',
    subscriber: 'GSUBSCRIBER123',
    merchant: 'GMERCHANT456',
    amount: '1000000',
    txHash: '0xabc123',
    eventIndex: 0,
    timestamp: 1700000000,
    traceContext: 'trace-1234',
  };
  const eventId = 'evt-9999';

  it('formats v1 legacy schema correctly', () => {
    const v1 = formatWebhookPayload(samplePayload, eventId, 'v1') as FormattedWebhookV1;
    expect(v1.event).toBe('payment.executed');
    expect(v1.subscriber).toBe('GSUBSCRIBER123');
    expect(v1.merchant).toBe('GMERCHANT456');
    expect(v1.amount).toBe('1000000');
    expect(v1.eventId).toBe('evt-9999');
    expect((v1 as any).schemaVersion).toBeUndefined();
  });

  it('formats v2 structured enveloped schema correctly', () => {
    const v2 = formatWebhookPayload(samplePayload, eventId, 'v2') as FormattedWebhookV2;
    expect(v2.schemaVersion).toBe('v2');
    expect(v2.id).toBe('evt-9999');
    expect(v2.type).toBe('payment.executed');
    expect(v2.createdAt).toBe(new Date(samplePayload.timestamp * 1000).toISOString());
    expect(v2.data.subscriber).toBe('GSUBSCRIBER123');
    expect(v2.data.merchant).toBe('GMERCHANT456');
    expect(v2.data.amount).toBe('1000000');
    expect(v2.metadata.timestamp).toBe(1700000000);
    expect(v2.metadata.traceContext).toBe('trace-1234');
  });

  it('computes and verifies HMAC signature on exact stringified payload', () => {
    const secret = 'merchant_webhook_secret_key_123';
    const v2 = formatWebhookPayload(samplePayload, eventId, 'v2');
    const rawBody = JSON.stringify(v2);

    const sig = signPayload(rawBody, secret);
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);

    const isValid = verifyWebhookSignature(rawBody, sig, secret);
    expect(isValid).toBe(true);

    const tampered = rawBody + ' ';
    const isTamperedValid = verifyWebhookSignature(tampered, sig, secret);
    expect(isTamperedValid).toBe(false);
  });
});
