/**
 * Compatibility Matrix Service
 *
 * Provides authoritative version compatibility resolution, breaking-change
 * lookups, and End-of-Support (EOS) enforcement for SorobanPay integrations.
 *
 * Maintenance Owner: Core Integrations Team (@sorobanpay/integrations-core)
 */

export type SupportStatus = 'active' | 'deprecated' | 'end-of-support' | 'unsupported';

export interface ComponentVersions {
  backendApi: string;      // e.g., 'v1', 'v2'
  contractSchema: number;  // e.g., 1, 2
  contractSemver?: string; // e.g., '1.0.0', '1.1.0'
  frontend?: string;        // e.g., '1.0.0', '1.1.0'
  stellarSdk?: string;      // e.g., '11.x', '12.x'
  node?: string;            // e.g., '18.x', '20.x'
}

export interface CompatibilityRecord {
  id: string;
  backendApi: string;
  contractSchema: number;
  contractSemver: string;
  frontend: string;
  stellarSdk: string;
  node: string;
  status: SupportStatus;
  releaseTag: string;
  artifactDigest: string;
  breakingChanges: string[];
  deprecationDate: string | null; // ISO 8601 date string (YYYY-MM-DD)
  sunsetDate: string | null;      // ISO 8601 date string (YYYY-MM-DD)
  minimumCompatible: {
    backendApi: string;
    contractSchema: number;
    frontend: string;
  };
}

export interface MaintenanceInfo {
  owner: string;
  contact: string;
  cadence: string;
  lastVerified: string;
  releaseUpdateStep: string;
}

export interface EndOfSupportPolicy {
  activeSupportMonths: number;
  deprecationNoticeDays: number;
  securityPatchGracePeriodDays: number;
  policySummary: string;
}

export interface CompatibilityCheckResult {
  isCompatible: boolean;
  status: SupportStatus;
  reasons: string[];
  breakingChanges: string[];
  recommendedUpgrade?: string;
}

export const MAINTENANCE_METADATA: MaintenanceInfo = {
  owner: 'Core Integrations Team (@sorobanpay/integrations-core)',
  contact: 'integrations-team@sorobanpay.org',
  cadence: 'Checked on every release tag and quarterly audit',
  lastVerified: '2026-11-20',
  releaseUpdateStep: 'docs/release-process.md#step-5-compatibility-matrix-update',
};

export const EOS_POLICY: EndOfSupportPolicy = {
  activeSupportMonths: 12,
  deprecationNoticeDays: 90,
  securityPatchGracePeriodDays: 30,
  policySummary:
    'Versions remain in active support for at least 12 months. Deprecation is announced at least 90 days before sunset. Critical security fixes are backported to deprecated versions during a 30-day grace period.',
};

/**
 * Authoritative compatibility registry across Backend API, Contract Schema,
 * and Frontend releases.
 */
export const COMPATIBILITY_MATRIX: CompatibilityRecord[] = [
  {
    id: 'matrix-v1-schema1',
    backendApi: 'v1',
    contractSchema: 1,
    contractSemver: '1.0.0',
    frontend: '1.0.0',
    stellarSdk: '11.x',
    node: '>=18.0.0 <21.0.0',
    status: 'deprecated',
    releaseTag: 'v1.0.0',
    artifactDigest: 'sha256:7a4a92349f6d107b0832ebed92d67b1c17849d70',
    breakingChanges: [
      'Initial baseline release. In-memory data layout differs from schema v2 option fields.',
    ],
    deprecationDate: '2026-10-01',
    sunsetDate: '2026-12-31',
    minimumCompatible: {
      backendApi: 'v1',
      contractSchema: 1,
      frontend: '1.0.0',
    },
  },
  {
    id: 'matrix-v1-schema2',
    backendApi: 'v1',
    contractSchema: 2,
    contractSemver: '1.1.0',
    frontend: '1.1.0',
    stellarSdk: '11.x',
    node: '>=18.0.0 <21.0.0',
    status: 'active',
    releaseTag: 'v1.1.0',
    artifactDigest: 'sha256:5f4020c9a3b15a45802d2b1e484537f8574e6d3a',
    breakingChanges: [
      'SubscriptionData gains grace_period, paused_until, overdue_since Option fields.',
      'Requires migrate(admin) on-chain execution to update instance storage schema to 2.',
    ],
    deprecationDate: null,
    sunsetDate: null,
    minimumCompatible: {
      backendApi: 'v1',
      contractSchema: 2,
      frontend: '1.0.0',
    },
  },
  {
    id: 'matrix-v2-schema2',
    backendApi: 'v2',
    contractSchema: 2,
    contractSemver: '1.1.0',
    frontend: '1.2.0',
    stellarSdk: '12.x',
    node: '>=20.0.0',
    status: 'active',
    releaseTag: 'v1.2.0',
    artifactDigest: 'sha256:9dec89a1c2b3e4f5a6b7c8d9e0f1a2b3c4d5e6f7',
    breakingChanges: [
      'Backend API v2 responses use strictly typed JSON ISO-8601 date-time envelopes.',
      'Webhooks v2 require Ed25519 or HMAC-SHA256 signature headers.',
    ],
    deprecationDate: null,
    sunsetDate: null,
    minimumCompatible: {
      backendApi: 'v2',
      contractSchema: 2,
      frontend: '1.2.0',
    },
  },
];

/**
 * Returns the full authoritative compatibility matrix.
 */
export function getCompatibilityMatrix(): CompatibilityRecord[] {
  return [...COMPATIBILITY_MATRIX];
}

/**
 * Returns maintenance ownership and release process references.
 */
export function getMaintenanceMetadata(): MaintenanceInfo {
  return { ...MAINTENANCE_METADATA };
}

/**
 * Returns the End-of-Support policy definition.
 */
export function getEndOfSupportPolicy(): EndOfSupportPolicy {
  return { ...EOS_POLICY };
}

/**
 * Evaluates whether a combination of backend, contract schema, and frontend is compatible.
 */
export function checkCompatibility(
  versions: ComponentVersions,
  evaluationDate: Date = new Date()
): CompatibilityCheckResult {
  const reasons: string[] = [];
  const breakingChanges: string[] = [];

  // 1. Locate matching entries by backend API and contract schema
  const matching = COMPATIBILITY_MATRIX.filter(
    (record) =>
      record.backendApi.toLowerCase() === versions.backendApi.toLowerCase() &&
      record.contractSchema === versions.contractSchema
  );

  if (matching.length === 0) {
    return {
      isCompatible: false,
      status: 'unsupported',
      reasons: [
        `No compatibility profile exists for Backend API '${versions.backendApi}' with Contract Schema '${versions.contractSchema}'.`,
      ],
      breakingChanges: [],
      recommendedUpgrade: 'Upgrade to Backend API v1 or v2 with Contract Schema 2 (release v1.1.0+).',
    };
  }

  // Pick candidate record (prioritize active over deprecated)
  const candidate = matching.find((r) => r.status === 'active') || matching[0];

  // 2. Check End-of-Support / Sunset timeline
  if (candidate.sunsetDate) {
    const sunset = new Date(candidate.sunsetDate);
    if (evaluationDate > sunset) {
      return {
        isCompatible: false,
        status: 'end-of-support',
        reasons: [
          `Combination '${candidate.id}' reached End-of-Support on ${candidate.sunsetDate}.`,
        ],
        breakingChanges: candidate.breakingChanges,
        recommendedUpgrade: 'Upgrade to active matrix profile matrix-v1-schema2 or matrix-v2-schema2.',
      };
    }
  }

  // 3. Frontend version check if supplied
  if (versions.frontend) {
    const minFrontend = candidate.minimumCompatible.frontend;
    if (compareSemver(versions.frontend, minFrontend) < 0) {
      reasons.push(
        `Frontend version '${versions.frontend}' is below minimum compatible version '${minFrontend}' for profile '${candidate.id}'.`
      );
    }
  }

  // 4. Contract semver check if supplied
  if (versions.contractSemver) {
    if (compareSemver(versions.contractSemver, candidate.contractSemver) < 0) {
      reasons.push(
        `Contract semver '${versions.contractSemver}' is older than validated release '${candidate.contractSemver}'.`
      );
    }
  }

  breakingChanges.push(...candidate.breakingChanges);

  const isCompatible = reasons.length === 0;
  return {
    isCompatible,
    status: isCompatible ? candidate.status : 'incompatible',
    reasons,
    breakingChanges,
    recommendedUpgrade: candidate.status === 'deprecated'
      ? 'Matrix profile is deprecated. Plan upgrade before sunset date: ' + candidate.sunsetDate
      : undefined,
  };
}

/**
 * Simple semantic version comparator (MAJOR.MINOR.PATCH).
 */
export function compareSemver(v1: string, v2: string): number {
  const clean1 = v1.replace(/^v/, '').split('-')[0];
  const clean2 = v2.replace(/^v/, '').split('-')[0];
  const p1 = clean1.split('.').map(Number);
  const p2 = clean2.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const a = p1[i] || 0;
    const b = p2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}
