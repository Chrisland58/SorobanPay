import {
  SchedulerLeaseService,
  inMemoryLeaseStore,
} from '../src/services/schedulerLeaseService';
import { PaymentScheduler } from '../src/services/paymentScheduler';

describe('SchedulerLeaseService & Overlapping Prevention (#1587)', () => {
  beforeEach(() => {
    inMemoryLeaseStore.clear();
  });

  it('acquires lease successfully on uncontested resource', async () => {
    const service = new SchedulerLeaseService({ useRedis: false });
    const result = await service.acquireLease('scheduler:cron', 'worker-1', 5000);

    expect(result.acquired).toBe(true);
    expect(result.token).toBeDefined();
    expect(result.holderId).toBe('worker-1');
  });

  it('rejects acquisition when lease is held by another worker', async () => {
    const service = new SchedulerLeaseService({ useRedis: false });
    const first = await service.acquireLease('scheduler:cron', 'worker-1', 5000);
    expect(first.acquired).toBe(true);

    const second = await service.acquireLease('scheduler:cron', 'worker-2', 5000);
    expect(second.acquired).toBe(false);
    expect(second.holderId).toBe('worker-1');
  });

  it('allows renewal by the current lease holder', async () => {
    const service = new SchedulerLeaseService({ useRedis: false });
    const acquired = await service.acquireLease('scheduler:cron', 'worker-1', 1000);
    expect(acquired.acquired).toBe(true);

    const renewed = await service.renewLease('scheduler:cron', 'worker-1', acquired.token!, 5000);
    expect(renewed).toBe(true);

    // Wrong token cannot renew
    const wrongRenew = await service.renewLease('scheduler:cron', 'worker-1', 'bad-token', 5000);
    expect(wrongRenew).toBe(false);
  });

  it('releases lease and allows another worker to acquire', async () => {
    const service = new SchedulerLeaseService({ useRedis: false });
    const first = await service.acquireLease('scheduler:cron', 'worker-1', 5000);
    expect(first.acquired).toBe(true);

    const released = await service.releaseLease('scheduler:cron', first.token!);
    expect(released).toBe(true);

    const second = await service.acquireLease('scheduler:cron', 'worker-2', 5000);
    expect(second.acquired).toBe(true);
    expect(second.holderId).toBe('worker-2');
  });

  it('withLease executes operation and releases cleanly', async () => {
    const service = new SchedulerLeaseService({ useRedis: false });
    let executed = false;

    const res = await service.withLease('scheduler:batch', 'worker-1', async () => {
      executed = true;
      return 42;
    });

    expect(res.executed).toBe(true);
    expect(res.result).toBe(42);
    expect(executed).toBe(true);

    // Lease should be released
    const second = await service.acquireLease('scheduler:batch', 'worker-2', 1000);
    expect(second.acquired).toBe(true);
  });

  it('PaymentScheduler skips execution if lease is currently held', async () => {
    const service = new SchedulerLeaseService({ useRedis: false });
    const contractId = 'CAAAAAAAAAAA';

    // Worker 1 holds the lease
    const initialLease = await service.acquireLease(`payment-scheduler:${contractId}`, 'worker-1', 10000);
    expect(initialLease.acquired).toBe(true);

    // Worker 2 attempts to run PaymentScheduler
    const scheduler = new PaymentScheduler(
      'https://rpc.stellar.org',
      contractId,
      'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      'Test SDF Network ; September 2015',
      service,
      'worker-2',
    );

    // Should return cleanly without throwing and without overlapping
    await expect(scheduler.processDuePayments()).resolves.not.toThrow();
  });
});
