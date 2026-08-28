/**
 * #711 — Payment State Machine
 *
 * Manages the full lifecycle of a payment record with:
 *   - Strictly validated state transitions
 *   - Full state change history per payment
 *   - State transition event logging
 *   - Rollback / compensating transactions (revert to prior state)
 *   - State timeout handling (timed_out fallback state)
 *   - State-specific action triggers (hooks called on each transition)
 *
 * Payment states:
 *   pending → authorised → processing → executed
 *                       ↓              ↓
 *                     failed         failed
 *                       ↓
 *                    refunded
 *   pending → cancelled
 *   (any) → timed_out   (timeout handler)
 */

import prisma from '../lib/prisma';

// ─── State definitions ────────────────────────────────────────────────────────

export type PaymentState =
  | 'pending'
  | 'authorised'
  | 'processing'
  | 'executed'
  | 'failed'
  | 'refunded'
  | 'cancelled'
  | 'timed_out';

/** Terminal states that cannot be transitioned out of. */
const TERMINAL_STATES = new Set<PaymentState>([
  'executed',
  'refunded',
  'cancelled',
  'timed_out',
]);

/**
 * Valid forward transitions.
 * Each key is a "from" state; values are the allowed "to" states.
 */
const ALLOWED_TRANSITIONS: Record<PaymentState, PaymentState[]> = {
  pending: ['authorised', 'cancelled', 'timed_out'],
  authorised: ['processing', 'failed', 'cancelled', 'timed_out'],
  processing: ['executed', 'failed', 'timed_out'],
  executed: [],           // terminal
  failed: ['refunded'],   // only path out of failed is refund
  refunded: [],           // terminal
  cancelled: [],          // terminal
  timed_out: [],          // terminal
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreatePaymentInput {
  paymentRef: string;
  subscriber: string;
  merchant: string;
  token: string;
  amount: string;
}

export interface TransitionResult {
  paymentId: number;
  paymentRef: string;
  fromState: PaymentState;
  toState: PaymentState;
  historyId: number;
}

/**
 * Action hook: called after every successful state transition.
 * Can be used to trigger notifications, webhook calls, downstream
 * settlement aggregation, etc.
 */
export type TransitionHook = (
  paymentRef: string,
  from: PaymentState,
  to: PaymentState,
  metadata?: Record<string, unknown>,
) => Promise<void>;

/** Timeout configuration per state. */
export interface TimeoutConfig {
  /** State that this timeout applies to. */
  state: PaymentState;
  /** Seconds before the payment is considered timed out. */
  timeoutSeconds: number;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class PaymentStateMachine {
  private hooks: TransitionHook[] = [];
  private timeoutConfigs: TimeoutConfig[] = [];

  constructor(opts: { timeoutConfigs?: TimeoutConfig[] } = {}) {
    this.timeoutConfigs = opts.timeoutConfigs ?? [
      { state: 'pending', timeoutSeconds: 300 },      // 5 min
      { state: 'authorised', timeoutSeconds: 600 },   // 10 min
      { state: 'processing', timeoutSeconds: 120 },   // 2 min
    ];
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Register a hook to be called on every successful transition.
   * Hooks are called in registration order, errors are logged and swallowed.
   */
  registerHook(hook: TransitionHook): void {
    this.hooks.push(hook);
  }

  /**
   * Create a new payment record in `pending` state.
   * Idempotent — returns the existing record if paymentRef already exists.
   */
  async createPayment(input: CreatePaymentInput) {
    const existing = await prisma.paymentRecord.findUnique({
      where: { paymentRef: input.paymentRef },
    });
    if (existing) return existing;

    const record = await prisma.paymentRecord.create({
      data: {
        ...input,
        currentState: 'pending',
        lastTransitionAt: new Date(),
      },
    });

    await prisma.paymentStateHistory.create({
      data: {
        paymentId: record.id,
        fromState: 'pending',
        toState: 'pending',
        triggeredBy: 'system:create',
      },
    });

    console.log(`[state-machine] payment ${input.paymentRef} created in state: pending`);
    return record;
  }

  /**
   * Transition a payment to a new state.
   * Throws if the transition is not allowed.
   */
  async transition(
    paymentRef: string,
    toState: PaymentState,
    opts: {
      triggeredBy?: string;
      metadata?: Record<string, unknown>;
      reason?: string;
    } = {},
  ): Promise<TransitionResult> {
    const payment = await this.getOrThrow(paymentRef);
    const fromState = payment.currentState as PaymentState;

    this.assertTransitionAllowed(fromState, toState);

    // Persist transition atomically
    const [updatedPayment, historyEntry] = await prisma.$transaction([
      prisma.paymentRecord.update({
        where: { paymentRef },
        data: {
          currentState: toState,
          lastTransitionAt: new Date(),
          updatedAt: new Date(),
        },
      }),
      prisma.paymentStateHistory.create({
        data: {
          paymentId: payment.id,
          fromState,
          toState,
          triggeredBy: opts.triggeredBy ?? 'system',
          metadata: opts.metadata ? JSON.stringify(opts.metadata) : opts.reason,
        },
      }),
    ]);

    console.log(
      `[state-machine] payment ${paymentRef}: ${fromState} → ${toState}` +
        (opts.triggeredBy ? ` (by ${opts.triggeredBy})` : ''),
    );

    // Run action hooks (non-blocking failure)
    await this.runHooks(paymentRef, fromState, toState, opts.metadata);

    return {
      paymentId: updatedPayment.id,
      paymentRef,
      fromState,
      toState,
      historyId: historyEntry.id,
    };
  }

  /**
   * Rollback the last transition (compensating transaction).
   *
   * Reads the second-most-recent history entry and reverts to that state.
   * Only possible if the current state is not a hard terminal state that
   * cannot be safely undone (executed, refunded).
   *
   * The rollback is itself recorded as a history entry.
   */
  async rollback(
    paymentRef: string,
    opts: { triggeredBy?: string; reason?: string } = {},
  ): Promise<TransitionResult> {
    const payment = await this.getOrThrow(paymentRef);
    const currentState = payment.currentState as PaymentState;

    if (['executed', 'refunded'].includes(currentState)) {
      throw new Error(
        `Cannot rollback payment ${paymentRef} in terminal state "${currentState}"`,
      );
    }

    // Find the previous state from history
    const history = await prisma.paymentStateHistory.findMany({
      where: { paymentId: payment.id },
      orderBy: { createdAt: 'desc' },
      take: 2,
    });

    if (history.length < 2) {
      throw new Error(
        `No previous state available to rollback for payment ${paymentRef}`,
      );
    }

    const previousState = history[1].fromState as PaymentState;

    const [updatedPayment, historyEntry] = await prisma.$transaction([
      prisma.paymentRecord.update({
        where: { paymentRef },
        data: {
          currentState: previousState,
          lastTransitionAt: new Date(),
          updatedAt: new Date(),
        },
      }),
      prisma.paymentStateHistory.create({
        data: {
          paymentId: payment.id,
          fromState: currentState,
          toState: previousState,
          triggeredBy: opts.triggeredBy ?? 'system:rollback',
          metadata: opts.reason ?? 'Compensating transaction / rollback',
        },
      }),
    ]);

    console.log(
      `[state-machine] payment ${paymentRef} ROLLED BACK: ${currentState} → ${previousState}`,
    );

    await this.runHooks(paymentRef, currentState, previousState);

    return {
      paymentId: updatedPayment.id,
      paymentRef,
      fromState: currentState,
      toState: previousState,
      historyId: historyEntry.id,
    };
  }

  /**
   * Scan for payments stuck in a state longer than the configured timeout and
   * transition them to `timed_out`.
   *
   * Returns the number of payments timed out.
   */
  async processTimeouts(): Promise<number> {
    const now = new Date();
    let count = 0;

    for (const config of this.timeoutConfigs) {
      const cutoff = new Date(now.getTime() - config.timeoutSeconds * 1000);

      const stalePayments = await prisma.paymentRecord.findMany({
        where: {
          currentState: config.state,
          lastTransitionAt: { lt: cutoff },
        },
      });

      for (const payment of stalePayments) {
        try {
          await this.transition(payment.paymentRef, 'timed_out', {
            triggeredBy: 'system:timeout',
            reason: `State "${config.state}" exceeded timeout of ${config.timeoutSeconds}s`,
          });
          count++;
        } catch (err) {
          console.error(
            `[state-machine] timeout transition failed for ${payment.paymentRef}:`,
            err,
          );
        }
      }
    }

    return count;
  }

  /**
   * Retrieve the complete state history for a payment.
   */
  async getHistory(paymentRef: string) {
    const payment = await this.getOrThrow(paymentRef);
    return prisma.paymentStateHistory.findMany({
      where: { paymentId: payment.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Retrieve a payment record with its full history.
   */
  async getPayment(paymentRef: string) {
    return prisma.paymentRecord.findUnique({
      where: { paymentRef },
      include: { stateHistory: { orderBy: { createdAt: 'asc' } } },
    });
  }

  /**
   * Check whether a given transition is valid without executing it.
   */
  isTransitionAllowed(from: PaymentState, to: PaymentState): boolean {
    return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
  }

  /**
   * Return all valid next states from the given state.
   */
  allowedTransitions(from: PaymentState): PaymentState[] {
    return ALLOWED_TRANSITIONS[from] ?? [];
  }

  /**
   * Return true if the state is terminal (no further transitions possible).
   */
  isTerminal(state: PaymentState): boolean {
    return TERMINAL_STATES.has(state);
  }

  // ─── Convenience transition methods ─────────────────────────────────────────

  async authorise(paymentRef: string, triggeredBy = 'merchant') {
    return this.transition(paymentRef, 'authorised', { triggeredBy });
  }

  async startProcessing(paymentRef: string, triggeredBy = 'system:scheduler') {
    return this.transition(paymentRef, 'processing', { triggeredBy });
  }

  async markExecuted(
    paymentRef: string,
    metadata?: Record<string, unknown>,
    triggeredBy = 'system:scheduler',
  ) {
    return this.transition(paymentRef, 'executed', { triggeredBy, metadata });
  }

  async markFailed(paymentRef: string, reason: string, triggeredBy = 'system') {
    return this.transition(paymentRef, 'failed', { triggeredBy, metadata: { reason } });
  }

  async markRefunded(paymentRef: string, triggeredBy = 'merchant') {
    return this.transition(paymentRef, 'refunded', { triggeredBy });
  }

  async cancel(paymentRef: string, triggeredBy = 'subscriber') {
    return this.transition(paymentRef, 'cancelled', { triggeredBy });
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async getOrThrow(paymentRef: string) {
    const payment = await prisma.paymentRecord.findUnique({ where: { paymentRef } });
    if (!payment) throw new Error(`Payment not found: ${paymentRef}`);
    return payment;
  }

  private assertTransitionAllowed(from: PaymentState, to: PaymentState): void {
    if (!this.isTransitionAllowed(from, to)) {
      const allowed = this.allowedTransitions(from);
      throw new Error(
        `Invalid payment state transition: ${from} → ${to}. ` +
          `Allowed from "${from}": ${allowed.join(', ') || 'none (terminal state)'}`,
      );
    }
  }

  private async runHooks(
    paymentRef: string,
    from: PaymentState,
    to: PaymentState,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    for (const hook of this.hooks) {
      try {
        await hook(paymentRef, from, to, metadata);
      } catch (err) {
        console.error(`[state-machine] hook error for ${paymentRef} (${from}→${to}):`, err);
      }
    }
  }
}
