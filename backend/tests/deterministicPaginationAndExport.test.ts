/**
 * backend/tests/deterministicPaginationAndExport.test.ts
 *
 * Covers:
 *  - Issue #1601: Structured API response metadata for request correlation
 *  - Issue #1600: Large merchant exports from a consistent database snapshot
 *  - Issue #1584: Preserve exact token amounts through API serialization
 *  - Issue #1582: Deterministic cursor pagination for payment & subscription APIs
 */

import express, { Express, Request, Response } from 'express';
import request from 'supertest';
import { correlationIdMiddleware } from '../src/middleware/correlationId';
import {
  encodeCursor,
  decodeCursor,
  paginateRecords,
  InvalidCursorError,
} from '../src/utils/cursorPagination';
import {
  formatTokenAmount,
  parseTokenAmount,
  serializeAmount,
} from '../src/utils/tokenAmount';
import {
  createSnapshotExportJob,
  getExportStatus,
  downloadExportSnapshot,
  _clearJobsForTesting,
} from '../src/services/snapshotExportService';

describe('Correlation Metadata Envelope (Issue #1601)', () => {
  function buildApp() {
    const app: Express = express();
    app.use(correlationIdMiddleware);

    app.get('/api/test-success', (_req: Request, res: Response) => {
      res.json({ data: 'ok' });
    });

    app.get('/api/test-error', (_req: Request, res: Response) => {
      res.status(400).json({ error: 'Bad Request' });
    });

    return app;
  }

  it('includes validated correlation ID in both success meta and error responses', async () => {
    const app = buildApp();

    const succ = await request(app).get('/api/test-success').expect(200);
    expect(succ.headers['x-correlation-id']).toBeDefined();
    expect(succ.body.meta?.requestId).toBe(succ.headers['x-correlation-id']);

    const err = await request(app).get('/api/test-error').expect(400);
    expect(err.headers['x-correlation-id']).toBeDefined();
    expect(err.body.correlationId).toBe(err.headers['x-correlation-id']);
  });

  it('accepts safe caller-supplied correlation ID within 64 chars', async () => {
    const app = buildApp();
    const customId = 'gateway-trace-1234567890';

    const res = await request(app)
      .get('/api/test-success')
      .set('x-correlation-id', customId)
      .expect(200);

    expect(res.headers['x-correlation-id']).toBe(customId);
    expect(res.body.meta.requestId).toBe(customId);
  });

  it('rejects malformed or oversized correlation ID and mints a clean UUID', async () => {
    const app = buildApp();
    const maliciousId = 'evil\r\nLogInjection: true\n' + 'x'.repeat(100);

    const res = await request(app)
      .get('/api/test-success')
      .set('x-correlation-id', maliciousId)
      .expect(200);

    // Header was rejected, fresh UUID generated
    expect(res.headers['x-correlation-id']).not.toBe(maliciousId);
    expect(res.headers['x-correlation-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});

describe('Snapshot Database Export (Issue #1600)', () => {
  beforeEach(() => {
    _clearJobsForTesting();
  });

  it('creates an async snapshot export job and produces deterministic CSV download', async () => {
    const merchant = 'GMERCHANT_EXPORT_TEST';
    const mockRows = [
      { date: '2024-01-01T00:00:00Z', subscriber: 'GSUB1', token: 'USDC', amount: '1000', txHash: 'tx1' },
      { date: '2024-01-02T00:00:00Z', subscriber: 'GSUB2', token: 'XLM', amount: '5000', txHash: 'tx2' },
    ];

    const job = await createSnapshotExportJob(merchant, async () => mockRows);
    expect(job.status).toBe('processing');

    // Wait for background generation
    await new Promise((r) => setTimeout(r, 50));

    const status = getExportStatus(job.jobId, merchant);
    expect(status.status).toBe('completed');
    expect(status.rowCount).toBe(2);
    expect(status.progress).toBe(100);

    // Download snapshot
    const downloaded = downloadExportSnapshot(job.jobId, merchant, job.downloadToken);
    expect(downloaded.csv).toContain('GSUB1');
    expect(downloaded.csv).toContain('GSUB2');
  });

  it('rejects unauthorized access from a different merchant or invalid download token', async () => {
    const merchant = 'GMERCHANT_ALPHA';
    const job = await createSnapshotExportJob(merchant, async () => []);
    await new Promise((r) => setTimeout(r, 20));

    // Another merchant tries to access status
    expect(() => getExportStatus(job.jobId, 'GMERCHANT_BETA')).toThrow(/Unauthorized/);

    // Invalid token
    expect(() => downloadExportSnapshot(job.jobId, merchant, 'wrong-token')).toThrow(
      /Invalid download token/,
    );
  });
});

describe('Exact Token Amount Serialization (Issue #1584)', () => {
  it('converts between raw base units and decimal strings without IEEE-754 drift', () => {
    // Stellar 7 decimals
    expect(formatTokenAmount('10000000', 7)).toBe('1.0');
    expect(formatTokenAmount('1', 7)).toBe('0.0000001');
    expect(parseTokenAmount('1.0', 7)).toBe('10000000');
    expect(parseTokenAmount('0.0000001', 7)).toBe('1');

    // 18 decimals (e.g. 1 ETH/ERC-20 = 10^18)
    const largeAmount = '1000000000000000000';
    expect(formatTokenAmount(largeAmount, 18)).toBe('1.0');
    expect(parseTokenAmount('1.0', 18)).toBe(largeAmount);

    // Arbitrary precision with small fraction: 0.000000000000000001
    expect(formatTokenAmount('1', 18)).toBe('0.000000000000000001');
    expect(parseTokenAmount('0.000000000000000001', 18)).toBe('1');

    // 6 decimals (e.g. USDC)
    expect(formatTokenAmount('50000000', 6)).toBe('50.0');
    expect(parseTokenAmount('50.0', 6)).toBe('50000000');

    // Zero decimal tokens
    expect(formatTokenAmount('42', 0)).toBe('42');
  });

  it('serializeAmount returns structured raw and formatted decimal properties', () => {
    const serialized = serializeAmount('15000000', 7);
    expect(serialized.raw).toBe('15000000');
    expect(serialized.decimal).toBe('1.5');
    expect(serialized.decimals).toBe(7);
  });
});

describe('Deterministic Cursor Pagination (Issue #1582)', () => {
  it('encodes and decodes opaque cursors deterministically', () => {
    const timestamp = '2024-01-15T12:00:00.000Z';
    const id = 'item_42';

    const cursor = encodeCursor(timestamp, id);
    expect(typeof cursor).toBe('string');

    const decoded = decodeCursor(cursor);
    expect(decoded.timestamp).toBe(timestamp);
    expect(decoded.id).toBe(id);
  });

  it('rejects tampered or corrupt cursors with InvalidCursorError', () => {
    const valid = encodeCursor('2024-01-15T12:00:00.000Z', 'id_1');
    const tampered = valid.slice(0, -4) + 'abcd';

    expect(() => decodeCursor(tampered)).toThrow(InvalidCursorError);
    expect(() => decodeCursor('not-a-cursor')).toThrow(InvalidCursorError);
  });

  it('paginates records stably across equal timestamps', () => {
    const fixedTs = '2024-01-15T10:00:00.000Z';
    const items = [
      { id: '10', createdAt: fixedTs, val: 'A' },
      { id: '9', createdAt: fixedTs, val: 'B' },
      { id: '8', createdAt: fixedTs, val: 'C' },
      { id: '7', createdAt: fixedTs, val: 'D' },
    ];

    // Page 1 (limit 2)
    const page1 = paginateRecords(items, 2, 4);
    expect(page1.data.map((d) => d.id)).toEqual(['10', '9']);
    expect(page1.pagination.hasMore).toBe(true);
    expect(page1.pagination.nextCursor).toBeDefined();

    const decoded = decodeCursor(page1.pagination.nextCursor!);
    expect(decoded.id).toBe('9');
    expect(decoded.timestamp).toBe(fixedTs);
  });
});
