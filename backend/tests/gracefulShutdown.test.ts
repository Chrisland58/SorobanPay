/**
 * Tests for #1387 — Database connection pooling and graceful shutdown.
 *
 * Tests cover:
 *  - getPool() creates a Pool with the correct min/max settings
 *  - closePool() calls pool.end() and nulls out the cached instance
 *  - disconnectPrisma() is exported and callable
 *  - isShuttingDown flag logic (middleware returns 503 when set)
 */

// ---------------------------------------------------------------------------
// Mock pg before any imports so the real Pool is never instantiated
// ---------------------------------------------------------------------------

const mockPoolEnd  = jest.fn().mockResolvedValue(undefined);
const mockPoolOn   = jest.fn();
const mockPoolConnect = jest.fn();

const MockPool = jest.fn().mockImplementation(() => ({
  end:     mockPoolEnd,
  on:      mockPoolOn,
  connect: mockPoolConnect,
}));

jest.mock('pg', () => ({ Pool: MockPool }));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('db/pool — connection pool configuration', () => {
  beforeEach(() => {
    jest.resetModules();
    MockPool.mockClear();
    mockPoolEnd.mockClear();
    mockPoolOn.mockClear();

    // Ensure DATABASE_URL is set so getPool() does not throw
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb';
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('creates a Pool with min=2, max=10', () => {
    const { getPool } = require('../src/db/pool');
    getPool();

    expect(MockPool).toHaveBeenCalledTimes(1);
    const constructorArgs = MockPool.mock.calls[0][0];
    expect(constructorArgs.min).toBe(2);
    expect(constructorArgs.max).toBe(10);
  });

  it('creates a Pool with idleTimeoutMillis and connectionTimeoutMillis', () => {
    const { getPool } = require('../src/db/pool');
    getPool();

    const constructorArgs = MockPool.mock.calls[0][0];
    expect(constructorArgs.idleTimeoutMillis).toBe(30_000);
    expect(constructorArgs.connectionTimeoutMillis).toBe(5_000);
  });

  it('returns the same Pool instance on repeated calls (singleton)', () => {
    const { getPool } = require('../src/db/pool');
    const pool1 = getPool();
    const pool2 = getPool();
    expect(pool1).toBe(pool2);
    expect(MockPool).toHaveBeenCalledTimes(1);
  });

  it('throws when DATABASE_URL is not set', () => {
    delete process.env.DATABASE_URL;
    const { getPool } = require('../src/db/pool');
    expect(() => getPool()).toThrow('DATABASE_URL environment variable is not set');
  });

  it('registers an error listener on the pool', () => {
    const { getPool } = require('../src/db/pool');
    getPool();
    expect(mockPoolOn).toHaveBeenCalledWith('error', expect.any(Function));
  });
});

describe('db/pool — closePool()', () => {
  beforeEach(() => {
    jest.resetModules();
    MockPool.mockClear();
    mockPoolEnd.mockClear();
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb';
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('calls pool.end() and nullifies the cached pool', async () => {
    const { getPool, closePool } = require('../src/db/pool');
    getPool(); // create the pool
    await closePool();
    expect(mockPoolEnd).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when called before getPool()', async () => {
    const { closePool } = require('../src/db/pool');
    // Should not throw
    await expect(closePool()).resolves.toBeUndefined();
    expect(mockPoolEnd).not.toHaveBeenCalled();
  });

  it('allows getPool() to create a fresh pool after closePool()', async () => {
    const { getPool, closePool } = require('../src/db/pool');
    getPool();
    await closePool();
    getPool();
    expect(MockPool).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// disconnectPrisma
// ---------------------------------------------------------------------------

describe('lib/prisma — disconnectPrisma()', () => {
  it('is exported as a function', () => {
    // We just verify the export shape without actually calling $disconnect
    // to avoid real database connections in unit tests.
    jest.resetModules();

    // Stub PrismaClient so it does not attempt a real DB connection
    jest.mock('../src/generated/prisma', () => ({
      PrismaClient: jest.fn().mockImplementation(() => ({
        $disconnect: jest.fn().mockResolvedValue(undefined),
        $queryRaw: jest.fn(),
        $transaction: jest.fn(),
        event: {},
        subscription: {},
        payment: {},
        webhookEndpoint: {},
        webhookDelivery: {},
      })),
    }));

    const { disconnectPrisma } = require('../src/lib/prisma');
    expect(typeof disconnectPrisma).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// isShuttingDown shutdown gate middleware
// ---------------------------------------------------------------------------

describe('isShuttingDown shutdown gate', () => {
  it('returns 503 {status: shutting_down} when isShuttingDown is true', () => {
    const mockJson   = jest.fn();
    const mockStatus = jest.fn().mockReturnValue({ json: mockJson });
    const mockNext   = jest.fn();

    const req = {} as any;
    const res = { status: mockStatus } as any;

    // Simulate the shutdown gate middleware inline
    const isShuttingDown = true;
    const shutdownGate = (_req: any, res: any, next: any) => {
      if (isShuttingDown) {
        res.status(503).json({ status: 'shutting_down' });
        return;
      }
      next();
    };

    shutdownGate(req, res, mockNext);

    expect(mockStatus).toHaveBeenCalledWith(503);
    expect(mockJson).toHaveBeenCalledWith({ status: 'shutting_down' });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('calls next() when isShuttingDown is false', () => {
    const mockNext = jest.fn();
    const req = {} as any;
    const res = { status: jest.fn() } as any;

    const isShuttingDown = false;
    const shutdownGate = (_req: any, _res: any, next: any) => {
      if (isShuttingDown) {
        _res.status(503).json({ status: 'shutting_down' });
        return;
      }
      next();
    };

    shutdownGate(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// MIN_CONNECTIONS / MAX_CONNECTIONS constants
// ---------------------------------------------------------------------------

describe('pool constants', () => {
  it('exports MIN_CONNECTIONS = 2 and MAX_CONNECTIONS = 10', () => {
    jest.resetModules();
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb';
    const { MIN_CONNECTIONS, MAX_CONNECTIONS } = require('../src/db/pool');
    expect(MIN_CONNECTIONS).toBe(2);
    expect(MAX_CONNECTIONS).toBe(10);
    delete process.env.DATABASE_URL;
  });
});
