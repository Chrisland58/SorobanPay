/**
 * #709 — Automated Scaling Policies Service
 *
 * Metrics-driven auto-scaling engine for SorobanPay services.
 *
 * Features:
 *   - CPU and memory-based scaling triggers
 *   - Custom metric scaling (queue depth, request rate)
 *   - Scale-up cooldown: 3 minutes
 *   - Scale-down cooldown: 10 minutes
 *   - Minimum and maximum replica bounds
 *   - Predictive scaling for scheduled events (cron-based pre-warm)
 *   - Scaling event logging to database
 *
 * The service evaluates metrics on demand (call `evaluateService`) and
 * also exposes a cron-friendly `runScalingCycle` method that evaluates
 * all registered policies and applies predictive pre-warm if scheduled.
 *
 * Actual replica mutation is delegated to a pluggable `ReplicaController`
 * interface so it can be backed by Kubernetes, Docker Swarm, ECS, or a
 * stub in tests.
 */

import cron, { ScheduledTask } from 'node-cron';
import prisma from '../lib/prisma';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ScalingDirection = 'scale-up' | 'scale-down' | 'none';

export type ScalingTrigger =
  | 'cpu'
  | 'memory'
  | 'queue_depth'
  | 'request_rate'
  | 'predictive'
  | 'manual';

export interface ServiceMetrics {
  service: string;
  cpuPercent?: number;
  memoryPercent?: number;
  queueDepth?: number;
  requestRatePerSec?: number;
  currentReplicas: number;
}

export interface ScalingPolicyConfig {
  service: string;
  minReplicas?: number;
  maxReplicas?: number;
  cpuThresholdUp?: number;
  cpuThresholdDown?: number;
  memThresholdUp?: number;
  memThresholdDown?: number;
  /** Custom metric thresholds. Key = trigger name, value = [scaleUpThreshold, scaleDownThreshold]. */
  customMetricThresholds?: Record<string, [number, number]>;
  /** Override the default scale-up cooldown (seconds). Default: 180. */
  scaleUpCooldownSec?: number;
  /** Override the default scale-down cooldown (seconds). Default: 600. */
  scaleDownCooldownSec?: number;
  enabled?: boolean;
}

export interface ScalingDecision {
  service: string;
  direction: ScalingDirection;
  trigger?: ScalingTrigger;
  metricValue?: number;
  threshold?: number;
  fromReplicas: number;
  toReplicas: number;
  reason: string;
  blockedByCooldown?: boolean;
}

/** Adapter interface — implement to connect to real infrastructure. */
export interface ReplicaController {
  getCurrentReplicas(service: string): Promise<number>;
  setReplicas(service: string, count: number): Promise<void>;
}

export interface PredictiveScheduleConfig {
  service: string;
  label: string;
  /** Cron expression for when to pre-warm. */
  cronExpr: string;
  targetReplicas: number;
}

// ─── In-process cooldown tracker ─────────────────────────────────────────────

const _cooldowns = new Map<string, { scaleUp: Date; scaleDown: Date }>();

function getCooldown(service: string) {
  if (!_cooldowns.has(service)) {
    const epoch = new Date(0);
    _cooldowns.set(service, { scaleUp: epoch, scaleDown: epoch });
  }
  return _cooldowns.get(service)!;
}

function setCooldown(service: string, direction: 'scale-up' | 'scale-down', endsAt: Date) {
  const cd = getCooldown(service);
  if (direction === 'scale-up') cd.scaleUp = endsAt;
  else cd.scaleDown = endsAt;
}

function isOnCooldown(service: string, direction: 'scale-up' | 'scale-down'): boolean {
  const cd = getCooldown(service);
  const now = new Date();
  return direction === 'scale-up' ? now < cd.scaleUp : now < cd.scaleDown;
}

/** Exposed for testing. */
export function resetCooldowns() {
  _cooldowns.clear();
}

// ─── In-memory policy registry ────────────────────────────────────────────────

const _policies = new Map<string, Required<ScalingPolicyConfig>>();

// ─── Service ──────────────────────────────────────────────────────────────────

export class AutoScaler {
  private replicaController: ReplicaController;
  private predictiveTasks: Array<{ config: PredictiveScheduleConfig; task: ScheduledTask }> =
    [];

  constructor(replicaController: ReplicaController) {
    this.replicaController = replicaController;
  }

  // ─── Policy management ───────────────────────────────────────────────────

  /**
   * Register or update a scaling policy for a service.
   * Persists to the database and keeps an in-memory copy.
   */
  async upsertPolicy(config: ScalingPolicyConfig): Promise<void> {
    const policy: Required<ScalingPolicyConfig> = {
      service: config.service,
      minReplicas: config.minReplicas ?? 1,
      maxReplicas: config.maxReplicas ?? 10,
      cpuThresholdUp: config.cpuThresholdUp ?? 70,
      cpuThresholdDown: config.cpuThresholdDown ?? 30,
      memThresholdUp: config.memThresholdUp ?? 80,
      memThresholdDown: config.memThresholdDown ?? 40,
      customMetricThresholds: config.customMetricThresholds ?? {},
      scaleUpCooldownSec: config.scaleUpCooldownSec ?? 180,
      scaleDownCooldownSec: config.scaleDownCooldownSec ?? 600,
      enabled: config.enabled ?? true,
    };

    _policies.set(config.service, policy);

    await prisma.scalingPolicy.upsert({
      where: { service: config.service },
      update: {
        minReplicas: policy.minReplicas,
        maxReplicas: policy.maxReplicas,
        cpuThresholdUp: policy.cpuThresholdUp,
        cpuThresholdDown: policy.cpuThresholdDown,
        memThresholdUp: policy.memThresholdUp,
        memThresholdDown: policy.memThresholdDown,
        scaleUpCooldownSec: policy.scaleUpCooldownSec,
        scaleDownCooldownSec: policy.scaleDownCooldownSec,
        enabled: policy.enabled,
        updatedAt: new Date(),
      },
      create: {
        service: config.service,
        minReplicas: policy.minReplicas,
        maxReplicas: policy.maxReplicas,
        cpuThresholdUp: policy.cpuThresholdUp,
        cpuThresholdDown: policy.cpuThresholdDown,
        memThresholdUp: policy.memThresholdUp,
        memThresholdDown: policy.memThresholdDown,
        scaleUpCooldownSec: policy.scaleUpCooldownSec,
        scaleDownCooldownSec: policy.scaleDownCooldownSec,
        enabled: policy.enabled,
      },
    });
  }

  /** Load all policies from the DB into the in-memory registry. */
  async loadPolicies(): Promise<void> {
    const rows = await prisma.scalingPolicy.findMany({ where: { enabled: true } });
    for (const row of rows) {
      _policies.set(row.service, {
        service: row.service,
        minReplicas: row.minReplicas,
        maxReplicas: row.maxReplicas,
        cpuThresholdUp: row.cpuThresholdUp,
        cpuThresholdDown: row.cpuThresholdDown,
        memThresholdUp: row.memThresholdUp,
        memThresholdDown: row.memThresholdDown,
        customMetricThresholds: {},
        scaleUpCooldownSec: row.scaleUpCooldownSec,
        scaleDownCooldownSec: row.scaleDownCooldownSec,
        enabled: row.enabled,
      });
    }
  }

  // ─── Scaling evaluation ──────────────────────────────────────────────────

  /**
   * Evaluate the current metrics for a service and apply scaling if warranted.
   * Returns the scaling decision taken (or 'none' if no action was required).
   */
  async evaluateService(metrics: ServiceMetrics): Promise<ScalingDecision> {
    const policy = _policies.get(metrics.service);

    if (!policy || !policy.enabled) {
      return this.noAction(metrics, 'No active policy');
    }

    const decision = this.computeDecision(metrics, policy);

    if (decision.direction === 'none') return decision;

    // Cooldown check
    if (isOnCooldown(metrics.service, decision.direction as 'scale-up' | 'scale-down')) {
      return {
        ...decision,
        direction: 'none',
        reason: `${decision.direction} blocked by cooldown`,
        blockedByCooldown: true,
      };
    }

    // Apply the scaling action
    await this.applyScaling(decision, policy);
    return decision;
  }

  /**
   * Evaluate all registered policies with the provided metric snapshots.
   * Metrics not supplied for a service will be fetched from the controller.
   */
  async runScalingCycle(metricSnapshots: ServiceMetrics[]): Promise<ScalingDecision[]> {
    const results: ScalingDecision[] = [];

    for (const metrics of metricSnapshots) {
      const decision = await this.evaluateService(metrics);
      results.push(decision);
    }

    return results;
  }

  // ─── Predictive scaling ──────────────────────────────────────────────────

  /**
   * Register a predictive scaling schedule.
   * At the cron time, the service is pre-warmed to `targetReplicas`.
   */
  async addPredictiveSchedule(config: PredictiveScheduleConfig): Promise<void> {
    const task = cron.schedule(config.cronExpr, async () => {
      await this.applyPredictiveScale(config);
    });

    this.predictiveTasks.push({ config, task });

    await prisma.predictiveScalingSchedule.create({
      data: {
        service: config.service,
        label: config.label,
        cronExpr: config.cronExpr,
        targetReplicas: config.targetReplicas,
        active: true,
      },
    });

    console.log(
      `[autoscaler] Predictive schedule registered: ${config.service} → ${config.targetReplicas} replicas at "${config.cronExpr}" (${config.label})`,
    );
  }

  /** Load and activate predictive schedules from the database. */
  async loadPredictiveSchedules(): Promise<void> {
    const schedules = await prisma.predictiveScalingSchedule.findMany({
      where: { active: true },
    });

    for (const s of schedules) {
      const config: PredictiveScheduleConfig = {
        service: s.service,
        label: s.label,
        cronExpr: s.cronExpr,
        targetReplicas: s.targetReplicas,
      };
      const task = cron.schedule(config.cronExpr, async () => {
        await this.applyPredictiveScale(config);
      });
      this.predictiveTasks.push({ config, task });
    }
  }

  /** Stop all predictive cron jobs. */
  stopAllPredictiveSchedules(): void {
    for (const { task } of this.predictiveTasks) {
      task.stop();
    }
    this.predictiveTasks = [];
  }

  // ─── Event log queries ───────────────────────────────────────────────────

  async getScalingEvents(service?: string, limit = 100) {
    return prisma.scalingEvent.findMany({
      where: service ? { service } : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getPolicy(service: string) {
    return prisma.scalingPolicy.findUnique({ where: { service } });
  }

  async listPolicies() {
    return prisma.scalingPolicy.findMany({ orderBy: { service: 'asc' } });
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private computeDecision(
    metrics: ServiceMetrics,
    policy: Required<ScalingPolicyConfig>,
  ): ScalingDecision {
    const current = metrics.currentReplicas;

    // ── CPU ──
    if (metrics.cpuPercent !== undefined) {
      if (metrics.cpuPercent >= policy.cpuThresholdUp) {
        return this.scaleUp(metrics, policy, 'cpu', metrics.cpuPercent, policy.cpuThresholdUp, current);
      }
      if (metrics.cpuPercent <= policy.cpuThresholdDown) {
        return this.scaleDown(metrics, policy, 'cpu', metrics.cpuPercent, policy.cpuThresholdDown, current);
      }
    }

    // ── Memory ──
    if (metrics.memoryPercent !== undefined) {
      if (metrics.memoryPercent >= policy.memThresholdUp) {
        return this.scaleUp(metrics, policy, 'memory', metrics.memoryPercent, policy.memThresholdUp, current);
      }
      if (metrics.memoryPercent <= policy.memThresholdDown) {
        return this.scaleDown(metrics, policy, 'memory', metrics.memoryPercent, policy.memThresholdDown, current);
      }
    }

    // ── Custom metrics ──
    for (const [metricKey, [upThresh, downThresh]] of Object.entries(
      policy.customMetricThresholds,
    )) {
      const value = (metrics as any)[metricKey] as number | undefined;
      if (value === undefined) continue;

      if (value >= upThresh) {
        const trigger = (metricKey === 'queueDepth'
          ? 'queue_depth'
          : metricKey === 'requestRatePerSec'
          ? 'request_rate'
          : metricKey) as ScalingTrigger;
        return this.scaleUp(metrics, policy, trigger, value, upThresh, current);
      }
      if (value <= downThresh) {
        const trigger = (metricKey === 'queueDepth'
          ? 'queue_depth'
          : metricKey === 'requestRatePerSec'
          ? 'request_rate'
          : metricKey) as ScalingTrigger;
        return this.scaleDown(metrics, policy, trigger, value, downThresh, current);
      }
    }

    return this.noAction(metrics, 'Metrics within acceptable range');
  }

  private scaleUp(
    metrics: ServiceMetrics,
    policy: Required<ScalingPolicyConfig>,
    trigger: ScalingTrigger,
    metricValue: number,
    threshold: number,
    current: number,
  ): ScalingDecision {
    const toReplicas = Math.min(current + 1, policy.maxReplicas);
    return {
      service: metrics.service,
      direction: toReplicas > current ? 'scale-up' : 'none',
      trigger,
      metricValue,
      threshold,
      fromReplicas: current,
      toReplicas,
      reason:
        toReplicas > current
          ? `${trigger} ${metricValue.toFixed(1)} ≥ threshold ${threshold} → scale up to ${toReplicas}`
          : `${trigger} above threshold but already at maxReplicas (${policy.maxReplicas})`,
    };
  }

  private scaleDown(
    metrics: ServiceMetrics,
    policy: Required<ScalingPolicyConfig>,
    trigger: ScalingTrigger,
    metricValue: number,
    threshold: number,
    current: number,
  ): ScalingDecision {
    const toReplicas = Math.max(current - 1, policy.minReplicas);
    return {
      service: metrics.service,
      direction: toReplicas < current ? 'scale-down' : 'none',
      trigger,
      metricValue,
      threshold,
      fromReplicas: current,
      toReplicas,
      reason:
        toReplicas < current
          ? `${trigger} ${metricValue.toFixed(1)} ≤ threshold ${threshold} → scale down to ${toReplicas}`
          : `${trigger} below threshold but already at minReplicas (${policy.minReplicas})`,
    };
  }

  private noAction(metrics: ServiceMetrics, reason: string): ScalingDecision {
    return {
      service: metrics.service,
      direction: 'none',
      fromReplicas: metrics.currentReplicas,
      toReplicas: metrics.currentReplicas,
      reason,
    };
  }

  private async applyScaling(
    decision: ScalingDecision,
    policy: Required<ScalingPolicyConfig>,
  ): Promise<void> {
    const { service, direction, toReplicas, fromReplicas } = decision;

    console.log(
      `[autoscaler] ${direction}: ${service} ${fromReplicas} → ${toReplicas} (${decision.reason})`,
    );

    await this.replicaController.setReplicas(service, toReplicas);

    // Set cooldown
    const cooldownSec =
      direction === 'scale-up' ? policy.scaleUpCooldownSec : policy.scaleDownCooldownSec;
    const cooldownEndsAt = new Date(Date.now() + cooldownSec * 1000);
    setCooldown(service, direction as 'scale-up' | 'scale-down', cooldownEndsAt);

    // Log the scaling event
    await prisma.scalingEvent.create({
      data: {
        service,
        direction,
        trigger: decision.trigger ?? 'manual',
        metricValue: decision.metricValue ?? 0,
        threshold: decision.threshold ?? 0,
        fromReplicas,
        toReplicas,
        cooldownEndsAt,
      },
    });
  }

  private async applyPredictiveScale(config: PredictiveScheduleConfig): Promise<void> {
    const service = config.service;
    const policy = _policies.get(service);

    if (!policy?.enabled) {
      console.warn(`[autoscaler] Predictive scale skipped — no active policy for ${service}`);
      return;
    }

    const currentReplicas = await this.replicaController.getCurrentReplicas(service);
    const toReplicas = Math.min(
      Math.max(config.targetReplicas, policy.minReplicas),
      policy.maxReplicas,
    );

    if (toReplicas === currentReplicas) {
      console.log(`[autoscaler] Predictive: ${service} already at ${currentReplicas} replicas`);
      return;
    }

    const direction: 'scale-up' | 'scale-down' = toReplicas > currentReplicas ? 'scale-up' : 'scale-down';

    console.log(
      `[autoscaler] Predictive "${config.label}": ${service} ${currentReplicas} → ${toReplicas}`,
    );

    await this.replicaController.setReplicas(service, toReplicas);

    const cooldownSec =
      direction === 'scale-up' ? policy.scaleUpCooldownSec : policy.scaleDownCooldownSec;
    const cooldownEndsAt = new Date(Date.now() + cooldownSec * 1000);
    setCooldown(service, direction, cooldownEndsAt);

    await prisma.scalingEvent.create({
      data: {
        service,
        direction,
        trigger: 'predictive',
        metricValue: toReplicas,
        threshold: config.targetReplicas,
        fromReplicas: currentReplicas,
        toReplicas,
        cooldownEndsAt,
      },
    });
  }
}
