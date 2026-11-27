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
 *   sorobanpay_db_pool_connections_active   gauge     — active database connections
 *   sorobanpay_db_pool_connections_idle     gauge     — idle database connections
 *   sorobanpay_db_pool_connections_waiting  gauge     — queued connection requests
 *   sorobanpay_db_pool_size                 gauge     — maximum database pool size
 *   sorobanpay_db_pool_utilization_ratio    gauge     — active connections / pool size
 *   sorobanpay_db_pool_saturation_ratio     gauge     — (active + waiting) / pool size
 *   sorobanpay_db_query_wait_duration_seconds histogram — wait duration to acquire db connection
 *   sorobanpay_db_query_duration_seconds    histogram — database query execution duration
 *   sorobanpay_db_pool_timeouts_total       counter   — database connection pool acquire timeouts
 *   sorobanpay_db_query_timeouts_total      counter   — database query timeouts
 *   sorobanpay_database_health_status       gauge     — database health signal (1 = ok, 0 = degraded)
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
// Database pool saturation & query wait duration metrics (#1681)
// ---------------------------------------------------------------------------

/** Active connections currently checked out of the database pool. */
export const dbPoolConnectionsActive = new client.Gauge({
  name: 'sorobanpay_db_pool_connections_active',
  help: 'Number of active database connections currently checked out of the pool.',
  registers: [registry],
});

/** Idle connections available in the database pool. */
export const dbPoolConnectionsIdle = new client.Gauge({
  name: 'sorobanpay_db_pool_connections_idle',
  help: 'Number of idle database connections currently waiting in the pool.',
  registers: [registry],
});

/** Requests queued waiting for an available connection from the pool. */
export const dbPoolConnectionsWaiting = new client.Gauge({
  name: 'sorobanpay_db_pool_connections_waiting',
  help: 'Number of queries currently waiting for an available database connection.',
  registers: [registry],
});

/** Total configured maximum database pool capacity. */
export const dbPoolSize = new client.Gauge({
  name: 'sorobanpay_db_pool_size',
  help: 'Maximum configured size of the database connection pool.',
  registers: [registry],
});

/** Ratio of active database connections to total pool capacity (0.0 - 1.0+). */
export const dbPoolUtilizationRatio = new client.Gauge({
  name: 'sorobanpay_db_pool_utilization_ratio',
  help: 'Database pool utilization ratio (active connections / pool size).',
  registers: [registry],
});

/** Ratio of active connections plus queued callers to pool capacity. */
export const dbPoolSaturationRatio = new client.Gauge({
  name: 'sorobanpay_db_pool_saturation_ratio',
  help: 'Database pool saturation ratio ((active + waiting) / pool size).',
  registers: [registry],
});

/** Histogram of wait durations for acquiring a connection from the pool. */
export const dbQueryWaitDurationSeconds = new client.Histogram({
  name: 'sorobanpay_db_query_wait_duration_seconds',
  help: 'Duration in seconds spent waiting to acquire a connection from the database pool.',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

/** Histogram of database query execution durations. */
export const dbQueryDurationSeconds = new client.Histogram({
  name: 'sorobanpay_db_query_duration_seconds',
  help: 'Execution duration of database queries in seconds.',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  labelNames: ['status'] as const,
  registers: [registry],
});

/** Total pool acquire timeouts encountered. */
export const dbPoolTimeoutsTotal = new client.Counter({
  name: 'sorobanpay_db_pool_timeouts_total',
  help: 'Total database pool acquisition timeouts.',
  registers: [registry],
});

/** Total query execution timeouts encountered. */
export const dbQueryTimeoutsTotal = new client.Counter({
  name: 'sorobanpay_db_query_timeouts_total',
  help: 'Total database query execution timeouts.',
  registers: [registry],
});

/** Database health signal gauge (1 = healthy, 0 = degraded/unhealthy). */
export const databaseHealthStatusGauge = new client.Gauge({
  name: 'sorobanpay_database_health_status',
  help: 'Database connectivity and health status signal (1 = healthy, 0 = degraded).',
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

/** Update database pool metrics snapshot. */
export function updateDbPoolMetrics(stats: {
  size: number;
  active: number;
  idle: number;
  waiting: number;
}): void {
  dbPoolSize.set(stats.size);
  dbPoolConnectionsActive.set(stats.active);
  dbPoolConnectionsIdle.set(stats.idle);
  dbPoolConnectionsWaiting.set(stats.waiting);
  const util = stats.size > 0 ? stats.active / stats.size : 0;
  const sat = stats.size > 0 ? (stats.active + stats.waiting) / stats.size : 0;
  dbPoolUtilizationRatio.set(util);
  dbPoolSaturationRatio.set(sat);
}

/** Record database connection pool acquire wait duration. */
export function recordDbWaitDuration(durationSeconds: number): void {
  dbQueryWaitDurationSeconds.observe(durationSeconds);
}

/** Record database query execution duration. */
export function recordDbQueryDuration(
  durationSeconds: number,
  status: 'success' | 'error' = 'success',
): void {
  dbQueryDurationSeconds.labels(status).observe(durationSeconds);
}

/** Increment database pool timeout counter. */
export function incrementDbPoolTimeouts(count = 1): void {
  dbPoolTimeoutsTotal.inc(count);
}

/** Increment database query timeout counter. */
export function incrementDbQueryTimeouts(count = 1): void {
  dbQueryTimeoutsTotal.inc(count);
}

/** Set database health signal (1 = healthy, 0 = degraded/down). */
export function setDbHealthStatus(isHealthy: boolean): void {
  databaseHealthStatusGauge.set(isHealthy ? 1 : 0);
}
