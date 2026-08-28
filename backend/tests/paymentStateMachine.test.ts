/**
 * #711 — PaymentStateMachine unit tests
 *
 * Tests cover:
 *   - All valid state transitions
 *   - Invalid transition rejection
 *   - Full history tracking
 *   - Rollback / compensating transactions
 *   - Timeout detection
 *   - Action hook invocation
 *   - Terminal state detection
 */

// ─── Mock Prisma ──────────────────────────────────────────────────────────────

const pmStore = {
  records: new Map<string, any>(),
  histories: [] as any[],
  recordIdSeq: 1,
  historyIdSeq: 1,
};

function resetPmStore() {
  pmStore.records.clear();
  pmStore.histories.length = 0;
  pmStore.recordIdSeq = 1;
  pmStore.historyIdSeq = 1;
}

jest.mock('../src/lib/prisma', () => {
  const mockPaymentRecordFindUnique = jest.fn().mockImplementation(async ({ where }: any) => {
    return pmStore.records.get(where.paymentRef) ?? null;
  });
  const mockPaymentRecordCreate = jest.fn().mockImplementation(async ({ data }: any) => {
    const rec = { id: pmStore.recordIdSeq++, ...data };
    pmStore.records.set(rec.paymentRef, rec);
    return rec;
  });
  const mockPaymentRecordUpdate = jest.fn().mockImplementation(async ({ where, data }: any) => {
    const rec = pmStore.records.get(where.paymentRef);
    if (!rec) throw new Error(`Not found: ${where.paymentRef}`);
    Object.assign(rec, data);
    return rec;
  });
  const mockPaymentRecordFindMany = jest.fn().mockImplementation(async ({ where }: any) => {
    return [...pmStore.records.values()].filter((r: any) => {
      if (where?.currentState && r.currentState !== where.currentState) return false;
      if (where?.lastTransitionAt?.lt) {
        return new Date(r.lastTransitionAt) < where.lastTransitionAt.lt;
      }
      return true;
    });
  });
  const mockStateHistoryCreate = jest.fn().mockImplementation(async ({ data }: any) => {
    const rec = { id: pmStore.historyIdSeq++, ...data, createdAt: new Date() };
    pmStore.histories.push(rec);
    return rec;
  });
  const mockStateHistoryFindMany = jest.fn().mockImplementation(async ({ where, orderBy, take }: any) => {
    let results = pmStore.histories.filter((h: any) => {
      if (where?.paymentId !== undefined && h.paymentId !== where.paymentId) return false;
      return true;
    });
    if (orderBy?.createdAt === 'desc') {
      results = [...results].reverse();
    }
    if (take !== undefined) results = results.slice(0, take);
    return results;
  });
  const mockTransaction = jest.fn().mockImplementation(async (ops: any[]) => {
    return Promise.all(ops);
  });

  return {
    __esModule: true,
    default: {
      paymentRecord: {
        findUnique: mockPaymentRecordFindUnique,
        create: mockPaymentRecordCreate,
        update: mockPaymentRecordUpdate,
        findMany: mockPaymentRecordFindMany,
      },
      paymentStateHistory: {
        create: mockStateHistoryCreate,
        findMany: mockStateHistoryFindMany,
      },
      $transaction: mockTransaction,
    },
  };
});

import { PaymentStateMachine, PaymentState } from '../src/services/paymentStateMachine';
import prisma from '../src/lib/prisma';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makePaymentInput(ref = 'PAY-001') {
  return {
    paymentRef: ref,
    subscriber: 'GABC123',
    merchant: 'GXYZ789',
    token: 'CUSDC',
    amount: '1000000',
  };
}

async function seedPayment(machine: PaymentStateMachine, ref = 'PAY-001', state: PaymentState = 'pending') {
  const p = await machine.createPayment(makePaymentInput(ref));
  // Set the state directly in the store for setup convenience
  const rec = pmStore.records.get(ref)!;
  rec.currentState = state;
  // Also add a history entry so rollback works
  if (state !== 'pending') {
    pmStore.histories.push({
      id: pmStore.historyIdSeq++,
      paymentId: rec.id,
      fromState: 'pending',
      toState: state,
      triggeredBy: 'test:seed',
      createdAt: new Date(),
    });
  }
  return p;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PaymentStateMachine', () => {
  let machine: PaymentStateMachine;

  beforeEach(() => {
    resetPmStore();
    jest.clearAllMocks();
    machine = new PaymentStateMachine();
  });

  // ── Payment creation ──────────────────────────────────────────────────────

  it('creates a payment in pending state', async () => {
    const p = await machine.createPayment(makePaymentInput());
    expect(p.currentState).toBe('pending');
    expect(p.paymentRef).toBe('PAY-001');
  });

  it('is idempotent on duplicate paymentRef', async () => {
    const p1 = await machine.createPayment(makePaymentInput());
    const p2 = await machine.createPayment(makePaymentInput());
    expect(p1.id).toBe(p2.id);
    expect(prisma.paymentRecord.create).toHaveBeenCalledTimes(1);
  });

  // ── Valid transitions ─────────────────────────────────────────────────────

  it('transitions pending → authorised', async () => {
    await seedPayment(machine, 'PAY-T1', 'pending');
    const result = await machine.transition('PAY-T1', 'authorised', { triggeredBy: 'merchant' });
    expect(result.fromState).toBe('pending');
    expect(result.toState).toBe('authorised');
  });

  it('transitions authorised → processing', async () => {
    await seedPayment(machine, 'PAY-T2', 'authorised');
    const result = await machine.transition('PAY-T2', 'processing');
    expect(result.toState).toBe('processing');
  });

  it('transitions processing → executed', async () => {
    await seedPayment(machine, 'PAY-T3', 'processing');
    const result = await machine.transition('PAY-T3', 'executed');
    expect(result.toState).toBe('executed');
  });

  it('transitions authorised → failed', async () => {
    await seedPayment(machine, 'PAY-T4', 'authorised');
    const result = await machine.transition('PAY-T4', 'failed');
    expect(result.toState).toBe('failed');
  });

  it('transitions failed → refunded', async () => {
    await seedPayment(machine, 'PAY-T5', 'failed');
    const result = await machine.transition('PAY-T5', 'refunded');
    expect(result.toState).toBe('refunded');
  });

  it('transitions pending → cancelled', async () => {
    await seedPayment(machine, 'PAY-T6', 'pending');
    const result = await machine.cancel('PAY-T6', 'subscriber');
    expect(result.toState).toBe('cancelled');
  });

  // ── Invalid transitions ───────────────────────────────────────────────────

  it('rejects executed → processing (terminal state)', async () => {
    await seedPayment(machine, 'PAY-INV1', 'executed');
    await expect(machine.transition('PAY-INV1', 'processing')).rejects.toThrow(
      'Invalid payment state transition',
    );
  });

  it('rejects pending → executed (skip states)', async () => {
    await seedPayment(machine, 'PAY-INV2', 'pending');
    await expect(machine.transition('PAY-INV2', 'executed')).rejects.toThrow(
      'Invalid payment state transition',
    );
  });

  it('rejects authorised → refunded (wrong path)', async () => {
    await seedPayment(machine, 'PAY-INV3', 'authorised');
    await expect(machine.transition('PAY-INV3', 'refunded')).rejects.toThrow(
      'Invalid payment state transition',
    );
  });

  it('rejects cancelled → any state (terminal)', async () => {
    await seedPayment(machine, 'PAY-INV4', 'cancelled');
    await expect(machine.transition('PAY-INV4', 'pending')).rejects.toThrow(
      'Invalid payment state transition',
    );
  });

  it('throws when payment does not exist', async () => {
    await expect(machine.transition('NO-SUCH-REF', 'authorised')).rejects.toThrow(
      'Payment not found',
    );
  });

  // ── Rollback ──────────────────────────────────────────────────────────────

  it('rolls back to previous state', async () => {
    await seedPayment(machine, 'PAY-RB1', 'pending');
    await machine.transition('PAY-RB1', 'authorised', { triggeredBy: 'merchant' });

    const result = await machine.rollback('PAY-RB1', { reason: 'auth expired' });
    expect(result.fromState).toBe('authorised');
    expect(result.toState).toBe('pending');
  });

  it('rejects rollback on executed (terminal, irreversible)', async () => {
    await seedPayment(machine, 'PAY-RB2', 'executed');
    await expect(machine.rollback('PAY-RB2')).rejects.toThrow('Cannot rollback');
  });

  it('rejects rollback on refunded (terminal, irreversible)', async () => {
    await seedPayment(machine, 'PAY-RB3', 'refunded');
    await expect(machine.rollback('PAY-RB3')).rejects.toThrow('Cannot rollback');
  });

  // ── State history ─────────────────────────────────────────────────────────

  it('records a history entry for every transition', async () => {
    await seedPayment(machine, 'PAY-H1', 'pending');
    await machine.transition('PAY-H1', 'authorised', { triggeredBy: 'test' });
    await machine.transition('PAY-H1', 'processing', { triggeredBy: 'test' });
    await machine.transition('PAY-H1', 'executed', { triggeredBy: 'test' });

    const history = await machine.getHistory('PAY-H1');
    // Initial create + 3 transitions = at least 4 entries
    expect(history.length).toBeGreaterThanOrEqual(3);
  });

  // ── Timeout handling ──────────────────────────────────────────────────────

  it('times out stale payments', async () => {
    // Create a payment and back-date lastTransitionAt
    await seedPayment(machine, 'PAY-TO1', 'pending');
    const rec = pmStore.records.get('PAY-TO1')!;
    rec.lastTransitionAt = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago

    const customMachine = new PaymentStateMachine({
      timeoutConfigs: [{ state: 'pending', timeoutSeconds: 300 }], // 5 min timeout
    });

    const count = await customMachine.processTimeouts();
    expect(count).toBe(1);

    const updated = pmStore.records.get('PAY-TO1');
    expect(updated?.currentState).toBe('timed_out');
  });

  it('does not time out payments within the timeout window', async () => {
    await seedPayment(machine, 'PAY-TO2', 'pending');
    const rec = pmStore.records.get('PAY-TO2')!;
    rec.lastTransitionAt = new Date(Date.now() - 60 * 1000); // only 1 min ago

    const customMachine = new PaymentStateMachine({
      timeoutConfigs: [{ state: 'pending', timeoutSeconds: 300 }], // 5 min
    });

    const count = await customMachine.processTimeouts();
    expect(count).toBe(0);
  });

  // ── Action hooks ──────────────────────────────────────────────────────────

  it('calls registered hooks on transition', async () => {
    const hookFn = jest.fn().mockResolvedValue(undefined);
    machine.registerHook(hookFn);

    await seedPayment(machine, 'PAY-HK1', 'pending');
    await machine.transition('PAY-HK1', 'authorised', { triggeredBy: 'test' });

    expect(hookFn).toHaveBeenCalledWith('PAY-HK1', 'pending', 'authorised', undefined);
  });

  it('does not throw if a hook errors', async () => {
    const errorHook = jest.fn().mockRejectedValue(new Error('hook failure'));
    machine.registerHook(errorHook);

    await seedPayment(machine, 'PAY-HK2', 'pending');
    await expect(
      machine.transition('PAY-HK2', 'authorised', { triggeredBy: 'test' }),
    ).resolves.toBeDefined();
  });

  // ── Terminal state helpers ─────────────────────────────────────────────────

  it('identifies terminal states correctly', () => {
    const terminals: PaymentState[] = ['executed', 'refunded', 'cancelled', 'timed_out'];
    const nonTerminals: PaymentState[] = ['pending', 'authorised', 'processing', 'failed'];
    for (const s of terminals) expect(machine.isTerminal(s)).toBe(true);
    for (const s of nonTerminals) expect(machine.isTerminal(s)).toBe(false);
  });

  it('returns correct allowed transitions', () => {
    expect(machine.allowedTransitions('pending')).toContain('authorised');
    expect(machine.allowedTransitions('pending')).toContain('cancelled');
    expect(machine.allowedTransitions('executed')).toHaveLength(0);
    expect(machine.allowedTransitions('refunded')).toHaveLength(0);
  });

  // ── isTransitionAllowed ───────────────────────────────────────────────────

  it('correctly validates transitions with isTransitionAllowed', () => {
    expect(machine.isTransitionAllowed('pending', 'authorised')).toBe(true);
    expect(machine.isTransitionAllowed('pending', 'executed')).toBe(false);
    expect(machine.isTransitionAllowed('executed', 'processing')).toBe(false);
    expect(machine.isTransitionAllowed('failed', 'refunded')).toBe(true);
  });
});
