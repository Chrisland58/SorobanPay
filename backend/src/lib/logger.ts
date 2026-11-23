/**
 * #1386 & #1682 — Structured logging with Pino, correlation IDs, and policy-driven redaction.
 *
 * Features:
 *  - JSON output to stdout (Pino)
 *  - LOG_LEVEL configurable via LOG_LEVEL env var (default: "info")
 *  - SERVICE_ROLE env var included in every log line (e.g. "indexer", "api",
 *    "webhook-worker") — set by the Kubernetes deployment as an env var
 *  - Sensitive Stellar addresses redacted to first-8 + last-8 chars
 *  - Automatic field-name and known-secret redaction matching organizational policy
 *  - pino-pretty transport in development (NODE_ENV !== "production"),
 *    falls back to plain JSON if pino-pretty is not installed
 *  - createServiceLogger(service) — factory for child loggers with a stable
 *    service tag (useful for services that run independently of the HTTP server)
 */

import pino from 'pino';
import { SENSITIVE_FIELD_PATTERN } from './logPolicy';

// ---------------------------------------------------------------------------
// Redaction helpers (exported for use in middleware and services)
// ---------------------------------------------------------------------------

/** Redact a Stellar address: keep first 8 and last 8 chars, mask the middle. */
export function redactAddress(address: string): string {
  if (!address || address.length <= 16) return address;
  const prefix = address.slice(0, 8);
  const suffix = address.slice(-8);
  return `${prefix}...${suffix}`;
}

/** Redact a Stellar secret seed, JWT, Bearer token, or private key. */
export function redactSecret(secret: string): string {
  if (!secret) return secret;
  // Stellar secret seed: starts with S, 56 chars
  if (/^S[A-Z2-7]{55}$/.test(secret)) {
    return `${secret.slice(0, 4)}...[REDACTED_SEED]`;
  }
  if (secret.length > 8) {
    return `${secret.slice(0, 4)}...[REDACTED]`;
  }
  return '[REDACTED]';
}

/** Redact email address: keep first char and domain, mask user identifier */
export function redactEmail(email: string): string {
  const atIndex = email.indexOf('@');
  if (atIndex <= 1) return '***@' + (email.slice(atIndex + 1) || 'redacted.com');
  return `${email[0]}***@${email.slice(atIndex + 1)}`;
}

/** Redact connection URI (strips password) */
export function redactUri(uri: string): string {
  return uri.replace(
    /((?:postgres|postgresql|mysql|mongodb|redis):\/\/[^:\s]+):([^@\s]+)@/i,
    '$1:[REDACTED]@',
  );
}

/** Recursively redact sensitive fields from telemetry or log payload objects. */
export function redactTelemetryPayload<T>(payload: T): T {
  if (payload === null || payload === undefined) return payload;
  if (typeof payload === 'string') {
    // Stellar secret seed
    if (/^S[A-Z2-7]{55}$/.test(payload)) {
      return redactSecret(payload) as unknown as T;
    }
    // Database URL
    if (/(?:postgres|postgresql|mysql|mongodb|redis):\/\/[^:\s]+:[^@\s]+@/i.test(payload)) {
      return redactUri(payload) as unknown as T;
    }
    // Bearer token
    if (/^Bearer\s+[a-zA-Z0-9_.\-~+/]+=*$/i.test(payload)) {
      return 'Bearer [REDACTED]' as unknown as T;
    }
    // JWT
    if (/^eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}$/.test(payload)) {
      return '[REDACTED_JWT]' as unknown as T;
    }
    return payload;
  }
  if (Array.isArray(payload)) {
    return payload.map((item) => redactTelemetryPayload(item)) as unknown as T;
  }
  if (typeof payload === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      payload as Record<string, unknown>,
    )) {
      if (SENSITIVE_FIELD_PATTERN.test(key)) {
        output[key] = '[REDACTED]';
      } else if (
        key.toLowerCase().includes('address') &&
        typeof value === 'string'
      ) {
        output[key] = redactAddress(value);
      } else if (
        key.toLowerCase() === 'email' &&
        typeof value === 'string'
      ) {
        output[key] = redactEmail(value);
      } else {
        output[key] = redactTelemetryPayload(value);
      }
    }
    return output as T;
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Logger factory
// ---------------------------------------------------------------------------

const isDev = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL ?? 'info';
const serviceRole = process.env.SERVICE_ROLE ?? 'sorobanpay-backend';

/**
 * Attempt to load pino-pretty for development; fall back to plain JSON if the
 * optional dependency is not installed (e.g. in the production Docker image).
 */
function buildTransport(): pino.TransportSingleOptions | undefined {
  if (!isDev) return undefined;
  try {
    require.resolve('pino-pretty');
    return {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    };
  } catch {
    if (!process.env.JEST_WORKER_ID) {
      process.stderr.write(
        '[logger] pino-pretty not installed — falling back to JSON output\n',
      );
    }
    return undefined;
  }
}

const transport = buildTransport();

/** Root application logger with automatic serializer-level redaction. */
export const logger = pino(
  {
    level: logLevel,
    base: { service: serviceRole },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'password',
        'passwd',
        'secret',
        'secret_key',
        'secretKey',
        'private_key',
        'privateKey',
        'seed',
        'secret_seed',
        'token',
        'accessToken',
        'access_token',
        'refreshToken',
        'refresh_token',
        'authorization',
        'apiKey',
        'api_key',
        'webhookSecret',
        'webhook_secret',
        'admin_jwt_secret',
        'cookie',
        'session',
        'sessionId',
        'creditCard',
        'credit_card',
        'cardNumber',
        'cvv',
        'cvc',
        'ssn',
        '*.password',
        '*.passwd',
        '*.secret',
        '*.secret_key',
        '*.secretKey',
        '*.private_key',
        '*.privateKey',
        '*.seed',
        '*.token',
        '*.authorization',
        '*.apiKey',
        '*.api_key',
        '*.webhookSecret',
        '*.webhook_secret',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
  },
  transport ? pino.transport(transport) : undefined,
);

/**
 * Create a child logger with a fixed `service` tag.
 *
 * Use this in long-running services (indexer, webhook worker) that run
 * independently of Express request context:
 *
 * @example
 * const log = createServiceLogger('indexer');
 * log.info({ cursor }, 'Fetched events');
 */
export function createServiceLogger(service: string): pino.Logger {
  return logger.child({ service });
}

export default logger;
