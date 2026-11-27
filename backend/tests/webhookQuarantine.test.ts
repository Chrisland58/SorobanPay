import {
  WebhookQueue,
  InMemoryJobStore,
  WebhookDeliverer,
  MAX_ATTEMPTS,
} from '../src/services/webhookQueue';

describe('Webhook Quarantine & Policy (#1585)', () => {
  let store: InMemoryJobStore;
  let queue: WebhookQueue;
  let stubDeliverer: jest.MockedFunction<WebhookDeliverer>;

  beforeEach(() => {
    store = new InMemoryJobStore();
    stubDeliverer = jest.fn();
    queue = new WebhookQueue(store, stubDeliverer);
  });

  it('automatically quarantines job when exceeding MAX_ATTEMPTS', async () => {
    stubDeliverer.mockResolvedValue({ success: false, statusCode: 500, error: 'Internal Server Error' });

    queue.enqueue({
      id: 'job-failing',
      merchantAddress: 'GMERCHANT_A',
      url: 'https://api.merchant.com/hook',
      payload: { hello: 'world' },
    });

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await queue.deliver('job-failing');
    }

    const job = queue.getJob('job-failing');
    expect(job).toBeDefined();
    expect(job?.status).toBe('quarantined');
    expect(job?.attempts).toBe(MAX_ATTEMPTS);

    const quarantined = queue.getQuarantined('job-failing');
    expect(quarantined).toBeDefined();
    expect(quarantined?.reasonCode).toBe('EXCEEDED_MAX_RETRIES');
    expect(quarantined?.auditHistory).toHaveLength(1);
    expect(quarantined?.auditHistory[0].action).toBe('quarantined');
  });

  it('supports manual operator quarantine and tenant isolation', () => {
    queue.enqueue({
      id: 'job-1',
      merchantAddress: 'GMERCHANT_A',
      url: 'https://api.merchant.com/hook1',
      payload: {},
    });
    queue.enqueue({
      id: 'job-2',
      merchantAddress: 'GMERCHANT_B',
      url: 'https://api.merchant.com/hook2',
      payload: {},
    });

    const entry = queue.quarantineJob('job-1', 'Target host DNS unresolved', 'ENDPOINT_DNS_FAILURE', 'admin@sorobanpay.com');
    expect(entry).toBeDefined();
    expect(entry?.reasonCode).toBe('ENDPOINT_DNS_FAILURE');

    // Tenant isolation query
    const merchantAQuarantined = queue.listQuarantined('GMERCHANT_A');
    expect(merchantAQuarantined).toHaveLength(1);

    const merchantBQuarantined = queue.listQuarantined('GMERCHANT_B');
    expect(merchantBQuarantined).toHaveLength(0);
  });

  it('replays quarantined job and tracks audit history', () => {
    queue.enqueue({
      id: 'job-quarantine-replay',
      merchantAddress: 'GMERCHANT_A',
      url: 'https://api.merchant.com/hook',
      payload: {},
    });

    queue.quarantineJob('job-quarantine-replay', 'Temporary endpoint outage', 'UPSTREAM_503', 'operator-1');

    const replayRes = queue.replayQuarantinedJob('job-quarantine-replay', 'operator-2');
    expect(replayRes.replayed).toBe(true);

    const job = queue.getJob('job-quarantine-replay');
    expect(job?.status).toBe('pending');
    expect(job?.attempts).toBe(0);

    const quarantineRecord = queue.getQuarantined('job-quarantine-replay');
    expect(quarantineRecord?.replayCount).toBe(1);
    expect(quarantineRecord?.auditHistory).toHaveLength(2);
    expect(quarantineRecord?.auditHistory[1].action).toBe('replay_attempted');
    expect(quarantineRecord?.auditHistory[1].actor).toBe('operator-2');
  });
});
