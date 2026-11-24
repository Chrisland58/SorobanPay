/**
 * promMetricsService.test.ts — #1383
 *
 * Unit tests for the prom-client based Prometheus metrics service.
 *
 * Verifies:
 *   1.  sorobanpay_events_indexed_total is registered.
 *   2.  sorobanpay_webhooks_delivered_total is registered.
 *   3.  sorobanpay_rpc_poll_duration_seconds is registered.
 *   4.  sorobanpay_active_subscriptions_gauge is registered.
 *   5.  sorobanpay_http_requests_total is registered.
 *   6.  sorobanpay_rate_limit_hits_total is registered.
 *   7.  collectMetrics() returns valid Prometheus text format (# HELP / # TYPE).
 *   8.  incrementEventsIndexed increments the counter.
 *   9.  recordWebhookDelivery increments success / failure labels.
 *   10. recordRpcPollDuration records histogram observations.
 *   11. setActiveSubscriptions sets the gauge value.
 *   12. recordHttpRequest increments with correct labels.
 *   13. recordRateLimitHit increments with correct method label.
 *   14. getMetricsContentType() returns text/plain content type.
 *   15. Default Node.js metrics (nodejs_ prefix) are included.
 */

import {
  registry,
  eventsIndexedTotal,
  webhooksDeliveredTotal,
  rpcPollDurationSeconds,
  activeSubscriptionsGauge,
  httpRequestsTotal,
  rateLimitHitsTotal,
  getMetricsContentType,
  collectMetrics,
  incrementEventsIndexed,
  recordWebhookDelivery,
  recordRpcPollDuration,
  setActiveSubscriptions,
  recordHttpRequest,
  recordRateLimitHit,
} from '../src/services/promMetricsService';

// Suppress unused-variable warnings — we import to ensure they export correctly.
void eventsIndexedTotal;
void webhooksDeliveredTotal;
void rpcPollDurationSeconds;
void activeSubscriptionsGauge;
void httpRequestsTotal;
void rateLimitHitsTotal;
void registry;

describe('#1383 — promMetricsService metric registration', () => {
  // ── 1–6: All required metrics are registered ────────────────────────────

  it('1. registers sorobanpay_events_indexed_total', async () => {
    expect(await collectMetrics()).toContain('sorobanpay_events_indexed_total');
  });

  it('2. registers sorobanpay_webhooks_delivered_total', async () => {
    expect(await collectMetrics()).toContain('sorobanpay_webhooks_delivered_total');
  });

  it('3. registers sorobanpay_rpc_poll_duration_seconds', async () => {
    expect(await collectMetrics()).toContain('sorobanpay_rpc_poll_duration_seconds');
  });

  it('4. registers sorobanpay_active_subscriptions_gauge', async () => {
    expect(await collectMetrics()).toContain('sorobanpay_active_subscriptions_gauge');
  });

  it('5. registers sorobanpay_http_requests_total', async () => {
    expect(await collectMetrics()).toContain('sorobanpay_http_requests_total');
  });

  it('6. registers sorobanpay_rate_limit_hits_total', async () => {
    expect(await collectMetrics()).toContain('sorobanpay_rate_limit_hits_total');
  });
});

describe('#1383 — promMetricsService output format', () => {
  // ── 7: Valid Prometheus text format ─────────────────────────────────────

  it('7. collectMetrics() returns a string with # HELP and # TYPE lines', async () => {
    const output = await collectMetrics();
    expect(typeof output).toBe('string');
    expect(output).toMatch(/# HELP/);
    expect(output).toMatch(/# TYPE/);
  });

  // ── 14: Content-Type ────────────────────────────────────────────────────

  it('14. getMetricsContentType() returns text/plain', () => {
    expect(getMetricsContentType()).toMatch(/text\/plain/);
  });

  // ── 15: Default Node.js metrics ─────────────────────────────────────────

  it('15. includes default nodejs_ metrics', async () => {
    expect(await collectMetrics()).toContain('nodejs_');
  });
});

describe('#1383 — promMetricsService counter / gauge helpers', () => {
  // ── 8: eventsIndexedTotal ────────────────────────────────────────────────

  it('8. incrementEventsIndexed adds to the counter', async () => {
    incrementEventsIndexed('subscribe', 5);
    const output = await collectMetrics();
    expect(output).toContain('sorobanpay_events_indexed_total');
    expect(output).toContain('event_type="subscribe"');
  });

  // ── 9: webhooksDeliveredTotal ────────────────────────────────────────────

  it('9a. recordWebhookDelivery(true) increments success label', async () => {
    recordWebhookDelivery(true);
    expect(await collectMetrics()).toContain('status="success"');
  });

  it('9b. recordWebhookDelivery(false) increments failure label', async () => {
    recordWebhookDelivery(false);
    expect(await collectMetrics()).toContain('status="failure"');
  });

  // ── 10: rpcPollDurationSeconds ───────────────────────────────────────────

  it('10a. recordRpcPollDuration records a success observation', async () => {
    recordRpcPollDuration(0.123, 'success');
    const output = await collectMetrics();
    expect(output).toContain('sorobanpay_rpc_poll_duration_seconds_bucket');
  });

  it('10b. recordRpcPollDuration records an error observation', async () => {
    recordRpcPollDuration(2.5, 'error');
    expect(await collectMetrics()).toContain('sorobanpay_rpc_poll_duration_seconds');
  });

  // ── 11: activeSubscriptionsGauge ────────────────────────────────────────

  it('11. setActiveSubscriptions sets the gauge value', async () => {
    setActiveSubscriptions(42);
    expect(await collectMetrics()).toContain('sorobanpay_active_subscriptions_gauge 42');
  });

  // ── 12: httpRequestsTotal ────────────────────────────────────────────────

  it('12. recordHttpRequest increments with method/route/status labels', async () => {
    recordHttpRequest('GET', '/health', 200);
    const output = await collectMetrics();
    expect(output).toContain('method="GET"');
    expect(output).toContain('route="/health"');
    expect(output).toContain('status="200"');
  });

  // ── 13: rateLimitHitsTotal ───────────────────────────────────────────────

  it('13. recordRateLimitHit increments with correct method label', async () => {
    recordRateLimitHit('POST');
    const output = await collectMetrics();
    expect(output).toContain('sorobanpay_rate_limit_hits_total');
    expect(output).toContain('method="POST"');
  });
});
