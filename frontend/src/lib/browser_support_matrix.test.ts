/**
 * browser_support_matrix.test.ts
 *
 * Automated test suite for browser and wallet extension support lifecycle matrix.
 * Verifies matrix completeness, actionable explanations for unsupported platforms,
 * boundary case evaluation, and operational lifecycle procedures.
 *
 * Issue #1634
 */

import {
  SUPPORT_MATRIX,
  getSupportStatus,
  evaluateSupport,
  getLifecycleProcedure,
  LIFECYCLE_PROCEDURES,
} from './browser_support_matrix';

describe('Browser and Wallet Support Lifecycle Matrix (#1634)', () => {
  describe('Matrix completeness and schema invariants', () => {
    it('should contain verified entries with non-empty required fields', () => {
      expect(SUPPORT_MATRIX.length).toBeGreaterThan(0);

      for (const entry of SUPPORT_MATRIX) {
        expect(entry.browser).toBeDefined();
        expect(entry.os).toBeDefined();
        expect(entry.wallet).toBeDefined();
        expect(['Supported', 'Degraded', 'Unsupported', 'Experimental']).toContain(entry.status);

        // Test date must follow ISO YYYY-MM-DD format
        expect(entry.testDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

        // Actionable explanation must not be empty or a generic promise
        expect(entry.actionableExplanation).toBeDefined();
        expect(entry.actionableExplanation.trim().length).toBeGreaterThan(15);
        expect(entry.notes).toBeDefined();
      }
    });

    it('should include all primary supported desktop platforms with verified test dates', () => {
      const chromeMac = getSupportStatus('Chrome', 'macOS', 'Freighter');
      expect(chromeMac).not.toBeNull();
      expect(chromeMac?.status).toBe('Supported');
      expect(chromeMac?.testDate).toBe('2026-11-20');

      const firefoxWindows = getSupportStatus('Firefox', 'Windows', 'Freighter');
      expect(firefoxWindows).not.toBeNull();
      expect(firefoxWindows?.status).toBe('Supported');
      expect(firefoxWindows?.testDate).toBe('2026-11-21');

      const braveMac = getSupportStatus('Brave', 'macOS', 'Freighter');
      expect(braveMac).not.toBeNull();
      expect(braveMac?.status).toBe('Supported');
      expect(braveMac?.testDate).toBe('2026-11-19');
    });

    it('should include Degraded and Unsupported status for Edge and Safari with explanations', () => {
      const edgeWindows = getSupportStatus('Edge', 'Windows', 'Freighter');
      expect(edgeWindows).not.toBeNull();
      expect(edgeWindows?.status).toBe('Degraded');
      expect(edgeWindows?.recommendedAlternative).toBeDefined();

      const safariMac = getSupportStatus('Safari', 'macOS', 'Freighter');
      expect(safariMac).not.toBeNull();
      expect(safariMac?.status).toBe('Unsupported');
      expect(safariMac?.actionableExplanation).toContain('Safari');
      expect(safariMac?.recommendedAlternative).toBeDefined();
    });

    it('should explicitly mark mobile environments as unsupported with actionable explanation', () => {
      const mobileSafari = getSupportStatus('Mobile Safari', 'iOS', 'Freighter');
      expect(mobileSafari).not.toBeNull();
      expect(mobileSafari?.status).toBe('Unsupported');
      expect(mobileSafari?.actionableExplanation).toContain('iOS Safari');

      const mobileChrome = getSupportStatus('Mobile Chrome', 'Android', 'Freighter');
      expect(mobileChrome).not.toBeNull();
      expect(mobileChrome?.status).toBe('Unsupported');
      expect(mobileChrome?.actionableExplanation).toContain('Android');
    });
  });

  describe('evaluateSupport() behavior and actionable messaging', () => {
    it('evaluates known supported combination with verified test date and actionable text', () => {
      const res = evaluateSupport({
        browser: 'Chrome',
        os: 'macOS',
        wallet: 'Freighter',
      });

      expect(res.status).toBe('Supported');
      expect(res.isActionable).toBe(true);
      expect(res.testDate).toBe('2026-11-20');
      expect(res.explanation).toContain('Supported');
    });

    it('evaluates known degraded combination and provides actionable mitigation', () => {
      const res = evaluateSupport({
        browser: 'Edge',
        os: 'Windows',
        wallet: 'Freighter',
      });

      expect(res.status).toBe('Degraded');
      expect(res.isActionable).toBe(true);
      expect(res.explanation).toContain('Degraded');
      expect(res.recommendedAlternative).toContain('Edge');
    });

    it('evaluates unsupported combination without giving an implied guarantee', () => {
      const res = evaluateSupport({
        browser: 'Safari',
        os: 'macOS',
        wallet: 'Freighter',
      });

      expect(res.status).toBe('Unsupported');
      expect(res.isActionable).toBe(true);
      expect(res.explanation).toContain('Freighter is not published for Safari');
      expect(res.recommendedAlternative).toBeDefined();
    });

    it('handles uncertified/unknown browser-wallet combination with explicit safe warning', () => {
      const res = evaluateSupport({
        browser: 'Netscape',
        os: 'Solaris',
        wallet: 'Freighter',
      });

      expect(res.status).toBe('Unsupported');
      expect(res.isActionable).toBe(true);
      expect(res.explanation).toContain('has not been certified by SorobanPay');
      expect(res.explanation).toContain('No compatibility guarantees exist');
      expect(res.recommendedAlternative).toContain('Chrome, Brave, or Firefox');
    });

    it('handles case-insensitivity and whitespace trim in parameter matching', () => {
      const res = evaluateSupport({
        browser: '  CHROME  ',
        os: '  macos ',
        wallet: ' freighter  ',
      });

      expect(res.status).toBe('Supported');
      expect(res.testDate).toBe('2026-11-20');
    });

    it('handles missing/undefined parameters gracefully with fallback boundary protection', () => {
      const res = evaluateSupport({});

      expect(res.status).toBe('Unsupported');
      expect(res.isActionable).toBe(true);
      expect(res.explanation).toContain('Unknown on Unknown');
    });
  });

  describe('Lifecycle Procedures (add, drop, investigate)', () => {
    it('provides a structured procedure for adding a new combination', () => {
      const proc = getLifecycleProcedure('add');
      expect(proc.action).toBe('add');
      expect(proc.phases.length).toBe(3);
      expect(proc.phases[0].phase).toContain('Intake');
      expect(proc.phases[1].phase).toContain('Laboratory');
      expect(proc.phases[2].phase).toContain('Automated');
    });

    it('provides a structured procedure for dropping/deprecating a combination', () => {
      const proc = getLifecycleProcedure('drop');
      expect(proc.action).toBe('drop');
      expect(proc.phases.length).toBe(3);
      expect(proc.phases[0].phase).toContain('Assessment');
      expect(proc.phases[1].phase).toContain('Deprecation Notice');
      expect(proc.phases[2].phase).toContain('Hard Deprecation');
    });

    it('provides a structured procedure for investigating anomalies and regressions', () => {
      const proc = getLifecycleProcedure('investigate');
      expect(proc.action).toBe('investigate');
      expect(proc.phases.length).toBe(3);
      expect(proc.phases[0].phase).toContain('Triage');
      expect(proc.phases[1].phase).toContain('Root Cause');
      expect(proc.phases[2].phase).toContain('Remediation');
    });

    it('ensures all lifecycle procedures are indexed in LIFECYCLE_PROCEDURES constant', () => {
      expect(Object.keys(LIFECYCLE_PROCEDURES)).toEqual(['add', 'drop', 'investigate']);
    });
  });
});
