import { Router, Request, Response } from 'express';
import { getPoolStats, getPool } from '../db/pool';
import { setDatabaseHealthSignal } from '../services/metricsService';

/** Bounded check timeout in milliseconds (#1076). */
export const CHECK_TIMEOUT_MS = 5000;

/**
 * Runs `fn` with a bounded timeout. Returns null if the timeout fires first.
 * Prevents hung dependency probes from blocking health endpoints indefinitely.
 */
export async function checkWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number = CHECK_TIMEOUT_MS,
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    fn()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

export const extendedHealthRouter = Router();

export class HealthState {
  public static isReady = false;
  public static postgres: 'healthy' | 'unhealthy' = 'healthy';
  public static redis: 'healthy' | 'unhealthy' = 'healthy';
  public static stellarRpc: 'healthy' | 'unhealthy' = 'healthy';
  public static queue: 'healthy' | 'unhealthy' = 'healthy';
  public static indexerLagSeconds = 12;
  public static startTime = Date.now();

  public static reset() {
    this.isReady = false;
    this.postgres = 'healthy';
    this.redis = 'healthy';
    this.stellarRpc = 'healthy';
    this.queue = 'healthy';
    this.indexerLagSeconds = 12;
  }
}

// GET /health — aggregate liveness + dependency status + db pool health signals
extendedHealthRouter.get('/health', async (_req: Request, res: Response) => {
  const isPostgresHealthy = HealthState.postgres === 'healthy';
  const isHealthy =
    isPostgresHealthy &&
    HealthState.redis === 'healthy' &&
    HealthState.stellarRpc === 'healthy';

  setDatabaseHealthSignal(isPostgresHealthy);

  const status = isHealthy ? 'healthy' : 'degraded';
  const uptime = Math.floor((Date.now() - HealthState.startTime) / 1000);
  const poolStats = getPoolStats();

  return res.status(isHealthy ? 200 : 503).json({
    status,
    uptime,
    dependencies: {
      postgres: HealthState.postgres,
      redis: HealthState.redis,
      stellar_rpc: HealthState.stellarRpc,
      queue: HealthState.queue,
      indexer_lag_seconds: HealthState.indexerLagSeconds,
      database_pool: {
        size: poolStats.size,
        active: poolStats.active,
        idle: poolStats.idle,
        waiting: poolStats.waiting,
        utilization_pct: Math.round(poolStats.utilization * 100) / 100,
        saturation_pct: Math.round(poolStats.saturation * 100) / 100,
        timeouts: poolStats.timeouts,
      },
    },
  });
});

// GET /health/ready — readiness probe: migrations done + critical deps healthy
extendedHealthRouter.get('/health/ready', (_req: Request, res: Response) => {
  if (!HealthState.isReady) {
    return res.status(503).json({
      status: 'not_ready',
      detail: 'Migration or first RPC poll pending',
    });
  }

  const criticalDepsHealthy =
    HealthState.postgres === 'healthy' && HealthState.stellarRpc === 'healthy';

  if (!criticalDepsHealthy) {
    return res.status(503).json({
      status: 'not_ready',
      reason: 'dependencies_unhealthy',
      dependencies: {
        postgres: HealthState.postgres,
        stellar_rpc: HealthState.stellarRpc,
      },
    });
  }

  return res.status(200).json({ status: 'ready' });
});

// GET /health/live — liveness probe: process is alive (never gated on deps)
extendedHealthRouter.get('/health/live', (_req: Request, res: Response) => {
  return res.status(200).json({ status: 'alive' });
});

// GET /health/database — specific database health and pool saturation signal (#1681)
extendedHealthRouter.get('/health/database', async (_req: Request, res: Response) => {
  const poolStats = getPoolStats();
  let dbReachable = HealthState.postgres === 'healthy';
  let queryLatencyMs: number | null = null;

  if (process.env.DATABASE_URL) {
    const probe = await checkWithTimeout(async () => {
      const start = Date.now();
      const p = getPool();
      await p.query('SELECT 1');
      return Date.now() - start;
    }, 2000);

    if (probe !== null) {
      queryLatencyMs = probe;
      dbReachable = true;
    } else if (HealthState.postgres !== 'healthy') {
      dbReachable = false;
    }
  }

  setDatabaseHealthSignal(dbReachable);

  const isSaturated = poolStats.saturation >= 90 || poolStats.waiting > 0;
  const isHealthy = dbReachable && !isSaturated;
  const statusCode = !dbReachable ? 503 : isSaturated ? 429 : 200;

  return res.status(statusCode).json({
    status: !dbReachable ? 'down' : isSaturated ? 'saturated' : 'healthy',
    pool: {
      size: poolStats.size,
      active: poolStats.active,
      idle: poolStats.idle,
      waiting: poolStats.waiting,
      utilization_pct: Math.round(poolStats.utilization * 100) / 100,
      saturation_pct: Math.round(poolStats.saturation * 100) / 100,
      timeouts: poolStats.timeouts,
    },
    latency_ms: queryLatencyMs,
  });
});
