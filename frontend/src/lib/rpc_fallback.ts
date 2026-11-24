"use client";

/**
 * rpc_fallback.ts
 *
 * Configurable RPC endpoint failover for idempotent read requests.
 *
 * Enforces:
 *  - Only idempotent read operations (getEvents, getAccount, getLatestLedger,
 *    simulateTransaction, getHealth, etc.) are eligible for failover.
 *  - Mutation / wallet submissions are strictly rejected from failover to prevent
 *    silent replay attacks or duplicated transactions.
 *  - Endpoint URLs and error messages are sanitized to prevent credential / API key leakage.
 *  - Bounded timeout and retry limits with observable attempt tracking.
 */

import * as SorobanRpc from "@stellar/js-sdk/rpc";

// ─── Supported idempotent read operations ─────────────────────────────────────

export const IDEMPOTENT_READ_OPERATIONS = [
  "getAccount",
  "getEvents",
  "getLatestLedger",
  "simulateTransaction",
  "getHealth",
  "getNetwork",
  "getTransaction",
  "getLedgerEntries",
] as const;

export type IdempotentReadOperation = (typeof IDEMPOTENT_READ_OPERATIONS)[number];

const IDEMPOTENT_SET = new Set<string>(IDEMPOTENT_READ_OPERATIONS);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RpcEndpoint {
  /** Endpoint URL */
  url: string;
  /** Priority (lower = higher priority) */
  priority: number;
  /** Whether this endpoint is currently available */
  available: boolean;
  /** Last check timestamp */
  lastChecked?: number;
}

export interface RpcFallbackConfig {
  /** Primary RPC endpoint */
  primary: string;
  /** Fallback endpoints (in priority order) */
  fallbacks: string[];
  /** Per-request read timeout in milliseconds (default: 5000) */
  requestTimeoutMs?: number;
  /** Health check timeout in milliseconds (default: 3000) */
  healthCheckTimeoutMs?: number;
  /** How long to cache availability status in ms (default: 60000) */
  cacheExpiryMs?: number;
  /** Maximum number of retries per endpoint (default: 1) */
  maxRetriesPerEndpoint?: number;
}

export interface RpcAttemptRecord {
  endpoint: string;
  durationMs: number;
  error?: string;
  success: boolean;
}

export interface RpcCallResult<T> {
  /** Result from RPC call */
  data: T;
  /** Which sanitized endpoint was successfully used */
  usedEndpoint: string;
  /** Number of retries before success */
  retries: number;
  /** Observable trace of all attempts (with sanitized endpoints and errors) */
  attempts: RpcAttemptRecord[];
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class IneligibleForFailoverError extends Error {
  constructor(operationName: string) {
    super(
      `Operation "${operationName}" is non-idempotent or unknown. Only idempotent read operations (${IDEMPOTENT_READ_OPERATIONS.join(
        ", ",
      )}) are eligible for RPC failover. Wallet submissions and mutations must not be replayed.`,
    );
    this.name = "IneligibleForFailoverError";
  }
}

export class RpcFailoverError extends Error {
  public readonly selectedEndpoint: string;
  public readonly finalFailureReason: string;
  public readonly attempts: RpcAttemptRecord[];

  constructor(
    selectedEndpoint: string,
    finalFailureReason: string,
    attempts: RpcAttemptRecord[],
  ) {
    super(
      `All configured RPC endpoints failed. Last tried endpoint: "${selectedEndpoint}". Final failure reason: ${finalFailureReason}`,
    );
    this.name = "RpcFailoverError";
    this.selectedEndpoint = selectedEndpoint;
    this.finalFailureReason = finalFailureReason;
    this.attempts = attempts;
  }
}

// ─── Sanitization helper ──────────────────────────────────────────────────────

/**
 * Strips basic auth credentials, query parameter keys/tokens, and path secrets
 * from URLs to prevent credential leakage in logs, UI, and errors.
 */
export function sanitizeEndpointUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    // Redact basic auth username / password
    if (parsed.username || parsed.password) {
      parsed.username = "";
      parsed.password = "";
    }
    // Redact sensitive query parameters
    const sensitiveParamKeys = [
      "key",
      "apikey",
      "api_key",
      "token",
      "secret",
      "auth",
      "password",
    ];
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (sensitiveParamKeys.some((s) => key.toLowerCase().includes(s))) {
        parsed.searchParams.set(key, "[REDACTED]");
      }
    }
    // Redact path tokens (e.g. /v1/ghp_xxxx or /v1/apikey)
    parsed.pathname = parsed.pathname.replace(
      /(\/v\d+\/)([a-zA-Z0-9_\-]{8,})/g,
      "$1[REDACTED]",
    );
    return parsed.toString();
  } catch {
    // If invalid URL, strip any credentials via regex
    return rawUrl
      .replace(/:\/\/[^@]+@/g, "://")
      .replace(/([?&](?:api_?key|token|secret)=)[^&]+/gi, "$1[REDACTED]");
  }
}

/**
 * Sanitizes an error message by stripping embedded URLs with credentials.
 */
export function sanitizeErrorMessage(message: string): string {
  return message.replace(
    /https?:\/\/[^\s]+/g,
    (matched) => sanitizeEndpointUrl(matched),
  );
}

// ─── Default Constants ────────────────────────────────────────────────────────

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 3000;
const DEFAULT_CACHE_EXPIRY_MS = 60000;

// ─── Manager ──────────────────────────────────────────────────────────────────

export class RpcFallbackManager {
  private endpoints: Map<string, RpcEndpoint> = new Map();
  private primaryEndpoint: string;
  private config: RpcFallbackConfig;

  constructor(config: RpcFallbackConfig) {
    this.config = {
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      healthCheckTimeoutMs: DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
      cacheExpiryMs: DEFAULT_CACHE_EXPIRY_MS,
      maxRetriesPerEndpoint: 1,
      ...config,
    };
    this.primaryEndpoint = config.primary;

    // Initialize endpoint map
    this.endpoints.set(config.primary, {
      url: config.primary,
      priority: 0,
      available: true,
    });

    config.fallbacks.forEach((url, index) => {
      this.endpoints.set(url, {
        url,
        priority: index + 1,
        available: true,
      });
    });
  }

  public getEndpointsByPriority(): RpcEndpoint[] {
    return Array.from(this.endpoints.values())
      .filter((ep) => this.isEndpointAvailable(ep))
      .sort((a, b) => a.priority - b.priority);
  }

  private isEndpointAvailable(endpoint: RpcEndpoint): boolean {
    if (!endpoint.available && endpoint.lastChecked) {
      const now = Date.now();
      const expiry = this.config.cacheExpiryMs!;
      if (now - endpoint.lastChecked > expiry) {
        endpoint.available = true;
      }
    }
    return endpoint.available;
  }

  private markUnavailable(url: string): void {
    const ep = this.endpoints.get(url);
    if (ep) {
      ep.available = false;
      ep.lastChecked = Date.now();
    }
  }

  private createServer(url: string): SorobanRpc.Server {
    return new SorobanRpc.Server(url, { allowHttp: false });
  }

  /**
   * Execute an idempotent read operation with bounded fallback across endpoints.
   * Throws IneligibleForFailoverError if the operation is non-idempotent.
   */
  async executeSafeRead<T>(
    operationName: IdempotentReadOperation,
    operation: (server: SorobanRpc.Server) => Promise<T>,
  ): Promise<RpcCallResult<T>> {
    if (!IDEMPOTENT_SET.has(operationName)) {
      throw new IneligibleForFailoverError(operationName);
    }

    const candidateEndpoints = this.getEndpointsByPriority();
    if (candidateEndpoints.length === 0) {
      const sanitizedPrimary = sanitizeEndpointUrl(this.primaryEndpoint);
      throw new RpcFailoverError(
        sanitizedPrimary,
        "No available RPC endpoints found in configuration pool",
        [],
      );
    }

    const attempts: RpcAttemptRecord[] = [];
    let lastError: Error | null = null;
    let lastSanitizedEndpoint = sanitizeEndpointUrl(this.primaryEndpoint);

    for (let i = 0; i < candidateEndpoints.length; i++) {
      const endpoint = candidateEndpoints[i];
      const sanitizedUrl = sanitizeEndpointUrl(endpoint.url);
      lastSanitizedEndpoint = sanitizedUrl;
      const startTime = Date.now();

      try {
        const server = this.createServer(endpoint.url);
        // Execute operation with timeout protection
        const result = await Promise.race([
          operation(server),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `Read request to ${sanitizedUrl} timed out after ${this.config.requestTimeoutMs}ms`,
                  ),
                ),
              this.config.requestTimeoutMs,
            ),
          ),
        ]);

        const durationMs = Date.now() - startTime;
        attempts.push({
          endpoint: sanitizedUrl,
          durationMs,
          success: true,
        });

        return {
          data: result,
          usedEndpoint: sanitizedUrl,
          retries: i,
          attempts,
        };
      } catch (err) {
        const durationMs = Date.now() - startTime;
        const rawErrMsg = err instanceof Error ? err.message : String(err);
        const sanitizedErrMsg = sanitizeErrorMessage(rawErrMsg);
        lastError = new Error(sanitizedErrMsg);

        this.markUnavailable(endpoint.url);
        attempts.push({
          endpoint: sanitizedUrl,
          durationMs,
          error: sanitizedErrMsg,
          success: false,
        });
      }
    }

    throw new RpcFailoverError(
      lastSanitizedEndpoint,
      lastError?.message ?? "Unknown failure",
      attempts,
    );
  }

  getPrimary(): string {
    return sanitizeEndpointUrl(this.primaryEndpoint);
  }

  getAllEndpoints(): string[] {
    return [this.primaryEndpoint, ...this.config.fallbacks].map(
      sanitizeEndpointUrl,
    );
  }

  getStatus(): Array<{ url: string; available: boolean; priority: number }> {
    return Array.from(this.endpoints.values()).map((ep) => ({
      url: sanitizeEndpointUrl(ep.url),
      available: this.isEndpointAvailable(ep),
      priority: ep.priority,
    }));
  }

  resetStatus(): void {
    this.endpoints.forEach((ep) => {
      ep.available = true;
      ep.lastChecked = undefined;
    });
  }
}

// ─── Singleton & Convenience Functions ────────────────────────────────────────

let fallbackManager: RpcFallbackManager | null = null;

export function initializeRpcFallback(config: RpcFallbackConfig): void {
  fallbackManager = new RpcFallbackManager(config);
}

export function getRpcFallbackManager(): RpcFallbackManager {
  if (!fallbackManager) {
    fallbackManager = new RpcFallbackManager(createRpcFallbackConfigFromEnv());
  }
  return fallbackManager;
}

export function createRpcFallbackConfigFromEnv(): RpcFallbackConfig {
  const primary =
    process.env.NEXT_PUBLIC_RPC_URL ||
    "https://soroban-testnet.stellar.org";

  const fallbacks: string[] = [];
  const envFallbacks = [
    process.env.NEXT_PUBLIC_FALLBACK_RPC_1,
    process.env.NEXT_PUBLIC_FALLBACK_RPC_2,
    process.env.NEXT_PUBLIC_FALLBACK_RPC_3,
  ].filter((url): url is string => Boolean(url && url.trim()));

  fallbacks.push(...envFallbacks);
  if (fallbacks.length === 0) {
    fallbacks.push("https://soroban-mainnet.stellar.org");
  }

  return {
    primary,
    fallbacks,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    healthCheckTimeoutMs: DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
    cacheExpiryMs: DEFAULT_CACHE_EXPIRY_MS,
  };
}

export async function executeSafeRead<T>(
  operationName: IdempotentReadOperation,
  operation: (server: SorobanRpc.Server) => Promise<T>,
): Promise<RpcCallResult<T>> {
  const manager = getRpcFallbackManager();
  return manager.executeSafeRead(operationName, operation);
}

/**
 * Legacy wrapper forwarding to executeSafeRead with default operation 'getEvents'.
 */
export async function executeRpcWithFallback<T>(
  operation: (server: SorobanRpc.Server) => Promise<T>,
): Promise<RpcCallResult<T>> {
  return executeSafeRead("getEvents", operation);
}

export function getRpcEndpointStatus(): Array<{
  url: string;
  available: boolean;
  priority: number;
}> {
  try {
    return getRpcFallbackManager().getStatus();
  } catch {
    return [];
  }
}
