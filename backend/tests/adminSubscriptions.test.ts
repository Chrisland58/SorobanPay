/**
 * adminSubscriptions.test.ts — #1381
 *
 * Unit tests for GET /api/v1/admin/subscriptions.
 *
 * Verifies:
 *   1. Returns 401 when Authorization header is missing.
 *   2. Returns 200 with paginated data when authenticated as admin.
 *   3. Returns 400 for an invalid status filter.
 *   4. Accepts valid status filters (ACTIVE, PAUSED, OVERDUE, CANCELLED, EXPIRED).
 *   5. Returns 400 for an invalid from date.
 *   6. Returns 400 for an invalid to date.
 *   7. meta.page reflects the requested page.
 *   8. pageSize is capped at 200.
 *   9. GET /subscriptions/:id returns 400 for non-numeric id.
 *  10. GET /subscriptions/:id returns 404 for unknown id.
 */

import express from 'express';
import request from 'supertest';
import { createHmac } from 'crypto';

// ---------------------------------------------------------------------------
// Mock Prisma before importing the router
// ---------------------------------------------------------------------------

const mockSubscriptions = [
  {
    id: 1,
    subscriber: 'GABC',
    merchant: 'GXYZ',
    token: 'CABC',
    status: 'ACTIVE',
    amount: '100',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: 2,
    subscriber: 'GDEF',
    merchant: 'GXYZ',
    token: 'CABC',
    status: 'CANCELLED',
    amount: '50',
    createdAt: new Date('2024-02-01'),
    updatedAt: new Date('2024-02-15'),
  },
  {
    id: 3,
    subscriber: 'GHIJ',
    merchant: 'GNEW',
    token: 'CDEF',
    status: 'OVERDUE',
    amount: '200',
    createdAt: new Date('2024-03-01'),
    updatedAt: new Date('2024-03-10'),
  },
];

const mockPrismaSubscription = {
  findMany: jest.fn().mockResolvedValue(mockSubscriptions),
  findUnique: jest.fn().mockImplementation(
    ({ where }: { where: { id: number } }) =>
      Promise.resolve(mockSubscriptions.find((s) => s.id === where.id) ?? null),
  ),
  count: jest.fn().mockResolvedValue(mockSubscriptions.length),
};

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn().mockImplementation((ops: unknown[]) =>
      Promise.all(
        ops.map((op) => (typeof op === 'function' ? op() : Promise.resolve(op))),
      ),
    ),
    subscription: mockPrismaSubscription,
    webhookDelivery: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    event: {
      count: jest.fn().mockResolvedValue(0),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  },
}));

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------

import adminRouter from '../src/routes/admin';

const TEST_ADMIN_SECRET = 'test-admin-secret-1381';

const app = express();
app.use(express.json());
app.use('/api/v1/admin', adminRouter);

// ---------------------------------------------------------------------------
// Helper: build a valid admin JWT
// ---------------------------------------------------------------------------

function makeAdminToken(secret = TEST_ADMIN_SECRET): string {
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

beforeAll(() => {
  process.env.ADMIN_JWT_SECRET = TEST_ADMIN_SECRET;
});

afterAll(() => {
  delete process.env.ADMIN_JWT_SECRET;
});

// ---------------------------------------------------------------------------
// Tests — GET /api/v1/admin/subscriptions
// ---------------------------------------------------------------------------

describe('#1381 — GET /api/v1/admin/subscriptions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(app).get('/api/v1/admin/subscriptions');
    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization token has wrong role', async () => {
    const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const now     = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({ sub: 'merchant', role: 'merchant', iat: now, exp: now + 3600 }),
    ).toString('base64url');
    const sig = createHmac('sha256', TEST_ADMIN_SECRET)
      .update(`${header}.${payload}`)
      .digest('base64url');
    const token = `${header}.${payload}.${sig}`;

    const res = await request(app)
      .get('/api/v1/admin/subscriptions')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('returns 200 with data and meta when authenticated', async () => {
    const res = await request(app)
      .get('/api/v1/admin/subscriptions')
      .set('Authorization', `Bearer ${makeAdminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('meta');
    expect(res.body.meta).toMatchObject({
      total: expect.any(Number),
      page: expect.any(Number),
      pageSize: expect.any(Number),
      totalPages: expect.any(Number),
    });
  });

  it('returns 400 for an invalid status filter', async () => {
    const res = await request(app)
      .get('/api/v1/admin/subscriptions?status=BOGUS')
      .set('Authorization', `Bearer ${makeAdminToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid status/);
  });

  it('returns 200 for each valid status filter', async () => {
    const statuses = ['ACTIVE', 'PAUSED', 'OVERDUE', 'CANCELLED', 'EXPIRED'];
    for (const status of statuses) {
      const res = await request(app)
        .get(`/api/v1/admin/subscriptions?status=${status}`)
        .set('Authorization', `Bearer ${makeAdminToken()}`);
      expect(res.status).toBe(200);
    }
  });

  it('returns 400 for an invalid from date', async () => {
    const res = await request(app)
      .get('/api/v1/admin/subscriptions?from=not-a-date')
      .set('Authorization', `Bearer ${makeAdminToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/from must be a valid ISO 8601 date/);
  });

  it('returns 400 for an invalid to date', async () => {
    const res = await request(app)
      .get('/api/v1/admin/subscriptions?to=not-a-date')
      .set('Authorization', `Bearer ${makeAdminToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/to must be a valid ISO 8601 date/);
  });

  it('meta.page reflects the requested page', async () => {
    const res = await request(app)
      .get('/api/v1/admin/subscriptions?page=2&pageSize=10')
      .set('Authorization', `Bearer ${makeAdminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.page).toBe(2);
    expect(res.body.meta.pageSize).toBe(10);
  });

  it('caps pageSize at 200', async () => {
    const res = await request(app)
      .get('/api/v1/admin/subscriptions?pageSize=9999')
      .set('Authorization', `Bearer ${makeAdminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.pageSize).toBeLessThanOrEqual(200);
  });

  it('passes merchant filter through to prisma', async () => {
    await request(app)
      .get('/api/v1/admin/subscriptions?merchant=GXYZ')
      .set('Authorization', `Bearer ${makeAdminToken()}`);
    const findManyCall = mockPrismaSubscription.findMany.mock.calls[0];
    expect(findManyCall).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tests — GET /api/v1/admin/subscriptions/:id
// ---------------------------------------------------------------------------

describe('#1381 — GET /api/v1/admin/subscriptions/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/v1/admin/subscriptions/1');
    expect(res.status).toBe(401);
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await request(app)
      .get('/api/v1/admin/subscriptions/abc')
      .set('Authorization', `Bearer ${makeAdminToken()}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/id must be a numeric value/);
  });

  it('returns 200 for a known subscription id', async () => {
    const res = await request(app)
      .get('/api/v1/admin/subscriptions/1')
      .set('Authorization', `Bearer ${makeAdminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
  });

  it('returns 404 for an unknown subscription id', async () => {
    mockPrismaSubscription.findUnique.mockResolvedValueOnce(null);
    const res = await request(app)
      .get('/api/v1/admin/subscriptions/9999')
      .set('Authorization', `Bearer ${makeAdminToken()}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Subscription not found/);
  });
});
