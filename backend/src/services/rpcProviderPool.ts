/**
 * backend/src/services/rpcProviderPool.ts
 *
 * Health-aware bounded RPC provider pool for indexer read operations (#1590).
 *
 * Responsibilities:
 *   - Manages a prioritized pool of Soroban RPC provider endpoints.
 *   - Tracks provider health (consecutive error counts, circuit state, cooldowns).
 *   - Executes read requests with bounded failover across healthy endpoints.
 *   - Redacts credentials, tokens, or private query params in logs and telemetry.
 *   - Fails explicitly when all providers are exhausted so indexer checkpoints
 *     do NOT advance erroneously.
 */

import { SorobanRpc } from '@stellar/stellar-sdk';
import logger from '../lib/logger';

export interface RpcEndpointStatus {
  url: string;
  consecutiveFailures: number;
  lastFailureAt: number;
  isHealthy: boolean;
}

export interface RpcPoolConfig {
  endpoints: string[];
  maxRetries?: number;
  cooldownPeriodMs?: number;
  failureThreshold?: number;
}

/** Redacts sensitive query parameters (e.g. api_key, token) from RPC URLs */
export function redactRpcUrl(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    if (parsed.password) parsed.password = 'REDACTED';
    for (const key of parsed.searchParams.keys()) {
      if (/key|token|auth|secret|credential/i.test(key)) {
        parsed.searchParams.set(key, '[REDACTED]');
      }
    }
    return parsed.toString();
  } catch {
    return urlStr.replace(/([?&][^=]+)=([^&]+)/g, '$1=[REDACTED]');
  }
}

export class RpcProviderPool {
  private endpoints: RpcEndpointStatus[];
  private maxRetries: number;
  private cooldownPeriodMs: number;
  private failureThreshold: number;
  private servers: Map<string, SorobanRpc.Server>;

  constructor(config: RpcPoolConfig) {
    if (!config.endpoints || config.endpoints.length === 0) {
      throw new Error('RpcProviderPool requires at least one endpoint');
    }

    this.maxRetries = config.maxRetries ?? config.endpoints.length;
    this.cooldownPeriodMs = config.cooldownPeriodMs ?? 30_000;
    this.failureThreshold = config.failureThreshold ?? 3;
    this.servers = new Map();

    this.endpoints = config.endpoints.map((url) => {
      this.servers.set(url, new SorobanRpc.Server(url, { allowHttp: false }));
      return {
        url,
        consecutiveFailures: 0,
        lastFailureAt: 0,
        isHealthy: true,
      };
    });
  }

  private refreshEndpointHealth(): void {
    const now = Date.now();
    for (const ep of this.endpoints) {
      if (!ep.isHealthy && now - ep.lastFailureAt > this.cooldownPeriodMs) {
        ep.isHealthy = true;
        ep.consecutiveFailures = 0;
        logger.info({
          event: 'indexer.rpc_endpoint_cooldown_expired',
          endpoint: redactRpcUrl(ep.url),
        });
      }
    }
  }

  /**
   * Get sorted candidate endpoints, prioritizing healthy ones.
   */
  private getCandidates(): RpcEndpointStatus[] {
    this.refreshEndpointHealth();
    return [...this.endpoints].sort((a, b) => {
      if (a.isHealthy === b.isHealthy) {
        return a.consecutiveFailures - b.consecutiveFailures;
      }
      return a.isHealthy ? -1 : 1;
    });
  }

  /**
   * Execute an indexer read operation across provider pool with bounded failover.
   */
  async executeWithFailover<T>(
    operation: (server: SorobanRpc.Server, endpointUrl: string) => Promise<T>,
  ): Promise<T> {
    const candidates = this.getCandidates();
    const attempts = Math.min(this.maxRetries, candidates.length);
    let lastError: unknown;

    for (let i = 0; i < attempts; i++) {
      const candidate = candidates[i];
      const server = this.servers.get(candidate.url)!;
      const safeUrl = redactRpcUrl(candidate.url);

      logger.info({
        event: 'indexer.rpc_endpoint_selected',
        endpoint: safeUrl,
        attempt: i + 1,
        totalCandidates: candidates.length,
      });

      try {
        const result = await operation(server, candidate.url);
        // Successful read: reset failure streak
        candidate.consecutiveFailures = 0;
        candidate.isHealthy = true;
        return result;
      } catch (err: unknown) {
        lastError = err;
        candidate.consecutiveFailures += 1;
        candidate.lastFailureAt = Date.now();
        if (candidate.consecutiveFailures >= this.failureThreshold) {
          candidate.isHealthy = false;
        }

        logger.warn({
          event: 'indexer.rpc_failover_attempt',
          failedEndpoint: safeUrl,
          attempt: i + 1,
          consecutiveFailures: candidate.consecutiveFailures,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.error({
      event: 'indexer.rpc_all_endpoints_exhausted',
      attemptedCount: attempts,
    });

    throw new Error(
      `All RPC provider endpoints failed after ${attempts} attempts. Checkpoint will not advance. Last error: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }

  getEndpointStatuses(): RpcEndpointStatus[] {
    return this.endpoints.map((ep) => ({
      ...ep,
      url: redactRpcUrl(ep.url),
    }));
  }
}
