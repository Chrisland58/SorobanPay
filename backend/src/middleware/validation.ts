/**
 * #1385 — Input validation middleware using Zod.
 *
 * Provides:
 *  - validateQuery(schema) — middleware factory that validates req.query
 *  - validateBody(schema)  — middleware factory that validates req.body
 *  - validate(schema)      — alias for validateBody (generic name)
 *  - Shared Zod schemas for Stellar addresses, amounts, intervals, and URLs
 *
 * NOTE: Express 5 makes `req.query` a read-only getter backed by a parsed
 * querystring. We cannot reassign it, so validated query params are stored
 * on `req.validatedQuery`. Route handlers should read from there.
 */

import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';

// ---------------------------------------------------------------------------
// Middleware factories
// ---------------------------------------------------------------------------

/**
 * Returns Express middleware that validates req.query against the given Zod
 * schema. On failure it responds 400 with structured field-level errors.
 * On success it stores the parsed (coerced) result on `req.validatedQuery`.
 *
 * Express 5 makes `req.query` a read-only getter, so we cannot overwrite it.
 * Use `(req as any).validatedQuery` in handlers downstream.
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({
        error: 'Invalid query parameters',
        details: result.error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }
    (req as any).validatedQuery = result.data;
    next();
  };
}

/**
 * Returns Express middleware that validates req.body against the given Zod
 * schema. On failure it responds 400 with structured field-level errors.
 * On success it replaces req.body with the parsed (coerced) result.
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: result.error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

/**
 * Generic alias for validateBody — use when the context is clear.
 */
export const validate = validateBody;

// ---------------------------------------------------------------------------
// Stellar address schemas
// ---------------------------------------------------------------------------

/**
 * Validates a Stellar account address (public key).
 * Must start with G and be 56 characters of base32 (A-Z2-7).
 */
export const stellarAddressSchema = z
  .string()
  .regex(
    /^G[A-Z2-7]{55}$/,
    'Must be a valid Stellar account address (starts with G, 56 characters)',
  );

/**
 * Validates a Soroban contract address.
 * Must start with C and be 56 characters of base32 (A-Z2-7).
 */
export const contractAddressSchema = z
  .string()
  .regex(
    /^C[A-Z2-7]{55}$/,
    'Must be a valid Soroban contract address (starts with C, 56 characters)',
  );

/**
 * Accepts either a Stellar account address (G...) or a contract address (C...).
 */
export const stellarAddressOrContractSchema = z.union([
  stellarAddressSchema,
  contractAddressSchema,
]);

// ---------------------------------------------------------------------------
// Payment parameter schemas
// ---------------------------------------------------------------------------

/**
 * Validates a subscription payment amount.
 * Must be a positive integer string or number representable as bigint, ≤ 10^18.
 */
export const amountSchema = z
  .union([z.string(), z.number(), z.bigint()])
  .transform((v) => BigInt(v.toString()))
  .refine((v) => v > 0n, { message: 'Amount must be positive' })
  .refine((v) => v <= 1_000_000_000_000_000_000n, {
    message: 'Amount must be ≤ 10^18 (1,000,000,000,000,000,000)',
  });

/**
 * Validates a subscription interval in seconds.
 * Minimum: 86400 (1 day), maximum: 31536000 (365 days).
 */
export const intervalSchema = z.coerce
  .number()
  .int('Interval must be an integer')
  .min(86400, 'Interval must be at least 86400 seconds (1 day)')
  .max(31536000, 'Interval must be at most 31536000 seconds (365 days)');

/**
 * Validates a webhook delivery URL.
 * Must be a valid HTTPS URL (HTTP not accepted for security reasons).
 */
export const webhookUrlSchema = z
  .string()
  .url('Must be a valid URL')
  .refine((v) => v.startsWith('https://'), {
    message: 'Webhook URL must use HTTPS',
  });

// ---------------------------------------------------------------------------
// Composite request body schemas
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/subscriptions — create or update a subscription.
 */
export const subscribeBodySchema = z.object({
  subscriber: stellarAddressSchema,
  merchant: stellarAddressSchema,
  token: stellarAddressOrContractSchema,
  amount: amountSchema,
  interval: intervalSchema,
  strict: z.boolean().default(false),
  grace_period: z.coerce.number().int().min(0).optional(),
});

export type SubscribeBody = z.infer<typeof subscribeBodySchema>;

/**
 * POST /api/v1/webhooks — register a webhook endpoint.
 */
export const webhookRegisterBodySchema = z.object({
  url: webhookUrlSchema,
  events: z
    .array(z.string().min(1))
    .min(1, 'At least one event type is required'),
  secret: z.string().min(16, 'Webhook secret must be at least 16 characters').optional(),
});

export type WebhookRegisterBody = z.infer<typeof webhookRegisterBodySchema>;

/**
 * POST /api/v1/auth/token — exchange a signed challenge for a JWT.
 */
export const authTokenBodySchema = z.object({
  transaction: z.string().min(1, 'transaction field is required'),
});

export type AuthTokenBody = z.infer<typeof authTokenBodySchema>;

// ---------------------------------------------------------------------------
// Common query parameter schemas
// ---------------------------------------------------------------------------

/** ISO 8601 date string (YYYY-MM-DD or full datetime). */
export const isoDateString = z.string().datetime({ offset: true }).or(
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format'),
);

/** Pagination query parameters. */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Payment report query parameters (BE-58). */
export const reportQuerySchema = z.object({
  merchant: z.string().min(1, 'merchant is required'),
  from: isoDateString.optional(),
  to: isoDateString.optional(),
  format: z.enum(['json', 'csv']).default('json'),
  status: z.enum(['all', 'success', 'failed']).default('all'),
  limit: z.coerce.number().int().min(1).max(100_000).default(10_000),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ReportQuery = z.infer<typeof reportQuerySchema>;
