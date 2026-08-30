import Redis from 'ioredis';

/**
 * Shared ioredis client.
 *
 * Reads REDIS_URL from the environment (set in .env.local / docker-compose).
 * Falls back to redis://localhost:6379 for local development.
 *
 * The client is a singleton: import it from this module everywhere instead of
 * creating multiple connections.
 */
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  // Reconnect with capped exponential back-off so transient network blips
  // don't flood logs and don't cause infinite-retry storms.
  retryStrategy(times: number): number | null {
    if (times > 10) {
      // Stop retrying after 10 attempts; let the caller handle the error.
      return null;
    }
    return Math.min(times * 100, 3_000); // max 3 s between retries
  },
  lazyConnect: false,
});

redis.on('error', (err: Error) => {
  console.error('[redis] connection error:', err.message);
});

redis.on('connect', () => {
  console.log('[redis] connected');
});

export default redis;
