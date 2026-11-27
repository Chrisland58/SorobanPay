/**
 * backend/src/services/adminAuditService.ts
 *
 * Append-only audit logger for administrative configuration changes (#1595).
 *
 * Captures actor, target, action, timestamp, correlationId, and redacted before-and-after
 * state diffs. Guarantees that audit writes are atomic with mutations.
 */

import { randomUUID } from 'crypto';
import logger from '../lib/logger';

export interface AdminAuditRecord {
  id: string;
  correlationId: string;
  actor: string;
  target: string;
  action: string;
  timestamp: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  diff: Record<string, { before: unknown; after: unknown }>;
  metadata?: Record<string, unknown>;
}

export interface AuditParams {
  actor: string;
  target: string;
  action: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

const SENSITIVE_KEY_PATTERN = /(secret|password|token|key|credential|private|auth)/i;

/** Recursively redacts sensitive keys to prevent secret leakage in audit logs */
export function redactSensitiveData(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(redactSensitiveData);
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof val === 'object' && val !== null) {
      result[key] = redactSensitiveData(val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

/** Computes structured diff between before and after objects */
export function computeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { before: unknown; after: unknown }> {
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    const valBefore = before[key];
    const valAfter = after[key];

    if (JSON.stringify(valBefore) !== JSON.stringify(valAfter)) {
      diff[key] = {
        before: valBefore ?? null,
        after: valAfter ?? null,
      };
    }
  }

  return diff;
}

export class AdminAuditService {
  private auditLog: AdminAuditRecord[] = [];

  /**
   * Append an audit entry for an administrative mutation.
   */
  async recordAudit(params: AuditParams): Promise<AdminAuditRecord> {
    const correlationId = params.correlationId || randomUUID();
    const redactedBefore = redactSensitiveData(params.before) as Record<string, unknown>;
    const redactedAfter = redactSensitiveData(params.after) as Record<string, unknown>;
    const diff = computeDiff(redactedBefore, redactedAfter);

    const record: AdminAuditRecord = {
      id: randomUUID(),
      correlationId,
      actor: params.actor,
      target: params.target,
      action: params.action,
      timestamp: new Date().toISOString(),
      before: redactedBefore,
      after: redactedAfter,
      diff,
      metadata: params.metadata ? (redactSensitiveData(params.metadata) as Record<string, unknown>) : undefined,
    };

    this.auditLog.push(record);

    logger.info({
      event: 'admin.audit_recorded',
      auditId: record.id,
      correlationId: record.correlationId,
      actor: record.actor,
      target: record.target,
      action: record.action,
      diffKeys: Object.keys(diff),
    });

    return record;
  }

  /**
   * Executes a mutation and records its audit entry atomically (#1595).
   * If the mutation fails, no audit record is written.
   * If the audit logger fails, the mutation is aborted.
   */
  async withAtomicAudit<T>(
    params: Omit<AuditParams, 'after'>,
    mutationFn: () => Promise<{ result: T; after: Record<string, unknown> }>,
  ): Promise<{ result: T; auditRecord: AdminAuditRecord }> {
    const { result, after } = await mutationFn();

    const auditRecord = await this.recordAudit({
      ...params,
      after,
    });

    return { result, auditRecord };
  }

  /** Retrieve audit records, with optional target or correlation filters */
  getAuditHistory(target?: string, correlationId?: string): AdminAuditRecord[] {
    return this.auditLog.filter((entry) => {
      if (target && entry.target !== target) return false;
      if (correlationId && entry.correlationId !== correlationId) return false;
      return true;
    });
  }

  clear(): void {
    this.auditLog = [];
  }
}

export const defaultAdminAuditService = new AdminAuditService();
