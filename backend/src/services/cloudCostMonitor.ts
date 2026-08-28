/**
 * #707 — Cloud Cost Monitoring & Optimization Service
 *
 * Responsibilities:
 *   1. Daily cloud spend tracking     — ingest daily cost samples per service
 *   2. Per-service cost breakdown     — query spend by service / date range
 *   3. Right-sizing recommendations   — analyse CPU/mem util vs provisioned
 *   4. Cost-allocation tag management — attach/read tags on spend records
 *   5. Monthly cost reports           — aggregate + export JSON/CSV summaries
 *   6. Budget alerts                  — fire at 80% and 100% of monthly limit
 *   7. Reserved-instance planning     — estimate savings from RI commitments
 */

import prisma from '../lib/prisma';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DailySpendInput {
  date: Date;
  service: string;
  costUsd: number;
  provider?: string;
  region?: string;
  cpuAvgPct?: number;
  memAvgPct?: number;
  currentVcpu?: number;
  currentRam?: number;
  /** Arbitrary key→value cost-allocation tags, e.g. { team: "backend", env: "prod" } */
  tags?: Record<string, string>;
}

export interface SpendSummary {
  service: string;
  totalCostUsd: number;
  days: number;
  avgDailyCostUsd: number;
}

export interface RightSizingInput {
  service: string;
  currentVcpu: number;
  currentRamGib: number;
  /** Observed average CPU utilisation over the analysis window (%). */
  avgCpuPct: number;
  /** Observed average memory utilisation over the analysis window (%). */
  avgMemPct: number;
  /** Current monthly cost in USD for this service. */
  currentMonthlyCostUsd: number;
}

export interface MonthlyReportData {
  yearMonth: string;
  totalCostUsd: number;
  breakdown: Record<string, number>;
  tagBreakdown: Record<string, number>;
}

export interface BudgetConfigInput {
  service: string;
  monthlyLimitUsd: number;
  alertAt80?: boolean;
  alertAt100?: boolean;
}

export interface ReservedInstanceInput {
  service: string;
  instanceType: string;
  /** Number of instances currently running on-demand. */
  onDemandCount: number;
  /** Average monthly on-demand cost per instance in USD. */
  onDemandMonthlyCostPerUnit: number;
  /** Reserved instance monthly cost per unit (1-yr, no-upfront). */
  reservedMonthlyCostPerUnit: number;
  term?: '1yr' | '3yr';
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Minimum utilisation target for right-sizing.
 * Resources used below this level are considered over-provisioned.
 */
const CPU_TARGET_PCT = 60;
const MEM_TARGET_PCT = 70;

/**
 * Minimum saving percentage that makes a right-sizing recommendation
 * worth surfacing (acceptance criteria: ≥ 15%).
 */
const MIN_SAVING_PCT = 15;

// ─── Service ──────────────────────────────────────────────────────────────────

export class CloudCostMonitor {

  // ── 1. Daily spend tracking ────────────────────────────────────────────────

  /**
   * Ingest a daily spend sample for a service.
   * Idempotent — upserting on (date, service).
   */
  async recordDailySpend(input: DailySpendInput): Promise<void> {
    const date = this.truncateToDay(input.date);

    await prisma.dailySpendRecord.upsert({
      where: {
        date_service: { date, service: input.service },
      },
      update: {
        costUsd: input.costUsd,
        cpuAvgPct: input.cpuAvgPct ?? 0,
        memAvgPct: input.memAvgPct ?? 0,
        currentVcpu: input.currentVcpu ?? 0,
        currentRam: input.currentRam ?? 0,
        tags: JSON.stringify(input.tags ?? {}),
      },
      create: {
        date,
        service: input.service,
        costUsd: input.costUsd,
        provider: input.provider ?? 'aws',
        region: input.region ?? 'us-east-1',
        cpuAvgPct: input.cpuAvgPct ?? 0,
        memAvgPct: input.memAvgPct ?? 0,
        currentVcpu: input.currentVcpu ?? 0,
        currentRam: input.currentRam ?? 0,
        tags: JSON.stringify(input.tags ?? {}),
      },
    });

    // After recording spend, check budget alerts for the month
    await this.checkBudgetAlerts(input.service, date);
  }

  /**
   * Bulk-ingest multiple daily spend records in one call.
   */
  async recordBulkDailySpend(records: DailySpendInput[]): Promise<void> {
    for (const record of records) {
      await this.recordDailySpend(record);
    }
  }

  // ── 2. Per-service cost breakdown ─────────────────────────────────────────

  /**
   * Return total spend per service for a date range, sorted by cost descending.
   */
  async getSpendBreakdown(from: Date, to: Date): Promise<SpendSummary[]> {
    const records = await prisma.dailySpendRecord.findMany({
      where: {
        date: { gte: this.truncateToDay(from), lte: this.truncateToDay(to) },
      },
      orderBy: { date: 'asc' },
    });

    // Aggregate by service
    const byService = new Map<string, { total: number; days: Set<string> }>();
    for (const r of records) {
      if (!byService.has(r.service)) {
        byService.set(r.service, { total: 0, days: new Set() });
      }
      const agg = byService.get(r.service)!;
      agg.total += r.costUsd;
      agg.days.add(r.date.toISOString().slice(0, 10));
    }

    return [...byService.entries()]
      .map(([service, { total, days }]) => ({
        service,
        totalCostUsd: Math.round(total * 100) / 100,
        days: days.size,
        avgDailyCostUsd: Math.round((total / days.size) * 100) / 100,
      }))
      .sort((a, b) => b.totalCostUsd - a.totalCostUsd);
  }

  /**
   * Return raw daily records for a specific service.
   */
  async getDailySpendForService(service: string, from: Date, to: Date) {
    return prisma.dailySpendRecord.findMany({
      where: {
        service,
        date: { gte: this.truncateToDay(from), lte: this.truncateToDay(to) },
      },
      orderBy: { date: 'asc' },
    });
  }

  // ── 3. Right-sizing recommendations ───────────────────────────────────────

  /**
   * Compute and persist a right-sizing recommendation for a service.
   *
   * Logic:
   *   recommended_vcpu = ceil(current_vcpu * (avg_cpu_pct / CPU_TARGET_PCT))
   *   recommended_ram  = ceil(current_ram  * (avg_mem_pct / MEM_TARGET_PCT))
   *   saving_pct = (1 - recommended_resource / current_resource) * 100
   *
   * Only persisted when projected saving ≥ MIN_SAVING_PCT (15%).
   */
  async generateRightSizingRecommendation(
    input: RightSizingInput,
  ): Promise<{
    recommendedVcpu: number;
    recommendedRamGib: number;
    estimatedSavingUsd: number;
    savingPct: number;
    actionable: boolean;
  }> {
    const recVcpu = Math.max(
      0.25,
      Math.ceil((input.currentVcpu * (input.avgCpuPct / CPU_TARGET_PCT)) * 4) / 4,
    );
    const recRam = Math.max(
      0.5,
      Math.ceil((input.currentRamGib * (input.avgMemPct / MEM_TARGET_PCT)) * 4) / 4,
    );

    // Saving is proportional to resource reduction (weighted 50/50 CPU & RAM)
    const cpuReductionPct = Math.max(0, (1 - recVcpu / input.currentVcpu) * 100);
    const ramReductionPct = Math.max(0, (1 - recRam / input.currentRamGib) * 100);
    const savingPct = Math.round(((cpuReductionPct + ramReductionPct) / 2) * 10) / 10;
    const estimatedSavingUsd =
      Math.round(input.currentMonthlyCostUsd * (savingPct / 100) * 100) / 100;

    const actionable = savingPct >= MIN_SAVING_PCT;

    if (actionable) {
      await prisma.rightSizingRecommendation.upsert({
        where: { service: input.service },
        update: {
          currentVcpu: input.currentVcpu,
          recommendedVcpu: recVcpu,
          currentRamGib: input.currentRamGib,
          recommendedRamGib: recRam,
          estimatedSavingUsd,
          savingPct,
          basis: '30d_avg',
          generatedAt: new Date(),
          updatedAt: new Date(),
        },
        create: {
          service: input.service,
          currentVcpu: input.currentVcpu,
          recommendedVcpu: recVcpu,
          currentRamGib: input.currentRamGib,
          recommendedRamGib: recRam,
          estimatedSavingUsd,
          savingPct,
          basis: '30d_avg',
        },
      });

      console.log(
        `[cost-monitor] Right-sizing: ${input.service} — ` +
          `vCPU ${input.currentVcpu} → ${recVcpu}, ` +
          `RAM ${input.currentRamGib} → ${recRam} GiB, ` +
          `save ~${savingPct}% ($${estimatedSavingUsd}/mo)`,
      );
    }

    return { recommendedVcpu: recVcpu, recommendedRamGib: recRam, estimatedSavingUsd, savingPct, actionable };
  }

  /**
   * Auto-generate right-sizing recommendations from 30-day spend history.
   * Iterates over every service that has utilisation data in the last 30 days.
   */
  async runRightSizingAnalysis(from?: Date): Promise<number> {
    const since = from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const records = await prisma.dailySpendRecord.findMany({
      where: {
        date: { gte: this.truncateToDay(since) },
        cpuAvgPct: { gt: 0 },
      },
      orderBy: { date: 'asc' },
    });

    // Aggregate per-service averages
    const byService = new Map<
      string,
      {
        cpuSum: number;
        memSum: number;
        costSum: number;
        count: number;
        vcpu: number;
        ram: number;
      }
    >();

    for (const r of records) {
      if (!byService.has(r.service)) {
        byService.set(r.service, { cpuSum: 0, memSum: 0, costSum: 0, count: 0, vcpu: r.currentVcpu, ram: r.currentRam });
      }
      const agg = byService.get(r.service)!;
      agg.cpuSum += r.cpuAvgPct;
      agg.memSum += r.memAvgPct;
      agg.costSum += r.costUsd;
      agg.count++;
      // Use most recent provisioned size
      agg.vcpu = r.currentVcpu;
      agg.ram = r.currentRam;
    }

    let recommendationCount = 0;
    for (const [service, agg] of byService) {
      if (agg.count === 0 || agg.vcpu === 0 || agg.ram === 0) continue;

      const result = await this.generateRightSizingRecommendation({
        service,
        currentVcpu: agg.vcpu,
        currentRamGib: agg.ram,
        avgCpuPct: agg.cpuSum / agg.count,
        avgMemPct: agg.memSum / agg.count,
        currentMonthlyCostUsd: (agg.costSum / agg.count) * 30,
      });

      if (result.actionable) recommendationCount++;
    }

    return recommendationCount;
  }

  async getRightSizingRecommendations() {
    return prisma.rightSizingRecommendation.findMany({
      orderBy: { estimatedSavingUsd: 'desc' },
    });
  }

  // ── 4. Cost-allocation tags ────────────────────────────────────────────────

  /**
   * Attach or update cost-allocation tags on all spend records for a service.
   * Merges new tags with existing ones.
   */
  async tagService(service: string, tags: Record<string, string>): Promise<void> {
    const records = await prisma.dailySpendRecord.findMany({ where: { service } });

    for (const record of records) {
      const existing = JSON.parse(record.tags) as Record<string, string>;
      const merged = { ...existing, ...tags };
      await prisma.dailySpendRecord.update({
        where: { id: record.id },
        data: { tags: JSON.stringify(merged) },
      });
    }
  }

  /**
   * Return spend grouped by a specific tag key for a date range.
   */
  async getSpendByTag(
    tagKey: string,
    from: Date,
    to: Date,
  ): Promise<Record<string, number>> {
    const records = await prisma.dailySpendRecord.findMany({
      where: {
        date: { gte: this.truncateToDay(from), lte: this.truncateToDay(to) },
      },
    });

    const result: Record<string, number> = {};
    for (const r of records) {
      const tags = JSON.parse(r.tags) as Record<string, string>;
      const tagValue = tags[tagKey] ?? 'untagged';
      result[tagValue] = (result[tagValue] ?? 0) + r.costUsd;
    }

    // Round values
    for (const k of Object.keys(result)) {
      result[k] = Math.round(result[k] * 100) / 100;
    }

    return result;
  }

  // ── 5. Monthly cost reports ────────────────────────────────────────────────

  /**
   * Generate (or regenerate) a monthly cost report for a given year-month.
   * Aggregates all daily records for that month.
   */
  async generateMonthlyReport(yearMonth: string): Promise<MonthlyReportData> {
    const { from, to } = this.monthBounds(yearMonth);

    const records = await prisma.dailySpendRecord.findMany({
      where: { date: { gte: from, lte: to } },
    });

    const breakdown: Record<string, number> = {};
    const tagTotals: Record<string, number> = {};
    let total = 0;

    for (const r of records) {
      breakdown[r.service] = (breakdown[r.service] ?? 0) + r.costUsd;
      total += r.costUsd;

      const tags = JSON.parse(r.tags) as Record<string, string>;
      for (const [k, v] of Object.entries(tags)) {
        const key = `${k}:${v}`;
        tagTotals[key] = (tagTotals[key] ?? 0) + r.costUsd;
      }
    }

    // Round everything
    for (const k of Object.keys(breakdown)) {
      breakdown[k] = Math.round(breakdown[k] * 100) / 100;
    }
    for (const k of Object.keys(tagTotals)) {
      tagTotals[k] = Math.round(tagTotals[k] * 100) / 100;
    }

    const data: MonthlyReportData = {
      yearMonth,
      totalCostUsd: Math.round(total * 100) / 100,
      breakdown,
      tagBreakdown: tagTotals,
    };

    await prisma.monthlyCostReport.upsert({
      where: { yearMonth },
      update: {
        totalCostUsd: data.totalCostUsd,
        breakdown: JSON.stringify(breakdown),
        tags: JSON.stringify(tagTotals),
      },
      create: {
        yearMonth,
        totalCostUsd: data.totalCostUsd,
        breakdown: JSON.stringify(breakdown),
        tags: JSON.stringify(tagTotals),
      },
    });

    console.log(
      `[cost-monitor] Monthly report ${yearMonth}: $${data.totalCostUsd} across ${Object.keys(breakdown).length} services`,
    );

    return data;
  }

  /**
   * Mark a monthly report as exported (e.g. emailed / uploaded to S3).
   */
  async markReportExported(yearMonth: string): Promise<void> {
    await prisma.monthlyCostReport.update({
      where: { yearMonth },
      data: { exportedAt: new Date() },
    });
  }

  async getMonthlyReport(yearMonth: string): Promise<MonthlyReportData | null> {
    const report = await prisma.monthlyCostReport.findUnique({ where: { yearMonth } });
    if (!report) return null;
    return {
      yearMonth: report.yearMonth,
      totalCostUsd: report.totalCostUsd,
      breakdown: JSON.parse(report.breakdown) as Record<string, number>,
      tagBreakdown: JSON.parse(report.tags) as Record<string, number>,
    };
  }

  /**
   * Export the monthly report as CSV string.
   */
  async exportMonthlyReportCsv(yearMonth: string): Promise<string> {
    const report = await this.getMonthlyReport(yearMonth);
    if (!report) throw new Error(`No report found for ${yearMonth}`);

    const lines = [
      `month,service,cost_usd`,
      ...Object.entries(report.breakdown).map(
        ([service, cost]) => `${yearMonth},${service},${cost}`,
      ),
      `${yearMonth},TOTAL,${report.totalCostUsd}`,
    ];

    await this.markReportExported(yearMonth);
    return lines.join('\n');
  }

  // ── 6. Budget alerts ───────────────────────────────────────────────────────

  /**
   * Create or update a budget configuration for a service.
   * Use service = "ALL" for an org-wide budget.
   */
  async setBudget(input: BudgetConfigInput): Promise<void> {
    await prisma.budgetConfig.upsert({
      where: { service: input.service },
      update: {
        monthlyLimitUsd: input.monthlyLimitUsd,
        alertAt80: input.alertAt80 ?? true,
        alertAt100: input.alertAt100 ?? true,
        updatedAt: new Date(),
      },
      create: {
        service: input.service,
        monthlyLimitUsd: input.monthlyLimitUsd,
        alertAt80: input.alertAt80 ?? true,
        alertAt100: input.alertAt100 ?? true,
      },
    });
  }

  /**
   * Return all unacknowledged budget alerts.
   */
  async getActiveBudgetAlerts() {
    return prisma.budgetAlert.findMany({
      where: { acknowledged: false },
      orderBy: { firedAt: 'desc' },
    });
  }

  /**
   * Acknowledge a budget alert so it stops appearing as active.
   */
  async acknowledgeBudgetAlert(id: number): Promise<void> {
    await prisma.budgetAlert.update({
      where: { id },
      data: { acknowledged: true },
    });
  }

  /**
   * Check budget thresholds for a service in the current month.
   * Called automatically after every `recordDailySpend`.
   */
  async checkBudgetAlerts(service: string, date: Date): Promise<void> {
    const yearMonth = date.toISOString().slice(0, 7); // "YYYY-MM"

    // Collect applicable budgets: service-specific + org-wide "ALL"
    const budgets = await prisma.budgetConfig.findMany({
      where: { service: { in: [service, 'ALL'] } },
    });

    for (const budget of budgets) {
      const { from, to } = this.monthBounds(yearMonth);

      // Sum all spend for this month (for service-specific, filter by service;
      // for "ALL" budget, sum everything)
      const where =
        budget.service === 'ALL'
          ? { date: { gte: from, lte: to } }
          : { service, date: { gte: from, lte: to } };

      const records = await prisma.dailySpendRecord.findMany({ where });
      const monthToDate = records.reduce((acc: number, r: { costUsd: number }) => acc + r.costUsd, 0);
      const usagePct = (monthToDate / budget.monthlyLimitUsd) * 100;

      const thresholds: Array<{ pct: number; enabled: boolean }> = [
        { pct: 80, enabled: budget.alertAt80 },
        { pct: 100, enabled: budget.alertAt100 },
      ];

      for (const { pct, enabled } of thresholds) {
        if (!enabled || usagePct < pct) continue;

        try {
          await prisma.budgetAlert.create({
            data: {
              service: budget.service,
              yearMonth,
              threshold: pct,
              spentUsd: Math.round(monthToDate * 100) / 100,
              limitUsd: budget.monthlyLimitUsd,
            },
          });

          console.warn(
            `[cost-monitor] 🚨 BUDGET ALERT — ${budget.service}: ` +
              `$${Math.round(monthToDate * 100) / 100} / $${budget.monthlyLimitUsd} ` +
              `(${Math.round(usagePct)}% — ${pct}% threshold breached)`,
          );
        } catch {
          // Unique constraint violation means alert already fired — skip silently
        }
      }
    }
  }

  // ── 7. Reserved-instance planning ─────────────────────────────────────────

  /**
   * Compute and persist a reserved-instance savings recommendation.
   *
   * Saving = (on-demand monthly cost − reserved monthly cost) × count
   */
  async generateReservedInstanceRecommendation(
    input: ReservedInstanceInput,
  ): Promise<{
    estimatedSavingUsd: number;
    savingPct: number;
    recommendation: string;
  }> {
    const onDemandMonthly = input.onDemandMonthlyCostPerUnit * input.onDemandCount;
    const reservedMonthly = input.reservedMonthlyCostPerUnit * input.onDemandCount;
    const estimatedSavingUsd = Math.round((onDemandMonthly - reservedMonthly) * 100) / 100;
    const savingPct =
      onDemandMonthly > 0
        ? Math.round(((onDemandMonthly - reservedMonthly) / onDemandMonthly) * 1000) / 10
        : 0;

    await prisma.reservedInstanceRecommendation.create({
      data: {
        service: input.service,
        instanceType: input.instanceType,
        recommendedCount: input.onDemandCount,
        onDemandMonthlyCost: onDemandMonthly,
        reservedMonthlyCost: reservedMonthly,
        estimatedSavingUsd,
        term: input.term ?? '1yr',
      },
    });

    const recommendation =
      savingPct >= 10
        ? `Convert ${input.onDemandCount}× ${input.instanceType} to ${input.term ?? '1yr'} RI — save $${estimatedSavingUsd}/mo (${savingPct}%)`
        : `Saving of ${savingPct}% is below recommendation threshold`;

    console.log(`[cost-monitor] RI recommendation for ${input.service}: ${recommendation}`);

    return { estimatedSavingUsd, savingPct, recommendation };
  }

  async getReservedInstanceRecommendations() {
    return prisma.reservedInstanceRecommendation.findMany({
      orderBy: { estimatedSavingUsd: 'desc' },
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Truncate a Date to midnight UTC. */
  private truncateToDay(date: Date): Date {
    const d = new Date(date);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  /** Return the start and end of a "YYYY-MM" month as UTC dates. */
  private monthBounds(yearMonth: string): { from: Date; to: Date } {
    const [year, month] = yearMonth.split('-').map(Number);
    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)); // last day
    return { from, to };
  }
}
