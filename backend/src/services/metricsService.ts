/**
 * BE-75 — Prometheus metrics service.
 *
 * Lightweight in-process metrics registry. Exposes:
 *   indexer_lag_seconds            gauge    — seconds behind chain tip
 *   events_processed_total         counter  — total on-chain events indexed
 *   webhook_delivery_total{status} counter  — webhook deliveries by outcome
 *   rpc_poll_total{status}         counter  — RPC poll attempts by outcome
 *   http_requests_total{method,route,status} counter — HTTP request count
 *   sorobanpay_db_pool_connections_active gauge — active pool connections
 *   sorobanpay_db_pool_connections_idle   gauge — idle pool connections
 *   sorobanpay_db_pool_connections_waiting gauge — queued connection waiters
 *   sorobanpay_db_pool_size               gauge — configured pool size
 *   sorobanpay_db_pool_utilization_ratio  gauge — active / size (0.0 to 1.0)
 *   sorobanpay_db_pool_saturation_ratio   gauge — (active + waiting) / size
 *   sorobanpay_db_query_wait_duration_seconds histogram — time waiting for a free connection
 *   sorobanpay_db_query_duration_seconds histogram — query execution duration
 *   sorobanpay_db_pool_timeouts_total     counter — pool acquire timeouts
 *   sorobanpay_db_query_timeouts_total    counter — query execution timeouts
 *   sorobanpay_database_health_status     gauge — database health signal (1 = healthy, 0 = degraded/down)
 *
 * NOTE ON CARDINALITY:
 * Metrics strictly avoid high-cardinality tenant/merchant identifiers to prevent
 * memory leaks and exposition overhead in multi-tenant environments.
 */

type LabelSet = Record<string, string | number>;

interface Counter {
  type: 'counter';
  help: string;
  values: Map<string, number>;
}

interface Gauge {
  type: 'gauge';
  help: string;
  values: Map<string, number>;
}

interface Histogram {
  type: 'histogram';
  help: string;
  buckets: number[];
  bucketCounts: Map<string, Map<number, number>>;
  sums: Map<string, number>;
  counts: Map<string, number>;
}

type Metric = Counter | Gauge | Histogram;

const registry = new Map<string, Metric>();

function labelKey(labels?: LabelSet): string {
  if (!labels || Object.keys(labels).length === 0) return '__default__';
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
}

// ─── Registration ──────────────────────────────────────────────────────────

function registerCounter(name: string, help: string): Counter {
  if (!registry.has(name)) {
    registry.set(name, { type: 'counter', help, values: new Map() });
  }
  return registry.get(name) as Counter;
}

function registerGauge(name: string, help: string): Gauge {
  if (!registry.has(name)) {
    registry.set(name, { type: 'gauge', help, values: new Map() });
  }
  return registry.get(name) as Gauge;
}

function registerHistogram(name: string, help: string, buckets: number[]): Histogram {
  if (!registry.has(name)) {
    registry.set(name, {
      type: 'histogram',
      help,
      buckets: [...buckets].sort((a, b) => a - b),
      bucketCounts: new Map(),
      sums: new Map(),
      counts: new Map(),
    });
  }
  return registry.get(name) as Histogram;
}

// ─── Pre-register all metrics ──────────────────────────────────────────────

registerGauge(
  'indexer_lag_seconds',
  'Seconds between the last successful RPC poll and now.',
);
registerCounter(
  'events_processed_total',
  'Total number of on-chain contract events indexed.',
);
registerCounter(
  'webhook_delivery_total',
  'Total webhook delivery attempts partitioned by status (success|failure).',
);
registerCounter(
  'rpc_poll_total',
  'Total Soroban RPC poll attempts partitioned by status (success|error).',
);
registerCounter(
  'http_requests_total',
  'Total HTTP requests partitioned by method, route, and status code.',
);

// Database connection pool & query saturation metrics (global / low-cardinality)
registerGauge(
  'sorobanpay_db_pool_connections_active',
  'Number of active database connections currently checked out of the pool.',
);
registerGauge(
  'sorobanpay_db_pool_connections_idle',
  'Number of idle database connections currently open in the pool.',
);
registerGauge(
  'sorobanpay_db_pool_connections_waiting',
  'Number of requests currently queued waiting for a free database connection.',
);
registerGauge(
  'sorobanpay_db_pool_size',
  'Maximum configured connection limit for the database pool.',
);
registerGauge(
  'sorobanpay_db_pool_utilization_ratio',
  'Ratio of active connections to pool size (0.0 to 1.0+).',
);
registerGauge(
  'sorobanpay_db_pool_saturation_ratio',
  'Saturation ratio measuring active plus queued callers relative to pool size.',
);
registerGauge(
  'sorobanpay_database_health_status',
  'Database connectivity health signal (1 = healthy, 0 = degraded/down).',
);
registerHistogram(
  'sorobanpay_db_query_wait_duration_seconds',
  'Duration in seconds waiting to acquire a connection from the database pool.',
  [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
);
registerHistogram(
  'sorobanpay_db_query_duration_seconds',
  'Database query execution duration in seconds.',
  [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
);
registerCounter(
  'sorobanpay_db_pool_timeouts_total',
  'Total number of timeouts encountered waiting to acquire a connection from the pool.',
);
registerCounter(
  'sorobanpay_db_query_timeouts_total',
  'Total number of database query execution timeouts.',
);

// Short-named aliases for compatibility
registerGauge('db_pool_connections_active', 'Active database connections.');
registerGauge('db_pool_connections_idle', 'Idle database connections.');
registerGauge('db_pool_connections_waiting', 'Waiters for a database connection.');
registerGauge('db_pool_size', 'Database pool size.');
registerGauge('db_pool_saturation_ratio', 'Pool saturation ratio.');
registerCounter('db_pool_timeouts_total', 'Pool acquire timeouts.');
registerCounter('db_query_timeouts_total', 'Query execution timeouts.');
registerGauge('database_health_status', 'Database health signal.');

// ─── Public API ────────────────────────────────────────────────────────────

/** Increment a counter by `amount` (default 1). */
export function incrementCounter(
  name: string,
  labels?: LabelSet,
  amount = 1,
): void {
  const metric = registry.get(name) as Counter | undefined;
  if (!metric || metric.type !== 'counter') return;
  const key = labelKey(labels);
  metric.values.set(key, (metric.values.get(key) ?? 0) + amount);
}

/** Set a gauge to an absolute value. */
export function setGauge(name: string, value: number, labels?: LabelSet): void {
  const metric = registry.get(name) as Gauge | undefined;
  if (!metric || metric.type !== 'gauge') return;
  const key = labelKey(labels);
  metric.values.set(key, value);
}

/** Record a value observation into a histogram. */
export function observeHistogram(
  name: string,
  value: number,
  labels?: LabelSet,
): void {
  const metric = registry.get(name) as Histogram | undefined;
  if (!metric || metric.type !== 'histogram') return;
  const key = labelKey(labels);

  let bMap = metric.bucketCounts.get(key);
  if (!bMap) {
    bMap = new Map();
    for (const b of metric.buckets) bMap.set(b, 0);
    metric.bucketCounts.set(key, bMap);
  }

  for (const b of metric.buckets) {
    if (value <= b) {
      bMap.set(b, (bMap.get(b) ?? 0) + 1);
    }
  }

  metric.sums.set(key, (metric.sums.get(key) ?? 0) + value);
  metric.counts.set(key, (metric.counts.get(key) ?? 0) + 1);
}

/** Record database connection acquisition wait duration (seconds). */
export function recordQueryWaitDuration(durationSeconds: number): void {
  observeHistogram('sorobanpay_db_query_wait_duration_seconds', durationSeconds);
}

/** Record database query execution duration (seconds). */
export function recordQueryExecutionDuration(
  durationSeconds: number,
  status: 'success' | 'error' = 'success',
): void {
  observeHistogram('sorobanpay_db_query_duration_seconds', durationSeconds, { status });
}

/** Record database health status signal (1 = healthy, 0 = degraded). */
export function setDatabaseHealthSignal(isHealthy: boolean): void {
  const val = isHealthy ? 1 : 0;
  setGauge('sorobanpay_database_health_status', val);
  setGauge('database_health_status', val);
}

/**
 * Synchronize database pool gauge metrics from a pool stats snapshot.
 */
export function syncDbPoolMetrics(stats: {
  size: number;
  active: number;
  idle: number;
  waiting: number;
  utilization: number;
  saturation: number;
}): void {
  const utilRatio = stats.size > 0 ? stats.active / stats.size : 0;
  const satRatio = stats.size > 0 ? (stats.active + stats.waiting) / stats.size : 0;

  setGauge('sorobanpay_db_pool_connections_active', stats.active);
  setGauge('sorobanpay_db_pool_connections_idle', stats.idle);
  setGauge('sorobanpay_db_pool_connections_waiting', stats.waiting);
  setGauge('sorobanpay_db_pool_size', stats.size);
  setGauge('sorobanpay_db_pool_utilization_ratio', utilRatio);
  setGauge('sorobanpay_db_pool_saturation_ratio', satRatio);

  // Synced short aliases
  setGauge('db_pool_connections_active', stats.active);
  setGauge('db_pool_connections_idle', stats.idle);
  setGauge('db_pool_connections_waiting', stats.waiting);
  setGauge('db_pool_size', stats.size);
  setGauge('db_pool_saturation_ratio', satRatio);
}

/**
 * Render all metrics in Prometheus text exposition format (v0.0.4).
 * https://prometheus.io/docs/instrumenting/exposition_formats/
 */
export function getPrometheusMetrics(): string {
  const lines: string[] = [];

  for (const [name, metric] of registry.entries()) {
    lines.push(`# HELP ${name} ${metric.help}`);
    lines.push(`# TYPE ${name} ${metric.type}`);

    if (metric.type === 'counter' || metric.type === 'gauge') {
      for (const [key, value] of metric.values.entries()) {
        if (key === '__default__') {
          lines.push(`${name} ${value}`);
        } else {
          lines.push(`${name}{${key}} ${value}`);
        }
      }
    } else if (metric.type === 'histogram') {
      for (const [key, bMap] of metric.bucketCounts.entries()) {
        const baseLabels = key === '__default__' ? '' : `${key},`;
        for (const bucket of metric.buckets) {
          const count = bMap.get(bucket) ?? 0;
          lines.push(`${name}_bucket{${baseLabels}le="${bucket}"} ${count}`);
        }
        const totalCount = metric.counts.get(key) ?? 0;
        const totalSum = metric.sums.get(key) ?? 0;
        lines.push(`${name}_bucket{${baseLabels}le="+Inf"} ${totalCount}`);
        if (key === '__default__') {
          lines.push(`${name}_sum ${totalSum}`);
          lines.push(`${name}_count ${totalCount}`);
        } else {
          lines.push(`${name}_sum{${key}} ${totalSum}`);
          lines.push(`${name}_count{${key}} ${totalCount}`);
        }
      }
    }
  }

  // Always end with a trailing newline
  return lines.join('\n') + '\n';
}

/**
 * Convenience: record an HTTP request.
 * Called from an Express middleware or after-response hook.
 */
export function recordHttpRequest(
  method: string,
  route: string,
  statusCode: number,
): void {
  incrementCounter('http_requests_total', {
    method: method.toUpperCase(),
    route,
    status: String(statusCode),
  });
}
