/**
 * #707 — CloudCostMonitor unit tests
 *
 * Covers:
 *   1. Daily spend ingestion (idempotency, multi-service)
 *   2. Per-service cost breakdown
 *   3. Right-sizing recommendations (≥15% saving threshold)
 *   4. Cost-allocation tags
 *   5. Monthly cost report generation + CSV export
 *   6. Budget alerts at 80% and 100%
 *   7. Reserved-instance planning
 */

// ─── Mock Prisma ──────────────────────────────────────────────────────────────

const costStore = {
  spend: [] as any[],
  rightSizing: new Map<string, any>(),
  reports: new Map<string, any>(),
  budgets: new Map<string, any>(),
  alerts: [] as any[],
  riRecs: [] as any[],
  idSeq: 1,
};

function resetCostStore() {
  costStore.spend.length = 0;
  costStore.rightSizing.clear();
  costStore.reports.clear();
  costStore.budgets.clear();
  costStore.alerts.length = 0;
  costStore.riRecs.length = 0;
  costStore.idSeq = 1;
}

function nextId() { return costStore.idSeq++; }

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    dailySpendRecord: {
      upsert: jest.fn().mockImplementation(async ({ where, create, update }: any) => {
        const key = `${where.date_service.date.toISOString().slice(0, 10)}_${where.date_service.service}`;
        const idx = costStore.spend.findIndex(
          (r) => r._key === key,
        );
        if (idx >= 0) {
          Object.assign(costStore.spend[idx], update);
          return costStore.spend[idx];
        }
        const rec = { id: nextId(), _key: key, ...create };
        costStore.spend.push(rec);
        return rec;
      }),
      findMany: jest.fn().mockImplementation(async ({ where }: any) => {
        return costStore.spend.filter((r) => {
          if (where?.service && r.service !== where.service) return false;
          if (where?.date?.gte && new Date(r.date) < where.date.gte) return false;
          if (where?.date?.lte && new Date(r.date) > where.date.lte) return false;
          if (where?.cpuAvgPct?.gt !== undefined && r.cpuAvgPct <= where.cpuAvgPct.gt) return false;
          return true;
        });
      }),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => {
        const rec = costStore.spend.find((r) => r.id === where.id);
        if (!rec) throw new Error('not found');
        Object.assign(rec, data);
        return rec;
      }),
    },
    rightSizingRecommendation: {
      upsert: jest.fn().mockImplementation(async ({ where, create, update }: any) => {
        const existing = costStore.rightSizing.get(where.service);
        if (existing) { Object.assign(existing, update); return existing; }
        const rec = { id: nextId(), ...create };
        costStore.rightSizing.set(where.service, rec);
        return rec;
      }),
      findMany: jest.fn().mockImplementation(async () =>
        [...costStore.rightSizing.values()].sort((a, b) => b.estimatedSavingUsd - a.estimatedSavingUsd),
      ),
    },
    monthlyCostReport: {
      upsert: jest.fn().mockImplementation(async ({ where, create, update }: any) => {
        const existing = costStore.reports.get(where.yearMonth);
        if (existing) { Object.assign(existing, update); return existing; }
        const rec = { id: nextId(), ...create };
        costStore.reports.set(where.yearMonth, rec);
        return rec;
      }),
      findUnique: jest.fn().mockImplementation(async ({ where }: any) =>
        costStore.reports.get(where.yearMonth) ?? null,
      ),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => {
        const rec = costStore.reports.get(where.yearMonth);
        if (!rec) throw new Error('not found');
        Object.assign(rec, data);
        return rec;
      }),
    },
    budgetConfig: {
      upsert: jest.fn().mockImplementation(async ({ where, create, update }: any) => {
        const existing = costStore.budgets.get(where.service);
        if (existing) { Object.assign(existing, update); return existing; }
        const rec = { id: nextId(), ...create };
        costStore.budgets.set(where.service, rec);
        return rec;
      }),
      findMany: jest.fn().mockImplementation(async ({ where }: any) => {
        return [...costStore.budgets.values()].filter((b) => {
          if (where?.service?.in) return where.service.in.includes(b.service);
          return true;
        });
      }),
    },
    budgetAlert: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        const duplicate = costStore.alerts.find(
          (a) =>
            a.service === data.service &&
            a.yearMonth === data.yearMonth &&
            a.threshold === data.threshold,
        );
        if (duplicate) throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
        const rec = { id: nextId(), acknowledged: false, firedAt: new Date(), ...data };
        costStore.alerts.push(rec);
        return rec;
      }),
      findMany: jest.fn().mockImplementation(async ({ where }: any) =>
        costStore.alerts.filter((a) => {
          if (where?.acknowledged !== undefined && a.acknowledged !== where.acknowledged) return false;
          return true;
        }),
      ),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => {
        const rec = costStore.alerts.find((a) => a.id === where.id);
        if (!rec) throw new Error('not found');
        Object.assign(rec, data);
        return rec;
      }),
    },
    reservedInstanceRecommendation: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        const rec = { id: nextId(), generatedAt: new Date(), ...data };
        costStore.riRecs.push(rec);
        return rec;
      }),
      findMany: jest.fn().mockImplementation(async () =>
        [...costStore.riRecs].sort((a, b) => b.estimatedSavingUsd - a.estimatedSavingUsd),
      ),
    },
  },
}));

import { CloudCostMonitor } from '../src/services/cloudCostMonitor';
import prisma from '../src/lib/prisma';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function day(offset = 0) {
  const d = new Date('2024-06-15T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CloudCostMonitor', () => {
  let monitor: CloudCostMonitor;

  beforeEach(() => {
    resetCostStore();
    jest.clearAllMocks();
    monitor = new CloudCostMonitor();
  });

  // ── 1. Daily spend tracking ──────────────────────────────────────────────

  it('records a daily spend entry', async () => {
    await monitor.recordDailySpend({
      date: day(),
      service: 'event-indexer',
      costUsd: 12.50,
      cpuAvgPct: 45,
      memAvgPct: 60,
      tags: { env: 'prod', team: 'backend' },
    });

    expect(prisma.dailySpendRecord.upsert).toHaveBeenCalledTimes(1);
    const call = (prisma.dailySpendRecord.upsert as jest.Mock).mock.calls[0][0];
    expect(call.create.costUsd).toBe(12.50);
    expect(call.create.service).toBe('event-indexer');
    expect(JSON.parse(call.create.tags)).toEqual({ env: 'prod', team: 'backend' });
  });

  it('is idempotent — upserts on (date, service)', async () => {
    await monitor.recordDailySpend({ date: day(), service: 'api', costUsd: 5 });
    await monitor.recordDailySpend({ date: day(), service: 'api', costUsd: 8 });

    // Both calls go through upsert; store should have one record updated
    expect(prisma.dailySpendRecord.upsert).toHaveBeenCalledTimes(2);
    expect(costStore.spend).toHaveLength(1);
    expect(costStore.spend[0].costUsd).toBe(8);
  });

  it('bulk-records multiple spend entries', async () => {
    await monitor.recordBulkDailySpend([
      { date: day(0), service: 'svc-a', costUsd: 10 },
      { date: day(0), service: 'svc-b', costUsd: 20 },
      { date: day(1), service: 'svc-a', costUsd: 11 },
    ]);

    expect(costStore.spend).toHaveLength(3);
  });

  // ── 2. Per-service cost breakdown ────────────────────────────────────────

  it('returns spend summary sorted by cost desc', async () => {
    costStore.spend.push(
      { id: nextId(), _key: 'k1', service: 'cheap', costUsd: 5, date: day(), cpuAvgPct: 0, memAvgPct: 0, tags: '{}' },
      { id: nextId(), _key: 'k2', service: 'expensive', costUsd: 100, date: day(), cpuAvgPct: 0, memAvgPct: 0, tags: '{}' },
      { id: nextId(), _key: 'k3', service: 'expensive', costUsd: 50, date: day(1), cpuAvgPct: 0, memAvgPct: 0, tags: '{}' },
    );

    const breakdown = await monitor.getSpendBreakdown(day(-1), day(2));
    expect(breakdown[0].service).toBe('expensive');
    expect(breakdown[0].totalCostUsd).toBe(150);
    expect(breakdown[0].days).toBe(2);
    expect(breakdown[0].avgDailyCostUsd).toBe(75);
    expect(breakdown[1].service).toBe('cheap');
  });

  it('returns empty array when no records exist', async () => {
    const result = await monitor.getSpendBreakdown(day(), day());
    expect(result).toEqual([]);
  });

  // ── 3. Right-sizing recommendations ─────────────────────────────────────

  it('generates a right-sizing recommendation when saving ≥ 15%', async () => {
    // CPU avg 30% vs 60% target → vCPU can be halved → ≥15% saving
    const result = await monitor.generateRightSizingRecommendation({
      service: 'event-indexer',
      currentVcpu: 4,
      currentRamGib: 8,
      avgCpuPct: 30,
      avgMemPct: 40,
      currentMonthlyCostUsd: 200,
    });

    expect(result.actionable).toBe(true);
    expect(result.savingPct).toBeGreaterThanOrEqual(15);
    expect(result.recommendedVcpu).toBeLessThan(4);
    expect(result.recommendedRamGib).toBeLessThan(8);
    expect(prisma.rightSizingRecommendation.upsert).toHaveBeenCalledTimes(1);
  });

  it('does NOT persist when saving is below 15%', async () => {
    // CPU very close to target — barely under-provisioned
    const result = await monitor.generateRightSizingRecommendation({
      service: 'efficient-svc',
      currentVcpu: 2,
      currentRamGib: 4,
      avgCpuPct: 58, // just under 60% target
      avgMemPct: 68, // just under 70% target
      currentMonthlyCostUsd: 100,
    });

    expect(result.actionable).toBe(false);
    expect(prisma.rightSizingRecommendation.upsert).not.toHaveBeenCalled();
  });

  it('recommended resources are never below minimum bounds', async () => {
    const result = await monitor.generateRightSizingRecommendation({
      service: 'tiny-svc',
      currentVcpu: 0.5,
      currentRamGib: 1,
      avgCpuPct: 1,
      avgMemPct: 1,
      currentMonthlyCostUsd: 10,
    });

    expect(result.recommendedVcpu).toBeGreaterThanOrEqual(0.25);
    expect(result.recommendedRamGib).toBeGreaterThanOrEqual(0.5);
  });

  it('runRightSizingAnalysis generates recommendations from spend history', async () => {
    // Seed spend records with utilisation data
    const base = { tags: '{}', currentVcpu: 4, currentRam: 8, provider: 'aws', region: 'us-east-1' };
    costStore.spend.push(
      { id: nextId(), _key: 'a', service: 'svc-x', costUsd: 50, cpuAvgPct: 25, memAvgPct: 30, date: day(-5), ...base },
      { id: nextId(), _key: 'b', service: 'svc-x', costUsd: 50, cpuAvgPct: 25, memAvgPct: 30, date: day(-4), ...base },
    );

    // Pass an explicit since date that covers the seeded records
    const count = await monitor.runRightSizingAnalysis(day(-10));
    expect(count).toBeGreaterThanOrEqual(1);
  });

  // ── 4. Cost-allocation tags ──────────────────────────────────────────────

  it('attaches tags to existing spend records', async () => {
    costStore.spend.push({
      id: nextId(), _key: 'k1', service: 'my-svc', costUsd: 10,
      date: day(), cpuAvgPct: 0, memAvgPct: 0, tags: JSON.stringify({ env: 'prod' }),
    });

    await monitor.tagService('my-svc', { team: 'platform', costCenter: 'eng-101' });

    expect(prisma.dailySpendRecord.update).toHaveBeenCalledTimes(1);
    const updatedTags = JSON.parse(costStore.spend[0].tags);
    expect(updatedTags.env).toBe('prod');        // original tag preserved
    expect(updatedTags.team).toBe('platform');   // new tag added
    expect(updatedTags.costCenter).toBe('eng-101');
  });

  it('groups spend by tag value', async () => {
    costStore.spend.push(
      { id: nextId(), _key: 'k1', service: 's1', costUsd: 30, date: day(), cpuAvgPct: 0, memAvgPct: 0, tags: JSON.stringify({ env: 'prod' }) },
      { id: nextId(), _key: 'k2', service: 's2', costUsd: 20, date: day(), cpuAvgPct: 0, memAvgPct: 0, tags: JSON.stringify({ env: 'prod' }) },
      { id: nextId(), _key: 'k3', service: 's3', costUsd: 10, date: day(), cpuAvgPct: 0, memAvgPct: 0, tags: JSON.stringify({ env: 'staging' }) },
    );

    const result = await monitor.getSpendByTag('env', day(-1), day(1));
    expect(result['prod']).toBe(50);
    expect(result['staging']).toBe(10);
  });

  it('labels untagged records as "untagged"', async () => {
    costStore.spend.push({
      id: nextId(), _key: 'k1', service: 's1', costUsd: 15, date: day(),
      cpuAvgPct: 0, memAvgPct: 0, tags: '{}',
    });

    const result = await monitor.getSpendByTag('env', day(-1), day(1));
    expect(result['untagged']).toBe(15);
  });

  // ── 5. Monthly cost reports ──────────────────────────────────────────────

  it('generates a monthly report aggregating all daily records', async () => {
    costStore.spend.push(
      { id: nextId(), _key: 'a', service: 'svc-a', costUsd: 100, date: new Date('2024-06-10'), cpuAvgPct: 0, memAvgPct: 0, tags: '{}' },
      { id: nextId(), _key: 'b', service: 'svc-b', costUsd: 200, date: new Date('2024-06-20'), cpuAvgPct: 0, memAvgPct: 0, tags: '{}' },
    );

    const report = await monitor.generateMonthlyReport('2024-06');
    expect(report.yearMonth).toBe('2024-06');
    expect(report.totalCostUsd).toBe(300);
    expect(report.breakdown['svc-a']).toBe(100);
    expect(report.breakdown['svc-b']).toBe(200);
    expect(prisma.monthlyCostReport.upsert).toHaveBeenCalledTimes(1);
  });

  it('exports a monthly report as CSV', async () => {
    costStore.reports.set('2024-06', {
      id: nextId(),
      yearMonth: '2024-06',
      totalCostUsd: 300,
      breakdown: JSON.stringify({ 'svc-a': 100, 'svc-b': 200 }),
      tags: '{}',
    });

    const csv = await monitor.exportMonthlyReportCsv('2024-06');
    expect(csv).toContain('month,service,cost_usd');
    expect(csv).toContain('2024-06,svc-a,100');
    expect(csv).toContain('2024-06,TOTAL,300');
    expect(prisma.monthlyCostReport.update).toHaveBeenCalledTimes(1); // marks exported
  });

  it('throws when exporting a non-existent report', async () => {
    await expect(monitor.exportMonthlyReportCsv('2000-01')).rejects.toThrow('No report found');
  });

  // ── 6. Budget alerts ─────────────────────────────────────────────────────

  it('fires an 80% budget alert when spend crosses threshold', async () => {
    // Budget: $100/month for 'indexer'
    costStore.budgets.set('indexer', {
      id: nextId(), service: 'indexer', monthlyLimitUsd: 100,
      alertAt80: true, alertAt100: true,
    });

    // Inject $85 of spend in June 2024
    costStore.spend.push({
      id: nextId(), _key: 'k1', service: 'indexer', costUsd: 85,
      date: new Date('2024-06-15'), cpuAvgPct: 0, memAvgPct: 0, tags: '{}',
    });

    await monitor.checkBudgetAlerts('indexer', new Date('2024-06-15'));

    const alert = costStore.alerts.find((a) => a.threshold === 80);
    expect(alert).toBeDefined();
    expect(alert.spentUsd).toBe(85);
    expect(alert.limitUsd).toBe(100);
  });

  it('fires a 100% budget alert when spend reaches the limit', async () => {
    costStore.budgets.set('indexer', {
      id: nextId(), service: 'indexer', monthlyLimitUsd: 100,
      alertAt80: true, alertAt100: true,
    });
    costStore.spend.push({
      id: nextId(), _key: 'k1', service: 'indexer', costUsd: 105,
      date: new Date('2024-06-15'), cpuAvgPct: 0, memAvgPct: 0, tags: '{}',
    });

    await monitor.checkBudgetAlerts('indexer', new Date('2024-06-15'));

    expect(costStore.alerts.some((a) => a.threshold === 80)).toBe(true);
    expect(costStore.alerts.some((a) => a.threshold === 100)).toBe(true);
  });

  it('does not fire a duplicate alert for the same threshold in the same month', async () => {
    costStore.budgets.set('svc', {
      id: nextId(), service: 'svc', monthlyLimitUsd: 100,
      alertAt80: true, alertAt100: false,
    });
    costStore.spend.push({
      id: nextId(), _key: 'k1', service: 'svc', costUsd: 90,
      date: new Date('2024-06-15'), cpuAvgPct: 0, memAvgPct: 0, tags: '{}',
    });

    // First call fires the alert
    await monitor.checkBudgetAlerts('svc', new Date('2024-06-15'));
    // Second call should not duplicate (unique constraint mock throws → silently swallowed)
    await monitor.checkBudgetAlerts('svc', new Date('2024-06-15'));

    expect(costStore.alerts.filter((a) => a.threshold === 80)).toHaveLength(1);
  });

  it('does not fire when spend is below 80%', async () => {
    costStore.budgets.set('svc2', {
      id: nextId(), service: 'svc2', monthlyLimitUsd: 1000,
      alertAt80: true, alertAt100: true,
    });
    costStore.spend.push({
      id: nextId(), _key: 'k1', service: 'svc2', costUsd: 100,
      date: new Date('2024-06-15'), cpuAvgPct: 0, memAvgPct: 0, tags: '{}',
    });

    await monitor.checkBudgetAlerts('svc2', new Date('2024-06-15'));
    expect(costStore.alerts).toHaveLength(0);
  });

  it('acknowledges a budget alert', async () => {
    const alert = { id: nextId(), service: 'svc', yearMonth: '2024-06', threshold: 80, acknowledged: false };
    costStore.alerts.push(alert);

    await monitor.acknowledgeBudgetAlert(alert.id);
    expect(costStore.alerts[0].acknowledged).toBe(true);
  });

  // ── 7. Reserved-instance planning ────────────────────────────────────────

  it('calculates RI saving correctly', async () => {
    const result = await monitor.generateReservedInstanceRecommendation({
      service: 'scheduler',
      instanceType: 't3.medium',
      onDemandCount: 4,
      onDemandMonthlyCostPerUnit: 30,     // $120/mo total on-demand
      reservedMonthlyCostPerUnit: 18,     // $72/mo total reserved
      term: '1yr',
    });

    expect(result.estimatedSavingUsd).toBe(48);     // 120 - 72
    expect(result.savingPct).toBe(40);               // 48/120
    expect(result.recommendation).toContain('t3.medium');
    expect(prisma.reservedInstanceRecommendation.create).toHaveBeenCalledTimes(1);
  });

  it('returns a below-threshold message when saving is low', async () => {
    const result = await monitor.generateReservedInstanceRecommendation({
      service: 'small-svc',
      instanceType: 't3.micro',
      onDemandCount: 1,
      onDemandMonthlyCostPerUnit: 10,
      reservedMonthlyCostPerUnit: 9.5,   // only 5% saving
    });

    expect(result.savingPct).toBeLessThan(10);
    expect(result.recommendation).toContain('below recommendation threshold');
  });

  it('returns all RI recommendations sorted by saving desc', async () => {
    costStore.riRecs.push(
      { id: nextId(), service: 'a', estimatedSavingUsd: 20, generatedAt: new Date() },
      { id: nextId(), service: 'b', estimatedSavingUsd: 80, generatedAt: new Date() },
    );

    const recs = await monitor.getReservedInstanceRecommendations();
    expect(recs[0].estimatedSavingUsd).toBe(80);
    expect(recs[1].estimatedSavingUsd).toBe(20);
  });
});
