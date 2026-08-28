/**
 * authService.ts
 *
 * SEP-10 challenge/response authentication service.
 *
 * Challenges are stored in Redis with a 5-minute TTL so they survive across
 * multiple backend instances (fixes #756 — the previous in-memory Map broke
 * authentication in horizontally-scaled deployments where ~50% of verify
 * requests landed on a pod that had never seen the challenge).
 *
 * Storage strategy:
 *   SET  soroban_pay:challenge:<accountId>  <JSON>  EX 300
 *   GETDEL soroban_pay:challenge:<accountId>        (atomic fetch-and-delete)
 *
 * Using GETDEL is intentional: it atomically retrieves and removes the record
 * in one round-trip, preventing replay attacks where an attacker re-submits the
 * same signed challenge after it has already been verified.
 */

import Redis from 'ioredis';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChallengeRecord {
  /** Random nonce embedded in the challenge transaction (base64-encoded XDR) */
  challengeXdr: string;
  /** Stellar G-address this challenge was issued for */
  accountId: string;
  /** Unix timestamp (ms) when the challenge was created */
  issuedAt: number;
}

export interface VerifyResult {
  /** true if the challenge exists, is unexpired, and the signature is valid */
  valid: boolean;
  /** Human-readable failure reason, present only when valid === false */
  error?: string;
}

// ── Redis setup ────────────────────────────────────────────────────────────────

/**
 * Redis TTL for challenges in seconds (5 minutes).
 * Must be long enough for the user to sign in their wallet but short enough to
 * limit the replay window.
 */
const CHALLENGE_TTL_SECONDS = 300;

/** Redis key prefix to avoid collisions with other services on the same instance */
const KEY_PREFIX = 'soroban_pay:challenge:';

/** Build the Redis key for a given account ID */
function challengeKey(accountId: string): string {
  return `${KEY_PREFIX}${accountId}`;
}

/**
 * Create a Redis client from the REDIS_URL environment variable.
 *
 * Falls back to `redis://localhost:6379` for local development so the service
 * starts without configuration in a default docker-compose setup.
 *
 * `lazyConnect: true` defers the connection until the first command so that
 * import-time errors don't crash the process before the app can log them.
 */
function createRedisClient(): Redis {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  return new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });
}

// Module-level singleton — one connection shared across all service calls.
let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    _redis = createRedisClient();
  }
  return _redis;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Store a SEP-10 challenge for the given account with a 5-minute TTL.
 *
 * Replaces any existing challenge for the same account (new login attempt
 * invalidates the previous one).
 *
 * @param record  Challenge record to store
 * @throws        On Redis connection or write failure
 */
export async function storeChallenge(record: ChallengeRecord): Promise<void> {
  const redis = getRedis();
  const key   = challengeKey(record.accountId);
  const value = JSON.stringify(record);

  // SET key value EX 300  (atomic write + TTL in one command)
  await redis.set(key, value, 'EX', CHALLENGE_TTL_SECONDS);
}

/**
 * Atomically retrieve and delete the pending challenge for an account.
 *
 * Uses the Redis GETDEL command (available since Redis 6.2) which fetches and
 * removes the key in a single atomic operation. This prevents race conditions
 * where two concurrent verify requests both read the same challenge before
 * either deletes it.
 *
 * Returns `null` if:
 *   - No challenge was stored for this account
 *   - The challenge TTL already expired (Redis evicted the key)
 *
 * @param accountId  Stellar G-address of the authenticating account
 * @returns          The stored ChallengeRecord, or null if not found
 * @throws           On Redis connection or command failure
 */
export async function consumeChallenge(
  accountId: string,
): Promise<ChallengeRecord | null> {
  const redis = getRedis();
  const key   = challengeKey(accountId);

  // GETDEL is atomic: fetch the value and delete the key in one round-trip.
  // This ensures a challenge can only be verified once, even under concurrent
  // requests from multiple backend pods.
  const raw = await redis.getdel(key);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as ChallengeRecord;
  } catch {
    // Corrupted data in Redis — treat as missing
    return null;
  }
}

/**
 * Check whether a pending challenge exists for an account (non-destructive read).
 *
 * Useful for diagnostics and rate-limiting — does NOT consume the challenge.
 *
 * @param accountId  Stellar G-address to check
 * @returns          true if a live challenge exists
 */
export async function hasPendingChallenge(accountId: string): Promise<boolean> {
  const redis  = getRedis();
  const exists = await redis.exists(challengeKey(accountId));
  return exists === 1;
}

/**
 * Gracefully close the Redis connection.
 *
 * Call this during process shutdown (SIGTERM/SIGINT) to allow in-flight
 * commands to finish before the connection is torn down.
 */
export async function closeRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}
