/**
 * #134 — Health endpoint.
 * GET /health  →  200 { status: "ok", apiVersion: "v1", ... } | 503 { status: "error", ... }
 *
 * Checks:
 *  1. Soroban RPC is reachable (getHealth)
 *  2. The configured contract ID is resolvable (getContractData produces any response)
 *  3. Redis cache is reachable (issue #1444)
 *
 * The response always includes `apiVersion` so monitoring systems and clients
 * can confirm which API version they are speaking to.
 */

import { Router, Request, Response } from 'express';
import { rpc, xdr } from '@stellar/stellar-sdk';
import { DEFAULT_VERSION } from '../middleware/versioning';
import { redisCache } from '../lib/redisCache';

export function buildHealthRouter(rpcUrl: string, contractId: string): Router {
  const router = Router();
  const server = new rpc.Server(rpcUrl);

  router.get('/', async (_req: Request, res: Response) => {
    const checks: Record<string, string> = {};
    let healthy = true;

    // 1. RPC reachability
    try {
      await server.getHealth();
      checks.rpc = 'ok';
    } catch (err) {
      checks.rpc = `error: ${(err as Error).message}`;
      healthy = false;
    }

    // 2. Contract resolvability — getContractData throws when the contract
    //    does not exist or the RPC cannot reach it.
    try {
      await server.getContractData(contractId, xdr.ScVal.scvLedgerKeyContractInstance());
      checks.contract = 'ok';
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      // A "not found" response still means the RPC resolved the address; anything
      // else (network error, invalid ID) is a real failure.
      if (msg.includes('not found') || msg.includes('entryNotFound')) {
        checks.contract = 'ok';
      } else {
        checks.contract = `error: ${msg}`;
        healthy = false;
      }
    }

    // 3. Redis cache reachability (issue #1444)
    //    When REDIS_URL is not set, ping() returns 'disabled' — this is NOT a
    //    health failure because Redis is optional. Only an actual connection
    //    error is treated as unhealthy.
    try {
      const redisStatus = await redisCache.ping();
      if (redisStatus === 'ok' || redisStatus === 'disabled') {
        checks.redis = redisStatus;
      } else {
        checks.redis = redisStatus;
        healthy = false;
      }
    } catch (err) {
      checks.redis = `error: ${(err as Error).message}`;
      healthy = false;
    }

    const status = healthy ? 'ok' : 'error';
    res.status(healthy ? 200 : 503).json({
      status,
      apiVersion: DEFAULT_VERSION,
      checks,
    });
  });

  return router;
}
