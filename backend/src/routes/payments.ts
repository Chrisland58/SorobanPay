/**
 * #711 — Payment State Machine REST routes
 *
 * POST /api/payments                           — create payment
 * GET  /api/payments/:ref                      — get payment + history
 * POST /api/payments/:ref/transition           — transition to new state
 * POST /api/payments/:ref/rollback             — rollback last transition
 * GET  /api/payments/:ref/history              — get full state history
 * GET  /api/payments/:ref/allowed-transitions  — get valid next states
 * POST /api/payments/timeout                   — run timeout scan (cron)
 */

import { Router, Request, Response } from 'express';
import { PaymentStateMachine, PaymentState, CreatePaymentInput } from '../services/paymentStateMachine';

const router = Router();
const stateMachine = new PaymentStateMachine();

// POST /api/payments
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body as CreatePaymentInput;
    if (!body.paymentRef || !body.subscriber || !body.merchant || !body.token || !body.amount) {
      res.status(400).json({ error: 'paymentRef, subscriber, merchant, token, amount are required' });
      return;
    }
    const payment = await stateMachine.createPayment(body);
    res.status(201).json(payment);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /api/payments/:ref
router.get('/:ref', async (req: Request, res: Response) => {
  try {
    const payment = await stateMachine.getPayment(req.params.ref);
    if (!payment) {
      res.status(404).json({ error: `Payment not found: ${req.params.ref}` });
      return;
    }
    res.json(payment);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/payments/:ref/transition
router.post('/:ref/transition', async (req: Request, res: Response) => {
  try {
    const { state, triggeredBy, metadata, reason } = req.body as {
      state: PaymentState;
      triggeredBy?: string;
      metadata?: Record<string, unknown>;
      reason?: string;
    };
    if (!state) {
      res.status(400).json({ error: '"state" is required' });
      return;
    }
    const result = await stateMachine.transition(req.params.ref, state, {
      triggeredBy,
      metadata,
      reason,
    });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = msg.includes('not found') ? 404 : msg.includes('Invalid') ? 422 : 500;
    res.status(code).json({ error: msg });
  }
});

// POST /api/payments/:ref/rollback
router.post('/:ref/rollback', async (req: Request, res: Response) => {
  try {
    const { triggeredBy, reason } = req.body as { triggeredBy?: string; reason?: string };
    const result = await stateMachine.rollback(req.params.ref, { triggeredBy, reason });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = msg.includes('not found') ? 404 : 422;
    res.status(code).json({ error: msg });
  }
});

// GET /api/payments/:ref/history
router.get('/:ref/history', async (req: Request, res: Response) => {
  try {
    const history = await stateMachine.getHistory(req.params.ref);
    res.json(history);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = msg.includes('not found') ? 404 : 500;
    res.status(code).json({ error: msg });
  }
});

// GET /api/payments/:ref/allowed-transitions
router.get('/:ref/allowed-transitions', async (req: Request, res: Response) => {
  try {
    const payment = await stateMachine.getPayment(req.params.ref);
    if (!payment) {
      res.status(404).json({ error: `Payment not found: ${req.params.ref}` });
      return;
    }
    const allowed = stateMachine.allowedTransitions(payment.currentState as PaymentState);
    res.json({
      currentState: payment.currentState,
      allowedTransitions: allowed,
      isTerminal: stateMachine.isTerminal(payment.currentState as PaymentState),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// POST /api/payments/timeouts  (intended for cron trigger)
router.post('/timeouts', async (_req: Request, res: Response) => {
  try {
    const count = await stateMachine.processTimeouts();
    res.json({ timedOutCount: count });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
