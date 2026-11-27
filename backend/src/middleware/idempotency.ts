/**
 * idempotency.ts
 *
 * Issue #1583: Standardized idempotency-key middleware across mutation routes.
 *
 * Implements standard idempotency semantics for payments, subscriptions, and webhooks:
 * - Scoped by tenant and route
 * - Replays previous successful responses with `Idempotent-Replay: true`
 * - Rejects payload conflicts with 409 Conflict (IDEMPOTENCY_PAYLOAD_MISMATCH)
 * - Guards concurrent identical requests with in-flight locking
 * - Releases locks and retains responses according to retention policy
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { createHash } from 'node:crypto';
import { isValidIdempotencyKey } from '../services/idempotencyService';

export interface IdempotencyEntry {
  key: string;
  tenantId: string;
  path: string;
  method: string;
  payloadHash: string;
  status: 'pending' | 'succeeded' | 'failed';
  statusCode?: number;
  body?: any;
  createdAt: number;
}

// In-memory idempotency cache with TTL retention (1 hour default)
const IDEMPOTENCY_STORE = new Map<string, IdempotencyEntry>();
const DEFAULT_RETENTION_MS = 60 * 60 * 1000; // 1 hour

export function computePayloadHash(payload: any): string {
  if (payload === undefined || payload === null) {
    return createHash('sha256').update('').digest('hex');
  }
  // Canonical JSON serialization sorting object keys recursively
  const canonicalString = JSON.stringify(payload, (_key, val) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val)
        .sort()
        .reduce((sorted: Record<string, any>, k) => {
          sorted[k] = val[k];
          return sorted;
        }, {});
    }
    return val;
  });
  return createHash('sha256').update(canonicalString).digest('hex');
}

export function clearIdempotencyStore(): void {
  IDEMPOTENCY_STORE.clear();
}

export interface IdempotencyOptions {
  required?: boolean;
  retentionMs?: number;
}

export function idempotencyMiddleware(options: IdempotencyOptions = {}): RequestHandler {
  const { required = false, retentionMs = DEFAULT_RETENTION_MS } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    // Only apply to mutation methods
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) {
      return next();
    }

    const rawKey = req.header('Idempotency-Key') || req.header('X-Idempotency-Key');

    if (!rawKey) {
      if (required) {
        res.status(400).json({
          error: 'MISSING_IDEMPOTENCY_KEY',
          message: 'Idempotency-Key header is required for this mutation route.',
        });
        return;
      }
      return next();
    }

    const key = rawKey.trim();

    if (!isValidIdempotencyKey(key)) {
      res.status(400).json({
        error: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency key format is invalid. Must be UUID or alphanumeric string.',
      });
      return;
    }

    const tenantId = (req as any).tenantId || (req.header('x-tenant-id') as string) || 'default';
    const storeKey = `${tenantId}:${req.baseUrl || ''}${req.path}:${key}`;
    const payloadHash = computePayloadHash(req.body);

    const existing = IDEMPOTENCY_STORE.get(storeKey);

    if (existing) {
      // Check retention TTL
      if (Date.now() - existing.createdAt > retentionMs) {
        IDEMPOTENCY_STORE.delete(storeKey);
      } else {
        // Payload conflict check
        if (existing.payloadHash !== payloadHash) {
          res.status(409).json({
            error: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
            message: 'An existing request has already been processed with this idempotency key and a different payload.',
          });
          return;
        }

        // Concurrent in-flight request
        if (existing.status === 'pending') {
          res.status(409).json({
            error: 'IDEMPOTENCY_OPERATION_IN_PROGRESS',
            message: 'A request with this idempotency key is currently in flight. Please retry shortly.',
          });
          return;
        }

        // Previous successful execution — replay original outcome
        if (existing.status === 'succeeded') {
          res.setHeader('Idempotent-Replay', 'true');
          res.status(existing.statusCode || 200).send(existing.body);
          return;
        }
      }
    }

    // Register new pending idempotency entry
    const newEntry: IdempotencyEntry = {
      key,
      tenantId,
      path: req.path,
      method: req.method,
      payloadHash,
      status: 'pending',
      createdAt: Date.now(),
    };
    IDEMPOTENCY_STORE.set(storeKey, newEntry);

    // Intercept response methods to capture final status and body
    const originalSend = res.send.bind(res);
    const originalJson = res.json.bind(res);

    let finished = false;

    const finalize = (body: any, isError = false) => {
      if (finished) return;
      finished = true;
      const statusCode = res.statusCode || 200;

      if (!isError && statusCode >= 200 && statusCode < 300) {
        newEntry.status = 'succeeded';
        newEntry.statusCode = statusCode;
        newEntry.body = body;
      } else {
        newEntry.status = 'failed';
        newEntry.statusCode = statusCode;
        newEntry.body = body;
      }
    };

    res.send = (body: any): Response => {
      finalize(body);
      return originalSend(body);
    };

    res.json = (body: any): Response => {
      finalize(body);
      return originalJson(body);
    };

    res.on('close', () => {
      if (!finished) {
        newEntry.status = 'failed';
      }
    });

    next();
  };
}
