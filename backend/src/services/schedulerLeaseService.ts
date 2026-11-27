/**
 * backend/src/services/schedulerLeaseService.ts
 *
 * Distributed lease coordination for the PaymentScheduler.
 *
 * Prevents overlapping scheduler executions across multiple worker instances.
 * Supports worker failure recovery via bounded TTL and automated expiry (#1643).
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

export class InMemoryLeaseStore {
  private leases = new Map<string, SchedulerLease>();

  acquire(leaseName: string, holderId: string, token: string, ttlMs: number): boolean {
    const now = Date.now();
    const existing = this.leases.get(leaseName);

    if (existing && existing.expiresAt > now) {
      if (existing.holderId === holderId && existing.token === token) {
        existing.expiresAt = now + ttlMs;
        existing.ttlMs = ttlMs;
        return true;
      }
      return false;
    }

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
  public store: InMemoryLeaseStore;

  constructor(options?: { useRedis?: boolean; store?: InMemoryLeaseStore }) {
    this.useRedis = options?.useRedis ?? false;
    this.store = options?.store ?? inMemoryLeaseStore;
  }

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

    const ok = this.store.acquire(leaseName, holderId, token, ttlMs);
    if (ok) {
      logger.info({ event: 'scheduler.lease_acquired_memory', leaseName, holderId });
      return {
        acquired: true,
        token,
        holderId,
        expiresAt: Date.now() + ttlMs,
      };
    }

    const currentLease = this.store.get(leaseName);
    return {
      acquired: false,
      holderId: currentLease?.holderId,
      expiresAt: currentLease?.expiresAt,
      reason: 'Lease held by another worker',
    };
  }

  async renewLease(
    leaseName: string,
    holderId: string,
    token: string,
    ttlMs: number = 60_000,
  ): Promise<boolean> {
    return this.store.renew(leaseName, holderId, token, ttlMs);
  }

  async releaseLease(leaseName: string, token: string): Promise<boolean> {
    if (this.useRedis) {
      try {
        await releaseLock(leaseName, token);
      } catch {
        // Fall through
      }
    }
    return this.store.release(leaseName, token);
  }
}

export const defaultSchedulerLeaseService = new SchedulerLeaseService({ useRedis: false });
