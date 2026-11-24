/**
 * Unit tests for the enhanced /health endpoint (#1377).
 *
 * All external dependencies (Soroban RPC, Prisma DB) are fully mocked so the
 * tests run without any network or database connectivity.
 */

import express from 'express';
import request from 'supertest';
import {
  runCheck,
  deriveOverallStatus,
  buildHealthRouter,
} from '../src/routes/health';

// ─── Mock @stellar/stellar-sdk ────────────────────────────────────────────────

const mockRpcServer = {
  getHealth: jest.fn(),
  getContractData: jest.fn(),
};

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    rpc: {
      ...actual.rpc,
      Server: jest.fn(() => mockRpcServer),
    },
  };
});

// ─── Mock Prisma client ───────────────────────────────────────────────────────

const mockPrisma = {
  $queryRaw: jest.fn(),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildTestApp() {
  const app = express();
  app.use(
    '/health',
    buildHealthRouter(
      'https://test-rpc.example.com',
      'CTEST000000000000000000000000000000000000000000000000000000000000',
      mockPrisma as any,
    ),
  );
  return app;
}

// ─── runCheck ─────────────────────────────────────────────────────────────────

describe('runCheck', () => {
  it('returns ok with latencyMs when the fn resolves', async () => {
    const result = await runCheck(async () => { /* no-op */ });
    expect(result.status).toBe('ok');
    expect(typeof result.latencyMs).toBe('number');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns error with message when fn throws', async () => {
    const result = await runCheck(async () => {
      throw new Error('connection refused');
    });
    expect(result.status).toBe('error');
    expect(result.message).toContain('connection refused');
    expect(typeof result.latencyMs).toBe('number');
  });

  it('returns timeout when fn exceeds the deadline', async () => {
    const result = await runCheck(
      () => new Promise<void>(() => { /* never resolves */ }),
      50,
    );
    expect(result.status).toBe('timeout');
    expect(result.message).toContain('50ms');
  }, 500);
});

// ─── deriveOverallStatus ──────────────────────────────────────────────────────

describe('deriveOverallStatus', () => {
  const ok  = { status: 'ok' as const };
  const err = { status: 'error' as const, message: 'fail' };
  const tmo = { status: 'timeout' as const, message: 'timed out' };

  it('returns ok when all checks pass', () => {
    expect(deriveOverallStatus({ rpc: ok, contract: ok, db: ok })).toBe('ok');
  });

  it('returns down when rpc fails', () => {
    expect(deriveOverallStatus({ rpc: err, contract: ok, db: ok })).toBe('down');
  });

  it('returns down when db fails', () => {
    expect(deriveOverallStatus({ rpc: ok, contract: ok, db: err })).toBe('down');
  });

  it('returns down when rpc times out', () => {
    expect(deriveOverallStatus({ rpc: tmo, contract: ok, db: ok })).toBe('down');
  });

  it('returns down when db times out', () => {
    expect(deriveOverallStatus({ rpc: ok, contract: ok, db: tmo })).toBe('down');
  });

  it('returns degraded when only contract check fails', () => {
    expect(deriveOverallStatus({ rpc: ok, contract: err, db: ok })).toBe('degraded');
  });

  it('returns degraded when only contract check times out', () => {
    expect(deriveOverallStatus({ rpc: ok, contract: tmo, db: ok })).toBe('degraded');
  });

  it('returns down when both rpc and db fail', () => {
    expect(deriveOverallStatus({ rpc: err, contract: err, db: err })).toBe('down');
  });
});

// ─── GET /health ──────────────────────────────────────────────────────────────

describe('GET /health', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 with status ok when all checks pass', async () => {
    mockRpcServer.getHealth.mockResolvedValue({ status: 'healthy' });
    mockRpcServer.getContractData.mockResolvedValue({});
    mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    const res = await request(buildTestApp()).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.rpc.status).toBe('ok');
    expect(res.body.checks.contract.status).toBe('ok');
    expect(res.body.checks.db.status).toBe('ok');
  });

  it('returns 503 with status down when rpc fails', async () => {
    mockRpcServer.getHealth.mockRejectedValue(new Error('RPC unreachable'));
    mockRpcServer.getContractData.mockResolvedValue({});
    mockPrisma.$queryRaw.mockResolvedValue([]);

    const res = await request(buildTestApp()).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('down');
    expect(res.body.checks.rpc.status).toBe('error');
    expect(res.body.checks.rpc.message).toContain('RPC unreachable');
  });

  it('returns 503 with status down when db fails', async () => {
    mockRpcServer.getHealth.mockResolvedValue({ status: 'healthy' });
    mockRpcServer.getContractData.mockResolvedValue({});
    mockPrisma.$queryRaw.mockRejectedValue(new Error('DB connection refused'));

    const res = await request(buildTestApp()).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('down');
    expect(res.body.checks.db.status).toBe('error');
    expect(res.body.checks.db.message).toContain('DB connection refused');
  });

  it('returns 503 with status degraded when only contract check fails', async () => {
    mockRpcServer.getHealth.mockResolvedValue({ status: 'healthy' });
    mockRpcServer.getContractData.mockRejectedValue(new Error('network error'));
    mockPrisma.$queryRaw.mockResolvedValue([]);

    const res = await request(buildTestApp()).get('/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.checks.contract.status).toBe('error');
    expect(res.body.checks.rpc.status).toBe('ok');
    expect(res.body.checks.db.status).toBe('ok');
  });

  it('treats contract entryNotFound as ok (contract deployed but instance absent)', async () => {
    mockRpcServer.getHealth.mockResolvedValue({ status: 'healthy' });
    mockRpcServer.getContractData.mockRejectedValue(new Error('entryNotFound'));
    mockPrisma.$queryRaw.mockResolvedValue([]);

    const res = await request(buildTestApp()).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.checks.contract.status).toBe('ok');
  });

  it('treats contract not found as ok', async () => {
    mockRpcServer.getHealth.mockResolvedValue({ status: 'healthy' });
    mockRpcServer.getContractData.mockRejectedValue(new Error('contract not found'));
    mockPrisma.$queryRaw.mockResolvedValue([]);

    const res = await request(buildTestApp()).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.checks.contract.status).toBe('ok');
  });

  it('includes apiVersion in the response body', async () => {
    mockRpcServer.getHealth.mockResolvedValue({ status: 'healthy' });
    mockRpcServer.getContractData.mockResolvedValue({});
    mockPrisma.$queryRaw.mockResolvedValue([]);

    const res = await request(buildTestApp()).get('/health');

    expect(res.body).toHaveProperty('apiVersion');
    expect(typeof res.body.apiVersion).toBe('string');
  });

  it('includes latencyMs in check results', async () => {
    mockRpcServer.getHealth.mockResolvedValue({ status: 'healthy' });
    mockRpcServer.getContractData.mockResolvedValue({});
    mockPrisma.$queryRaw.mockResolvedValue([]);

    const res = await request(buildTestApp()).get('/health');

    expect(typeof res.body.checks.rpc.latencyMs).toBe('number');
    expect(typeof res.body.checks.db.latencyMs).toBe('number');
  });
});

// ─── GET /health/ready ────────────────────────────────────────────────────────

describe('GET /health/ready', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 ready when rpc and db are healthy', async () => {
    mockRpcServer.getHealth.mockResolvedValue({ status: 'healthy' });
    mockPrisma.$queryRaw.mockResolvedValue([]);

    const res = await request(buildTestApp()).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body).toHaveProperty('timestamp');
  });

  it('returns 503 not_ready when rpc is down', async () => {
    mockRpcServer.getHealth.mockRejectedValue(new Error('down'));
    mockPrisma.$queryRaw.mockResolvedValue([]);

    const res = await request(buildTestApp()).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not_ready');
  });

  it('returns 503 not_ready when db is down', async () => {
    mockRpcServer.getHealth.mockResolvedValue({ status: 'healthy' });
    mockPrisma.$queryRaw.mockRejectedValue(new Error('db down'));

    const res = await request(buildTestApp()).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not_ready');
  });
});

// ─── GET /health/live ─────────────────────────────────────────────────────────

describe('GET /health/live', () => {
  it('always returns 200 alive regardless of dependency state', async () => {
    // No mocks needed — liveness is process-level only
    const res = await request(buildTestApp()).get('/health/live');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('alive');
    expect(res.body).toHaveProperty('timestamp');
  });
});
