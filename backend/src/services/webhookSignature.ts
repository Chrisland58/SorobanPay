/**
 * backend/src/services/webhookSignature.ts
 *
 * HMAC-SHA256 signature generation and verification for webhook deliveries.
 */

import { createHmac, timingSafeEqual, randomBytes } from 'crypto';

// ---------------------------------------------------------------------------
// Issue #1596: Webhook Signing Key Rotation & Identifiers
// ---------------------------------------------------------------------------

export type SigningKeyStatus = 'active' | 'retiring' | 'revoked';

export interface SigningKey {
  keyId: string;
  secret: string;
  status: SigningKeyStatus;
  createdAt: Date;
  expiresAt?: Date | null;
}

export interface WebhookKeyMetadata {
  keyId: string;
  status: SigningKeyStatus;
  createdAt: Date;
  expiresAt?: Date | null;
  hint: string;
}

export const DEFAULT_KEY_ROTATION_OVERLAP_MS = 24 * 60 * 60 * 1000; // 24 hours overlap

/**
 * Return safe public key metadata without leaking secret material.
 */
export function toSafeKeyMetadata(key: SigningKey): WebhookKeyMetadata {
  const cleanSecret = key.secret.trim();
  const hint = cleanSecret.length > 4 ? `...${cleanSecret.slice(-4)}` : '****';
  return {
    keyId: key.keyId,
    status: key.status,
    createdAt: key.createdAt,
    expiresAt: key.expiresAt ?? null,
    hint,
  };
}

/**
 * Rotate webhook keys:
 * - Moves the current active key to 'retiring' with a bounded overlap expiration
 * - Instantiates a new active key
 * - Drops revoked or expired keys
 */
export function rotateWebhookKey(
  existingKeys: SigningKey[],
  newSecret?: string,
  overlapMs = DEFAULT_KEY_ROTATION_OVERLAP_MS,
): { keys: SigningKey[]; activeKey: SigningKey } {
  const now = new Date();
  const overlapDeadline = new Date(now.getTime() + overlapMs);

  const secret = newSecret || randomBytes(32).toString('hex');
  const activeKey: SigningKey = {
    keyId: `key_${Date.now()}_${randomBytes(4).toString('hex')}`,
    secret,
    status: 'active',
    createdAt: now,
  };

  const updatedKeys: SigningKey[] = [];

  for (const k of existingKeys) {
    if (k.status === 'revoked') continue;
    if (k.expiresAt && k.expiresAt.getTime() < now.getTime()) continue;

    if (k.status === 'active') {
      // Transition previous active key to retiring
      updatedKeys.push({
        ...k,
        status: 'retiring',
        expiresAt: overlapDeadline,
      });
    } else {
      updatedKeys.push(k);
    }
  }

  updatedKeys.push(activeKey);

  return {
    keys: updatedKeys,
    activeKey,
  };
}

/**
 * Sign a payload using a versioned signing key.
 * Returns the signature string and the keyId to include in delivery headers.
 */
export function signPayloadWithKey(
  body: string,
  key: SigningKey,
): { signatureHeader: string; keyId: string } {
  const signature = signPayload(body, key.secret);
  return {
    signatureHeader: signature,
    keyId: key.keyId,
  };
}

/**
 * Verify a webhook HMAC signature against a set of versioned keys.
 * If keyId is provided, matches that specific key.
 * Otherwise, tests against all non-revoked and non-expired keys.
 */
export function verifyWebhookSignatureWithKeys(
  body: string,
  signatureHeader: string,
  keys: SigningKey[],
  keyId?: string,
): boolean {
  if (!signatureHeader || !keys || keys.length === 0 || typeof body !== 'string') {
    return false;
  }

  const now = Date.now();
  const eligibleKeys = keys.filter((k) => {
    if (k.status === 'revoked') return false;
    if (k.expiresAt && k.expiresAt.getTime() < now) return false;
    if (keyId && k.keyId !== keyId) return false;
    return true;
  });

  for (const candidate of eligibleKeys) {
    if (verifyWebhookSignature(body, signatureHeader, candidate.secret)) {
      return true;
    }
  }

  return false;
}

/**
 * Generate the HMAC-SHA256 signature for a webhook payload body.
 * Merchants can verify this signature using their endpoint secret.
 *
 * Signature format: "sha256=<hex_digest>"
 */
export function signPayload(body: string, secret: string): string {
  const hmac = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${hmac}`;
}

/**
 * Verify a webhook HMAC-SHA256 signature header using timing-safe comparison.
 *
 * @param body The raw request body string
 * @param signatureHeader The signature header value, e.g. "sha256=<hex_digest>"
 * @param secret The webhook endpoint signing secret
 * @returns true if the signature is valid, false otherwise
 */
export function verifyWebhookSignature(body: string, signatureHeader: string, secret: string): boolean {
  if (!signatureHeader || !secret || typeof body !== 'string') return false;
  const expected = signPayload(body, secret);
  if (expected.length !== signatureHeader.length) return false;
  try {
    return timingSafeEqual(Buffer.from(signatureHeader, 'utf-8'), Buffer.from(expected, 'utf-8'));
  } catch {
    return false;
  }
}
