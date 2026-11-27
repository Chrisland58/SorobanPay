/**
 * backend/tests/tenantRateLimiterAndBodyLimits.test.ts
 *
 * Covers:
 *  - Issue #1594: Tenant-level rate limits for expensive API operations
 *  - Issue #1591: Request body and collection-size limits on API routes
 */

import express, { Express, Request, Response } from 'express';
import request from 'supertest';
import { makeTenantLimiter } from '../src/middleware/rateLimiter';
import {
  webhookRegisterBodySchema,
  batchPaymentBodySchema,
  validateBody,
} from '../src/middleware/validation';
import { errorHandler } from '../src/middleware/errorHandler';

describe('Tenant-Level Rate Limiting (Issue #1594)', () => {
  function buildAppWithLimiter() {
    const app: Express = express();
    app.use(express.json());

    // Middleware to extract tenant from header or query
    app.use((req: Request, _res: Response, next) => {
      const tid = (req.headers['x-tenant-id'] as string) || (req.query.tenantId as string);
      if (tid) (req as any).tenantId = tid;
      next();
    });

    // 2 requests per window for easy testing
    const limiter = makeTenantLimiter('export', 60 * 1000, 2);

    app.get('/api/v1/expensive-export', limiter, (_req: Request, res: Response) => {
      res.json({ success: true });
    });

    return app;
  }

  it('enforces limit per tenant and isolates limits between tenants', async () => {
    const app = buildAppWithLimiter();

    // Tenant A consumes their 2 requests
    await request(app)
      .get('/api/v1/expensive-export')
      .set('x-tenant-id', 'tenant_a')
      .expect(200);

    await request(app)
      .get('/api/v1/expensive-export')
      .set('x-tenant-id', 'tenant_a')
      .expect(200);

    // Tenant A is now rate-limited
    const resA = await request(app)
      .get('/api/v1/expensive-export')
      .set('x-tenant-id', 'tenant_a')
      .expect(429);

    expect(resA.body.error).toBe('Too Many Requests');
    expect(resA.body.operationClass).toBe('export');
    expect(resA.headers['retry-after']).toBeDefined();

    // Tenant B is unaffected and can still make requests
    await request(app)
      .get('/api/v1/expensive-export')
      .set('x-tenant-id', 'tenant_b')
      .expect(200);
  });
});

describe('Request Body & Collection Size Limits (Issue #1591)', () => {
  function buildAppWithBodyLimits() {
    const app: Express = express();
    // 5kb limit for testing oversize rejection
    app.use(express.json({ limit: '5kb' }));

    app.post(
      '/api/v1/webhooks',
      validateBody(webhookRegisterBodySchema),
      (_req: Request, res: Response) => {
        res.json({ success: true });
      },
    );

    app.post(
      '/api/v1/payments/batch',
      validateBody(batchPaymentBodySchema),
      (_req: Request, res: Response) => {
        res.json({ success: true });
      },
    );

    app.use(errorHandler);
    return app;
  }

  it('rejects oversized JSON bodies with 413 Payload Too Large', async () => {
    const app = buildAppWithBodyLimits();
    const largePayload = { data: 'x'.repeat(10 * 1024) }; // 10kb > 5kb limit

    const res = await request(app)
      .post('/api/v1/webhooks')
      .send(largePayload)
      .expect(413);

    expect(res.body.error).toMatch(/Payload Too Large/i);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.correlationId).toBeDefined();
  });

  it('rejects webhook registrations exceeding the maximum collection size (50 event types)', async () => {
    const app = buildAppWithBodyLimits();
    const tooManyEvents = Array.from({ length: 51 }, (_, i) => `event.type.${i}`);

    const res = await request(app)
      .post('/api/v1/webhooks')
      .send({
        url: 'https://example.com/webhook',
        events: tooManyEvents,
      })
      .expect(400);

    expect(res.body.error).toBe('Invalid request body');
    expect(res.body.details[0].message).toContain('Cannot exceed 50 event types');
  });

  it('rejects batch payment requests exceeding the maximum collection size (100 subscribers)', async () => {
    const app = buildAppWithBodyLimits();
    const tooManySubscribers = Array.from(
      { length: 101 },
      () => 'GBBD7632644265432654326543265432654326543265432654326543',
    );

    const res = await request(app)
      .post('/api/v1/payments/batch')
      .send({
        merchant: 'GA234567890123456789012345678901234567890123456789012345',
        subscribers: tooManySubscribers,
      })
      .expect(400);

    expect(res.body.error).toBe('Invalid request body');
    expect(res.body.details[0].message).toContain('Batch size cannot exceed 100 subscribers');
  });

  it('accepts valid payloads within collection size bounds', async () => {
    const app = buildAppWithBodyLimits();
    await request(app)
      .post('/api/v1/webhooks')
      .send({
        url: 'https://example.com/webhook',
        events: ['payment.success', 'payment.failed'],
      })
      .expect(200);
  });
});
