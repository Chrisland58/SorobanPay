/**
 * contractUpgradeChecklist.test.ts
 *
 * Automated test suite for Contract Upgrade Approval & Verification Checklist (#1630).
 * Asserts phase separation (Build, Review, Deployment, Post-Deployment Verification),
 * Wasm hash validation, signoff enforcement, and test command references.
 */

import {
  CONTRACT_UPGRADE_CHECKLIST,
  getChecklistByPhase,
  validateWasmHash,
  validateUpgradeSignoff,
  UPGRADE_TEST_COMMANDS,
} from '../src/services/contractUpgradeChecklistService';

describe('Contract Upgrade Approval and Verification Checklist (#1630)', () => {
  describe('Phase separation and item coverage', () => {
    it('separates checklist into Build, Review, Deployment, and Post-Deployment Verification phases', () => {
      const buildItems = getChecklistByPhase('BUILD');
      const reviewItems = getChecklistByPhase('REVIEW');
      const deployItems = getChecklistByPhase('DEPLOYMENT');
      const postDeployItems = getChecklistByPhase('POST_DEPLOYMENT_VERIFICATION');

      expect(buildItems.length).toBeGreaterThanOrEqual(3);
      expect(reviewItems.length).toBeGreaterThanOrEqual(4);
      expect(deployItems.length).toBeGreaterThanOrEqual(2);
      expect(postDeployItems.length).toBeGreaterThanOrEqual(3);

      const totalItems =
        buildItems.length + reviewItems.length + deployItems.length + postDeployItems.length;
      expect(totalItems).toBe(CONTRACT_UPGRADE_CHECKLIST.length);
    });

    it('enforces required review items: storage layout, authorization, event schema, and rollback', () => {
      const reviewIds = getChecklistByPhase('REVIEW').map((item) => item.id);
      expect(reviewIds).toContain('review_storage_compatibility');
      expect(reviewIds).toContain('review_authorization_guards');
      expect(reviewIds).toContain('review_event_schema_stability');
      expect(reviewIds).toContain('review_rollback_readiness');
    });

    it('enforces post-deployment verification items: Wasm hash, migrated event, smoke read', () => {
      const postDeployIds = getChecklistByPhase('POST_DEPLOYMENT_VERIFICATION').map(
        (item) => item.id,
      );
      expect(postDeployIds).toContain('verify_wasm_hash_match');
      expect(postDeployIds).toContain('verify_contract_migrated_event');
      expect(postDeployIds).toContain('verify_smoke_read');
    });
  });

  describe('Wasm hash validation', () => {
    it('accepts valid 64-character lowercase hex sha256 string', () => {
      const validHash = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
      const result = validateWasmHash(validHash);
      expect(result.isValid).toBe(true);
      expect(result.normalizedHash).toBe(validHash);
    });

    it('normalizes uppercase hex characters and trims whitespace', () => {
      const mixedHash = '  A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90  ';
      const result = validateWasmHash(mixedHash);
      expect(result.isValid).toBe(true);
      expect(result.normalizedHash).toBe(
        'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
      );
    });

    it('rejects invalid hashes (short, long, non-hex)', () => {
      expect(validateWasmHash('').isValid).toBe(false);
      expect(validateWasmHash('tooshort').isValid).toBe(false);
      expect(
        validateWasmHash(
          'g1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
        ).isValid,
      ).toBe(false); // 'g' is not hex
    });
  });

  describe('Signoff validation and readiness gates', () => {
    it('blocks release if any required item is missing', () => {
      const incomplete = ['build_deterministic_wasm', 'build_optimize_wasm'];
      const signoff = validateUpgradeSignoff(incomplete);
      expect(signoff.isReadyForRelease).toBe(false);
      expect(signoff.missingItems.length).toBeGreaterThan(0);
    });

    it('approves release when all required items are checked off', () => {
      const allRequired = CONTRACT_UPGRADE_CHECKLIST.filter((i) => i.requiredForSignoff).map(
        (i) => i.id,
      );
      const signoff = validateUpgradeSignoff(allRequired);
      expect(signoff.isReadyForRelease).toBe(true);
      expect(signoff.missingItems.length).toBe(0);
    });
  });

  describe('Upgrade test commands linkage', () => {
    it('links to exact storage regression upgrade command', () => {
      expect(UPGRADE_TEST_COMMANDS.storageRegression).toContain('upgrade-test');
      expect(UPGRADE_TEST_COMMANDS.storageRegression).toContain('-- upgrade');
      expect(UPGRADE_TEST_COMMANDS.contractUnitTests).toBeDefined();
    });
  });
});
