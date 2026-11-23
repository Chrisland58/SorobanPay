import {
  checkCompatibility,
  getCompatibilityMatrix,
  getMaintenanceMetadata,
  getEndOfSupportPolicy,
  compareSemver,
  COMPATIBILITY_MATRIX,
  MAINTENANCE_METADATA,
  EOS_POLICY,
} from '../src/services/compatibilityService';

describe('Compatibility Matrix Service', () => {
  describe('getCompatibilityMatrix', () => {
    it('returns the authoritative matrix records', () => {
      const records = getCompatibilityMatrix();
      expect(records.length).toBeGreaterThanOrEqual(3);
      for (const rec of records) {
        expect(rec.id).toBeDefined();
        expect(rec.backendApi).toBeDefined();
        expect(rec.contractSchema).toBeGreaterThanOrEqual(1);
        expect(rec.releaseTag).toMatch(/^v\d+\.\d+\.\d+/);
        expect(rec.artifactDigest).toMatch(/^sha256:[a-f0-9]{40,64}/);
        expect(Array.isArray(rec.breakingChanges)).toBe(true);
        expect(rec.minimumCompatible).toBeDefined();
        expect(rec.minimumCompatible.frontend).toBeDefined();
      }
    });

    it('contains documented maintenance ownership and update step', () => {
      const meta = getMaintenanceMetadata();
      expect(meta.owner).toContain('Core Integrations Team');
      expect(meta.contact).toBe('integrations-team@sorobanpay.org');
      expect(meta.releaseUpdateStep).toContain('docs/release-process.md');
      expect(meta.lastVerified).toBeDefined();
    });

    it('contains explicit end-of-support policy parameters', () => {
      const policy = getEndOfSupportPolicy();
      expect(policy.activeSupportMonths).toBe(12);
      expect(policy.deprecationNoticeDays).toBe(90);
      expect(policy.securityPatchGracePeriodDays).toBe(30);
      expect(policy.policySummary.length).toBeGreaterThan(20);
    });
  });

  describe('compareSemver', () => {
    it('correctly compares semantic versions', () => {
      expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
      expect(compareSemver('1.1.0', '1.0.0')).toBe(1);
      expect(compareSemver('1.0.0', '1.1.0')).toBe(-1);
      expect(compareSemver('2.0.0', '1.9.9')).toBe(1);
      expect(compareSemver('v1.2.0', '1.2.0')).toBe(0);
    });
  });

  describe('checkCompatibility', () => {
    it('approves currently active combination (v1 + schema 2 + frontend 1.1.0)', () => {
      const res = checkCompatibility({
        backendApi: 'v1',
        contractSchema: 2,
        frontend: '1.1.0',
      });
      expect(res.isCompatible).toBe(true);
      expect(res.status).toBe('active');
      expect(res.reasons).toHaveLength(0);
      expect(res.breakingChanges.length).toBeGreaterThan(0);
    });

    it('approves API v2 combination (v2 + schema 2 + frontend 1.2.0)', () => {
      const res = checkCompatibility({
        backendApi: 'v2',
        contractSchema: 2,
        frontend: '1.2.0',
      });
      expect(res.isCompatible).toBe(true);
      expect(res.status).toBe('active');
      expect(res.reasons).toHaveLength(0);
    });

    it('flags deprecated combination before its sunset date', () => {
      // Evaluation date before sunset (e.g., 2026-11-15 < 2026-12-31)
      const res = checkCompatibility(
        {
          backendApi: 'v1',
          contractSchema: 1,
          frontend: '1.0.0',
        },
        new Date('2026-11-15T00:00:00Z')
      );
      expect(res.isCompatible).toBe(true);
      expect(res.status).toBe('deprecated');
      expect(res.recommendedUpgrade).toContain('deprecated');
    });

    it('rejects combination after sunset date per End-of-Support policy', () => {
      // Evaluation date after sunset date (e.g. 2027-01-05 > 2026-12-31)
      const res = checkCompatibility(
        {
          backendApi: 'v1',
          contractSchema: 1,
          frontend: '1.0.0',
        },
        new Date('2027-01-05T00:00:00Z')
      );
      expect(res.isCompatible).toBe(false);
      expect(res.status).toBe('end-of-support');
      expect(res.reasons[0]).toContain('reached End-of-Support');
      expect(res.recommendedUpgrade).toBeDefined();
    });

    it('rejects completely unsupported or mismatched version combinations', () => {
      const res = checkCompatibility({
        backendApi: 'v3',
        contractSchema: 99,
      });
      expect(res.isCompatible).toBe(false);
      expect(res.status).toBe('unsupported');
      expect(res.reasons[0]).toContain("No compatibility profile exists for Backend API 'v3'");
    });

    it('rejects frontend release that is older than minimum compatible threshold', () => {
      const res = checkCompatibility({
        backendApi: 'v2',
        contractSchema: 2,
        frontend: '1.0.0', // minimum for v2 is 1.2.0
      });
      expect(res.isCompatible).toBe(false);
      expect(res.status).toBe('incompatible');
      expect(res.reasons[0]).toContain("is below minimum compatible version '1.2.0'");
    });

    it('rejects contract semver below validated release', () => {
      const res = checkCompatibility({
        backendApi: 'v1',
        contractSchema: 2,
        contractSemver: '0.9.0', // validated is 1.1.0
      });
      expect(res.isCompatible).toBe(false);
      expect(res.reasons[0]).toContain("is older than validated release '1.1.0'");
    });
  });
});
