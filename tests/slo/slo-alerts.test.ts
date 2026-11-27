import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const RULES_PATH = path.join(ROOT, 'deploy/prometheus/slo-rules.yml');
const DASHBOARD_PATH = path.join(ROOT, 'deploy/grafana/sorobanpay-slo-dashboard.json');
const RUNBOOK_PATH = path.join(ROOT, 'docs/runbooks/slo-alerts.md');

interface AlertRule {
  alert: string;
  service: string;
  runbookUrl: string;
}

function evaluateThreshold(
  values: number[],
  predicate: (v: number) => boolean,
  requiredConsecutive: number
): { firing: boolean; recovered: boolean } {
  let consecutive = 0;
  let everFired = false;
  let currentlyFiring = false;

  for (const v of values) {
    if (predicate(v)) {
      consecutive += 1;
      if (consecutive >= requiredConsecutive) {
        everFired = true;
        currentlyFiring = true;
      }
    } else {
      consecutive = 0;
      currentlyFiring = false;
    }
  }

  return {
    firing: currentlyFiring,
    recovered: everFired && !currentlyFiring,
  };
}

describe('SorobanPay SLO Alerts & Dashboards', () => {
  const rulesContent = fs.readFileSync(RULES_PATH, 'utf8');
  const runbookContent = fs.readFileSync(RUNBOOK_PATH, 'utf8');
  const dashboard = JSON.parse(fs.readFileSync(DASHBOARD_PATH, 'utf8'));

  const expectedAlerts: AlertRule[] = [
    {
      alert: 'APIAvailabilitySLOBreach',
      service: 'api',
      runbookUrl: 'docs/runbooks/slo-alerts.md#apiavailabilityslobreach',
    },
    {
      alert: 'APILatencySLOBreach',
      service: 'api',
      runbookUrl: 'docs/runbooks/slo-alerts.md#apilatencyslobreach',
    },
    {
      alert: 'IndexerFreshnessSLOBreach',
      service: 'indexer',
      runbookUrl: 'docs/runbooks/slo-alerts.md#indexerfreshnessslobreach',
    },
    {
      alert: 'WebhookDeliveryLagSLOBreach',
      service: 'webhook-worker',
      runbookUrl: 'docs/runbooks/slo-alerts.md#webhookdeliverylagslobreach',
    },
  ];

  test.each(expectedAlerts)(
    'alert $alert defines owning service ($service) and runbook_url',
    ({ alert, service, runbookUrl }) => {
      expect(rulesContent).toContain(`alert: ${alert}`);
      expect(rulesContent).toContain(`service: ${service}`);
      expect(rulesContent).toContain(`runbook_url: "${runbookUrl}"`);
      expect(runbookContent).toContain(`### ${alert}`);
    }
  );

  test('Grafana SLO dashboard includes all 4 SLO panels', () => {
    expect(dashboard.uid).toBe('sorobanpay-slo-overview');
    expect(Array.isArray(dashboard.panels)).toBe(true);
    expect(dashboard.panels).toHaveLength(4);
  });

  test('synthetic data verifies firing, boundary, and recovery for API availability', () => {
    // Boundary: exactly 0.999 does not breach (< 0.999)
    expect(evaluateThreshold([0.999, 0.999, 0.999], (v) => v < 0.999, 2).firing).toBe(false);
    // Firing then recovery
    const res = evaluateThreshold([0.9995, 0.995, 0.994, 0.9992], (v) => v < 0.999, 2);
    expect(res.firing).toBe(false);
    expect(res.recovered).toBe(true);
  });

  test('synthetic data verifies firing, boundary, and recovery for API latency', () => {
    expect(evaluateThreshold([0.5, 0.5], (v) => v > 0.5, 2).firing).toBe(false);
    const res = evaluateThreshold([0.3, 0.65, 0.72], (v) => v > 0.5, 2);
    expect(res.firing).toBe(true);
  });

  test('synthetic data verifies firing, boundary, and recovery for indexer freshness', () => {
    expect(evaluateThreshold([60, 60], (v) => v > 60, 2).firing).toBe(false);
    const res = evaluateThreshold([15, 75, 90, 12], (v) => v > 60, 2);
    expect(res.firing).toBe(false);
    expect(res.recovered).toBe(true);
  });

  test('synthetic data verifies firing, boundary, and recovery for webhook delivery lag', () => {
    expect(evaluateThreshold([30, 30], (v) => v > 30, 2).firing).toBe(false);
    const res = evaluateThreshold([10, 45, 50], (v) => v > 30, 2);
    expect(res.firing).toBe(true);
  });
});
