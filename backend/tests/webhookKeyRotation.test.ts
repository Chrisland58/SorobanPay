/**
 * webhookKeyRotation.test.ts
 *
 * Automated tests for webhook signing-key rotation with key identifiers (Issue #1596):
 * - Key rotation permits bounded overlap while signing with single active key
 * - Delivery verification validates active or retiring keys
 * - Reject revoked or expired keys
 * - Secret values are excluded from public metadata
 */

import {
  rotateWebhookKey,
  signPayloadWithKey,
  verifyWebhookSignatureWithKeys,
  toSafeKeyMetadata,
  type SigningKey,
} from '../src/services/webhookSignature';

describe('Webhook Signing Key Rotation & Identifiers (#1596)', () => {
  const initialKey: SigningKey = {
    keyId: 'key_v1',
    secret: 'secret_11111111111111111111111111111111',
    status: 'active',
    createdAt: new Date(Date.now() - 3600_000),
  };

  it('rotates active key and retains previous key in retiring status with overlap', () => {
    const { keys, activeKey } = rotateWebhookKey([initialKey], 'secret_22222222222222222222222222222222', 86400_000);

    expect(activeKey.status).toBe('active');
    expect(activeKey.secret).toBe('secret_22222222222222222222222222222222');

    const previousKey = keys.find((k) => k.keyId === 'key_v1');
    expect(previousKey).toBeDefined();
    expect(previousKey?.status).toBe('retiring');
    expect(previousKey?.expiresAt).toBeDefined();
  });

  it('signs payload with active key and returns key identifier', () => {
    const { activeKey } = rotateWebhookKey([initialKey]);
    const payload = JSON.stringify({ event: 'subscription.created', id: 'sub_123' });

    const { signatureHeader, keyId } = signPayloadWithKey(payload, activeKey);
    expect(keyId).toBe(activeKey.keyId);
    expect(signatureHeader).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it('verifies signatures signed by active key or retiring key during overlap window', () => {
    const { keys, activeKey } = rotateWebhookKey([initialKey]);
    const payload = JSON.stringify({ event: 'payment.executed', amount: '500' });

    // Payload signed by previous (retiring) key
    const sigV1 = signPayloadWithKey(payload, initialKey);
    expect(verifyWebhookSignatureWithKeys(payload, sigV1.signatureHeader, keys, sigV1.keyId)).toBe(true);

    // Payload signed by new (active) key
    const sigV2 = signPayloadWithKey(payload, activeKey);
    expect(verifyWebhookSignatureWithKeys(payload, sigV2.signatureHeader, keys, sigV2.keyId)).toBe(true);
  });

  it('rejects expired or revoked keys', () => {
    const expiredKey: SigningKey = {
      keyId: 'key_expired',
      secret: 'expired_secret',
      status: 'retiring',
      createdAt: new Date(Date.now() - 100_000),
      expiresAt: new Date(Date.now() - 5_000), // Expired 5 seconds ago
    };

    const payload = '{"test":true}';
    const sig = signPayloadWithKey(payload, expiredKey);

    expect(verifyWebhookSignatureWithKeys(payload, sig.signatureHeader, [expiredKey])).toBe(false);
  });

  it('toSafeKeyMetadata excludes raw secret and only displays hint', () => {
    const meta = toSafeKeyMetadata(initialKey);
    expect((meta as any).secret).toBeUndefined();
    expect(meta.keyId).toBe('key_v1');
    expect(meta.status).toBe('active');
    expect(meta.hint).toBe('...1111');
  });
});
