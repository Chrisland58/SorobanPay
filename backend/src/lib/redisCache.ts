/**
 * Issue #1444 — Redis cache client for MRR analytics and future use.
 *
 * Provides a simple get/set/del cache API backed by ioredis.
 * Falls back gracefully to a no-op implementation when REDIS_URL is not set
 * or ioredis is not installed.
 *
 * Usage:
 *   import { redisCache } from './redisCache';
 *
 *   // Cache an expensive MRR query result for 60 seconds
 *   const cached = await redisCache.get<MrrResult>(`mrr:${merchant}`);
 *   if (cached) return cached;
 *   const result = await computeMrr(merchant);
 *   await redisCache.set(`mrr:${merchant}`, result, 60);
 *   return result;
 */

export interface CacheClient {
  /** Get a cached value by key. Returns null if not found or Redis is unavailable. */
  get<T = unknown>(key: string): Promise<T | null>;
  /** Set a value. ttlSeconds defaults to 60 if not provided. */
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
  /** Delete a key. */
  del(key: string): Promise<void>;
  /** Check Redis connectivity. Returns "ok" or an error message. */
  ping(): Promise<string>;
  /** Close the connection (for graceful shutdown). */
  quit(): Promise<void>;
}

// ---------------------------------------------------------------------------
// No-op fallback implementation (in-memory disabled)
// ---------------------------------------------------------------------------

const noop: CacheClient = {
  get: async () => null,
  set: async () => {},
  del: async () => {},
  ping: async () => 'disabled',
  quit: async () => {},
};

// ---------------------------------------------------------------------------
// Redis implementation (ioredis)
// ---------------------------------------------------------------------------

const CACHE_KEY_PREFIX = process.env.REDIS_CACHE_PREFIX ?? 'sorobanpay:cache:';
const DEFAULT_TTL_SECONDS = 60;

function buildRedisCache(): CacheClient {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.info('[redis-cache] REDIS_URL not set — cache disabled.');
    return noop;
  }

  let client: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Redis = require('ioredis');
    client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
      retryStrategy: (times: number) => {
        if (times > 5) {
          console.warn('[redis-cache] Redis reconnect attempts exhausted; cache disabled.');
          return null;
        }
        return Math.min(times * 200, 2000);
      },
    });
    client.on('error', (err: Error) => {
      console.warn(`[redis-cache] Redis error: ${err.message}`);
    });
    client.on('connect', () => {
      console.info('[redis-cache] Redis cache client connected.');
    });
  } catch {
    console.warn('[redis-cache] ioredis not installed — cache disabled.');
    return noop;
  }

  const prefixed = (key: string) => `${CACHE_KEY_PREFIX}${key}`;

  return {
    async get<T>(key: string): Promise<T | null> {
      try {
        const raw = await client.get(prefixed(key));
        if (raw === null) return null;
        return JSON.parse(raw) as T;
      } catch (err) {
        console.warn(`[redis-cache] get failed for key "${key}": ${(err as Error).message}`);
        return null;
      }
    },

    async set(key: string, value: unknown, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<void> {
      try {
        const raw = JSON.stringify(value);
        await client.set(prefixed(key), raw, 'EX', ttlSeconds);
      } catch (err) {
        console.warn(`[redis-cache] set failed for key "${key}": ${(err as Error).message}`);
        // fail-open — caching failure should not break the API
      }
    },

    async del(key: string): Promise<void> {
      try {
        await client.del(prefixed(key));
      } catch {
        /* best-effort */
      }
    },

    async ping(): Promise<string> {
      try {
        const result: string = await client.ping();
        return result === 'PONG' ? 'ok' : result;
      } catch (err) {
        return `error: ${(err as Error).message}`;
      }
    },

    async quit(): Promise<void> {
      try {
        await client.quit();
      } catch {
        /* ignore */
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton — lazily initialised
// ---------------------------------------------------------------------------

let _cache: CacheClient | undefined;

export function getRedisCache(): CacheClient {
  if (!_cache) {
    _cache = buildRedisCache();
  }
  return _cache;
}

/** Convenience re-export of the singleton for simple imports. */
export const redisCache = {
  get: <T>(key: string) => getRedisCache().get<T>(key),
  set: (key: string, value: unknown, ttl?: number) => getRedisCache().set(key, value, ttl),
  del: (key: string) => getRedisCache().del(key),
  ping: () => getRedisCache().ping(),
  quit: () => getRedisCache().quit(),
};
