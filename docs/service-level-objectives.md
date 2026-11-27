# Service-Level Objectives (SLOs) & Alert Ownership Guide

This document defines the formal Service-Level Objectives (SLOs), Service-Level Indicators (SLIs), alerting thresholds, operational ownership, and escalation procedures for SorobanPay's production platform.

---

## 1. Core Service-Level Objectives

Each SLO is defined with an explicit measurement window, numerical availability/freshness target, and authoritative Prometheus metric data source.

| Service Domain | Service-Level Indicator (SLI) | Target Objective | Measurement Window | Authoritative Data Source | User Impact |
|---|---|---|---|---|---|
| **API Gateway (Availability)** | Ratio of successful HTTP requests (`status < 500`) to total requests | **$\ge$ 99.9%** | Rolling 30 days | `sorobanpay_http_requests_total{status!~"5.."}` / `sorobanpay_http_requests_total` | Merchants cannot initiate checkouts or query subscription status |
| **API Gateway (Latency)** | Proportion of non-streaming requests completed in $\le$ 300ms | **$\ge$ 95.0%** (p95) | Rolling 7 days | `histogram_quantile(0.95, sum(rate(sorobanpay_http_request_duration_seconds_bucket[5m])) by (le))` | Degraded checkout responsiveness and portal timeouts |
| **Event Indexer (Freshness)** | Difference between network latest ledger and indexer checkpoint | **$\le$ 2 ledgers** ($\ge$ 99% of time) | Rolling 24 hours | `sorobanpay_indexer_ledger_lag` | Stale payment confirmations and delayed invoice generation |
| **Webhook Delivery (Reliability)** | Percentage of webhook events successfully delivered (`HTTP 2xx`) within 30s | **$\ge$ 99.5%** | Rolling 24 hours | `sorobanpay_webhook_deliveries_total{status="success",duration_seconds="<30"}` | Merchants fail to unlock customer access or update billing state |

---

## 2. Alert Thresholds, Runbook Links & Designated Owners

Every production alert is mapped to a designated owner role and links directly to an actionable troubleshooting runbook.

```
+----------------------------------------------------------------------------------------------------+
| SEVERITY MATRIX                                                                                    |
| - P1 (Critical): Active customer outage or data inconsistency -> 15 min response -> Page on-call   |
| - P2 (High): Degraded performance or burn-rate exceeding budget  -> 1 hour response  -> Ticket + Slack |
| - P3 (Warning): Near capacity or single-instance transient issue -> Next business day              |
+----------------------------------------------------------------------------------------------------+
```

### Alert Definitions

| Alert Name | Severity | Condition & Threshold | Owner Role | Actionable Runbook Link |
|---|---|---|---|---|
| `ApiAvailabilityErrorBudgetBurn` | **P1 (Critical)** | Error rate > 1% over 5m (14.4x burn rate) | **SRE / Platform Lead** | [API Outage Runbook](./troubleshooting-backend.md#api-server-errors) |
| `ApiHighLatencyP95` | **P2 (High)** | p95 latency > 800ms for > 10m | **Backend Engineering** | [Database & API Latency Runbook](./operations.md#database-performance) |
| `IndexerLedgerLagCritical` | **P1 (Critical)** | Ledger lag > 10 ledgers for > 5m | **Data / Indexer Eng** | [RPC & Indexer Runbook](./rpc-failover-operations.md#active-provider-switchover-procedure) |
| `IndexerStalled` | **P1 (Critical)** | No ledger advanced for > 3m | **Data / Indexer Eng** | [Disaster Recovery Runbook](./disaster-recovery.md#step-4-indexer-replay-from-safe-checkpoint) |
| `WebhookDeliveryBacklogSpike` | **P2 (High)** | Outbox backlog > 500 events or DLQ > 50 | **Integration Eng** | [Webhook Operations Runbook](./webhook-integration.md#dlq-handling) |
| `PostgresConnectionPoolSaturated` | **P2 (High)** | Active connections > 85% of pool max | **DBA / Infrastructure** | [Database Migration & Pool Runbook](./database-migrations.md) |

---

## 3. Escalation Pathways & On-Call Expectations

When an SLO alert fires, on-call operators must follow this standardized escalation sequence:

```
[Tier 1: Primary On-Call Engineer]
- Initial response within 15 mins for P1, 1 hour for P2
- Acknowledge alert in PagerDuty / OpsGenie
- Post incident bridge link in #incident-ops Slack
                     |
         (Unresolved after 30 mins)
                     v
[Tier 2: Component Tech Lead / Secondary On-Call]
- Assumes technical investigation
- Evaluates failover / rollback options
                     |
         (Outage exceeds 45 mins)
                     v
[Tier 3: Incident Commander / Head of Engineering]
- Executive communication & merchant status page broadcast
- Authorization for emergency maintenance cutover
```

---

## 4. Error Budget Policy

1. **Monthly Review**: Platform and product engineering conduct a monthly SLO review analyzing consumption of error budgets.
2. **Budget Exhaustion**: If a service consumes > 100% of its monthly error budget, all non-critical feature releases for that tier are frozen until stability work is implemented and deployed.
