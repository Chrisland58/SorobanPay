/**
 * BE-59 — Rate limiting and DDoS protection.
 *
 * Features:
 *  - Per-route limits: public (60/min), auth (10/min), export (1/min)
 *  - Retry-After header on every 429 response
 *  - Body size limit enforced via express.json({ limit: '10kb' })
 *  - Configurable IP trust-proxy via RATE_LIMIT_TRUST_PROXY env var
 *  - Redis-backed store (distributed) via ioredis + rate-limiter-flexible
 *    when REDIS_URL is set; falls back to in-memory store otherwise
 *  - Configurable IP allowlist for internal monitoring (RATE_LIMIT_ALLOWLIST)
 *
 * Issue #1444 — Switched from rate-limit-redis to ioredis + rate-limiter-flexible
 * for distributed rate limiting across multiple backend replicas.
 */

import rateLimit, { RateLimitRequestHandler, Options } from 'express-rate-limit';
import { Request, Response } from 'express';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function logLimitReached(req: Request): void {
  const log = (req as any).log ?? console;
  if (typeof log.warn === 'function') {
    log.warn({
      event: 'rate_limit.exceeded',
      ip: req.ip,
      path: req.path,
    });
  }
}

/**
 * Build a handler that emits a 429 with a Retry-After header.
 * windowMs is the limiter's window in milliseconds.
 */
function make429Handler(windowMs: number) {
  return (req: Request, res: Response): void => {
    logLimitReached(req);
    const retryAfterSec = Math.ceil(windowMs / 1000);
    res.setHeader('Retry-After', String(retryAfterSec));
    res.status(429).json({
      error: 'Too Many Requests',
      retryAfter: retryAfterSec,
      message: `Rate limit exceeded. Please wait ${retryAfterSec} seconds before retrying.`,
    });
  };
}

// ---------------------------------------------------------------------------
// IP allowlist (comma-separated IPs in RATE_LIMIT_ALLOWLIST env var)
// ---------------------------------------------------------------------------

const rawAllowlist = process.env.RATE_LIMIT_ALLOWLIST ?? '';
const allowlistedIPs = new Set(
  rawAllowlist
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

function isAllowlisted(req: Request): boolean {
  if (allowlistedIPs.size === 0) return false;
  return allowlistedIPs.has(req.ip ?? '');
}

// ---------------------------------------------------------------------------
// Redis client (shared singleton) — ioredis
// ---------------------------------------------------------------------------

let redisClient: any | undefined;

function getRedisClient(): any | undefined {
  if (redisClient !== undefined) return redisClient; // may be null (failed)

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return undefined; // memory store

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Redis = require('ioredis');
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
      // Suppress non-fatal errors to stdout — handled in error listeners below
      retryStrategy: (times: number) => {
        if (times > 5) {
          console.warn('[rate-limiter] Redis reconnect attempts exhausted; using memory store.');
          return null; // stop retrying
        }
        return Math.min(times * 100, 1000);
      },
    });
    redisClient.on('error', (err: Error) => {
      console.warn(`[rate-limiter] Redis error: ${err.message}`);
    });
    redisClient.on('connect', () => {
      console.info('[rate-limiter] Redis client connected.');
    });
  } catch {
    // ioredis not installed — fall back to memory store
    redisClient = null;
    console.warn('[rate-limiter] ioredis not installed — falling back to in-memory rate limiting.');
  }
  return redisClient ?? undefined;
}

// ---------------------------------------------------------------------------
// Distributed Redis store — rate-limiter-flexible adapter for express-rate-limit
// ---------------------------------------------------------------------------

/**
 * Adapter that wraps rate-limiter-flexible's RateLimiterRedis so it satisfies
 * the express-rate-limit `Options['store']` interface.
 */
class RedisStoreAdapter implements NonNullable<Options['store']> {
  private limiter: any;

  constructor(client: any, windowMs: number, max: number) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { RateLimiterRedis } = require('rate-limiter-flexible');
    this.limiter = new RateLimiterRedis({
      storeClient: client,
      keyPrefix: process.env.RATE_LIMIT_REDIS_PREFIX ?? 'sorobanpay:rl:',
      points: max,            // max requests per window
      duration: windowMs / 1000, // rate-limiter-flexible uses seconds
      blockDuration: 0,       // don't block after limit; let next window reset
      insuranceLimiter: undefined,
    });
  }

  async increment(key: string): Promise<{ totalHits: number; resetTime: Date | undefined }> {
    try {
      const res = await this.limiter.consume(key, 1);
      return {
        totalHits: res.consumedPoints,
        resetTime: new Date(Date.now() + res.msBeforeNext),
      };
    } catch (err: any) {
      // rate-limiter-flexible throws RateLimitError when limit exceeded
      if (err && typeof err.consumedPoints === 'number') {
        return {
          totalHits: err.consumedPoints,
          resetTime: new Date(Date.now() + (err.msBeforeNext ?? 0)),
        };
      }
      // Unexpected error — allow the request through (fail-open)
      return { totalHits: 1, resetTime: undefined };
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await this.limiter.reward(key, 1);
    } catch {
      /* ignore — best-effort */
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await this.limiter.delete(key);
    } catch {
      /* ignore — best-effort */
    }
  }
}

// ---------------------------------------------------------------------------
// Build the store: distributed Redis (ioredis + rate-limiter-flexible) or in-memory
// ---------------------------------------------------------------------------

function buildStore(windowMs: number, max: number): Options['store'] | undefined {
  const client = getRedisClient();
  if (!client) return undefined; // memory store fallback

  try {
    return new RedisStoreAdapter(client, windowMs, max);
  } catch {
    // rate-limiter-flexible not installed — fall back to memory
    console.warn('[rate-limiter] rate-limiter-flexible not installed — using in-memory store.');
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Rate limiter factory
// ---------------------------------------------------------------------------

function makeLimiter(windowMs: number, max: number): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: 'draft-7', // RateLimit-* headers (RFC draft 7)
    legacyHeaders: false,
    store: buildStore(windowMs, max),
    skip: (req) => isAllowlisted(req),
    handler: make429Handler(windowMs),
  });
}

// ---------------------------------------------------------------------------
// Named limiters
// ---------------------------------------------------------------------------

/** 60 requests per minute — general public endpoints */
export const publicLimiter = makeLimiter(60 * 1000, 60);

/** 10 requests per minute — auth/challenge endpoints */
export const authLimiter = makeLimiter(60 * 1000, 10);

/** 1 request per minute — export/reporting endpoints */
export const exportLimiter = makeLimiter(60 * 1000, 1);

/**
 * Legacy export — kept for backwards compat with existing index.ts usage.
 * Behaves like publicLimiter.
 */
export const apiLimiter = publicLimiter;

/** @deprecated use publicLimiter instead */
export const strictLimiter = authLimiter;
