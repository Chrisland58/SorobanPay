/**
 * authService.ts
 *
 * SEP-10 challenge-response authentication service.
 *
 * #766 — Replaces the process-local in-memory Map with a Redis-backed store so
 * that challenges issued by pod A can be verified by pod B in a multi-instance
 * deployment.
 *
 * ## Challenge lifecycle
 *
 *   1. issueChallenge(publicKey)  — stores challenge in Redis with a 5-minute TTL
 *   2. verifyChallenge(publicKey, signed) — reads from Redis and deletes atomically
 *
 * ## Redis key scheme
 *
 *   sep10:challenge:<publicKey>  →  JSON { nonce, issuedAt }
 *
 * ## Multi-instance correctness
 *
 *   Because Redis is a shared external store, any pod can verify any challenge
 *   regardless of which pod issued it.  The atomic GET+DEL pattern (GETDEL or a
 *   Lua script) prevents replay attacks: a challenge is consumed on first use.
 */

import Redis from 'ioredis';
import {
  Keypair,
  Transaction,
  Networks,
  FeeBumpTransaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import logger from '../lib/logger';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Redis key prefix for SEP-10 challenges. */
const KEY_PREFIX = 'sep10:challenge:';

/** TTL for a pending challenge (seconds). Matches SEP-10 recommendation of 300 s. */
const CHALLENGE_TTL_SECONDS = 300;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChallengeRecord {
  nonce: string;
  issuedAt: number; // Unix timestamp (ms)
}

export interface AuthChallengeResponse {
  /** Base64-encoded challenge transaction XDR to be signed by the client. */
  challengeXdr: string;
  /** Unix timestamp (ms) at which the challenge expires. */
  expiresAt: number;
}

export interface AuthVerifyResult {
  /** Whether the challenge was valid and the signature is correct. */
  valid: boolean;
  /** Public key of the verified account (only present when valid === true). */
  publicKey?: string;
  error?: string;
}

// ─── Redis client ─────────────────────────────────────────────────────────────

/**
 * Lazily-constructed Redis client.
 *
 * The connection string is read from REDIS_URL at runtime. This allows the
 * module to be imported in tests without immediately opening a connection.
 */
let _redis: Redis | null = null;

export function getRedisClient(): Redis {
  if (!_redis) {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error(
        'REDIS_URL is not set. Add redis://localhost:6379 to your .env.local for development.',
      );
    }
    _redis = new Redis(url, {
      // Fail fast during startup so misconfiguration is visible immediately.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 3,
    });

    _redis.on('error', (err) => {
      logger.error({ event: 'redis.error', msg: err.message });
    });

    _redis.on('connect', () => {
      logger.info({ event: 'redis.connected', url: url.replace(/:[^:@]+@/, ':***@') });
    });
  }
  return _redis;
}

/**
 * Override the Redis client — used in tests to inject a mock or in-memory client.
 */
export function setRedisClient(client: Redis): void {
  _redis = client;
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Issue a SEP-10 challenge for the given public key.
 *
 * Stores a nonce in Redis with a 5-minute TTL and returns the challenge XDR
 * to be signed by the client.
 *
 * @param publicKey  Stellar G-address of the account requesting authentication
 * @param serverKeypair  Keypair used to sign the challenge transaction
 * @param networkPassphrase  Stellar network passphrase
 */
export async function issueChallenge(
  publicKey: string,
  serverKeypair: Keypair,
  networkPassphrase: string = Networks.TESTNET,
): Promise<AuthChallengeResponse> {
  const redis = getRedisClient();

  const nonce = serverKeypair.sign(Buffer.from(publicKey + Date.now())).toString('base64');
  const issuedAt = Date.now();
  const expiresAt = issuedAt + CHALLENGE_TTL_SECONDS * 1_000;

  const record: ChallengeRecord = { nonce, issuedAt };

  const redisKey = `${KEY_PREFIX}${publicKey}`;
  await redis.set(redisKey, JSON.stringify(record), 'EX', CHALLENGE_TTL_SECONDS);

  logger.debug({
    event: 'auth.challenge_issued',
    publicKey,
    expiresAt: new Date(expiresAt).toISOString(),
  });

  // Build a minimal Stellar transaction whose memo carries the nonce.
  // The client signs this transaction and returns it to verifyChallenge().
  const account = await buildChallengeAccount(publicKey, serverKeypair);
  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase,
  })
    .addMemo({ type: 'text', value: nonce.slice(0, 28) } as any) // SEP-10 uses memo
    .setTimeout(CHALLENGE_TTL_SECONDS)
    .build();

  tx.sign(serverKeypair);

  return {
    challengeXdr: tx.toEnvelope().toXDR('base64'),
    expiresAt,
  };
}

/**
 * Verify a SEP-10 challenge response.
 *
 * Atomically reads and deletes the stored challenge from Redis (GETDEL).
 * Returns `{ valid: false }` if the challenge has expired, was already used,
 * or the signature is invalid.
 *
 * @param publicKey  Stellar G-address of the authenticating account
 * @param signedXdr  Base64 XDR of the signed challenge transaction
 * @param networkPassphrase  Must match the network used in issueChallenge
 */
export async function verifyChallenge(
  publicKey: string,
  signedXdr: string,
  networkPassphrase: string = Networks.TESTNET,
): Promise<AuthVerifyResult> {
  const redis = getRedisClient();

  const redisKey = `${KEY_PREFIX}${publicKey}`;

  // Atomic read-and-delete: challenge is consumed on first use (no replay).
  const raw = await redis.getdel(redisKey);

  if (!raw) {
    return {
      valid: false,
      error: 'Challenge not found or already consumed. Request a new challenge.',
    };
  }

  let record: ChallengeRecord;
  try {
    record = JSON.parse(raw) as ChallengeRecord;
  } catch {
    return { valid: false, error: 'Malformed challenge record in Redis.' };
  }

  // Verify the nonce hasn't expired (belt-and-suspenders on top of Redis TTL).
  const ageMs = Date.now() - record.issuedAt;
  if (ageMs > CHALLENGE_TTL_SECONDS * 1_000) {
    return { valid: false, error: 'Challenge has expired.' };
  }

  // Verify the signature on the transaction.
  try {
    const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
    if (tx instanceof FeeBumpTransaction) {
      return { valid: false, error: 'FeeBumpTransaction is not accepted as a challenge response.' };
    }

    const keypair = Keypair.fromPublicKey(publicKey);
    const txHash = (tx as Transaction).hash();

    const hasValidSig = (tx as Transaction).signatures.some((sig) => {
      try {
        return keypair.verify(txHash, sig.signature());
      } catch {
        return false;
      }
    });

    if (!hasValidSig) {
      return { valid: false, error: 'No valid signature from the expected account.' };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `Signature verification failed: ${msg}` };
  }

  logger.info({ event: 'auth.challenge_verified', publicKey });

  return { valid: true, publicKey };
}

/**
 * Revoke all pending challenges for a given public key.
 * Useful when a user explicitly logs out or requests a new challenge.
 */
export async function revokeChallenge(publicKey: string): Promise<void> {
  const redis = getRedisClient();
  await redis.del(`${KEY_PREFIX}${publicKey}`);
  logger.debug({ event: 'auth.challenge_revoked', publicKey });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build a minimal Stellar Account object for transaction construction.
 * We use a deterministic sequence number so no RPC call is needed.
 */
async function buildChallengeAccount(
  publicKey: string,
  _serverKeypair: Keypair,
): Promise<{ accountId: () => string; sequenceNumber: () => string; incrementSequenceNumber: () => void; }> {
  // Minimal account shim — sequence number starts at 0 for challenge transactions.
  let seq = BigInt(0);
  return {
    accountId: () => publicKey,
    sequenceNumber: () => seq.toString(),
    incrementSequenceNumber: () => { seq += BigInt(1); },
  };
}
