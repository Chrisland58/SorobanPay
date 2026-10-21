/**
 * #1377 — Health endpoint with RPC, contract, and DB connectivity checks.
 *
 * GET /health
 *   Returns 200 { status: 'ok', checks: { rpc, contract, db } } when all checks pass.
 *   Returns 503 { status: 'degraded'|'down', checks: { rpc, contract, db } } when any check fails.
 *
 * Each check is bounded to CHECK_TIMEOUT_MS to ensure total response time < 2 s.
 * All three checks run concurrently via Promise.all.
 *
 * Status semantics:
 *   ok       — all three checks pass
 *   degraded — RPC and DB pass but contract check fails (e.g. contract not yet deployed)
 *   down     — RPC or DB is unreachable (critical dependency failure)
 *
 * Used by Kubernetes liveness (/health/live), readiness (/health/ready),
 * and full health (/health) probes.
 */

import { Router, Request, Response } from 'express';
import { rpc, xdr } from '@stellar/stellar-sdk';
import { DEFAULT_VERSION } from '../middleware/versioning';

/** Maximum milliseconds allowed per individual check before it times out. */
export const CHECK_TIMEOUT_MS = 1500;

export type CheckStatus = 'ok' | 'error' | 'timeout';

export interface CheckResult {
  status: CheckStatus;
  message?: string;
  latencyMs?: number;
}

export type OverallStatus = 'ok' | 'degraded' | 'down';

/**
 * Runs an async check with a bounded timeout.
 * Returns { status: 'timeout' } if the check does not resolve within timeoutMs.
 * Never throws.
 */
export async function runCheck(
  fn: () => Promise<void>,
  timeoutMs: number = CHECK_TIMEOUT_MS,
): Promise<CheckResult> {
  const start = Date.now();
  return new Promise<CheckResult>((resolve) => {
    const timer = setTimeout(() => {
      resolve({ status: 'timeout', message: `Check timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    fn()
      .then(() => {
        clearTimeout(timer);
        resolve({ status: 'ok', latencyMs: Date.now() - start });
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        const message = err instanceof Error ? err.message : String(err);
        resolve({ status: 'error', message, latencyMs: Date.now() - start });
      });
  });
}

/**
 * Determines the overall health status from individual check results.
 *
 * - All ok                      → 'ok'
 * - rpc or db failed/timeout    → 'down'   (critical path)
 * - only contract failed/timeout → 'degraded' (non-critical, contract may not be deployed yet)
 */
export function deriveOverallStatus(checks: {
  rpc: CheckResult;
  contract: CheckResult;
  db: CheckResult;
}): OverallStatus {
  const allOk = Object.values(checks).every((c) => c.status === 'ok');
  if (allOk) return 'ok';

  const criticalFailed =
    checks.rpc.status !== 'ok' || checks.db.status !== 'ok';
  return criticalFailed ? 'down' : 'degraded';
}

/**
 * Build the health router.
 *
 * @param rpcUrl      Soroban RPC endpoint URL
 * @param contractId  Contract address to verify resolvability
 * @param prismaClient Injectable Prisma client (used in tests to avoid real DB)
 */
export function buildHealthRouter(
  rpcUrl: string,
  contractId: string,
  prismaClient?: { $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown> },
): Router {
  const router = Router();
  const server = new rpc.Server(rpcUrl);

  /** Resolve the DB client lazily to avoid circular import at module load time. */
  async function getDbClient() {
    if (prismaClient) return prismaClient;
    const mod = await import('../lib/prisma');
    return mod.default;
  }

  // ─── GET /health ────────────────────────────────────────────────────────────

  router.get('/', async (_req: Request, res: Response) => {
    // Run all three checks concurrently — each has its own independent timeout
    const [rpcResult, contractResult, dbResult] = await Promise.all([

      // Check 1: Soroban RPC reachability
      runCheck(async () => {
        await server.getHealth();
      }),

      // Check 2: Contract address resolvability
      runCheck(async () => {
        try {
          await server.getContractData(
            contractId,
            xdr.ScVal.scvLedgerKeyContractInstance(),
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // 'not found' / 'entryNotFound' means the RPC resolved the address but
          // the contract instance entry is absent — still counts as reachable
          if (!msg.includes('not found') && !msg.includes('entryNotFound')) {
            throw err;
          }
        }
      }),

      // Check 3: Database connectivity
      runCheck(async () => {
        const db = await getDbClient();
        await (db as any).$queryRaw`SELECT 1`;
      }),
    ]);

    const checks = { rpc: rpcResult, contract: contractResult, db: dbResult };
    const status = deriveOverallStatus(checks);

    res.status(status === 'ok' ? 200 : 503).json({
      status,
      apiVersion: DEFAULT_VERSION,
      checks,
    });
  });

  // ─── GET /health/ready — Kubernetes readiness probe ──────────────────────────
  // Gates on RPC + DB; contract is non-critical for readiness

  router.get('/ready', async (_req: Request, res: Response) => {
    const [rpcResult, dbResult] = await Promise.all([
      runCheck(async () => { await server.getHealth(); }),
      runCheck(async () => {
        const db = await getDbClient();
        await (db as any).$queryRaw`SELECT 1`;
      }),
    ]);

    const ready = rpcResult.status === 'ok' && dbResult.status === 'ok';

    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      checks: { rpc: rpcResult, db: dbResult },
      timestamp: new Date().toISOString(),
    });
  });

  // ─── GET /health/live — Kubernetes liveness probe ───────────────────────────
  // Process-level only — always 200 as long as the Node.js process is alive

  router.get('/live', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'alive',
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
