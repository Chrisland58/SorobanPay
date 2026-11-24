/**
 * Tests for #1385 — Zod input validation middleware and schemas.
 */

import { Request, Response, NextFunction } from 'express';
import {
  validateBody,
  validateQuery,
  validate,
  stellarAddressSchema,
  contractAddressSchema,
  stellarAddressOrContractSchema,
  amountSchema,
  intervalSchema,
  webhookUrlSchema,
  subscribeBodySchema,
  webhookRegisterBodySchema,
  authTokenBodySchema,
  paginationSchema,
} from '../src/middleware/validation';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockReqRes(body: unknown = {}, query: unknown = {}) {
  const req = { body, query } as unknown as Request;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  const next = jest.fn() as NextFunction;
  return { req, res, next, status, json };
}

// ---------------------------------------------------------------------------
// stellarAddressSchema
// ---------------------------------------------------------------------------

describe('stellarAddressSchema', () => {
  const VALID = 'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3YUPNFMRA';

  it('accepts a valid G-address (56 chars)', () => {
    expect(stellarAddressSchema.safeParse(VALID).success).toBe(true);
  });

  it('rejects an address that does not start with G', () => {
    const result = stellarAddressSchema.safeParse('BAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3YUPNFMRA');
    expect(result.success).toBe(false);
  });

  it('rejects an address that is too short', () => {
    expect(stellarAddressSchema.safeParse('GABC123').success).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(stellarAddressSchema.safeParse('').success).toBe(false);
  });

  it('rejects an address with lowercase characters', () => {
    const lower = VALID.toLowerCase();
    expect(stellarAddressSchema.safeParse(lower).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// contractAddressSchema
// ---------------------------------------------------------------------------

describe('contractAddressSchema', () => {
  const VALID_CONTRACT = 'CAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3YUPNFMRA';

  it('accepts a valid C-address', () => {
    expect(contractAddressSchema.safeParse(VALID_CONTRACT).success).toBe(true);
  });

  it('rejects a G-address', () => {
    const g = 'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3YUPNFMRA';
    expect(contractAddressSchema.safeParse(g).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stellarAddressOrContractSchema
// ---------------------------------------------------------------------------

describe('stellarAddressOrContractSchema', () => {
  it('accepts G-address', () => {
    expect(
      stellarAddressOrContractSchema.safeParse(
        'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3YUPNFMRA',
      ).success,
    ).toBe(true);
  });

  it('accepts C-address', () => {
    expect(
      stellarAddressOrContractSchema.safeParse(
        'CAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3YUPNFMRA',
      ).success,
    ).toBe(true);
  });

  it('rejects other prefixes', () => {
    expect(
      stellarAddressOrContractSchema.safeParse(
        'XAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3YUPNFMRA',
      ).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// amountSchema
// ---------------------------------------------------------------------------

describe('amountSchema', () => {
  it('accepts a positive integer string', () => {
    const result = amountSchema.safeParse('100');
    expect(result.success).toBe(true);
    expect((result as any).data).toBe(100n);
  });

  it('accepts a positive number', () => {
    expect(amountSchema.safeParse(500).success).toBe(true);
  });

  it('rejects 0', () => {
    expect(amountSchema.safeParse(0).success).toBe(false);
  });

  it('rejects negative amounts', () => {
    expect(amountSchema.safeParse(-1).success).toBe(false);
  });

  it('rejects amounts above 10^18', () => {
    expect(amountSchema.safeParse('1000000000000000001').success).toBe(false);
  });

  it('accepts exactly 10^18', () => {
    expect(amountSchema.safeParse('1000000000000000000').success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// intervalSchema
// ---------------------------------------------------------------------------

describe('intervalSchema', () => {
  it('accepts the minimum value (86400)', () => {
    expect(intervalSchema.safeParse(86400).success).toBe(true);
  });

  it('accepts the maximum value (31536000)', () => {
    expect(intervalSchema.safeParse(31536000).success).toBe(true);
  });

  it('rejects values below 86400', () => {
    expect(intervalSchema.safeParse(86399).success).toBe(false);
  });

  it('rejects values above 31536000', () => {
    expect(intervalSchema.safeParse(31536001).success).toBe(false);
  });

  it('accepts a string that coerces to a valid number', () => {
    expect(intervalSchema.safeParse('604800').success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// webhookUrlSchema
// ---------------------------------------------------------------------------

describe('webhookUrlSchema', () => {
  it('accepts a valid https URL', () => {
    expect(webhookUrlSchema.safeParse('https://example.com/webhook').success).toBe(true);
  });

  it('rejects an http URL', () => {
    const result = webhookUrlSchema.safeParse('http://example.com/webhook');
    expect(result.success).toBe(false);
    expect((result as any).error.errors[0].message).toContain('HTTPS');
  });

  it('rejects a non-URL string', () => {
    expect(webhookUrlSchema.safeParse('not-a-url').success).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(webhookUrlSchema.safeParse('').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateBody middleware
// ---------------------------------------------------------------------------

describe('validateBody middleware', () => {
  const schema = z.object({ name: z.string().min(1) });

  it('calls next() when body is valid', () => {
    const { req, res, next } = mockReqRes({ name: 'Alice' });
    validateBody(schema)(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('replaces req.body with the parsed (coerced) value', () => {
    const coercingSchema = z.object({ count: z.coerce.number() });
    const { req, res, next } = mockReqRes({ count: '42' });
    validateBody(coercingSchema)(req, res, next);
    expect(req.body.count).toBe(42);
  });

  it('returns 400 with field-level errors on invalid body', () => {
    const { req, res, next, status, json } = mockReqRes({ name: '' });
    validateBody(schema)(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Invalid request body',
        details: expect.arrayContaining([
          expect.objectContaining({ field: 'name' }),
        ]),
      }),
    );
  });

  it('validate() is an alias for validateBody()', () => {
    expect(validate).toBe(validateBody);
  });
});

// ---------------------------------------------------------------------------
// validateQuery middleware
// ---------------------------------------------------------------------------

describe('validateQuery middleware', () => {
  const schema = paginationSchema;

  it('calls next() and sets validatedQuery on valid input', () => {
    const { req, res, next } = mockReqRes({}, { limit: '10', offset: '0' });
    validateQuery(schema)(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect((req as any).validatedQuery).toEqual({ limit: 10, offset: 0 });
  });

  it('returns 400 on invalid query', () => {
    const { req, res, next, status } = mockReqRes({}, { limit: '-1' });
    validateQuery(schema)(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
  });

  it('does not overwrite req.query (Express 5 safety)', () => {
    const { req, res, next } = mockReqRes({}, { limit: '5' });
    const originalQuery = req.query;
    validateQuery(schema)(req, res, next);
    expect(req.query).toBe(originalQuery);
  });
});

// ---------------------------------------------------------------------------
// subscribeBodySchema
// ---------------------------------------------------------------------------

describe('subscribeBodySchema', () => {
  const VALID_BODY = {
    subscriber: 'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3YUPNFMRA',
    merchant:   'GBHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3YUPNFMRA',
    token:      'CAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3YUPNFMRA',
    amount:     '1000',
    interval:   2592000,
    strict:     false,
  };

  it('accepts a valid subscribe body', () => {
    expect(subscribeBodySchema.safeParse(VALID_BODY).success).toBe(true);
  });

  it('rejects when subscriber is not a valid Stellar address', () => {
    const result = subscribeBodySchema.safeParse({ ...VALID_BODY, subscriber: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('rejects when interval is below minimum', () => {
    const result = subscribeBodySchema.safeParse({ ...VALID_BODY, interval: 3600 });
    expect(result.success).toBe(false);
  });

  it('defaults strict to false when omitted', () => {
    const { strict, ...withoutStrict } = VALID_BODY;
    const result = subscribeBodySchema.safeParse(withoutStrict);
    expect(result.success).toBe(true);
    expect((result as any).data.strict).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// webhookRegisterBodySchema
// ---------------------------------------------------------------------------

describe('webhookRegisterBodySchema', () => {
  it('accepts a valid webhook registration', () => {
    const result = webhookRegisterBodySchema.safeParse({
      url: 'https://example.com/hook',
      events: ['payment.executed'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an http webhook URL', () => {
    const result = webhookRegisterBodySchema.safeParse({
      url: 'http://example.com/hook',
      events: ['payment.executed'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty events array', () => {
    const result = webhookRegisterBodySchema.safeParse({
      url: 'https://example.com/hook',
      events: [],
    });
    expect(result.success).toBe(false);
  });
});
