/**
 * backend/src/services/schedulerLeaseService.ts
 *
 * Distributed lease coordination for the PaymentScheduler.
 *
 * Prevents overlapping scheduler executions across multiple worker instances (#1587).
 * Ensures that if a scheduler tick is taking longer than the tick interval or if
 * multiple worker processes are running, only one worker can execute payment batches
 * at any given time.
 *
 * Responsibilities:
 *   - Acquire lease with bounded TTL (fail-closed if lease is currently held).
 *   - Support explicit lease renewal for long-running batches.
 *   - Safe lease release with ownership token validation (avoids releasing an expired lease held by another).
 *   - Automatic recovery after lease TTL expires.
 */

import { randomUUID } from 'crypto';
import logger from '../lib/logger';
import { acquireLock, releaseLock } from '../lib/redis';

export interface SchedulerLease {
  leaseName: string;
  holderId: string;
  token: string;
  acquiredAt: number;
  expiresAt: number;
  ttlMs: number;
}

export interface AcquireLeaseResult {
  acquired: boolean;
  token?: string;
  holderId?: string;
  expiresAt?: number;
  reason?: string;
}

// In-memory fallback lease registry for single-process environments or tests
class InMemoryLeaseStore {
  private leases = new Map<string, SchedulerLease>();

  acquire(leaseName: string, holderId: string, token: string, ttlMs: number): boolean {
    const now = Date.now();
    const existing = this.leases.get(leaseName);

    if (existing && existing.expiresAt > now) {
      if (existing.holderId === holderId && existing.token === token) {
        // Renewal
        existing.expiresAt = now + ttlMs;
        existing.ttlMs = ttlMs;
        return true;
      }
      return false;
    }

    // Unheld or expired
    this.leases.set(leaseName, {
      leaseName,
      holderId,
      token,
      acquiredAt: now,
      expiresAt: now + ttlMs,
      ttlMs,
    });
    return true;
  }

  renew(leaseName: string, holderId: string, token: string, ttlMs: number): boolean {
    const now = Date.now();
    const existing = this.leases.get(leaseName);
    if (!existing || existing.expiresAt <= now) {
      return false;
    }
    if (existing.holderId !== holderId || existing.token !== token) {
      return false;
    }
    existing.expiresAt = now + ttlMs;
    existing.ttlMs = ttlMs;
    return true;
  }

  release(leaseName: string, token: string): boolean {
    const existing = this.leases.get(leaseName);
    if (!existing) {
      return false;
    }
    if (existing.token === token) {
      this.leases.delete(leaseName);
      return true;
    }
    return false;
  }

  get(leaseName: string): SchedulerLease | undefined {
    const lease = this.leases.get(leaseName);
    if (!lease) return undefined;
    if (lease.expiresAt <= Date.now()) {
      this.leases.delete(leaseName);
      return undefined;
    }
    return lease;
  }

  clear(): void {
    this.leases.clear();
  }
}

export const inMemoryLeaseStore = new InMemoryLeaseStore();

export class SchedulerLeaseService {
  private useRedis: boolean;

  constructor(options?: { useRedis?: boolean }) {
    this.useRedis = options?.useRedis ?? true;
  }

  /**
   * Acquire a distributed lease for the scheduler.
   */
  async acquireLease(
    leaseName: string,
    holderId: string = randomUUID(),
    ttlMs: number = 60_000,
  ): Promise<AcquireLeaseResult> {
    const token = `${holderId}:${randomUUID()}`;

    if (this.useRedis) {
      try {
        const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
        const lockRes = await acquireLock(leaseName, ttlSeconds);
        if (lockRes.acquired && lockRes.token) {
          logger.info({ event: 'scheduler.lease_acquired', leaseName, holderId });
          return {
            acquired: true,
            token: lockRes.token,
            holderId,
            expiresAt: Date.now() + ttlMs,
          };
        }
      } catch (err) {
        logger.warn({
          event: 'scheduler.redis_lock_failed_fallback_to_memory',
          leaseName,
          error: String(err),
        });
      }
    }

    // In-memory fallback
    const ok = inMemoryLeaseStore.acquire(leaseName, holderId, token, ttlMs);
    if (ok) {
      logger.info({ event: 'scheduler.lease_acquired_memory', leaseName, holderId });
      return {
        acquired: true,
        token,
        holderId,
        expiresAt: Date.now() + ttlMs,
      };
    }

    const currentLease = inMemoryLeaseStore.get(leaseName);
    logger.warn({
      event: 'scheduler.lease_busy',
      leaseName,
      attemptedHolder: holderId,
      currentHolder: currentLease?.holderId,
      expiresAt: currentLease?.expiresAt,
    });

    return {
      acquired: false,
      holderId: currentLease?.holderId,
      expiresAt: currentLease?.expiresAt,
      reason: 'Lease held by another worker',
    };
  }

  /**
   * Renew an existing lease to keep it alive during prolonged batch processing.
   */
  async renewLease(
    leaseName: string,
    holderId: string,
    token: string,
    ttlMs: number = 60_000,
  ): Promise<boolean> {
    const ok = inMemoryLeaseStore.renew(leaseName, holderId, token, ttlMs);
    if (ok) {
      logger.debug({ event: 'scheduler.lease_renewed', leaseName, holderId });
    }
    return ok;
  }

  /**
   * Release a previously acquired lease.
   */
  async releaseLease(leaseName: string, token: string): Promise<boolean> {
    if (this.useRedis) {
      try {
        await releaseLock(leaseName, token);
      } catch {
        // Fall through
      }
    }
    const released = inMemoryLeaseStore.release(leaseName, token);
    logger.info({ event: 'scheduler.lease_released', leaseName, released });
    return released;
  }

  /**
   * Execute an operation guarded by a distributed lease.
   * If another execution holds the lease, skips execution cleanly.
   */
  async withLease<T>(
    leaseName: string,
    holderId: string,
    operation: () => Promise<T>,
    options?: { ttlMs?: number },
  ): Promise<{ executed: boolean; result?: T; reason?: string }> {
    const ttlMs = options?.ttlMs ?? 60_000;
    const lease = await this.acquireLease(leaseName, holderId, ttlMs);

    if (!lease.acquired || !lease.token) {
      return {
        executed: false,
        reason: lease.reason ?? 'Lease busy',
      };
    }

    try {
      const result = await operation();
      return { executed: true, result };
    } finally {
      await this.releaseLease(leaseName, lease.token);
    }
  }
}

export const defaultSchedulerLeaseService = new SchedulerLeaseService({ useRedis: false });
