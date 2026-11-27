import { Pool, PoolClient } from 'pg';
import {
  setGauge,
  incrementCounter,
  recordQueryWaitDuration,
  recordQueryExecutionDuration,
  syncDbPoolMetrics,
} from '../services/metricsService';

// ---------------------------------------------------------------------------
// Connection pool configuration
// ---------------------------------------------------------------------------

/**
 * Minimum connections kept alive in the pool.
 * Matches the Prisma minimum pool size so both clients compete for the same
 * underlying Postgres connections in predictable numbers.
 */
export const MIN_CONNECTIONS = 2;

/**
 * Maximum connections the pool may open simultaneously.
 * Sized to stay well within the Postgres default of 100 max_connections when
 * running multiple service replicas (2 API pods × 10 = 20 connections max).
 */
export const MAX_CONNECTIONS = 10;

/** Default timeout waiting to acquire a connection from the pool (5 seconds). */
export const CONNECTION_TIMEOUT_MS = 5_000;

let pool: Pool | null = null;

export interface PoolStats {
  size: number;
  active: number;
  idle: number;
  waiting: number;
  utilization: number;
  saturation: number;
  timeouts: number;
}

// In-process telemetry counters (bounded / global, never tenant-partitioned)
let poolAcquireTimeouts = 0;
let queryTimeouts = 0;

/**
 * Returns current snapshot of database connection pool stats.
 */
export function getPoolStats(): PoolStats {
  const currentPool = pool;
  if (!currentPool) {
    return {
      size: MAX_CONNECTIONS,
      active: 0,
      idle: 0,
      waiting: 0,
      utilization: 0,
      saturation: 0,
      timeouts: poolAcquireTimeouts,
    };
  }

  const total = currentPool.totalCount ?? 0;
  const idle = currentPool.idleCount ?? 0;
  const active = Math.max(0, total - idle);
  const waiting = currentPool.waitingCount ?? 0;
  const size = MAX_CONNECTIONS;
  const utilization = size > 0 ? (active / size) * 100 : 0;
  // Saturation: ratio of (active + queued callers) to max pool capacity
  const saturation = size > 0 ? ((active + waiting) / size) * 100 : 0;

  return {
    size,
    active,
    idle,
    waiting,
    utilization,
    saturation,
    timeouts: poolAcquireTimeouts,
  };
}

/**
 * Records an acquire or connection timeout.
 */
export function recordPoolTimeout(): void {
  poolAcquireTimeouts++;
  incrementCounter('db_pool_timeouts_total');
  incrementCounter('sorobanpay_db_pool_timeouts_total');
}

/**
 * Records a query execution timeout.
 */
export function recordQueryTimeout(): void {
  queryTimeouts++;
  incrementCounter('db_query_timeouts_total');
  incrementCounter('sorobanpay_db_query_timeouts_total');
}

/**
 * Returns the shared pg connection pool, creating it on first call.
 * Reads DATABASE_URL from the environment.
 *
 * Pool settings:
 *   min: 2  — keep at least 2 warm connections at all times
 *   max: 10 — cap at 10 concurrent connections per process
 *   idleTimeoutMillis: 30000  — release idle connections after 30 s
 *   connectionTimeoutMillis: 5000 — fail fast if no connection is available within 5 s
 */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    pool = new Pool({
      connectionString,
      min: MIN_CONNECTIONS,
      max: MAX_CONNECTIONS,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    });

    // Surface unexpected pool errors to stderr so they appear in structured logs
    pool.on('error', (err: Error) => {
      process.stderr.write(
        `[db/pool] Unexpected error on idle client: ${err.message}\n`,
      );
    });
  }

  // Sync latest pool telemetry gauges to metrics registry
  const stats = getPoolStats();
  syncDbPoolMetrics(stats);

  return pool;
}

/**
 * Connects to the pool with query wait-duration tracking and timeout observation.
 */
export async function connectWithMetrics(): Promise<PoolClient> {
  const currentPool = getPool();
  const startTime = Date.now();

  try {
    const client = await currentPool.connect();
    const waitSeconds = Math.max(0, (Date.now() - startTime) / 1000);
    recordQueryWaitDuration(waitSeconds);

    // Update gauge snapshots
    const stats = getPoolStats();
    syncDbPoolMetrics(stats);

    return client;
  } catch (err: unknown) {
    const errorMsg = (err instanceof Error) ? err.message : String(err);
    if (errorMsg.includes('timeout') || errorMsg.includes('Connection terminated') || (Date.now() - startTime >= CONNECTION_TIMEOUT_MS)) {
      recordPoolTimeout();
    }
    const stats = getPoolStats();
    syncDbPoolMetrics(stats);
    throw err;
  }
}

/**
 * Executes a function inside a single client transaction.
 * Automatically commits on success and rolls back on error.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await connectWithMetrics();
  const txStart = Date.now();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    const execDuration = Math.max(0, (Date.now() - txStart) / 1000);
    recordQueryExecutionDuration(execDuration, 'success');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    const execDuration = Math.max(0, (Date.now() - txStart) / 1000);
    recordQueryExecutionDuration(execDuration, 'error');
    throw err;
  } finally {
    client.release();
    const stats = getPoolStats();
    syncDbPoolMetrics(stats);
  }
}

/**
 * Drains and closes the pg connection pool.
 * Called during graceful shutdown to ensure all in-flight queries complete
 * before the process exits.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
  const stats = getPoolStats();
  syncDbPoolMetrics(stats);
}
