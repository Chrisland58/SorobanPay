import {
  AdminAuditService,
  redactSensitiveData,
  computeDiff,
} from '../src/services/adminAuditService';

describe('Admin Audit Service (#1595)', () => {
  let auditService: AdminAuditService;

  beforeEach(() => {
    auditService = new AdminAuditService();
  });

  it('records audit entry with structured diff between before and after states', async () => {
    const record = await auditService.recordAudit({
      actor: 'admin@platform.com',
      target: 'platform:protocol_fee',
      action: 'update_fee_bps',
      before: { fee_bps: 100, collector: 'GAAA' },
      after: { fee_bps: 250, collector: 'GAAA' },
      correlationId: 'req-abc-123',
    });

    expect(record.id).toBeDefined();
    expect(record.correlationId).toBe('req-abc-123');
    expect(record.diff).toEqual({
      fee_bps: { before: 100, after: 250 },
    });
  });

  it('redacts sensitive fields in before, after, and metadata structures', async () => {
    const record = await auditService.recordAudit({
      actor: 'admin@platform.com',
      target: 'merchant:webhook_endpoint',
      action: 'update_secret',
      before: { webhook_url: 'https://api.example.com', secretKey: 'super_secret_1' },
      after: { webhook_url: 'https://api.example.com', secretKey: 'super_secret_2' },
    });

    expect(record.before.secretKey).toBe('[REDACTED]');
    expect(record.after.secretKey).toBe('[REDACTED]');
    expect(record.diff.secretKey).toBeUndefined(); // Both redacted, no plaintext diff leaked
  });

  it('withAtomicAudit successfully records mutation and audit together', async () => {
    let mutated = false;
    const { result, auditRecord } = await auditService.withAtomicAudit(
      {
        actor: 'operator-1',
        target: 'tenant:MERCHANT_1',
        action: 'set_rate_limit',
        before: { limit: 60 },
      },
      async () => {
        mutated = true;
        return {
          result: 'SUCCESS',
          after: { limit: 120 },
        };
      },
    );

    expect(mutated).toBe(true);
    expect(result).toBe('SUCCESS');
    expect(auditRecord.diff.limit).toEqual({ before: 60, after: 120 });
    expect(auditService.getAuditHistory('tenant:MERCHANT_1')).toHaveLength(1);
  });

  it('withAtomicAudit does not record audit when mutation fails', async () => {
    await expect(
      auditService.withAtomicAudit(
        {
          actor: 'operator-1',
          target: 'tenant:MERCHANT_1',
          action: 'failing_action',
          before: {},
        },
        async () => {
          throw new Error('Database transaction aborted');
        },
      ),
    ).rejects.toThrow('Database transaction aborted');

    expect(auditService.getAuditHistory('tenant:MERCHANT_1')).toHaveLength(0);
  });
});
