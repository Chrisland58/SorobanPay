import {
  WebhookQueue,
  InMemoryJobStore,
  WebhookDeliverer,
  MAX_ATTEMPTS,
} from '../src/services/webhookQueue';

describe('Webhook Quarantine, Manual Replay, and Audit History (#1641)', () => {
  let store: InMemoryJobStore;
  let queue: WebhookQueue;
  let stubDeliverer: jest.MockedFunction<WebhookDeliverer>;

  beforeEach(() => {
    store = new InMemoryJobStore();
    stubDeliverer = jest.fn();
    queue = new WebhookQueue(store, stubDeliverer);
  });

  it('quarantines job automatically on exhaustion and records audit record', async () => {
    stubDeliverer.mockResolvedValue({
      success: false,
      statusCode: 504,
      error: 'Gateway Timeout',
    });

    queue.enqueue({
      id: 'job-crash-101',
      merchantAddress: 'GMERCHANT_ALPHA',
      url: 'https://merchant.example.com/webhooks',
      payload: { event: 'payment.executed', amount: '500' },
    });

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await queue.deliver('job-crash-101');
    }

    const job = queue.getJob('job-crash-101');
    expect(job?.status).toBe('quarantined');
    expect(job?.attempts).toBe(MAX_ATTEMPTS);

    const quarantine = queue.getQuarantined('job-crash-101');
    expect(quarantine).toBeDefined();
    expect(quarantine?.reasonCode).toBe('EXCEEDED_MAX_RETRIES');
    expect(quarantine?.auditHistory).toHaveLength(1);
    expect(quarantine?.auditHistory[0].action).toBe('quarantined');
    expect(quarantine?.auditHistory[0].actor).toBe('system.retry_policy');
  });

  it('supports operator manual quarantine with code and reasons', () => {
    queue.enqueue({
      id: 'job-tls-broken',
      merchantAddress: 'GMERCHANT_BETA',
      url: 'https://bad-ssl.merchant.example.com/webhook',
      payload: { test: true },
    });

    const entry = queue.quarantineJob(
      'job-tls-broken',
      'Certificate expired on merchant target host',
      'TLS_CERT_EXPIRED',
      'security-operator',
    );

    expect(entry).toBeDefined();
    expect(entry?.reasonCode).toBe('TLS_CERT_EXPIRED');
    expect(entry?.auditHistory[0].actor).toBe('security-operator');

    const job = queue.getJob('job-tls-broken');
    expect(job?.status).toBe('quarantined');
  });

  it('manually replays quarantined job, resets attempt budget, and appends audit record', () => {
    queue.enqueue({
      id: 'job-replayed',
      merchantAddress: 'GMERCHANT_ALPHA',
      url: 'https://merchant.example.com/webhooks',
      payload: { ok: true },
    });

    queue.quarantineJob(
      'job-replayed',
      'Endpoint maintenance',
      'MAINTENANCE_DOWNTIME',
      'ops-agent-1',
    );

    const replayResult = queue.replayQuarantinedJob('job-replayed', 'ops-agent-2');
    expect(replayResult.replayed).toBe(true);

    const replayedJob = queue.getJob('job-replayed');
    expect(replayedJob?.status).toBe('pending');
    expect(replayedJob?.attempts).toBe(0);

    const record = queue.getQuarantined('job-replayed');
    expect(record?.replayCount).toBe(1);
    expect(record?.auditHistory).toHaveLength(2);
    expect(record?.auditHistory[1].action).toBe('replay_attempted');
    expect(record?.auditHistory[1].actor).toBe('ops-agent-2');
  });

  it('prevents replay if another active live job already exists with same ID', () => {
    queue.enqueue({
      id: 'job-active-duplicate',
      merchantAddress: 'GMERCHANT_ALPHA',
      url: 'https://merchant.example.com/webhooks',
      payload: {},
    });

    queue.quarantineJob('job-active-duplicate', 'Testing guard');

    // First replay transitions to pending
    const firstReplay = queue.replayQuarantinedJob('job-active-duplicate');
    expect(firstReplay.replayed).toBe(true);

    // Second replay while job is active pending is rejected
    const secondReplay = queue.replayQuarantinedJob('job-active-duplicate');
    expect(secondReplay.replayed).toBe(false);
    expect(secondReplay.reason).toContain('live job already active');
  });

  it('enforces strict tenant isolation on quarantined query list', () => {
    queue.enqueue({
      id: 'job-tenant-1',
      merchantAddress: 'MERCHANT_X',
      url: 'https://x.example.com',
      payload: {},
    });
    queue.enqueue({
      id: 'job-tenant-2',
      merchantAddress: 'MERCHANT_Y',
      url: 'https://y.example.com',
      payload: {},
    });

    queue.quarantineJob('job-tenant-1', 'Reason X');
    queue.quarantineJob('job-tenant-2', 'Reason Y');

    const tenantX = queue.listQuarantined('MERCHANT_X');
    expect(tenantX).toHaveLength(1);
    expect(tenantX[0].job.id).toBe('job-tenant-1');

    const tenantY = queue.listQuarantined('MERCHANT_Y');
    expect(tenantY).toHaveLength(1);
    expect(tenantY[0].job.id).toBe('job-tenant-2');
  });
});
