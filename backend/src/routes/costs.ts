/**
 * #707 — Cloud Cost Monitoring REST routes
 *
 * POST /api/costs/spend                        — record daily spend
 * POST /api/costs/spend/bulk                   — bulk ingest
 * GET  /api/costs/breakdown?from=&to=          — per-service breakdown
 * GET  /api/costs/service/:service?from=&to=   — daily records for one service
 * GET  /api/costs/tags/:tagKey?from=&to=       — spend grouped by tag value
 * POST /api/costs/tags/:service                — attach tags to service records
 *
 * GET  /api/costs/right-sizing                 — list all recommendations
 * POST /api/costs/right-sizing/analyze         — run analysis on last 30 days
 * POST /api/costs/right-sizing/recommend       — compute single recommendation
 *
 * GET  /api/costs/reports/:yearMonth           — get monthly report
 * POST /api/costs/reports/:yearMonth/generate  — generate/regenerate report
 * GET  /api/costs/reports/:yearMonth/export    — download CSV
 *
 * GET  /api/costs/budgets/alerts               — active budget alerts
 * POST /api/costs/budgets/alerts/:id/ack       — acknowledge an alert
 * PUT  /api/costs/budgets/:service             — upsert budget config
 *
 * GET  /api/costs/reserved-instances           — list RI recommendations
 * POST /api/costs/reserved-instances/recommend — compute RI recommendation
 */

import { Router, Request, Response } from 'express';
import {
  CloudCostMonitor,
  DailySpendInput,
  RightSizingInput,
  BudgetConfigInput,
  ReservedInstanceInput,
} from '../services/cloudCostMonitor';

const router = Router();
const monitor = new CloudCostMonitor();

// ── Spend tracking ─────────────────────────────────────────────────────────

router.post('/spend', async (req: Request, res: Response) => {
  try {
    const body = req.body as DailySpendInput;
    if (!body.service || body.costUsd === undefined || !body.date) {
      res.status(400).json({ error: 'service, date, and costUsd are required' });
      return;
    }
    await monitor.recordDailySpend({ ...body, date: new Date(body.date) });
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/spend/bulk', async (req: Request, res: Response) => {
  try {
    const records = (req.body as DailySpendInput[]).map((r) => ({
      ...r,
      date: new Date(r.date),
    }));
    await monitor.recordBulkDailySpend(records);
    res.status(201).json({ success: true, count: records.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Breakdown ──────────────────────────────────────────────────────────────

router.get('/breakdown', async (req: Request, res: Response) => {
  try {
    const from = req.query.from ? new Date(req.query.from as string) : new Date(0);
    const to = req.query.to ? new Date(req.query.to as string) : new Date();
    res.json(await monitor.getSpendBreakdown(from, to));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get('/service/:service', async (req: Request, res: Response) => {
  try {
    const from = req.query.from ? new Date(req.query.from as string) : new Date(0);
    const to = req.query.to ? new Date(req.query.to as string) : new Date();
    res.json(await monitor.getDailySpendForService(req.params.service, from, to));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Tags ───────────────────────────────────────────────────────────────────

router.get('/tags/:tagKey', async (req: Request, res: Response) => {
  try {
    const from = req.query.from ? new Date(req.query.from as string) : new Date(0);
    const to = req.query.to ? new Date(req.query.to as string) : new Date();
    res.json(await monitor.getSpendByTag(req.params.tagKey, from, to));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/tags/:service', async (req: Request, res: Response) => {
  try {
    const tags = req.body as Record<string, string>;
    await monitor.tagService(req.params.service, tags);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Right-sizing ───────────────────────────────────────────────────────────

router.get('/right-sizing', async (_req: Request, res: Response) => {
  try {
    res.json(await monitor.getRightSizingRecommendations());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/right-sizing/analyze', async (req: Request, res: Response) => {
  try {
    const since = req.body?.since ? new Date(req.body.since as string) : undefined;
    const count = await monitor.runRightSizingAnalysis(since);
    res.json({ recommendationsGenerated: count });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/right-sizing/recommend', async (req: Request, res: Response) => {
  try {
    const input = req.body as RightSizingInput;
    if (!input.service || !input.currentVcpu || !input.currentRamGib) {
      res.status(400).json({ error: 'service, currentVcpu, and currentRamGib are required' });
      return;
    }
    const result = await monitor.generateRightSizingRecommendation(input);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Monthly reports ────────────────────────────────────────────────────────

router.get('/reports/:yearMonth', async (req: Request, res: Response) => {
  try {
    const report = await monitor.getMonthlyReport(req.params.yearMonth);
    if (!report) {
      res.status(404).json({ error: `No report for ${req.params.yearMonth}` });
      return;
    }
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/reports/:yearMonth/generate', async (req: Request, res: Response) => {
  try {
    const report = await monitor.generateMonthlyReport(req.params.yearMonth);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get('/reports/:yearMonth/export', async (req: Request, res: Response) => {
  try {
    const csv = await monitor.exportMonthlyReportCsv(req.params.yearMonth);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="cost-report-${req.params.yearMonth}.csv"`,
    );
    res.send(csv);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = msg.includes('No report') ? 404 : 500;
    res.status(code).json({ error: msg });
  }
});

// ── Budget alerts ──────────────────────────────────────────────────────────

router.get('/budgets/alerts', async (_req: Request, res: Response) => {
  try {
    res.json(await monitor.getActiveBudgetAlerts());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/budgets/alerts/:id/ack', async (req: Request, res: Response) => {
  try {
    await monitor.acknowledgeBudgetAlert(Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.put('/budgets/:service', async (req: Request, res: Response) => {
  try {
    const input: BudgetConfigInput = { ...req.body, service: req.params.service };
    if (!input.monthlyLimitUsd) {
      res.status(400).json({ error: 'monthlyLimitUsd is required' });
      return;
    }
    await monitor.setBudget(input);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Reserved instances ─────────────────────────────────────────────────────

router.get('/reserved-instances', async (_req: Request, res: Response) => {
  try {
    res.json(await monitor.getReservedInstanceRecommendations());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/reserved-instances/recommend', async (req: Request, res: Response) => {
  try {
    const input = req.body as ReservedInstanceInput;
    if (!input.service || !input.instanceType || !input.onDemandCount) {
      res.status(400).json({ error: 'service, instanceType, and onDemandCount are required' });
      return;
    }
    const result = await monitor.generateReservedInstanceRecommendation(input);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
