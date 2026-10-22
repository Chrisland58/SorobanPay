import { Pool, PoolClient } from 'pg';

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

let pool: Pool | null = null;

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
      connectionTimeoutMillis: 5_000,
    });

    // Surface unexpected pool errors to stderr so they appear in structured logs
    pool.on('error', (err: Error) => {
      process.stderr.write(
        `[db/pool] Unexpected error on idle client: ${err.message}\n`,
      );
    });
  }
  return pool;
}

/**
 * Executes a function inside a single client transaction.
 * Automatically commits on success and rolls back on error.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
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
}
