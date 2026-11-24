/**
 * cancellationAudit.test.ts — #1382
 *
 * Unit tests for the cancellation audit trail service and routes.
 *
 * Verifies:
 *   recordCancellation:
 *     1. Calls prisma upsert with correct data.
 *     2. Is idempotent on duplicate transactionHash.
 *     3. Throws if reason exceeds 1000 characters.
 *     4. Accepts reason up to 1000 characters.
 *     5. Uses source='event' by default.
 *     6. Accepts source='reconciliation'.
 *
 *   listCancellations:
 *     7. Returns data, total, limit, and offset.
 *     8. Caps limit at 200.
 *     9. Uses default limit 50 when not specified.
 *
 *   pruneExpiredAuditRecords:
 *    10. Calls deleteMany with a cutoff date at least 6 years in the past.
 *    11. Reads AUDIT_RETENTION_YEARS env var when retentionYears not passed.
 *
 *   Route — GET /api/v1/admin/cancellations:
 *    12. Returns 401 without admin JWT.
 *    13. Returns 200 with data and pagination fields when authenticated.
 *    14. Returns 400 for invalid from date.
 *    15. Returns 400 for invalid to date.
 *    16. Returns 400 for invalid network value.
 *
 *   Route — GET /api/v1/admin/cancellations/export:
 *    17. Returns CSV content-type and attachment header.
 *    18. Returns 400 for invalid from date.
 */

import {
  recordCancellation,
  listCancellations,
  pruneExpiredAuditRecords,
  CancellationAuditInput,
} from '../src/services/cancellationAuditService';

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

const mockRecord = {
  id: 'uuid-1',
  network: 'testnet',
  contractId: 'CABC',
  subscriberAddress: 'GABC',
  merchantAddress: 'GXYZ',
  tokenAddress: 'CTOK',
  amount: '10000000',
  intervalSeconds: BigInt(2592000),
  nextPaymentAt: new Date('2026-07-01'),
  cancelledAt: new Date('2026-06-01'),
  ledger: BigInt(1234567),
  transactionHash: 'abc123',
  reason: 'Switching to annual billing',
  source: 'event',
  createdAt: new Date('2026-06-01'),
  updatedAt: new Date('2026-06-01'),
};

const mockPrisma = {
  $transaction: jest.fn().mockImplementation((ops: unknown[]) =>
    Promise.all(
      ops.map((op) => (typeof op === 'function' ? op() : Promise.resolve(op))),
    ),
  ),
  cancellationAudit: {
    upsert:     jest.fn().mockResolvedValue(mockRecord),
    findMany:   jest.fn().mockResolvedValue([mockRecord]),
    count:      jest.fn().mockResolvedValue(1),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
};

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

// ---------------------------------------------------------------------------
// Shared valid input
// ---------------------------------------------------------------------------

const validInput: CancellationAuditInput = {
  network: 'testnet',
  contractId: 'CABC',
  subscriberAddress: 'GABC',
  merchantAddress: 'GXYZ',
  tokenAddress: 'CTOK',
  amount: '10000000',
  intervalSeconds: BigInt(2592000),
  ledger: BigInt(1234567),
  transactionHash: 'abc123',
};

// ---------------------------------------------------------------------------
// Tests — recordCancellation
// ---------------------------------------------------------------------------

describe('#1382 — recordCancellation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('1. calls prisma upsert with correct transactionHash', async () => {
    await recordCancellation(validInput);
    expect(mockPrisma.cancellationAudit.upsert).toHaveBeenCalledTimes(1);
    const call = mockPrisma.cancellationAudit.upsert.mock.calls[0][0];
    expect(call.where.network_tx_hash.transactionHash).toBe('abc123');
  });

  it('2. is idempotent — upsert called twice without error', async () => {
    await recordCancellation(validInput);
    await recordCancellation(validInput);
    expect(mockPrisma.cancellationAudit.upsert).toHaveBeenCalledTimes(2);
  });

  it('3. throws if reason exceeds 1000 characters', async () => {
    const input = { ...validInput, reason: 'x'.repeat(1001) };
    await expect(recordCancellation(input)).rejects.toThrow(
      'reason must not exceed 1000 characters',
    );
  });

  it('4. accepts reason exactly 1000 characters', async () => {
    const input = { ...validInput, reason: 'x'.repeat(1000) };
    await expect(recordCancellation(input)).resolves.toBeDefined();
  });

  it('5. uses source=event by default', async () => {
    await recordCancellation(validInput);
    const call = mockPrisma.cancellationAudit.upsert.mock.calls[0][0];
    expect(call.create.source).toBe('event');
  });

  it('6. accepts source=reconciliation', async () => {
    await recordCancellation({ ...validInput, source: 'reconciliation' });
    const call = mockPrisma.cancellationAudit.upsert.mock.calls[0][0];
    expect(call.create.source).toBe('reconciliation');
  });
});

// ---------------------------------------------------------------------------
// Tests — listCancellations
// ---------------------------------------------------------------------------

describe('#1382 — listCancellations', () => {
  beforeEach(() => jest.clearAllMocks());

  it('7. returns data, total, limit, and offset', async () => {
    const result = await listCancellations({ merchantAddress: 'GXYZ' });
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('limit');
    expect(result).toHaveProperty('offset');
  });

  it('8. caps limit at 200', async () => {
    const result = await listCancellations({ limit: 99999 });
    expect(result.limit).toBeLessThanOrEqual(200);
  });

  it('9. uses default limit 50 when not specified', async () => {
    const result = await listCancellations({});
    expect(result.limit).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Tests — pruneExpiredAuditRecords
// ---------------------------------------------------------------------------

describe('#1382 — pruneExpiredAuditRecords', () => {
  beforeEach(() => jest.clearAllMocks());

  it('10. calls deleteMany with a cutoff date at least 6 years ago', async () => {
    await pruneExpiredAuditRecords(7);
    expect(mockPrisma.cancellationAudit.deleteMany).toHaveBeenCalledTimes(1);
    const call = mockPrisma.cancellationAudit.deleteMany.mock.calls[0][0];
    expect(call.where.cancelledAt.lt).toBeInstanceOf(Date);
    const sixYearsAgo = new Date();
    sixYearsAgo.setFullYear(sixYearsAgo.getFullYear() - 6);
    expect(call.where.cancelledAt.lt.getTime()).toBeLessThan(sixYearsAgo.getTime());
  });

  it('11. reads AUDIT_RETENTION_YEARS env var when retentionYears not passed', async () => {
    process.env.AUDIT_RETENTION_YEARS = '10';
    await pruneExpiredAuditRecords();
    const call = mockPrisma.cancellationAudit.deleteMany.mock.calls[0][0];
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    // Cutoff should be approximately 10 years ago (within 1 minute tolerance)
    expect(
      Math.abs(call.where.cancelledAt.lt.getTime() - tenYearsAgo.getTime()),
    ).toBeLessThan(60_000);
    delete process.env.AUDIT_RETENTION_YEARS;
  });
});

// ---------------------------------------------------------------------------
// Tests — Routes (GET /api/v1/admin/cancellations)
// ---------------------------------------------------------------------------

import express from 'express';
import request from 'supertest';
import { createHmac } from 'crypto';
import cancellationAuditRouter from '../src/routes/cancellationAudit';

const TEST_SECRET = 'test-admin-secret-1382';

function makeAdminToken(secret = TEST_SECRET): string {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now     = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ sub: 'admin', role: 'admin', iat: now, exp: now + 3600 }),
  ).toString('base64url');
  const sig = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

const app = express();
app.use(express.json());
app.use('/api/v1/admin/cancellations', cancellationAuditRouter);

beforeAll(() => { process.env.ADMIN_JWT_SECRET = TEST_SECRET; });
afterAll(()  => { delete process.env.ADMIN_JWT_SECRET; });

describe('#1382 — GET /api/v1/admin/cancellations', () => {
  beforeEach(() => jest.clearAllMocks());

  it('12. returns 401 without admin JWT', async () => {
    const res = await request(app).get('/api/v1/admin/cancellations');
    expect(res.status).toBe(401);
  });

  it('13. returns 200 with data and pagination fields', async () => {
    const res = await request(app)
      .get('/api/v1/admin/cancellations')
      .set('Authorization', `Bearer ${makeAdminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('limit');
    expect(res.body).toHaveProperty('offset');
  });

  it('14. returns 400 for invalid from date', async () => {
    const res = await request(app)
      .get('/api/v1/admin/cancellations?from=not-a-date')
      .set('Authorization', `Bearer ${makeAdminToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/from must be a valid ISO 8601 date/);
  });

  it('15. returns 400 for invalid to date', async () => {
    const res = await request(app)
      .get('/api/v1/admin/cancellations?to=bad-date')
      .set('Authorization', `Bearer ${makeAdminToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/to must be a valid ISO 8601 date/);
  });

  it('16. returns 400 for invalid network value', async () => {
    const res = await request(app)
      .get('/api/v1/admin/cancellations?network=unknown')
      .set('Authorization', `Bearer ${makeAdminToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/network must be testnet or mainnet/);
  });
});

describe('#1382 — GET /api/v1/admin/cancellations/export', () => {
  beforeEach(() => jest.clearAllMocks());

  it('17. returns CSV content-type and attachment header', async () => {
    const res = await request(app)
      .get('/api/v1/admin/cancellations/export')
      .set('Authorization', `Bearer ${makeAdminToken()}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.headers['content-disposition']).toMatch(/cancellations-/);
  });

  it('18. returns 400 for invalid from date in export', async () => {
    const res = await request(app)
      .get('/api/v1/admin/cancellations/export?from=bad')
      .set('Authorization', `Bearer ${makeAdminToken()}`);
    expect(res.status).toBe(400);
  });
});
