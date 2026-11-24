/**
 * securityPolicyService.ts
 *
 * Operational engine and validation utilities for SorobanPay's Security Reporting
 * and Vulnerability Response Policy (#1633).
 */

export type ReportCategory = 'SECURITY_VULNERABILITY' | 'PUBLIC_BUG' | 'SUPPORT_REQUEST';

export type VulnerabilitySeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface SecurityContactPath {
  channel: 'GITHUB_SECURITY_ADVISORY' | 'SECURITY_EMAIL';
  target: string;
  isMaintained: boolean;
  pgpKeyId?: string;
  expectedAcknowledgmentHours: number;
}

export interface SeveritySLAs {
  acknowledgmentHours: number;
  triageHours: number;
  remediationDays: number;
  advisoryPublicationDays: number;
}

export const MAINTAINED_CONTACT_PATHS: SecurityContactPath[] = [
  {
    channel: 'GITHUB_SECURITY_ADVISORY',
    target: 'https://github.com/Chrisland58/SorobanPay/security/advisories/new',
    isMaintained: true,
    expectedAcknowledgmentHours: 24,
  },
  {
    channel: 'SECURITY_EMAIL',
    target: 'security@sorobanpay.org',
    isMaintained: true,
    pgpKeyId: '0x4A6B8F9C2D1E5A7B',
    expectedAcknowledgmentHours: 48,
  },
];

export const SEVERITY_SLAS: Record<VulnerabilitySeverity, SeveritySLAs> = {
  CRITICAL: {
    acknowledgmentHours: 24,
    triageHours: 24,
    remediationDays: 7,
    advisoryPublicationDays: 14,
  },
  HIGH: {
    acknowledgmentHours: 48,
    triageHours: 48,
    remediationDays: 14,
    advisoryPublicationDays: 30,
  },
  MEDIUM: {
    acknowledgmentHours: 48,
    triageHours: 72,
    remediationDays: 30,
    advisoryPublicationDays: 60,
  },
  LOW: {
    acknowledgmentHours: 72,
    triageHours: 96,
    remediationDays: 90,
    advisoryPublicationDays: 90,
  },
};

export const IN_SCOPE_TARGETS = [
  'contracts/subscription/src/',
  'backend/src/',
  'frontend/src/',
  'deploy/k8s/',
  'indexer cursor & webhook delivery engine',
  'SEP-41 token transfer & allowance state',
];

export const OUT_OF_SCOPE_TARGETS = [
  'Third-party Stellar RPC infrastructure outages',
  'Freighter / wallet extension internal vulnerabilities',
  'Phishing or spoofing of the SorobanPay domain',
  'Automated scanner dumps without proof-of-concept impact',
  'Denial of service through public Stellar network gas exhaustion',
  'Social engineering targeting maintainers',
];

/**
 * Classify incoming issues to distinguish private security vulnerabilities
 * from public bug reports and user support requests.
 */
export function classifyReport(content: {
  title?: string;
  description?: string;
  stepsToReproduce?: string;
}): {
  category: ReportCategory;
  recommendedChannel: string;
  reason: string;
} {
  const fullText = `${content.title || ''} ${content.description || ''} ${content.stepsToReproduce || ''}`.toLowerCase();

  if (!fullText.trim()) {
    return {
      category: 'SUPPORT_REQUEST',
      recommendedChannel: 'https://github.com/Chrisland58/SorobanPay/discussions',
      reason: 'Empty submission treated as inquiry. Please provide details.',
    };
  }

  // Security vulnerability triggers
  const securityKeywords = [
    'vulnerability',
    'exploit',
    'bypass auth',
    'unauthorized',
    'privilege escalation',
    'drain funds',
    'secret leak',
    'private key',
    'signature replay',
    'remote code execution',
    'injection',
    'sql injection',
    'timing attack',
    'reentrancy',
    'denial of service against contract',
  ];

  const hasSecurityKeyword = securityKeywords.some((kw) => fullText.includes(kw));

  if (hasSecurityKeyword) {
    return {
      category: 'SECURITY_VULNERABILITY',
      recommendedChannel: 'https://github.com/Chrisland58/SorobanPay/security/advisories/new or security@sorobanpay.org',
      reason: 'Contains potential vulnerability or exploit indicators. Do NOT file publicly.',
    };
  }

  // Support inquiry triggers
  const supportKeywords = [
    'how do i',
    'help with setup',
    'friendbot',
    'faucet',
    'where is',
    'question',
    'failing to install freighter',
    'testnet balance',
    'configuration advice',
  ];

  const hasSupportKeyword = supportKeywords.some((kw) => fullText.includes(kw));
  if (hasSupportKeyword) {
    return {
      category: 'SUPPORT_REQUEST',
      recommendedChannel: 'https://github.com/Chrisland58/SorobanPay/discussions',
      reason: 'Classified as user support request or configuration inquiry.',
    };
  }

  // Default to public bug report
  return {
    category: 'PUBLIC_BUG',
    recommendedChannel: 'https://github.com/Chrisland58/SorobanPay/issues/new?template=bug_report.md',
    reason: 'Functional bug or unexpected behavior without direct security vulnerability.',
  };
}

/**
 * Validate that an advisory text does not expose sensitive incident details
 * such as database credentials, raw tokens, internal IP addresses, or subscriber secrets.
 */
export function sanitizePublicAdvisory(rawAdvisoryText: string): {
  isSafeToPublish: boolean;
  sanitizedText: string;
  redactedItems: string[];
} {
  const redactedItems: string[] = [];
  let sanitized = rawAdvisoryText;

  // Pattern 1: Database connection strings / passwords
  const dbRegex = /postgres(ql)?:\/\/[^\s]+/gi;
  if (dbRegex.test(sanitized)) {
    sanitized = sanitized.replace(dbRegex, '[REDACTED_DATABASE_URL]');
    redactedItems.push('DATABASE_URL');
  }

  // Pattern 2: Secrets or API keys (ghp_, sk_, hex secrets)
  const secretRegex = /(ghp_[a-zA-Z0-9]{36}|OPERATOR_SECRET\s*=\s*[a-zA-Z0-9_]+|WEBHOOK_SECRET\s*=\s*[a-zA-Z0-9_]+)/gi;
  if (secretRegex.test(sanitized)) {
    sanitized = sanitized.replace(secretRegex, '[REDACTED_SECRET]');
    redactedItems.push('SECRET_KEY');
  }

  // Pattern 3: Internal IP addresses
  const ipRegex = /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g;
  if (ipRegex.test(sanitized)) {
    sanitized = sanitized.replace(ipRegex, '[REDACTED_INTERNAL_IP]');
    redactedItems.push('INTERNAL_IP');
  }

  return {
    isSafeToPublish: redactedItems.length === 0,
    sanitizedText: sanitized,
    redactedItems,
  };
}
