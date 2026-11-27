import {
  SchedulerLeaseService,
  InMemoryLeaseStore,
} from '../src/services/schedulerLeaseService';

describe('Scheduler Lease Recovery after Worker Termination (#1643)', () => {
  let store: InMemoryLeaseStore;
  let service: SchedulerLeaseService;

  beforeEach(() => {
    store = new InMemoryLeaseStore();
    service = new SchedulerLeaseService({ useRedis: false, store });
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('blocks second worker while first worker holds active lease', async () => {
    const worker1Lease = await service.acquireLease('payment-scheduler', 'worker-1', 5000);
    expect(worker1Lease.acquired).toBe(true);

    const worker2Lease = await service.acquireLease('payment-scheduler', 'worker-2', 5000);
    expect(worker2Lease.acquired).toBe(false);
    expect(worker2Lease.holderId).toBe('worker-1');
  });

  it('recovers lease automatically when worker-1 crashes without releasing after TTL elapses', async () => {
    const worker1Lease = await service.acquireLease('payment-scheduler', 'worker-1', 3000);
    expect(worker1Lease.acquired).toBe(true);

    // Worker 1 abruptly terminates (e.g. process SIGKILL) — releaseLease is never called

    // Advance time before expiry: worker-2 is still blocked
    jest.advanceTimersByTime(2000);
    const prematureAttempt = await service.acquireLease('payment-scheduler', 'worker-2', 3000);
    expect(prematureAttempt.acquired).toBe(false);

    // Advance time past the 3000ms TTL
    jest.advanceTimersByTime(1001);

    // Worker 2 attempts acquisition and successfully recovers the abandoned lease
    const recoveryAttempt = await service.acquireLease('payment-scheduler', 'worker-2', 3000);
    expect(recoveryAttempt.acquired).toBe(true);
    expect(recoveryAttempt.holderId).toBe('worker-2');
  });

  it('prevents crashed worker from renewing after lease has been recovered by another worker', async () => {
    const worker1Lease = await service.acquireLease('payment-scheduler', 'worker-1', 2000);
    expect(worker1Lease.acquired).toBe(true);

    // Worker 1 freezes, time advances past TTL
    jest.advanceTimersByTime(2500);

    // Worker 2 acquires the lease
    const worker2Lease = await service.acquireLease('payment-scheduler', 'worker-2', 5000);
    expect(worker2Lease.acquired).toBe(true);

    // Worker 1 wakes up and attempts renewal — must fail
    const lateRenewal = await service.renewLease(
      'payment-scheduler',
      'worker-1',
      worker1Lease.token!,
      5000,
    );
    expect(lateRenewal).toBe(false);

    // Worker 1 attempts release with stale token — must not release worker-2's lease
    const staleRelease = await service.releaseLease('payment-scheduler', worker1Lease.token!);
    expect(staleRelease).toBe(false);

    // Worker 2's lease remains valid
    const currentLease = store.get('payment-scheduler');
    expect(currentLease?.holderId).toBe('worker-2');
  });
});
