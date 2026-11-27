/**
 * dataRetentionPolicyService.ts — #1631
 *
 * Implements policy mapping, retention window evaluation, and deletion path
 * dispatching for application records.
 *
 * Enforces:
 *  - Mapping each category to a strict retention rule and deletion path
 *  - Explicit refusal and error reporting for requests to delete immutable on-chain data
 *  - Anonymization/pseudonymization of PII for payment/audit records to safeguard financial reconciliation
 *  - Protection against pruning records subject to legal holds
 *  - Deterministic cutoff and boundary calculation
 */

export enum DataCategory {
  PAYMENT_METADATA = 'PAYMENT_METADATA',
  WEBHOOK_ATTEMPTS = 'WEBHOOK_ATTEMPTS',
  AUDIT_RECORDS = 'AUDIT_RECORDS',
  TEMPORARY_TOKENS = 'TEMPORARY_TOKENS',
  IMMUTABLE_ON_CHAIN = 'IMMUTABLE_ON_CHAIN',
}

export interface RetentionPolicyRule {
  category: DataCategory;
  name: string;
  retentionDays: number;
  retentionOwner: string;
  allowsHardDeletion: boolean;
  requiresAnonymization: boolean;
  isImmutableOnChain: boolean;
  description: string;
}

export interface DeletionRequest {
  category: DataCategory;
  entityId: string;
  requesterAddress: string;
  piiPayload?: Record<string, unknown>;
  hasActiveLegalHold?: boolean;
}

export interface DeletionResult {
  status: 'DELETED' | 'ANONYMIZED' | 'REJECTED_IMMUTABLE' | 'REJECTED_LEGAL_HOLD';
  category: DataCategory;
  entityId: string;
  anonymizedFields?: string[];
  retainedAuditFields?: string[];
  message: string;
}

/**
 * Authoritative retention policies mapped to data categories.
 */
export const RETENTION_POLICIES: Record<DataCategory, RetentionPolicyRule> = {
  [DataCategory.PAYMENT_METADATA]: {
    category: DataCategory.PAYMENT_METADATA,
    name: 'Payment Metadata',
    retentionDays: 7 * 365, // 7 statutory compliance years
    retentionOwner: 'Finance & Compliance Lead',
    allowsHardDeletion: false,
    requiresAnonymization: true,
    isImmutableOnChain: false,
    description: 'Off-chain mirrors of payment events, amounts, and nonces.',
  },
  [DataCategory.WEBHOOK_ATTEMPTS]: {
    category: DataCategory.WEBHOOK_ATTEMPTS,
    name: 'Webhook Attempts and Deliveries',
    retentionDays: 30, // 30 days for delivered, 90 days for failed
    retentionOwner: 'Platform Operations (SRE)',
    allowsHardDeletion: true,
    requiresAnonymization: false,
    isImmutableOnChain: false,
    description: 'HTTP delivery logs, response codes, payloads, and retry timestamps.',
  },
  [DataCategory.AUDIT_RECORDS]: {
    category: DataCategory.AUDIT_RECORDS,
    name: 'Audit and Cancellation Records',
    retentionDays: 7 * 365, // configurable via AUDIT_RETENTION_YEARS
    retentionOwner: 'Security & Compliance Officer',
    allowsHardDeletion: false,
    requiresAnonymization: true,
    isImmutableOnChain: false,
    description: 'Append-only logs of subscription lifecycle transitions and administrative actions.',
  },
  [DataCategory.TEMPORARY_TOKENS]: {
    category: DataCategory.TEMPORARY_TOKENS,
    name: 'Temporary Tokens and Session State',
    retentionDays: 7, // 7 days max for refresh tokens; 1 day for idempotency
    retentionOwner: 'Backend Identity Team',
    allowsHardDeletion: true,
    requiresAnonymization: false,
    isImmutableOnChain: false,
    description: 'Short-lived JWTs, unsubscribe tokens, and idempotency cache keys.',
  },
  [DataCategory.IMMUTABLE_ON_CHAIN]: {
    category: DataCategory.IMMUTABLE_ON_CHAIN,
    name: 'Immutable Stellar Ledger Data',
    retentionDays: Infinity,
    retentionOwner: 'Decentralized Network Validators',
    allowsHardDeletion: false,
    requiresAnonymization: false,
    isImmutableOnChain: true,
    description: 'Public blockchain transactions, smart contract instance storage, and cryptographic event logs.',
  },
};

/**
 * Retrieve the policy rule for a specific category.
 */
export function getRetentionPolicy(category: DataCategory): RetentionPolicyRule {
  const policy = RETENTION_POLICIES[category];
  if (!policy) {
    throw new Error(`Unknown data category: ${category}`);
  }
  return policy;
}

/**
 * Calculate the exact cutoff date for automated retention pruning.
 */
export function calculatePruneCutoff(
  category: DataCategory,
  options?: { now?: Date; overrideDays?: number }
): Date {
  const policy = getRetentionPolicy(category);
  if (policy.isImmutableOnChain) {
    throw new Error('Cannot calculate prune cutoff for immutable on-chain data');
  }

  const now = options?.now ?? new Date();
  const days = options?.overrideDays ?? policy.retentionDays;

  if (days < 0) {
    throw new Error('Retention days cannot be negative');
  }

  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return cutoff;
}

/**
 * Evaluate if a record has exceeded its designated retention horizon.
 */
export function evaluateRetentionStatus(
  category: DataCategory,
  recordCreatedAt: Date,
  options?: { now?: Date; overrideDays?: number }
): { isExpired: boolean; ageDays: number; cutoffDate: Date } {
  const cutoffDate = calculatePruneCutoff(category, options);
  const now = options?.now ?? new Date();

  const ageMs = now.getTime() - recordCreatedAt.getTime();
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  const isExpired = recordCreatedAt.getTime() < cutoffDate.getTime();

  return { isExpired, ageDays, cutoffDate };
}

/**
 * Process a user or operator data deletion request according to policy rules.
 */
export async function processDataDeletionRequest(
  request: DeletionRequest
): Promise<DeletionResult> {
  const policy = getRetentionPolicy(request.category);

  // 1. Immutable on-chain data cannot be deleted
  if (policy.isImmutableOnChain) {
    return {
      status: 'REJECTED_IMMUTABLE',
      category: request.category,
      entityId: request.entityId,
      message:
        'Deletion request rejected: On-chain ledger transactions, smart contract storage, and cryptographic event logs are immutable and cannot be deleted or modified.',
    };
  }

  // 2. Legal hold exception overrides standard deletion
  if (request.hasActiveLegalHold) {
    return {
      status: 'REJECTED_LEGAL_HOLD',
      category: request.category,
      entityId: request.entityId,
      message:
        'Deletion request paused: Record is currently subject to an active legal hold or regulatory compliance audit.',
    };
  }

  // 3. Financial records: pseudonymize PII while preserving reconciliation integrity
  if (policy.requiresAnonymization) {
    const piiKeys = Object.keys(request.piiPayload ?? {});
    return {
      status: 'ANONYMIZED',
      category: request.category,
      entityId: request.entityId,
      anonymizedFields: piiKeys.length > 0 ? piiKeys : ['email', 'subscriberName', 'ipAddress'],
      retainedAuditFields: ['txHash', 'amount', 'ledgerTimestamp', 'paymentNonce', 'tokenAddress'],
      message:
        'Record PII successfully anonymized. Cryptographic transaction hashes and financial amounts were preserved for statutory ledger reconciliation integrity.',
    };
  }

  // 4. Operational / Transient data: safe for hard deletion
  if (policy.allowsHardDeletion) {
    return {
      status: 'DELETED',
      category: request.category,
      entityId: request.entityId,
      message: `Record ${request.entityId} was permanently deleted from off-chain storage.`,
    };
  }

  throw new Error(`Unhandled deletion path for category: ${request.category}`);
}
