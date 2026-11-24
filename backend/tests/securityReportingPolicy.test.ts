/**
 * securityReportingPolicy.test.ts
 *
 * Automated test suite for SorobanPay Security Reporting and Vulnerability Response Policy (#1633).
 * Verifies maintained contact paths, SLA targets, report classification, boundary cases,
 * and advisory sanitization.
 */

import {
  MAINTAINED_CONTACT_PATHS,
  SEVERITY_SLAS,
  IN_SCOPE_TARGETS,
  OUT_OF_SCOPE_TARGETS,
  classifyReport,
  sanitizePublicAdvisory,
} from '../src/services/securityPolicyService';

describe('Security Reporting & Vulnerability Response Policy (#1633)', () => {
  describe('Maintained contact paths and SLAs', () => {
    it('provides maintained private reporting channels with SLA targets', () => {
      expect(MAINTAINED_CONTACT_PATHS.length).toBeGreaterThanOrEqual(2);

      const ghAdvisory = MAINTAINED_CONTACT_PATHS.find(
        (c) => c.channel === 'GITHUB_SECURITY_ADVISORY',
      );
      expect(ghAdvisory).toBeDefined();
      expect(ghAdvisory?.isMaintained).toBe(true);
      expect(ghAdvisory?.expectedAcknowledgmentHours).toBeLessThanOrEqual(24);

      const emailPath = MAINTAINED_CONTACT_PATHS.find((c) => c.channel === 'SECURITY_EMAIL');
      expect(emailPath).toBeDefined();
      expect(emailPath?.isMaintained).toBe(true);
      expect(emailPath?.target).toBe('security@sorobanpay.org');
      expect(emailPath?.pgpKeyId).toBeDefined();
    });

    it('enforces severity-tiered SLA response times', () => {
      expect(SEVERITY_SLAS.CRITICAL.acknowledgmentHours).toBeLessThanOrEqual(24);
      expect(SEVERITY_SLAS.CRITICAL.remediationDays).toBeLessThanOrEqual(7);

      expect(SEVERITY_SLAS.HIGH.acknowledgmentHours).toBeLessThanOrEqual(48);
      expect(SEVERITY_SLAS.HIGH.remediationDays).toBeLessThanOrEqual(14);

      expect(SEVERITY_SLAS.MEDIUM.remediationDays).toBeLessThanOrEqual(30);
      expect(SEVERITY_SLAS.LOW.remediationDays).toBeLessThanOrEqual(90);
    });

    it('defines explicit in-scope and out-of-scope boundaries', () => {
      expect(IN_SCOPE_TARGETS).toContain('contracts/subscription/src/');
      expect(IN_SCOPE_TARGETS).toContain('backend/src/');
      expect(IN_SCOPE_TARGETS.length).toBeGreaterThanOrEqual(5);

      expect(OUT_OF_SCOPE_TARGETS.length).toBeGreaterThanOrEqual(4);
      expect(
        OUT_OF_SCOPE_TARGETS.some((item) => item.toLowerCase().includes('automated scanner')),
      ).toBe(true);
    });
  });

  describe('Report classification: security vs bug vs support', () => {
    it('classifies potential exploit or authorization bypass as private security report', () => {
      const report = {
        title: 'Possible authorization bypass in execute_payment',
        description: 'Unauthorized caller can invoke transfer and drain funds via replay.',
      };

      const result = classifyReport(report);
      expect(result.category).toBe('SECURITY_VULNERABILITY');
      expect(result.recommendedChannel).toContain('security');
      expect(result.reason).toContain('Do NOT file publicly');
    });

    it('classifies standard UI/functional issue as public bug report', () => {
      const report = {
        title: 'Table alignment glitch in merchant portal',
        description: 'The subscription table header overflows horizontally on 1080p display.',
      };

      const result = classifyReport(report);
      expect(result.category).toBe('PUBLIC_BUG');
      expect(result.recommendedChannel).toContain('issues/new');
    });

    it('classifies configuration or setup inquiry as support request', () => {
      const report = {
        title: 'How do I fund my testnet account with friendbot?',
        description: 'Where is the faucet URL to get test XLM for setting up Freighter?',
      };

      const result = classifyReport(report);
      expect(result.category).toBe('SUPPORT_REQUEST');
      expect(result.recommendedChannel).toContain('discussions');
    });

    it('handles empty or blank submission with safe inquiry fallback', () => {
      const result = classifyReport({});
      expect(result.category).toBe('SUPPORT_REQUEST');
      expect(result.reason).toContain('Empty submission');
    });
  });

  describe('Public advisory sanitization and incident detail protection', () => {
    it('detects and redacts sensitive database connection strings', () => {
      const rawText =
        'Remediated SQL issue. Root cause was connection to postgresql://admin:supersecret@10.0.0.5:5432/sorobanpay.';
      const res = sanitizePublicAdvisory(rawText);

      expect(res.isSafeToPublish).toBe(false);
      expect(res.redactedItems).toContain('DATABASE_URL');
      expect(res.sanitizedText).not.toContain('supersecret');
      expect(res.sanitizedText).toContain('[REDACTED_DATABASE_URL]');
    });

    it('detects and redacts secret keys or personal access tokens', () => {
      const rawText = 'Patched webhook issue. Incident occurred using OPERATOR_SECRET=top_secret_prod_key.';
      const res = sanitizePublicAdvisory(rawText);

      expect(res.isSafeToPublish).toBe(false);
      expect(res.redactedItems).toContain('SECRET_KEY');
      expect(res.sanitizedText).toContain('[REDACTED_SECRET]');
    });

    it('permits clean technical advisory without redactions', () => {
      const cleanText =
        'GHSA-2026-001: Corrected integer overflow check in fee calculations. Upgraded to contract v1.2.0.';
      const res = sanitizePublicAdvisory(cleanText);

      expect(res.isSafeToPublish).toBe(true);
      expect(res.redactedItems.length).toBe(0);
      expect(res.sanitizedText).toBe(cleanText);
    });
  });
});
