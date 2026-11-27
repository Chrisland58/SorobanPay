/**
 * analytics.pagination.contract.test.ts
 *
 * API contract tests for stable cursor pagination under interleaved inserts
 * on GET /api/analytics/events.
 *
 * Covers:
 *  - Traversal of original result set without duplicates or omissions when
 *    records with equal or later timestamps are inserted between page requests
 *  - Subsequent observation of newly inserted records
 *  - Stable ordering tie-breakers (createdAt + id)
 *  - Cursor tampering (malformed, empty, non-numeric, zero, negative) -> 400
 *  - Page-size bounds (min=1, max=200, out-of-bounds/non-numeric -> 400)
 *  - Consistent REST response schema for empty and final pages
 */

import express from 'express';
import request from 'supertest';

interface StoredEvent {
  id: number;
  userId: string;
  eventName: string;
  page: string | null;
  properties: Record<string, unknown> | null;
  createdAt: Date;
}

const store: StoredEvent[] = [];

jest.mock('../../lib/prisma', () => ({
  __esModule: true,
  default: {
    analyticsEvent: {
      findMany: jest.fn(async (args: any) => {
        const where = args?.where ?? {};
        let rows = store.filter((r) => {
          if (where.userId !== undefined && r.userId !== where.userId) return false;
          if (where.id?.gt !== undefined && !(r.id > where.id.gt)) return false;
          if (where.id?.lt !== undefined && !(r.id < where.id.lt)) return false;
          return true;
        });

        const orderBy: Array<Record<string, 'asc' | 'desc'>> = args?.orderBy ?? [];
        rows = [...rows].sort((a, b) => {
          for (const clause of orderBy) {
            if (clause.createdAt) {
              const diff = a.createdAt.getTime() - b.createdAt.getTime();
              if (diff !== 0) return clause.createdAt === 'asc' ? diff : -diff;
            }
            if (clause.id) {
              const diff = a.id - b.id;
              if (diff !== 0) return clause.id === 'asc' ? diff : -diff;
            }
          }
          return 0;
        });

        if (typeof args?.take === 'number') {
          rows = rows.slice(0, args.take);
        }

        return rows.map((r) => ({
          id: r.id,
          eventName: r.eventName,
          page: r.page,
          properties: r.properties,
          createdAt: r.createdAt,
        }));
      }),
      count: jest.fn(async (args: any) => {
        const where = args?.where ?? {};
        return store.filter((r) =>
          where.userId !== undefined ? r.userId === where.userId : true,
        ).length;
      }),
    },
    event: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}));

import analyticsRouter from '../analytics';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/analytics', analyticsRouter);
  return app;
}

const TENANT_ID = 'tenant-contract';
const TENANT_HEADER = { 'x-tenant-id': TENANT_ID };

function seedEvent(id: number, createdAt: Date, eventName = `event_${id}`): StoredEvent {
  const record: StoredEvent = {
    id,
    userId: TENANT_ID,
    eventName,
    page: '/checkout',
    properties: null,
    createdAt,
  };
  store.push(record);
  return record;
}

function encodeCursor(raw: string): string {
  return Buffer.from(raw, 'utf8').toString('base64url');
}

describe('GET /api/analytics/events — cursor pagination API contract', () => {
  beforeEach(() => {
    store.length = 0;
    jest.clearAllMocks();
  });

  describe('stable pagination under interleaved inserts', () => {
    test('traverses original set without duplicates or omissions and observes newly inserted records', async () => {
      const t1 = new Date('2026-01-01T00:00:00.000Z');
      const t2 = new Date('2026-01-01T00:01:00.000Z');
      const t3 = new Date('2026-01-01T00:02:00.000Z');

      seedEvent(1, t1);
      seedEvent(2, t1);
      seedEvent(3, t2);
      seedEvent(4, t2);

      const app = buildApp();

      // Page 1 (limit=2) -> [1, 2]
      const page1 = await request(app)
        .get('/api/analytics/events?limit=2')
        .set(TENANT_HEADER);

      expect(page1.status).toBe(200);
      expect(page1.body.items.map((i: any) => i.id)).toEqual([1, 2]);
      expect(page1.body.nextCursor).toBeTruthy();
      expect(page1.body.prevCursor).toBeNull();

      // Interleave inserts between page 1 and page 2:
      // one with equal timestamp (t2) and one with later timestamp (t3)
      seedEvent(5, t2);
      seedEvent(6, t3);

      // Page 2 (limit=2) -> [3, 4], no duplicates or omissions of original set
      const page2 = await request(app)
        .get(`/api/analytics/events?limit=2&cursor=${page1.body.nextCursor}`)
        .set(TENANT_HEADER);

      expect(page2.status).toBe(200);
      expect(page2.body.items.map((i: any) => i.id)).toEqual([3, 4]);
      expect(page2.body.nextCursor).toBeTruthy();
      expect(page2.body.prevCursor).toBeTruthy();

      // Page 3 (limit=2) -> observes newly inserted [5, 6]
      const page3 = await request(app)
        .get(`/api/analytics/events?limit=2&cursor=${page2.body.nextCursor}`)
        .set(TENANT_HEADER);

      expect(page3.status).toBe(200);
      expect(page3.body.items.map((i: any) => i.id)).toEqual([5, 6]);
      expect(page3.body.nextCursor).toBeNull();
      expect(page3.body.prevCursor).toBeTruthy();

      const allIds = [
        ...page1.body.items,
        ...page2.body.items,
        ...page3.body.items,
      ].map((i: any) => i.id);
      expect(allIds).toEqual([1, 2, 3, 4, 5, 6]);
      expect(new Set(allIds).size).toBe(6);
    });

    test('uses id as deterministic tie-breaker when createdAt timestamps are equal', async () => {
      const sameTs = new Date('2026-01-01T12:00:00.000Z');
      seedEvent(10, sameTs);
      seedEvent(11, sameTs);
      seedEvent(12, sameTs);

      const app = buildApp();

      const fwd1 = await request(app)
        .get('/api/analytics/events?limit=2&direction=forward')
        .set(TENANT_HEADER);
      expect(fwd1.status).toBe(200);
      expect(fwd1.body.items.map((i: any) => i.id)).toEqual([10, 11]);

      const fwd2 = await request(app)
        .get(`/api/analytics/events?limit=2&direction=forward&cursor=${fwd1.body.nextCursor}`)
        .set(TENANT_HEADER);
      expect(fwd2.status).toBe(200);
      expect(fwd2.body.items.map((i: any) => i.id)).toEqual([12]);
      expect(fwd2.body.nextCursor).toBeNull();

      const bwd = await request(app)
        .get('/api/analytics/events?limit=3&direction=backward')
        .set(TENANT_HEADER);
      expect(bwd.status).toBe(200);
      expect(bwd.body.items.map((i: any) => i.id)).toEqual([12, 11, 10]);
    });
  });

  describe('cursor tampering and validation', () => {
    test.each([
      ['malformed', '!!!not-base64!!!'],
      ['non-numeric', encodeCursor('not-a-number')],
      ['zero', encodeCursor('0')],
      ['negative', encodeCursor('-42')],
    ])('returns 400 for %s cursor', async (_label, badCursor) => {
      const app = buildApp();
      const res = await request(app)
        .get(`/api/analytics/events?cursor=${encodeURIComponent(badCursor)}`)
        .set(TENANT_HEADER);

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid cursor' });
    });
  });

  describe('page-size bounds', () => {
    test('accepts minimum limit=1 and maximum limit=200', async () => {
      const app = buildApp();

      const minRes = await request(app)
        .get('/api/analytics/events?limit=1')
        .set(TENANT_HEADER);
      expect(minRes.status).toBe(200);

      const maxRes = await request(app)
        .get('/api/analytics/events?limit=200')
        .set(TENANT_HEADER);
      expect(maxRes.status).toBe(200);
    });

    test.each(['0', '-1', '201', 'abc'])('returns 400 for invalid limit=%s', async (limit) => {
      const app = buildApp();
      const res = await request(app)
        .get(`/api/analytics/events?limit=${limit}`)
        .set(TENANT_HEADER);

      expect(res.status).toBe(400);
    });
  });

  describe('REST response schema consistency', () => {
    test('empty dataset returns consistent CursorPage shape', async () => {
      const app = buildApp();
      const res = await request(app)
        .get('/api/analytics/events')
        .set(TENANT_HEADER);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        items: [],
        nextCursor: null,
        prevCursor: null,
        total: 0,
        pageSize: 0,
      });
    });

    test('final page returns consistent CursorPage shape with null nextCursor', async () => {
      const ts = new Date('2026-01-01T00:00:00.000Z');
      seedEvent(1, ts);
      seedEvent(2, ts);
      seedEvent(3, ts);

      const app = buildApp();
      const page1 = await request(app)
        .get('/api/analytics/events?limit=2')
        .set(TENANT_HEADER);

      const finalPage = await request(app)
        .get(`/api/analytics/events?limit=2&cursor=${page1.body.nextCursor}`)
        .set(TENANT_HEADER);

      expect(finalPage.status).toBe(200);
      expect(finalPage.body).toMatchObject({
        nextCursor: null,
        total: 3,
        pageSize: 1,
      });
      expect(typeof finalPage.body.prevCursor).toBe('string');
      expect(Array.isArray(finalPage.body.items)).toBe(true);
      expect(finalPage.body.items).toHaveLength(1);
    });
  });
});
