# SorobanPay SLOs & Alert Response Runbooks

This document defines the user-impact Service Level Objectives (SLOs), alert thresholds, owning services, and incident response procedures for SorobanPay.

## SLO Summary

| Signal | Owning Service | Objective | Alert Name | Threshold | Window (`for`) |
| --- | --- | --- | --- | --- | --- |
| API Availability | `api` | >= 99.9% non-5xx responses | `APIAvailabilitySLOBreach` | `< 0.999` | `5m` |
| API Latency (p95) | `api` | <= 500ms p95 response time | `APILatencySLOBreach` | `> 0.5s` | `5m` |
| Indexer Freshness | `indexer` | <= 60s behind latest ledger | `IndexerFreshnessSLOBreach` | `> 60s` | `3m` |
| Webhook Delivery Lag (p95) | `webhook-worker` | <= 30s p95 delivery lag | `WebhookDeliveryLagSLOBreach` | `> 30s` | `5m` |

Prometheus rules are defined in [deploy/prometheus/slo-rules.yml](../../deploy/prometheus/slo-rules.yml) and visualized in [deploy/grafana/sorobanpay-slo-dashboard.json](../../deploy/grafana/sorobanpay-slo-dashboard.json).

---

## Response Runbooks

### APIAvailabilitySLOBreach

- **Owning Service:** `api`
- **Severity:** `critical`
- **Trigger:** `sorobanpay:api_availability:ratio_rate5m < 0.999` for `5m`
- **Triage Steps:**
  1. Check API pod/container health and recent deployments.
  2. Inspect 5xx error logs in the `api` service for database connection errors, Soroban RPC timeouts, or unhandled exceptions.
  3. Verify PostgreSQL and Redis connectivity.
- **Mitigation:** Roll back recent faulty deployments or scale `api` replicas if saturated.

### APILatencySLOBreach

- **Owning Service:** `api`
- **Severity:** `warning`
- **Trigger:** `sorobanpay:api_latency:p95_seconds5m > 0.5` for `5m`
- **Triage Steps:**
  1. Identify slow endpoints from HTTP duration histograms.
  2. Check database query latency, connection pool saturation, and Soroban RPC response times.
- **Mitigation:** Scale `api` horizontally, tune slow queries, or enable/verify caching.

### IndexerFreshnessSLOBreach

- **Owning Service:** `indexer`
- **Severity:** `critical`
- **Trigger:** `sorobanpay:indexer_freshness:lag_seconds > 60` for `3m`
- **Triage Steps:**
  1. Check `indexer` logs for Soroban RPC rate-limiting, network errors, or cursor stalls.
  2. Verify Stellar/Soroban RPC endpoint health.
  3. Confirm PostgreSQL write throughput is not blocking ledger commits.
- **Mitigation:** Switch to a healthy RPC endpoint or restart the stalled `indexer` worker.

### WebhookDeliveryLagSLOBreach

- **Owning Service:** `webhook-worker`
- **Severity:** `warning`
- **Trigger:** `sorobanpay:webhook_delivery:p95_lag_seconds5m > 30` for `5m`
- **Triage Steps:**
  1. Check `webhook-worker` queue depth and retry backlog.
  2. Identify failing or slow merchant webhook endpoints causing retry amplification.
- **Mitigation:** Scale `webhook-worker` replicas or circuit-break/rate-limit persistently failing merchant endpoints.
