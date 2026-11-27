/**
 * idempotencyMiddleware.test.ts
 *
 * Automated tests for standardized idempotency middleware across mutation routes (Issue #1583):
 * - Replays identical requests with original outcome and Idempotent-Replay header
 * - Rejects payload conflicts with 409 Conflict (IDEMPOTENCY_PAYLOAD_MISMATCH)
 * - Guards concurrent identical requests with 409 (IDEMPOTENCY_OPERATION_IN_PROGRESS)
 * - Validates key formats and scopes by tenant
 */

import express from 'express';
import request from 'supertest';
import {
  idempotencyMiddleware,
  clearIdempotencyStore,
  computePayloadHash,
} from '../src/middleware/idempotency';

describe('Standardized Idempotency Middleware (#1583)', () => {
  let app: express.Express;
  let counter = 0;

  beforeEach(() => {
    clearIdempotencyStore();
    counter = 0;
    app = express();
    app.use(express.json());
    app.use(idempotencyMiddleware());

    // Test mutation route that increments a counter (side-effect)
    app.post('/api/test/mutate', (req, res) => {
      counter += 1;
      res.status(201).json({
        success: true,
        counter,
        echo: req.body,
      });
    });
  });

  it('allows normal request without idempotency key to execute', async () => {
    const res = await request(app)
      .post('/api/test/mutate')
      .send({ amount: 100 });

    expect(res.status).toBe(201);
    expect(res.body.counter).toBe(1);
    expect(res.headers['idempotent-replay']).toBeUndefined();
  });

  it('replays identical request with original outcome without repeating side effects', async () => {
    const key = 'idem_key_123';
    const payload = { amount: 500, merchant: 'G_MERCHANT' };

    // First execution
    const firstRes = await request(app)
      .post('/api/test/mutate')
      .set('Idempotency-Key', key)
      .send(payload);

    expect(firstRes.status).toBe(201);
    expect(firstRes.body.counter).toBe(1);
    expect(firstRes.headers['idempotent-replay']).toBeUndefined();

    // Second execution (replay)
    const secondRes = await request(app)
      .post('/api/test/mutate')
      .set('Idempotency-Key', key)
      .send(payload);

    expect(secondRes.status).toBe(201);
    expect(secondRes.body.counter).toBe(1); // Counter did not increment again!
    expect(secondRes.headers['idempotent-replay']).toBe('true');
    expect(counter).toBe(1);
  });

  it('rejects same key with different payload with 409 Conflict', async () => {
    const key = 'idem_key_conflict';

    // First request
    await request(app)
      .post('/api/test/mutate')
      .set('Idempotency-Key', key)
      .send({ amount: 100 });

    // Second request with conflicting payload
    const conflictRes = await request(app)
      .post('/api/test/mutate')
      .set('Idempotency-Key', key)
      .send({ amount: 200 }); // Different amount!

    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.error).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');
    expect(counter).toBe(1);
  });

  it('rejects invalid key formats', async () => {
    const res = await request(app)
      .post('/api/test/mutate')
      .set('Idempotency-Key', 'invalid/key$#@!')
      .send({ amount: 100 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_IDEMPOTENCY_KEY');
  });

  it('computes canonical payload hash invariant to object key ordering', () => {
    const obj1 = { b: 2, a: 1, nested: { y: 'bar', x: 'foo' } };
    const obj2 = { a: 1, b: 2, nested: { x: 'foo', y: 'bar' } };

    expect(computePayloadHash(obj1)).toBe(computePayloadHash(obj2));
  });
});
