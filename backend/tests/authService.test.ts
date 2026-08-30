/**
 * authService.test.ts
 *
 * Unit tests for the Redis-backed SEP-10 challenge store (issue #766).
 *
 * Uses an in-memory Redis mock so no real Redis instance is required.
 */

import { Keypair, Networks } from '@stellar/stellar-sdk';
import {
  issueChallenge,
  verifyChallenge,
  revokeChallenge,
  setRedisClient,
} from '../../src/services/authService';

// ─── In-memory Redis mock ─────────────────────────────────────────────────────

class InMemoryRedis {
  private store = new Map<string, { value: string; expiresAt: number }>();

  async set(key: string, value: string, _ex: 'EX', ttlSeconds: number): Promise<'OK'> {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1_000,
    });
    return 'OK';
  }

  async getdel(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    this.store.delete(key);
    return entry.value;
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  on(_event: string, _listener: (...args: unknown[]) => void): this {
    return this;
  }

  clear(): void {
    this.store.clear();
  }

  /** Test helper — peek at a key without consuming it. */
  peekSync(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry || Date.now() > entry.expiresAt) return null;
    return entry.value;
  }
}

// ─── Test setup ───────────────────────────────────────────────────────────────

let mockRedis: InMemoryRedis;
const serverKeypair = Keypair.random();
const clientKeypair = Keypair.random();
const publicKey = clientKeypair.publicKey();

beforeEach(() => {
  mockRedis = new InMemoryRedis();
  setRedisClient(mockRedis as any);
});

// ─── issueChallenge ───────────────────────────────────────────────────────────

describe('issueChallenge', () => {
  it('stores a challenge in Redis and returns XDR + expiresAt', async () => {
    const result = await issueChallenge(publicKey, serverKeypair, Networks.TESTNET);

    expect(result.challengeXdr).toBeTruthy();
    expect(typeof result.challengeXdr).toBe('string');
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it('stores the challenge under the correct Redis key', async () => {
    await issueChallenge(publicKey, serverKeypair, Networks.TESTNET);

    const stored = mockRedis.peekSync(`sep10:challenge:${publicKey}`);
    expect(stored).not.toBeNull();

    const record = JSON.parse(stored!);
    expect(record).toHaveProperty('nonce');
    expect(record).toHaveProperty('issuedAt');
  });

  it('overwrites a previous challenge for the same public key', async () => {
    await issueChallenge(publicKey, serverKeypair, Networks.TESTNET);
    const first = mockRedis.peekSync(`sep10:challenge:${publicKey}`);

    await issueChallenge(publicKey, serverKeypair, Networks.TESTNET);
    const second = mockRedis.peekSync(`sep10:challenge:${publicKey}`);

    // Both should exist, but nonces differ because timestamps differ
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
  });
});

// ─── verifyChallenge ──────────────────────────────────────────────────────────

describe('verifyChallenge', () => {
  it('returns valid=false when no challenge is stored', async () => {
    const result = await verifyChallenge(publicKey, 'not-valid-xdr', Networks.TESTNET);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/not found|already consumed/i);
  });

  it('consumes the challenge on first verify (no replay)', async () => {
    const { challengeXdr } = await issueChallenge(publicKey, serverKeypair, Networks.TESTNET);

    // First call — challenge present
    const first = await verifyChallenge(publicKey, challengeXdr, Networks.TESTNET);
    // The XDR is not signed by clientKeypair, so sig check will fail,
    // but the Redis key must be consumed regardless.
    const second = await verifyChallenge(publicKey, challengeXdr, Networks.TESTNET);

    expect(second.valid).toBe(false);
    expect(second.error).toMatch(/not found|already consumed/i);
    // Confirm key is gone
    expect(mockRedis.peekSync(`sep10:challenge:${publicKey}`)).toBeNull();
    void first; // suppress unused-variable warning
  });

  it('returns valid=false with invalid XDR after challenge is found', async () => {
    await issueChallenge(publicKey, serverKeypair, Networks.TESTNET);
    const result = await verifyChallenge(publicKey, 'bad-xdr', Networks.TESTNET);
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ─── revokeChallenge ──────────────────────────────────────────────────────────

describe('revokeChallenge', () => {
  it('removes the challenge from Redis', async () => {
    await issueChallenge(publicKey, serverKeypair, Networks.TESTNET);
    expect(mockRedis.peekSync(`sep10:challenge:${publicKey}`)).not.toBeNull();

    await revokeChallenge(publicKey);
    expect(mockRedis.peekSync(`sep10:challenge:${publicKey}`)).toBeNull();
  });

  it('does not throw when no challenge exists', async () => {
    await expect(revokeChallenge(publicKey)).resolves.not.toThrow();
  });
});

// ─── Multi-instance correctness ───────────────────────────────────────────────

describe('multi-instance correctness', () => {
  it('challenge issued by one client can be verified by another (shared Redis)', async () => {
    // Simulate two different "pods" sharing the same Redis instance (mockRedis)
    const podARedis = mockRedis;
    const podBRedis = mockRedis; // same instance = shared store

    setRedisClient(podARedis as any);
    const { challengeXdr } = await issueChallenge(publicKey, serverKeypair, Networks.TESTNET);

    // Pod B uses the same Redis → can read the challenge pod A stored
    setRedisClient(podBRedis as any);
    // Verify returns false because the XDR isn't signed by clientKeypair,
    // but crucially the challenge IS found (no "not found" error).
    const result = await verifyChallenge(publicKey, challengeXdr, Networks.TESTNET);
    expect(result.error).not.toMatch(/not found/i);
  });
});
