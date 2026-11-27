/**
 * dataRetentionPolicy.test.ts — #1631
 *
 * Automated test suite for application record data retention and deletion policies.
 *
 * Verifies:
 *  1. Authoritative mapping of every data category to a retention rule and owner.
 *  2. Explicit rejection of requests attempting to delete immutable on-chain data.
 *  3. Anonymization of payment and audit metadata while retaining reconciliation fields.
 *  4. Immediate hard deletion of temporary tokens and transient webhook logs.
 *  5. Legal hold exception overriding scheduled deletion.
 *  6. Boundary calculations (exact millisecond before, on, and after cutoff).
 *  7. Error handling for negative retention horizons or unknown categories.
 */

import {
  DataCategory,
  RETENTION_POLICIES,
  getRetentionPolicy,
  calculatePruneCutoff,
  evaluateRetentionStatus,
  processDataDeletionRequest,
} from '../src/services/dataRetentionPolicyService';

describe('Data Retention and Deletion Policy (#1631)', () => {
  describe('Policy Mapping', () => {
    it('maps every data category to an explicit retention owner and rule', () => {
      const categories = Object.values(DataCategory);

      for (const cat of categories) {
        const policy = getRetentionPolicy(cat);
        expect(policy).toBeDefined();
        expect(policy.name).toBeTruthy();
        expect(policy.retentionOwner).toBeTruthy();
        expect(typeof policy.retentionDays).toBe('number');
        expect(typeof policy.allowsHardDeletion).toBe('boolean');
        expect(typeof policy.requiresAnonymization).toBe('boolean');
        expect(typeof policy.isImmutableOnChain).toBe('boolean');
      }
    });

    it('identifies statutory 7-year retention for payment and audit records', () => {
      const paymentPolicy = getRetentionPolicy(DataCategory.PAYMENT_METADATA);
      expect(paymentPolicy.retentionDays).toBe(7 * 365);
      expect(paymentPolicy.requiresAnonymization).toBe(true);
      expect(paymentPolicy.allowsHardDeletion).toBe(false);

      const auditPolicy = getRetentionPolicy(DataCategory.AUDIT_RECORDS);
      expect(auditPolicy.retentionDays).toBe(7 * 365);
      expect(auditPolicy.requiresAnonymization).toBe(true);
    });

    it('identifies short-term rolling retention for webhooks and tokens', () => {
      const webhookPolicy = getRetentionPolicy(DataCategory.WEBHOOK_ATTEMPTS);
      expect(webhookPolicy.retentionDays).toBeLessThanOrEqual(90);
      expect(webhookPolicy.allowsHardDeletion).toBe(true);

      const tokenPolicy = getRetentionPolicy(DataCategory.TEMPORARY_TOKENS);
      expect(tokenPolicy.retentionDays).toBeLessThanOrEqual(7);
      expect(tokenPolicy.allowsHardDeletion).toBe(true);
    });

    it('throws error for unknown data category', () => {
      expect(() => getRetentionPolicy('INVALID_CATEGORY' as DataCategory)).toThrow(
        /Unknown data category/
      );
    });
  });

  describe('Immutable On-Chain Data Protection', () => {
    it('marks on-chain data as immutable and prevents hard deletion', () => {
      const policy = getRetentionPolicy(DataCategory.IMMUTABLE_ON_CHAIN);
      expect(policy.isImmutableOnChain).toBe(true);
      expect(policy.allowsHardDeletion).toBe(false);
      expect(policy.retentionDays).toBe(Infinity);
    });

    it('rejects deletion requests for immutable on-chain data with technical notice', async () => {
      const result = await processDataDeletionRequest({
        category: DataCategory.IMMUTABLE_ON_CHAIN,
        entityId: 'ledger-tx-hash-0x123',
        requesterAddress: 'GBB4...ABC',
      });

      expect(result.status).toBe('REJECTED_IMMUTABLE');
      expect(result.message).toContain('immutable and cannot be deleted');
    });

    it('throws when attempting to calculate prune cutoff for immutable on-chain data', () => {
      expect(() => calculatePruneCutoff(DataCategory.IMMUTABLE_ON_CHAIN)).toThrow(
        /Cannot calculate prune cutoff for immutable on-chain data/
      );
    });
  });

  describe('Boundary Conditions and Expiry Calculation', () => {
    const fixedNow = new Date('2026-11-21T12:00:00.000Z');

    it('computes exact cutoff date for 30-day retention', () => {
      const cutoff = calculatePruneCutoff(DataCategory.WEBHOOK_ATTEMPTS, {
        now: fixedNow,
        overrideDays: 30,
      });

      const expectedCutoff = new Date(fixedNow.getTime() - 30 * 24 * 60 * 60 * 1000);
      expect(cutoff.toISOString()).toBe(expectedCutoff.toISOString());
    });

    it('correctly evaluates boundary at exact millisecond, 1ms before, and 1ms after', () => {
      const overrideDays = 10;
      const cutoff = calculatePruneCutoff(DataCategory.WEBHOOK_ATTEMPTS, {
        now: fixedNow,
        overrideDays,
      });

      // 1 ms older than cutoff -> expired
      const olderRecord = new Date(cutoff.getTime() - 1);
      const evalOlder = evaluateRetentionStatus(DataCategory.WEBHOOK_ATTEMPTS, olderRecord, {
        now: fixedNow,
        overrideDays,
      });
      expect(evalOlder.isExpired).toBe(true);

      // Exactly at cutoff -> not expired (< cutoff check)
      const exactRecord = new Date(cutoff.getTime());
      const evalExact = evaluateRetentionStatus(DataCategory.WEBHOOK_ATTEMPTS, exactRecord, {
        now: fixedNow,
        overrideDays,
      });
      expect(evalExact.isExpired).toBe(false);

      // 1 ms newer than cutoff -> not expired
      const newerRecord = new Date(cutoff.getTime() + 1);
      const evalNewer = evaluateRetentionStatus(DataCategory.WEBHOOK_ATTEMPTS, newerRecord, {
        now: fixedNow,
        overrideDays,
      });
      expect(evalNewer.isExpired).toBe(false);
    });

    it('rejects negative retention days', () => {
      expect(() =>
        calculatePruneCutoff(DataCategory.WEBHOOK_ATTEMPTS, {
          now: fixedNow,
          overrideDays: -5,
        })
      ).toThrow(/Retention days cannot be negative/);
    });
  });

  describe('User Deletion Requests and Financial Reconciliation', () => {
    it('pseudonymizes PII for payment metadata while preserving reconciliation audit hashes', async () => {
      const result = await processDataDeletionRequest({
        category: DataCategory.PAYMENT_METADATA,
        entityId: 'pay_123',
        requesterAddress: 'GSUBSCRIBER_WALLET',
        piiPayload: {
          email: 'user@example.com',
          subscriberName: 'Jane Doe',
          ipAddress: '192.168.1.1',
        },
      });

      expect(result.status).toBe('ANONYMIZED');
      expect(result.anonymizedFields).toEqual(['email', 'subscriberName', 'ipAddress']);
      expect(result.retainedAuditFields).toEqual(
        expect.arrayContaining(['txHash', 'amount', 'ledgerTimestamp'])
      );
      expect(result.message).toContain('reconciliation integrity');
    });

    it('hard-deletes temporary tokens upon user request', async () => {
      const result = await processDataDeletionRequest({
        category: DataCategory.TEMPORARY_TOKENS,
        entityId: 'session_refresh_token_abc',
        requesterAddress: 'GSUBSCRIBER_WALLET',
      });

      expect(result.status).toBe('DELETED');
      expect(result.message).toContain('permanently deleted');
    });

    it('honors active legal holds and rejects deletion during pending investigation', async () => {
      const result = await processDataDeletionRequest({
        category: DataCategory.AUDIT_RECORDS,
        entityId: 'audit_event_999',
        requesterAddress: 'GUSER_WALLET',
        hasActiveLegalHold: true,
      });

      expect(result.status).toBe('REJECTED_LEGAL_HOLD');
      expect(result.message).toContain('active legal hold');
    });
  });
});
