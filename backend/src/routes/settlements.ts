/**
 * #712 — Settlement REST routes
 *
 * POST /api/settlements/aggregate          — trigger aggregation run
 * GET  /api/settlements/:merchant          — list batches for merchant
 * GET  /api/settlements/:merchant/report   — multi-currency net report
 * GET  /api/settlements/batch/:batchRef    — get batch + instructions
 * POST /api/settlements/batch/:batchRef/advance — advance status
 * POST /api/settlements/batch/:batchRef/partial — apply partial settlement
 * POST /api/settlements/batch/:batchRef/confirm — confirm batch
 */

import { Router, Request, Response } from 'express';
import { SettlementAggregator, SettlementStatus } from '../services/settlementAggregator';

const router = Router();
const aggregator = new SettlementAggregator({ feeRate: Number(process.env.SETTLEMENT_FEE_RATE ?? 0) });

// POST /api/settlements/aggregate
router.post('/aggregate', async (_req: Request, res: Response) => {
  try {
    const count = await aggregator.aggregatePendingPayments();
    res.json({ success: true, batchesCreatedOrUpdated: count });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// GET /api/settlements/:merchant
router.get('/:merchant', async (req: Request, res: Response) => {
  try {
    const { merchant } = req.params;
    const status = req.query.status as SettlementStatus | undefined;
    const batches = await aggregator.getBatchesForMerchant(merchant, status);
    res.json(batches);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// GET /api/settlements/:merchant/report
router.get('/:merchant/report', async (req: Request, res: Response) => {
  try {
    const { merchant } = req.params;
    const from = req.query.from ? new Date(req.query.from as string) : new Date(0);
    const to = req.query.to ? new Date(req.query.to as string) : new Date();
    const report = await aggregator.getNetSettlementReport(merchant, from, to);
    res.json(report);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// GET /api/settlements/batch/:batchRef
router.get('/batch/:batchRef', async (req: Request, res: Response) => {
  try {
    const instructions = await aggregator.getInstructions(req.params.batchRef);
    res.json(instructions);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const statusCode = msg.includes('not found') ? 404 : 500;
    res.status(statusCode).json({ error: msg });
  }
});

// POST /api/settlements/batch/:batchRef/advance
router.post('/batch/:batchRef/advance', async (req: Request, res: Response) => {
  try {
    const { status, reason } = req.body as { status: SettlementStatus; reason?: string };
    if (!status) {
      res.status(400).json({ error: '"status" is required' });
      return;
    }
    const updated = await aggregator.advanceStatus(req.params.batchRef, status, reason);
    res.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const statusCode = msg.includes('not found') ? 404 : msg.includes('Invalid') ? 422 : 500;
    res.status(statusCode).json({ error: msg });
  }
});

// POST /api/settlements/batch/:batchRef/partial
router.post('/batch/:batchRef/partial', async (req: Request, res: Response) => {
  try {
    const { paidAmount, reason } = req.body as { paidAmount: string; reason?: string };
    if (!paidAmount) {
      res.status(400).json({ error: '"paidAmount" is required' });
      return;
    }
    const updated = await aggregator.applyPartialSettlement(req.params.batchRef, {
      paidAmount,
      reason,
    });
    res.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const statusCode = msg.includes('not found') ? 404 : 422;
    res.status(statusCode).json({ error: msg });
  }
});

// POST /api/settlements/batch/:batchRef/confirm
router.post('/batch/:batchRef/confirm', async (req: Request, res: Response) => {
  try {
    const { reason } = req.body as { reason?: string };
    const updated = await aggregator.confirmBatch(req.params.batchRef, reason);
    res.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const statusCode = msg.includes('not found') ? 404 : 422;
    res.status(statusCode).json({ error: msg });
  }
});

export default router;
