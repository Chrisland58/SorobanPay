/**
 * Redis client with graceful fallback.
 *
 * When REDIS_URL is not set or Redis is unreachable, all cache operations
 * silently return null/undefined so the application continues hitting
 * PostgreSQL directly without any change in behaviour.
 *
 * Cache TTLs are configurable via environment variables:
 *   CACHE_TTL_SUBSCRIPTIONS         (default: 60 s)
 *   CACHE_TTL_ANALYTICS             (default: 300 s)
 *   CACHE_TTL_SUBSCRIPTION_DETAIL   (default: 30 s)
 *
 * Distributed locks (#1067):
 *   acquireLock / renewLock / releaseLock implement ownership-token-based
 *   distributed locking so expired locks cannot be released by another worker.
 */

import Redis from 'ioredis';
import { randomUUID } from 'crypto';

// ─── TTL configuration ────────────────────────────────────────────────────
export const CACHE_TTL = {
  /** subscriptions:merchant:{address} */
  subscriptions: parseInt(process.env.CACHE_TTL_SUBSCRIPTIONS ?? '60', 10),
  /** analytics:revenue:{address}:{period} */
  analytics: parseInt(process.env.CACHE_TTL_ANALYTICS ?? '300', 10),
  /** subscription:{subscriber}:{merchant} */
  subscriptionDetail: parseInt(process.env.CACHE_TTL_SUBSCRIPTION_DETAIL ?? '30', 10),
} as const;

// ─── Cache key helpers ────────────────────────────────────────────────────
export const CacheKey = {
  merchantSubscriptions: (address: string) => `subscriptions:merchant:${address}`,
  analyticsRevenue: (address: string, period: string) =>
    `analytics:revenue:${address}:${period}`,
  subscriptionDetail: (subscriber: string, merchant: string) =>
    `subscription:${subscriber}:${merchant}`,
  // Pattern helpers for invalidation
  merchantPattern: (address: string) => `subscriptions:merchant:${address}*`,
  analyticsPattern: (address: string) => `analytics:revenue:${address}*`,
  subscriptionPattern: (subscriber: string, merchant: string) =>
    `subscription:${subscriber}:${merchant}*`,
};

// ─── Pub/Sub channel names ────────────────────────────────────────────────
export const PubSubChannel = {
  /** Published when a new event is indexed for a merchant. */
  newEvent: 'cache:invalidate',
} as const;

// ─── Redis client singleton ───────────────────────────────────────────────

let redisClient: Redis | null = null;
let redisAvailable = false;

/**
 * Returns the shared Redis client, or null if Redis is unavailable.
 * The client is created lazily on first call.
 */
export function getRedisClient(): Redis | null {
  if (redisClient) return redisAvailable ? redisClient : null;

  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn('[redis] REDIS_URL not set — caching disabled, falling back to PostgreSQL.');
    return null;
  }

  redisClient = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    lazyConnect: true,
  });

  redisClient.on('connect', () => {
    redisAvailable = true;
    console.log('[redis] Connected to Redis.');
  });

  redisClient.on('error', (err: Error) => {
    if (redisAvailable) {
      console.warn('[redis] Connection error — caching disabled, falling back to PostgreSQL:', err.message);
    }
    redisAvailable = false;
  });

  redisClient.on('reconnecting', () => {
    console.log('[redis] Reconnecting to Redis…');
  });

  redisClient.on('ready', () => {
    redisAvailable = true;
    console.log('[redis] Ready.');
  });

  // Attempt connection (non-blocking — if it fails we fall back gracefully)
  redisClient.connect().catch((err: Error) => {
    console.warn('[redis] Initial connection failed — caching disabled:', err.message);
    redisAvailable = false;
  });

  return redisAvailable ? redisClient : null;
}

// ─── Cache helpers ────────────────────────────────────────────────────────

/**
 * Get a value from cache. Returns null on cache miss or Redis unavailability.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = getRedisClient();
  if (!client) return null;
  try {
    const raw = await client.get(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn('[redis] cacheGet error — falling back to PostgreSQL:', (err as Error).message);
    return null;
  }
}

/**
 * Set a value in cache with an optional TTL (seconds).
 * Silently swallows errors.
 */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const client = getRedisClient();
  if (!client) return;
  try {
    await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    console.warn('[redis] cacheSet error:', (err as Error).message);
  }
}

/**
 * Delete one or more cache keys by exact match.
 * Silently swallows errors.
 */
export async function cacheDelete(...keys: string[]): Promise<void> {
  const client = getRedisClient();
  if (!client || keys.length === 0) return;
  try {
    await client.del(...keys);
  } catch (err) {
    console.warn('[redis] cacheDelete error:', (err as Error).message);
  }
}

/**
 * Delete all cache keys matching a glob pattern.
 * Uses SCAN to avoid blocking the Redis server.
 */
export async function cacheDeletePattern(pattern: string): Promise<void> {
  const client = getRedisClient();
  if (!client) return;
  try {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, found] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...found);
    } while (cursor !== '0');

    if (keys.length > 0) {
      await client.del(...keys);
    }
  } catch (err) {
    console.warn('[redis] cacheDeletePattern error:', (err as Error).message);
  }
}

/**
 * Publish a cache-invalidation message on the Redis pub/sub channel.
 * Used by the event indexer to bust stale cache entries when new events arrive.
 */
export async function publishCacheInvalidation(payload: CacheInvalidationPayload): Promise<void> {
  const client = getRedisClient();
  if (!client) return;
  try {
    await client.publish(PubSubChannel.newEvent, JSON.stringify(payload));
  } catch (err) {
    console.warn('[redis] publishCacheInvalidation error:', (err as Error).message);
  }
}

export interface CacheInvalidationPayload {
  merchant: string;
  subscriber?: string;
  eventType: string;
}

/**
 * Subscribe to cache-invalidation events and run the handler for each message.
 * Creates a dedicated subscriber client so the main client can still issue
 * regular commands (ioredis clients in subscribe mode cannot issue GETS/SETS).
 *
 * Returns a cleanup function that unsubscribes when called.
 */
export function subscribeToCacheInvalidation(
  handler: (payload: CacheInvalidationPayload) => void,
): () => void {
  const url = process.env.REDIS_URL;
  if (!url) return () => {};

  const subscriber = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
  });

  subscriber.on('error', (err: Error) => {
    console.warn('[redis:subscriber] Error:', err.message);
  });

  subscriber.subscribe(PubSubChannel.newEvent).catch((err: Error) => {
    console.warn('[redis:subscriber] Subscribe failed:', err.message);
  });

  subscriber.on('message', (_channel: string, message: string) => {
    try {
      const payload = JSON.parse(message) as CacheInvalidationPayload;
      handler(payload);
    } catch (err) {
      console.warn('[redis:subscriber] Failed to parse message:', err);
    }
  });

  return () => {
    subscriber.unsubscribe(PubSubChannel.newEvent).catch(() => {});
    subscriber.quit().catch(() => {});
  };
}

/**
 * Gracefully disconnect the Redis client.
 * Call this during server shutdown.
 */
export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch {
      redisClient.disconnect();
    }
    redisClient = null;
    redisAvailable = false;
  }
}

// ─── Distributed lock ownership tokens (#1067) ────────────────────────────

/**
 * Options for acquiring a distributed lock.
 */
export interface LockOptions {
  /** Lock TTL in milliseconds. */
  ttlMs: number;
  /** Number of retry attempts after the first failure (default: 0 = no retry). */
  retryCount?: number;
  /** Delay between retry attempts in milliseconds (default: 100). */
  retryDelayMs?: number;
}

/**
 * A handle returned when a lock is successfully acquired.
 * Must be passed back to renewLock / releaseLock so the ownership token
 * can be verified atomically in Redis.
 */
export interface LockHandle {
  /** The full Redis key used to store the lock (prefix: lock:{key}). */
  key: string;
  /** UUID ownership token stored as the lock value. */
  token: string;
  /** Unix epoch milliseconds when the lock expires. */
  expiresAt: number;
}

/** Lua: atomically renew the lock TTL only if the token matches. */
const RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
else
  return 0
end
`;

/** Lua: atomically delete the lock only if the token matches. */
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`;

/** Sleep helper for retry back-off. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Acquire a distributed lock with an ownership token.
 *
 * Uses Redis SET NX PX so the lock is atomic: only one worker can hold it
 * at a time.  Returns a LockHandle containing the ownership token, or null
 * if the lock could not be acquired within the allowed retry budget.
 *
 * When Redis is unavailable the function returns null (graceful fallback).
 */
export async function acquireLock(
  key: string,
  options: LockOptions,
): Promise<LockHandle | null> {
  const client = getRedisClient();
  if (!client) return null;

  const redisKey = `lock:${key}`;
  const { ttlMs, retryCount = 0, retryDelayMs = 100 } = options;
  const token = randomUUID();
  const maxAttempts = 1 + retryCount;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // SET key value NX PX ttl  — returns 'OK' on success, null on failure
      const result = await client.set(redisKey, token, 'NX', 'PX', ttlMs);
      if (result === 'OK') {
        return { key: redisKey, token, expiresAt: Date.now() + ttlMs };
      }
    } catch (err) {
      console.warn('[redis] acquireLock error:', (err as Error).message);
      return null;
    }

    if (attempt < maxAttempts - 1) {
      await sleep(retryDelayMs);
    }
  }

  return null;
}

/**
 * Renew a lock's TTL using the ownership token.
 *
 * Returns true if the TTL was extended, false if the lock has expired or
 * is now held by a different worker (token mismatch).
 *
 * When Redis is unavailable returns false (graceful fallback).
 */
export async function renewLock(
  handle: LockHandle,
  ttlMs: number,
): Promise<boolean> {
  const client = getRedisClient();
  if (!client) return false;

  try {
    const result = await client.eval(
      RENEW_SCRIPT,
      1,
      handle.key,
      handle.token,
      String(ttlMs),
    ) as number;
    return result === 1;
  } catch (err) {
    console.warn('[redis] renewLock error:', (err as Error).message);
    return false;
  }
}

/**
 * Release a lock using the ownership token.
 *
 * Returns true if the lock was deleted, false if it has already expired or
 * is held by a different worker.  An expired lock owned by another worker
 * can never be released by this handle.
 *
 * When Redis is unavailable returns false (graceful fallback).
 */
export async function releaseLock(handle: LockHandle): Promise<boolean> {
  const client = getRedisClient();
  if (!client) return false;

  try {
    const result = await client.eval(
      RELEASE_SCRIPT,
      1,
      handle.key,
      handle.token,
    ) as number;
    return result === 1;
  } catch (err) {
    console.warn('[redis] releaseLock error:', (err as Error).message);
    return false;
  }
}
