/**
 * #709 — Automated Scaling Policies REST routes
 *
 * PUT  /api/scaling/policies/:service        — upsert policy
 * GET  /api/scaling/policies                 — list all policies
 * GET  /api/scaling/policies/:service        — get single policy
 * POST /api/scaling/evaluate                 — evaluate metrics and scale
 * GET  /api/scaling/events                   — get scaling event log
 * GET  /api/scaling/events/:service          — get events for a service
 * POST /api/scaling/predictive               — add predictive schedule
 */

import { Router, Request, Response } from 'express';
import { AutoScaler, ScalingPolicyConfig, ServiceMetrics, PredictiveScheduleConfig } from '../services/autoScaler';

const router = Router();

// Default stub controller — replace with a real Kubernetes/ECS adapter in production
const stubController = {
  _replicas: new Map<string, number>(),
  async getCurrentReplicas(service: string): Promise<number> {
    return this._replicas.get(service) ?? 1;
  },
  async setReplicas(service: string, count: number): Promise<void> {
    this._replicas.set(service, count);
    console.log(`[replica-controller] ${service} → ${count} replicas`);
  },
};

const scaler = new AutoScaler(stubController);

// PUT /api/scaling/policies/:service
router.put('/policies/:service', async (req: Request, res: Response) => {
  try {
    const config: ScalingPolicyConfig = { ...req.body, service: req.params.service };
    await scaler.upsertPolicy(config);
    const saved = await scaler.getPolicy(req.params.service);
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /api/scaling/policies
router.get('/policies', async (_req: Request, res: Response) => {
  try {
    res.json(await scaler.listPolicies());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /api/scaling/policies/:service
router.get('/policies/:service', async (req: Request, res: Response) => {
  try {
    const policy = await scaler.getPolicy(req.params.service);
    if (!policy) {
      res.status(404).json({ error: `No policy for service: ${req.params.service}` });
      return;
    }
    res.json(policy);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/scaling/evaluate
router.post('/evaluate', async (req: Request, res: Response) => {
  try {
    const snapshots: ServiceMetrics[] = Array.isArray(req.body) ? req.body : [req.body];
    const decisions = await scaler.runScalingCycle(snapshots);
    res.json(decisions);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /api/scaling/events
router.get('/events', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    res.json(await scaler.getScalingEvents(undefined, limit));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /api/scaling/events/:service
router.get('/events/:service', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    res.json(await scaler.getScalingEvents(req.params.service, limit));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/scaling/predictive
router.post('/predictive', async (req: Request, res: Response) => {
  try {
    const config = req.body as PredictiveScheduleConfig;
    if (!config.service || !config.cronExpr || !config.targetReplicas || !config.label) {
      res.status(400).json({
        error: 'service, label, cronExpr, and targetReplicas are required',
      });
      return;
    }
    await scaler.addPredictiveSchedule(config);
    res.status(201).json({ message: `Predictive schedule registered for ${config.service}` });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
