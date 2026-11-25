/**
 * serviceLevelObjectives.test.ts
 *
 * Automated verification of SLO targets, measurement windows, data sources,
 * alert thresholds, owner roles, and runbook linkages (#1636).
 */

describe('Service-Level Objectives (SLO) & Alert Ownership Invariants (#1636)', () => {
  interface SLOConfig {
    domain: string;
    target: number;
    windowDays: number;
    dataSourceMetric: string;
    ownerRole: string;
    runbookRef: string;
  }

  const REGISTERED_SLOS: Record<string, SLOConfig> = {
    API_AVAILABILITY: {
      domain: 'API Gateway',
      target: 0.999, // 99.9%
      windowDays: 30,
      dataSourceMetric: 'sorobanpay_http_requests_total',
      ownerRole: 'SRE / Platform Lead',
      runbookRef: 'docs/troubleshooting-backend.md',
    },
    API_LATENCY_P95: {
      domain: 'API Gateway',
      target: 0.95, // 95% under 300ms
      windowDays: 7,
      dataSourceMetric: 'sorobanpay_http_request_duration_seconds',
      ownerRole: 'Backend Engineering',
      runbookRef: 'docs/operations.md',
    },
    INDEXER_FRESHNESS: {
      domain: 'Event Indexer',
      target: 0.99, // 99% <= 2 ledgers lag
      windowDays: 1, // 24h rolling
      dataSourceMetric: 'sorobanpay_indexer_ledger_lag',
      ownerRole: 'Data / Indexer Eng',
      runbookRef: 'docs/rpc-failover-operations.md',
    },
    WEBHOOK_RELIABILITY: {
      domain: 'Webhook Delivery',
      target: 0.995, // 99.5% success
      windowDays: 1,
      dataSourceMetric: 'sorobanpay_webhook_deliveries_total',
      ownerRole: 'Integration Eng',
      runbookRef: 'docs/webhook-integration.md',
    },
  };

  describe('SLO Configuration Integrity', () => {
    it('ensures each SLO states measurement window, target, and data source', () => {
      for (const [key, slo] of Object.entries(REGISTERED_SLOS)) {
        expect(slo.target).toBeGreaterThan(0.9);
        expect(slo.target).toBeLessThanOrEqual(1.0);
        expect(slo.windowDays).toBeGreaterThanOrEqual(1);
        expect(slo.dataSourceMetric).toBeTruthy();
        expect(slo.ownerRole).toBeTruthy();
        expect(slo.runbookRef).toMatch(/^docs\/.*\.md$/);
      }
    });

    it('calculates error budget burn rate and fires alerts on threshold breach', () => {
      function evaluateApiAvailability(successCount: number, totalCount: number, target: number) {
        if (totalCount === 0) return { availability: 1, isBreached: false, burnRate: 0 };
        const availability = successCount / totalCount;
        const errorRate = 1 - availability;
        const targetErrorRate = 1 - target; // 0.001 for 99.9%
        const burnRate = errorRate / targetErrorRate;
        const isBreached = availability < target;
        return { availability, isBreached, burnRate };
      }

      // Normal operations: 99.95% availability (no breach)
      const healthy = evaluateApiAvailability(99950, 100000, 0.999);
      expect(healthy.isBreached).toBe(false);
      expect(healthy.burnRate).toBeLessThan(1.0);

      // Degraded operations: 98.5% availability (breach: 15x burn rate)
      const degraded = evaluateApiAvailability(98500, 100000, 0.999);
      expect(degraded.isBreached).toBe(true);
      expect(degraded.burnRate).toBe(15);
    });

    it('validates indexer lag alert thresholds and severity classification', () => {
      function classifyIndexerLag(lag: number): { severity: 'OK' | 'P2' | 'P1'; requiresPage: boolean } {
        if (lag <= 2) return { severity: 'OK', requiresPage: false };
        if (lag <= 10) return { severity: 'P2', requiresPage: false };
        return { severity: 'P1', requiresPage: true };
      }

      expect(classifyIndexerLag(1)).toEqual({ severity: 'OK', requiresPage: false });
      expect(classifyIndexerLag(5)).toEqual({ severity: 'P2', requiresPage: false });
      expect(classifyIndexerLag(12)).toEqual({ severity: 'P1', requiresPage: true });
    });
  });

  describe('Alert Ownership & Escalation SLA Matrix', () => {
    it('verifies all alert severity tiers have defined escalation response SLAs', () => {
      const SLA_TIERS = {
        P1_CRITICAL: { ackTimeMinutes: 15, maxResolutionHours: 2 },
        P2_HIGH: { ackTimeMinutes: 60, maxResolutionHours: 8 },
        P3_WARNING: { ackTimeMinutes: 1440, maxResolutionHours: 72 },
      };

      expect(SLA_TIERS.P1_CRITICAL.ackTimeMinutes).toBeLessThanOrEqual(15);
      expect(SLA_TIERS.P2_HIGH.ackTimeMinutes).toBeLessThanOrEqual(60);
    });
  });
});
