/**
 * transaction_telemetry.ts
 *
 * Issue #1579: Request-scoped telemetry for client transaction lifecycle.
 *
 * Features:
 * - Generates non-sensitive correlation IDs for end-to-end tracing
 * - Tracks lifecycle stages: build -> simulate -> sign -> submit -> confirm -> error
 * - Strictly strips secrets, private keys, raw provider handles, and PII
 * - Configurable emission, sampling, and custom sinks
 */

export type TransactionLifecycleStage =
  | 'build'
  | 'simulate'
  | 'sign'
  | 'submit'
  | 'confirm'
  | 'error';

export interface TelemetryConfig {
  enabled: boolean;
  sampleRate: number; // 0.0 to 1.0 (1.0 = 100%)
  sink?: (event: TransactionLifecycleEvent) => void;
}

export interface TransactionLifecycleEvent {
  correlationId: string;
  stage: TransactionLifecycleStage;
  action: string;
  network: string;
  timestamp: number;
  durationMs?: number;
  txHash?: string;
  metadata?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
  };
}

let globalTelemetryConfig: TelemetryConfig = {
  enabled: true,
  sampleRate: 1.0,
  sink: undefined,
};

export function configureTelemetry(config: Partial<TelemetryConfig>): void {
  globalTelemetryConfig = {
    ...globalTelemetryConfig,
    ...config,
  };
}

export function resetTelemetryConfig(): void {
  globalTelemetryConfig = {
    enabled: true,
    sampleRate: 1.0,
    sink: undefined,
  };
}

function truncateAddress(addr?: string | null): string | undefined {
  if (!addr || typeof addr !== 'string') return undefined;
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-8)}`;
}

/** Sanitize metadata to strip secret keys, tokens, and sensitive provider data */
function sanitizeTelemetryMetadata(raw?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  const clean: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    const lower = key.toLowerCase();
    // Exclude secrets, private keys, passwords, and raw provider handles
    if (
      lower.includes('secret') ||
      lower.includes('private') ||
      lower.includes('seed') ||
      lower.includes('password') ||
      lower.includes('bearer') ||
      lower.includes('keypair') ||
      lower.includes('signer') ||
      lower.includes('walletprovider') ||
      lower.includes('window')
    ) {
      continue;
    }

    if (lower.includes('address') || lower.includes('subscriber') || lower.includes('merchant')) {
      clean[key] = typeof value === 'string' ? truncateAddress(value) : value;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      clean[key] = sanitizeTelemetryMetadata(value as Record<string, unknown>);
    } else {
      clean[key] = value;
    }
  }

  return clean;
}

export class TransactionTelemetry {
  public readonly correlationId: string;
  private readonly action: string;
  private readonly network: string;
  private readonly startTime: number;
  private lastStageTime: number;
  private currentStage: TransactionLifecycleStage | null = null;
  private readonly sampled: boolean;

  constructor(action: string, network = 'testnet', correlationId?: string) {
    this.action = action;
    this.network = network;
    this.startTime = Date.now();
    this.lastStageTime = this.startTime;
    this.correlationId = correlationId || `corr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.sampled = Math.random() < (globalTelemetryConfig.sampleRate ?? 1.0);
  }

  emit(stage: TransactionLifecycleStage, data?: {
    txHash?: string;
    metadata?: Record<string, unknown>;
    error?: unknown;
  }): TransactionLifecycleEvent | null {
    if (!globalTelemetryConfig.enabled || !this.sampled) {
      return null;
    }

    // Only emit on transition or explicit error
    if (this.currentStage === stage && stage !== 'error') {
      return null;
    }
    this.currentStage = stage;

    const now = Date.now();
    const durationMs = now - this.lastStageTime;
    this.lastStageTime = now;

    let errObj: { name: string; message: string } | undefined;
    if (data?.error) {
      if (data.error instanceof Error) {
        errObj = { name: data.error.name, message: data.error.message };
      } else {
        errObj = { name: 'Error', message: String(data.error) };
      }
    }

    const event: TransactionLifecycleEvent = {
      correlationId: this.correlationId,
      stage,
      action: this.action,
      network: this.network,
      timestamp: now,
      durationMs,
      txHash: data?.txHash,
      metadata: sanitizeTelemetryMetadata(data?.metadata),
      error: errObj,
    };

    if (globalTelemetryConfig.sink) {
      try {
        globalTelemetryConfig.sink(event);
      } catch (err) {
        console.warn('[Telemetry] Error in custom sink:', err);
      }
    }

    return event;
  }
}

export function createTransactionTelemetry(
  action: string,
  network = 'testnet',
  correlationId?: string,
): TransactionTelemetry {
  return new TransactionTelemetry(action, network, correlationId);
}
