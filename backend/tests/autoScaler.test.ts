/**
 * #709 — AutoScaler unit tests
 *
 * Tests cover:
 *   - CPU-based scale-up and scale-down
 *   - Memory-based triggers
 *   - Custom metrics (queue depth, request rate)
 *   - Scale-up cooldown (3 min default)
 *   - Scale-down cooldown (10 min default)
 *   - Min/max replica bounds
 *   - Predictive scaling execution
 *   - Scaling event logging
 *   - No-op when metrics are within range
 */

// ─── Mock Prisma ──────────────────────────────────────────────────────────────

const scalingStore = {
  events: [] as any[],
  policies: new Map<string, any>(),
  predictive: [] as any[],
  eventIdSeq: 1,
  policyIdSeq: 1,
  predictiveIdSeq: 1,
};

function resetScalingStore() {
  scalingStore.events.length = 0;
  scalingStore.policies.clear();
  scalingStore.predictive.length = 0;
  scalingStore.eventIdSeq = 1;
  scalingStore.policyIdSeq = 1;
  scalingStore.predictiveIdSeq = 1;
}

jest.mock('../src/lib/prisma', () => {
  return {
    __esModule: true,
    default: {
      scalingEvent: {
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          const rec = { id: scalingStore.eventIdSeq++, ...data, createdAt: new Date() };
          scalingStore.events.push(rec);
          return rec;
        }),
        findMany: jest.fn().mockImplementation(async ({ where, orderBy, take }: any) => {
          let results = scalingStore.events.filter((e: any) => {
            if (where?.service && e.service !== where.service) return false;
            return true;
          });
          if (take) results = results.slice(0, take);
          return results;
        }),
      },
      scalingPolicy: {
        upsert: jest.fn().mockImplementation(async ({ where, create, update }: any) => {
          const existing = scalingStore.policies.get(where.service);
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          const rec = { id: scalingStore.policyIdSeq++, ...create, createdAt: new Date() };
          scalingStore.policies.set(where.service, rec);
          return rec;
        }),
        findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
          return scalingStore.policies.get(where.service) ?? null;
        }),
        findMany: jest.fn().mockImplementation(async ({ where }: any) => {
          return [...scalingStore.policies.values()].filter((p: any) => {
            if (where?.enabled !== undefined && p.enabled !== where.enabled) return false;
            return true;
          });
        }),
      },
      predictiveScalingSchedule: {
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          const rec = { id: scalingStore.predictiveIdSeq++, ...data, createdAt: new Date() };
          scalingStore.predictive.push(rec);
          return rec;
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    },
  };
});

// ─── Imports ──────────────────────────────────────────────────────────────────

import { AutoScaler, resetCooldowns, ServiceMetrics } from '../src/services/autoScaler';
import prisma from '../src/lib/prisma';

// ─── Stub replica controller ──────────────────────────────────────────────────

function makeStubController(initialReplicas = 2) {
  const replicaCounts = new Map<string, number>();
  return {
    replicaCounts,
    async getCurrentReplicas(service: string): Promise<number> {
      return replicaCounts.get(service) ?? initialReplicas;
    },
    async setReplicas(service: string, count: number): Promise<void> {
      replicaCounts.set(service, count);
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AutoScaler', () => {
  let controller: ReturnType<typeof makeStubController>;
  let scaler: AutoScaler;

  beforeEach(async () => {
    resetScalingStore();
    resetCooldowns();
    jest.clearAllMocks();
    controller = makeStubController(2);
    scaler = new AutoScaler(controller);

    // Register a default policy
    await scaler.upsertPolicy({
      service: 'event-indexer',
      minReplicas: 1,
      maxReplicas: 5,
      cpuThresholdUp: 70,
      cpuThresholdDown: 30,
      memThresholdUp: 80,
      memThresholdDown: 40,
      scaleUpCooldownSec: 180,
      scaleDownCooldownSec: 600,
    });
  });

  // ── CPU scaling ──────────────────────────────────────────────────────────

  it('scales up when CPU exceeds threshold', async () => {
    const metrics: ServiceMetrics = {
      service: 'event-indexer',
      cpuPercent: 85,
      currentReplicas: 2,
    };
    const decision = await scaler.evaluateService(metrics);

    expect(decision.direction).toBe('scale-up');
    expect(decision.trigger).toBe('cpu');
    expect(decision.toReplicas).toBe(3);
    expect(prisma.scalingEvent.create).toHaveBeenCalledTimes(1);
  });

  it('scales down when CPU is below low threshold', async () => {
    const metrics: ServiceMetrics = {
      service: 'event-indexer',
      cpuPercent: 20,
      currentReplicas: 3,
    };
    const decision = await scaler.evaluateService(metrics);

    expect(decision.direction).toBe('scale-down');
    expect(decision.trigger).toBe('cpu');
    expect(decision.toReplicas).toBe(2);
  });

  it('does not scale when CPU is within range', async () => {
    const metrics: ServiceMetrics = {
      service: 'event-indexer',
      cpuPercent: 50,
      currentReplicas: 2,
    };
    const decision = await scaler.evaluateService(metrics);

    expect(decision.direction).toBe('none');
    expect(prisma.scalingEvent.create).not.toHaveBeenCalled();
  });

  // ── Memory scaling ───────────────────────────────────────────────────────

  it('scales up when memory exceeds threshold', async () => {
    const metrics: ServiceMetrics = {
      service: 'event-indexer',
      memoryPercent: 90,
      currentReplicas: 2,
    };
    const decision = await scaler.evaluateService(metrics);

    expect(decision.direction).toBe('scale-up');
    expect(decision.trigger).toBe('memory');
  });

  it('scales down when memory is below low threshold', async () => {
    const metrics: ServiceMetrics = {
      service: 'event-indexer',
      memoryPercent: 25,
      currentReplicas: 4,
    };
    const decision = await scaler.evaluateService(metrics);

    expect(decision.direction).toBe('scale-down');
    expect(decision.trigger).toBe('memory');
  });

  // ── Custom metrics ───────────────────────────────────────────────────────

  it('scales up based on queue depth custom metric', async () => {
    await scaler.upsertPolicy({
      service: 'payment-scheduler',
      minReplicas: 1,
      maxReplicas: 8,
      customMetricThresholds: {
        queueDepth: [100, 10],
        requestRatePerSec: [500, 50],
      },
      scaleUpCooldownSec: 180,
      scaleDownCooldownSec: 600,
    });

    const metrics: ServiceMetrics = {
      service: 'payment-scheduler',
      queueDepth: 150,
      currentReplicas: 2,
    };
    const decision = await scaler.evaluateService(metrics);

    expect(decision.direction).toBe('scale-up');
    expect(decision.trigger).toBe('queue_depth');
  });

  it('scales up based on request rate custom metric', async () => {
    await scaler.upsertPolicy({
      service: 'api-gateway',
      minReplicas: 1,
      maxReplicas: 8,
      customMetricThresholds: {
        requestRatePerSec: [500, 50],
      },
      scaleUpCooldownSec: 180,
      scaleDownCooldownSec: 600,
    });

    const metrics: ServiceMetrics = {
      service: 'api-gateway',
      requestRatePerSec: 750,
      currentReplicas: 2,
    };
    const decision = await scaler.evaluateService(metrics);

    expect(decision.direction).toBe('scale-up');
    expect(decision.trigger).toBe('request_rate');
  });

  // ── Cooldown enforcement ─────────────────────────────────────────────────

  it('blocks scale-up if scale-up cooldown is active', async () => {
    const metrics: ServiceMetrics = {
      service: 'event-indexer',
      cpuPercent: 85,
      currentReplicas: 2,
    };

    // First scale-up — succeeds
    const first = await scaler.evaluateService(metrics);
    expect(first.direction).toBe('scale-up');

    // Immediate second scale-up — blocked by cooldown
    const second = await scaler.evaluateService({ ...metrics, currentReplicas: 3 });
    expect(second.direction).toBe('none');
    expect(second.blockedByCooldown).toBe(true);
  });

  it('blocks scale-down if scale-down cooldown is active', async () => {
    const metrics: ServiceMetrics = {
      service: 'event-indexer',
      cpuPercent: 20,
      currentReplicas: 3,
    };

    const first = await scaler.evaluateService(metrics);
    expect(first.direction).toBe('scale-down');

    const second = await scaler.evaluateService({ ...metrics, currentReplicas: 2 });
    expect(second.direction).toBe('none');
    expect(second.blockedByCooldown).toBe(true);
  });

  // ── Replica bounds ───────────────────────────────────────────────────────

  it('does not exceed maxReplicas', async () => {
    const metrics: ServiceMetrics = {
      service: 'event-indexer',
      cpuPercent: 95,
      currentReplicas: 5, // already at max
    };
    const decision = await scaler.evaluateService(metrics);
    expect(decision.direction).toBe('none');
    expect(decision.toReplicas).toBe(5);
  });

  it('does not go below minReplicas', async () => {
    const metrics: ServiceMetrics = {
      service: 'event-indexer',
      cpuPercent: 10,
      currentReplicas: 1, // already at min
    };
    const decision = await scaler.evaluateService(metrics);
    expect(decision.direction).toBe('none');
    expect(decision.toReplicas).toBe(1);
  });

  // ── No active policy ─────────────────────────────────────────────────────

  it('returns none when no policy exists for service', async () => {
    const metrics: ServiceMetrics = {
      service: 'unknown-service',
      cpuPercent: 99,
      currentReplicas: 1,
    };
    const decision = await scaler.evaluateService(metrics);
    expect(decision.direction).toBe('none');
    expect(decision.reason).toMatch(/No active policy/);
  });

  // ── Scaling event logging ────────────────────────────────────────────────

  it('logs a scaling event when scale-up occurs', async () => {
    const metrics: ServiceMetrics = {
      service: 'event-indexer',
      cpuPercent: 85,
      currentReplicas: 2,
    };
    await scaler.evaluateService(metrics);

    const events = await scaler.getScalingEvents('event-indexer');
    expect(events.length).toBe(1);
    expect(events[0].direction).toBe('scale-up');
    expect(events[0].trigger).toBe('cpu');
  });

  it('does not log an event when no scaling occurs', async () => {
    const metrics: ServiceMetrics = {
      service: 'event-indexer',
      cpuPercent: 50,
      currentReplicas: 2,
    };
    await scaler.evaluateService(metrics);

    const events = await scaler.getScalingEvents('event-indexer');
    expect(events.length).toBe(0);
  });

  // ── runScalingCycle ──────────────────────────────────────────────────────

  it('evaluates multiple services in a single cycle', async () => {
    await scaler.upsertPolicy({
      service: 'webhook-notifier',
      minReplicas: 1,
      maxReplicas: 4,
      cpuThresholdUp: 60,
      cpuThresholdDown: 20,
      scaleUpCooldownSec: 180,
      scaleDownCooldownSec: 600,
    });

    const decisions = await scaler.runScalingCycle([
      { service: 'event-indexer', cpuPercent: 85, currentReplicas: 2 },
      { service: 'webhook-notifier', cpuPercent: 75, currentReplicas: 1 },
    ]);

    expect(decisions).toHaveLength(2);
    expect(decisions[0].direction).toBe('scale-up');
    expect(decisions[1].direction).toBe('scale-up');
  });
});
