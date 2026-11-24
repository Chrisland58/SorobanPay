/**
 * Tests for #1386 — Structured logging with correlation IDs.
 *
 * Tests cover:
 *  - Logger level respects LOG_LEVEL env var
 *  - redactAddress/redactSecret helper correctness
 *  - correlationIdMiddleware: attaches req.id, sets X-Correlation-Id header
 *  - correlationIdMiddleware: respects incoming X-Correlation-Id header
 *  - createServiceLogger: produces a child logger with the service tag
 */

import { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockReqRes(headers: Record<string, string> = {}) {
  const req = {
    headers,
    method: 'GET',
    path: '/test',
  } as unknown as Request;

  const setHeader = jest.fn();
  const on = jest.fn();
  const res = { setHeader, on } as unknown as Response;

  const next = jest.fn() as NextFunction;
  return { req, res, next, setHeader, on };
}

// ---------------------------------------------------------------------------
// redactAddress
// ---------------------------------------------------------------------------

describe('redactAddress', () => {
  let redactAddress: (addr: string) => string;

  beforeAll(() => {
    ({ redactAddress } = require('../src/lib/logger'));
  });

  it('masks the middle of a long address', () => {
    const addr = 'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3YUPNFMRA';
    const result = redactAddress(addr);
    expect(result).toMatch(/^GAHJJJKM\.\.\./);
    expect(result).toEndWith('UPNFMRA');
    expect(result).not.toEqual(addr);
  });

  it('returns addresses of 16 chars or fewer unchanged', () => {
    expect(redactAddress('GABCDEFG')).toBe('GABCDEFG');
  });

  it('handles empty string', () => {
    expect(redactAddress('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// redactSecret
// ---------------------------------------------------------------------------

describe('redactSecret', () => {
  let redactSecret: (secret: string) => string;

  beforeAll(() => {
    ({ redactSecret } = require('../src/lib/logger'));
  });

  it('redacts a Stellar secret seed (S...)', () => {
    // 56 chars starting with S, base32
    const seed = 'SCZANGBA5YHTNYVVV326C7NKJUKGH7LCJG75BVDZSB6ZMKWCZZ7YUPEZ';
    const result = redactSecret(seed);
    expect(result).toContain('[REDACTED_SEED]');
    expect(result).not.toContain(seed.slice(4));
  });

  it('redacts a generic long secret token', () => {
    const token = 'some-very-long-secret-token-value';
    const result = redactSecret(token);
    expect(result).toContain('[REDACTED]');
  });

  it('redacts short strings as [REDACTED]', () => {
    expect(redactSecret('abc')).toBe('[REDACTED]');
  });

  it('handles empty string', () => {
    expect(redactSecret('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// createServiceLogger
// ---------------------------------------------------------------------------

describe('createServiceLogger', () => {
  it('returns a pino child logger', () => {
    const { createServiceLogger } = require('../src/lib/logger');
    const log = createServiceLogger('indexer');
    expect(typeof log.info).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.child).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Logger level
// ---------------------------------------------------------------------------

describe('logger level', () => {
  it('defaults to "info" when LOG_LEVEL is not set', () => {
    const saved = process.env.LOG_LEVEL;
    delete process.env.LOG_LEVEL;
    jest.resetModules();
    const { logger } = require('../src/lib/logger');
    expect(logger.level).toBe('info');
    if (saved !== undefined) process.env.LOG_LEVEL = saved;
  });

  it('uses LOG_LEVEL env var when set', () => {
    process.env.LOG_LEVEL = 'warn';
    jest.resetModules();
    const { logger } = require('../src/lib/logger');
    expect(logger.level).toBe('warn');
    delete process.env.LOG_LEVEL;
    jest.resetModules();
  });
});

// ---------------------------------------------------------------------------
// correlationIdMiddleware
// ---------------------------------------------------------------------------

describe('correlationIdMiddleware', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('attaches req.id as a non-empty string', () => {
    const { correlationIdMiddleware } = require('../src/middleware/correlationId');
    const { req, res, next } = mockReqRes();
    correlationIdMiddleware(req, res, next);
    expect(typeof req.id).toBe('string');
    expect(req.id.length).toBeGreaterThan(0);
  });

  it('sets the X-Correlation-Id response header', () => {
    const { correlationIdMiddleware } = require('../src/middleware/correlationId');
    const { req, res, next, setHeader } = mockReqRes();
    correlationIdMiddleware(req, res, next);
    expect(setHeader).toHaveBeenCalledWith('X-Correlation-Id', req.id);
  });

  it('attaches req.log as an object with info/error methods', () => {
    const { correlationIdMiddleware } = require('../src/middleware/correlationId');
    const { req, res, next } = mockReqRes();
    correlationIdMiddleware(req, res, next);
    expect(typeof req.log).toBe('object');
    expect(typeof req.log.info).toBe('function');
    expect(typeof req.log.error).toBe('function');
  });

  it('calls next()', () => {
    const { correlationIdMiddleware } = require('../src/middleware/correlationId');
    const { req, res, next } = mockReqRes();
    correlationIdMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('reuses an incoming X-Correlation-Id header instead of minting a new one', () => {
    const { correlationIdMiddleware } = require('../src/middleware/correlationId');
    const existingId = 'test-correlation-id-12345';
    const { req, res, next } = mockReqRes({ 'x-correlation-id': existingId });
    correlationIdMiddleware(req, res, next);
    expect(req.id).toBe(existingId);
  });

  it('generates distinct IDs for different requests', () => {
    const { correlationIdMiddleware } = require('../src/middleware/correlationId');
    const { req: req1, res: res1, next: next1 } = mockReqRes();
    const { req: req2, res: res2, next: next2 } = mockReqRes();
    correlationIdMiddleware(req1, res1, next1);
    correlationIdMiddleware(req2, res2, next2);
    expect(req1.id).not.toBe(req2.id);
  });
});
