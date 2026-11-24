/**
 * #1383 — prom-client based Prometheus metrics service.
 *
 * Exposes the following custom SorobanPay metrics:
 *   sorobanpay_events_indexed_total         counter   — events indexed from chain (label: event_type)
 *   sorobanpay_webhooks_delivered_total     counter   — webhook deliveries (label: status)
 *   sorobanpay_rpc_poll_duration_seconds    histogram — RPC poll latency in seconds (label: status)
 *   sorobanpay_active_subscriptions_gauge  gauge     — current active subscription count
 *   sorobanpay_http_requests_total          counter   — HTTP requests (labels: method, route, status)
 *   sorobanpay_rate_limit_hits_total        counter   — 429 responses (label: method)
 *
 * Plus all default Node.js metrics (heap, GC, event loop lag, etc.) via
 * prom-client.collectDefaultMetrics() with the 'nodejs_' prefix.
 *
 * Usage in Express route handler:
 *   import { getMetricsContentType, collectMetrics } from './promMetricsService';
 *   res.set('Content-Type', getMetricsContentType());
 *   res.send(await collectMetrics());
 */

import client from 'prom-client';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Dedicated registry — avoids polluting prom-client's default global registry
 * in test environments and multi-instance deployments.
 */
export const registry = new client.Registry();

// Collect default Node.js process metrics (heap, GC, event loop lag, active handles, etc.)
client.collectDefaultMetrics({
  register: registry,
  prefix: 'nodejs_',
});

// ---------------------------------------------------------------------------
// Custom SorobanPay metrics
// ---------------------------------------------------------------------------

/** Total on-chain events indexed, partitioned by event type. */
export const eventsIndexedTotal = new client.Counter({
  name: 'sorobanpay_events_indexed_total',
  help: 'Total number of on-chain contract events indexed from the Soroban RPC.',
  labelNames: ['event_type'] as const,
  registers: [registry],
});

/** Total webhook delivery attempts, partitioned by outcome. */
export const webhooksDeliveredTotal = new client.Counter({
  name: 'sorobanpay_webhooks_delivered_total',
  help: 'Total webhook delivery attempts partitioned by status (success | failure).',
  labelNames: ['status'] as const,
  registers: [registry],
});

/**
 * Histogram of Soroban RPC poll durations in seconds.
 * Buckets chosen to give useful p50 / p95 / p99 resolution for typical RPC latencies.
 */
export const rpcPollDurationSeconds = new client.Histogram({
  name: 'sorobanpay_rpc_poll_duration_seconds',
  help: 'Duration of Soroban RPC getEvents() poll calls in seconds.',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  labelNames: ['status'] as const,
  registers: [registry],
});

/** Current number of active on-chain subscriptions tracked by the indexer. */
export const activeSubscriptionsGauge = new client.Gauge({
  name: 'sorobanpay_active_subscriptions_gauge',
  help: 'Current number of active on-chain subscriptions tracked by the indexer.',
  registers: [registry],
});

/** Total HTTP requests handled by the backend. */
export const httpRequestsTotal = new client.Counter({
  name: 'sorobanpay_http_requests_total',
  help: 'Total HTTP requests handled by the backend, partitioned by method, route, and status code.',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

/** Total rate-limit 429 responses issued. */
export const rateLimitHitsTotal = new client.Counter({
  name: 'sorobanpay_rate_limit_hits_total',
  help: 'Total number of 429 Too Many Requests responses issued by the rate limiter.',
  labelNames: ['method'] as const,
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the correct Content-Type value for the Prometheus text exposition format.
 * Set this as the `Content-Type` header before calling collectMetrics().
 */
export function getMetricsContentType(): string {
  return registry.contentType;
}

/**
 * Collect all registered metrics and return them in Prometheus text format.
 * This is async because some default collectors (e.g., GC, event loop) are async.
 */
export async function collectMetrics(): Promise<string> {
  return registry.metrics();
}

// ---------------------------------------------------------------------------
// Convenience helpers (called from indexer, webhook worker, middleware, etc.)
// ---------------------------------------------------------------------------

/** Record one or more indexed events by type. */
export function incrementEventsIndexed(eventType = 'unknown', count = 1): void {
  eventsIndexedTotal.labels(eventType).inc(count);
}

/** Record a webhook delivery outcome. */
export function recordWebhookDelivery(success: boolean): void {
  webhooksDeliveredTotal.labels(success ? 'success' : 'failure').inc();
}

/** Record an RPC poll duration observation. */
export function recordRpcPollDuration(
  durationSeconds: number,
  status: 'success' | 'error',
): void {
  rpcPollDurationSeconds.labels(status).observe(durationSeconds);
}

/** Update the active subscriptions gauge to an absolute value. */
export function setActiveSubscriptions(count: number): void {
  activeSubscriptionsGauge.set(count);
}

/** Record an HTTP request. */
export function recordHttpRequest(
  method: string,
  route: string,
  statusCode: number,
): void {
  httpRequestsTotal.labels(method.toUpperCase(), route, String(statusCode)).inc();
}

/** Record a rate-limit hit (429 response). */
export function recordRateLimitHit(method: string): void {
  rateLimitHitsTotal.labels(method.toUpperCase()).inc();
}
