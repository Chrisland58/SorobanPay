/**
 * #1388 — Unit tests for the health endpoint.
 * Tests RPC/DB failure simulation and response shape.
 */

// ─── Mocks — must be before all imports ──────────────────────────────────────

const mockGetHealth = jest.fn();
const mockGetContractData = jest.fn();

jest.mock('@stellar/stellar-sdk', () => ({
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      getHealth: mockGetHealth,
      getContractData: mockGetContractData,
    })),
  },
  xdr: {
    ScVal: {
      scvLedgerKeyContractInstance: jest.fn().mockReturnValue('ledger-key'),
    },
  },
}));

jest.mock('../src/lib/tracing', () => ({
  getTracer: jest.fn(),
  withSpan: jest.fn((_a: unknown, _b: unknown, fn: (span: unknown) => unknown) =>
    fn({ setAttributes: jest.fn() }),
  ),
  SpanKind: { CLIENT: 0 },
  initTracing: jest.fn(),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import express from 'express';
import request from 'supertest';
import { buildHealthRouter } from '../src/routes/health';

const RPC_URL = 'https://soroban-testnet.stellar.org';
const CONTRACT_ID = 'CTEST000000000000000000000000000000000000000000000000000000';

function buildApp() {
  const app = express();
  app.use('/health', buildHealthRouter(RPC_URL, CONTRACT_ID));
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Health Route (#1388)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 200 with status ok when both RPC and contract checks pass', async () => {
    mockGetHealth.mockResolvedValueOnce({ status: 'healthy' });
    mockGetContractData.mockResolvedValueOnce({ entries: [] });

    const res = await request(buildApp()).get('/health').expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body.checks.rpc).toBe('ok');
    expect(res.body.checks.contract).toBe('ok');
  });

  it('returns 503 with status error when RPC getHealth throws', async () => {
    mockGetHealth.mockRejectedValueOnce(new Error('Connection refused'));
    mockGetContractData.mockResolvedValueOnce({ entries: [] });

    const res = await request(buildApp()).get('/health').expect(503);

    expect(res.body.status).toBe('error');
    expect(res.body.checks.rpc).toContain('error');
  });

  it('returns 200 when contract getContractData throws "not found" (expected)', async () => {
    mockGetHealth.mockResolvedValueOnce({ status: 'healthy' });
    mockGetContractData.mockRejectedValueOnce(new Error('Contract not found: entryNotFound'));

    const res = await request(buildApp()).get('/health').expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body.checks.contract).toBe('ok');
  });

  it('returns 200 when contract throws "not found" (different wording)', async () => {
    mockGetHealth.mockResolvedValueOnce({ status: 'healthy' });
    mockGetContractData.mockRejectedValueOnce(new Error('Contract address not found'));

    const res = await request(buildApp()).get('/health').expect(200);

    expect(res.body.status).toBe('ok');
  });

  it('returns 503 when contract getContractData throws a non-not-found error', async () => {
    mockGetHealth.mockResolvedValueOnce({ status: 'healthy' });
    mockGetContractData.mockRejectedValueOnce(new Error('Internal server error'));

    const res = await request(buildApp()).get('/health').expect(503);

    expect(res.body.status).toBe('error');
    expect(res.body.checks.contract).toContain('error');
  });

  it('response always contains apiVersion field', async () => {
    mockGetHealth.mockResolvedValueOnce({ status: 'healthy' });
    mockGetContractData.mockResolvedValueOnce({ entries: [] });

    const res = await request(buildApp()).get('/health').expect(200);

    expect(res.body).toHaveProperty('apiVersion');
    expect(typeof res.body.apiVersion).toBe('string');
  });

  it('returns 503 when both RPC and contract checks fail', async () => {
    mockGetHealth.mockRejectedValueOnce(new Error('Network error'));
    mockGetContractData.mockRejectedValueOnce(new Error('Timeout'));

    const res = await request(buildApp()).get('/health').expect(503);

    expect(res.body.status).toBe('error');
    expect(res.body.checks.rpc).toContain('error');
  });

  it('response includes both rpc and contract check fields', async () => {
    mockGetHealth.mockResolvedValueOnce({ status: 'healthy' });
    mockGetContractData.mockResolvedValueOnce({ entries: [] });

    const res = await request(buildApp()).get('/health').expect(200);

    expect(res.body.checks).toHaveProperty('rpc');
    expect(res.body.checks).toHaveProperty('contract');
  });
});
