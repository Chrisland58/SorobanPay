# RPC Provider Outage and Failover Operations Guide

This guide establishes the standard operating procedure for monitoring, diagnosing, and executing failovers for Soroban RPC providers in SorobanPay. It provides operational runbooks to distinguish RPC provider outages from smart contract invariant violations and database/indexer faults, outlines safe retry boundaries, and details evidence collection prior to provider switchover.

---

## 1. Failure Domain Classification

When a payment, subscription creation, or indexing process fails, operators and developers must isolate the failure domain before taking remediation action:

```
                                  +------------------------------+
                                  |   Application Error Event    |
                                  +------------------------------+
                                                 |
                   +-----------------------------+-----------------------------+
                   |                                                           |
                   v                                                           v
   [HTTP Transport / RPC Error]                                     [Contract Invariant Revert]
   - Status 502 / 503 / 504                                         - HTTP 200 with result XDR
   - ECONNREFUSED / ETIMEDOUT                                       - HostError / ContractError #N
   - JSON-RPC -32603 / -32000                                       - "InvalidAmount", "PaymentNotDue"
   - Cloudflare / Provider HTML error                               - "InsufficientAllowance"
                   |                                                           |
                   v                                                           v
         RPC Provider Outage                                        Contract / Business Fault
     (Eligible for Read Failover)                                (FAILOVER FORBIDDEN - Fix Inputs)
```

### Domain Distinction Matrix

| Failure Domain | Primary Indicators | Typical Status / Error Codes | Actionable Path |
|---|---|---|---|
| **RPC Provider Outage** | Connection refused, gateway timeouts, DNS resolution failure, JSON-RPC node internal error | HTTP `502 Bad Gateway`, `503 Service Unavailable`, `504 Gateway Timeout`, `ECONNREFUSED`, `ETIMEDOUT` | Failover to alternate healthy RPC endpoint for idempotent reads. Poll for submitted tx hash. |
| **Contract Invariant Violation** | RPC node responds promptly (HTTP 200) with diagnostic result XDR indicating contract failure | `HostError(Error(Contract, #N))`, `Error code 1..17` | Do NOT failover provider. Fix contract parameters, allowance, or wait for billing cycle. |
| **Database / Indexer Fault** | Postgres pool timeout, ledger cursor stalled, Redis queue backlog | `P2024 (Pool timeout)`, `ECONNREFUSED :5432`, `stalled_cursor_gap` | Investigate Postgres connection pool, Prisma migrations, and disk I/O. Do NOT failover RPC. |
| **Rate Limit / Throttling** | Provider response containing 429 status or rate limit headers | HTTP `429 Too Many Requests`, `Retry-After` header | Back off request rate, distribute traffic across keys, or failover read traffic. |

---

## 2. Configured Failover Behavior & Safe Retry Boundaries

SorobanPay implements a multi-endpoint failover architecture (`RPC_URL`, `BACKUP_RPC_URLS`) with strict safety boundaries.

### Strict Prohibition: No Automatic Replay of Non-Idempotent Mutations

> [!CAUTION]
> **AUTOMATIC REPLAY OF NON-IDEMPOTENT WALLET SUBMISSIONS IS STRICTLY PROHIBITED.**
> Under no circumstances may an automated client, background worker, or retry loop resubmit a signed transaction (`sendTransaction`) or generate a new transaction for the same payment intent across alternate RPC endpoints without explicit verification of prior non-inclusion.

#### Why Replay is Prohibited
1. **Silent Inclusion Risk**: An RPC endpoint that returns an HTTP `504 Gateway Timeout` or `502 Bad Gateway` may have already broadcast the transaction to the Stellar validator consensus network. Re-submitting the transaction or generating a new sequence number causes duplicate debits on subscriber accounts.
2. **Sequence Number Collisions**: Replaying transactions with identical source accounts can consume sequence numbers out-of-order, causing subsequent transactions to fail with `txBAD_SEQ`.

#### Safe Recovery Protocol for In-Flight Submissions
When a `sendTransaction` call fails with an ambiguous transport error:
1. **Extract Transaction Hash**: Capture the transaction hash computed locally prior to submission.
2. **Poll Status Across Providers**: Execute read-only `getTransaction(hash)` against the fallback RPC endpoint.
3. **Wait for Finality Window**: Continue status polling for at least 60 seconds (12 ledgers).
4. **Resubmit Only If Expired**: Only if `getTransaction` confirms non-existence and the ledger sequence exceeds the transaction's `timeBounds.maxTime` may a new transaction be prepared.

### Safe Retry Boundaries for Idempotent Reads

Idempotent read operations are safe to retry and failover across endpoints:
- `getAccount(address)`
- `getLatestLedger()`
- `getEvents(startLedger, filters)`
- `simulateTransaction(tx)`
- `getHealth()`
- `getNetwork()`
- `getTransaction(hash)`
- `getLedgerEntries(keys)`

#### Retry Policy Parameters
- **Maximum Failover Attempts**: 3 endpoints per request cycle.
- **Per-Attempt Timeout**: 5,000 ms for read calls, 10,000 ms for simulation.
- **Backoff Strategy**: Exponential backoff with full jitter:
  $$\text{Delay} = \min(5000\text{ ms}, \text{random}(0, \text{InitialDelay} \times 2^{\text{attempt}}))$$
- **Circuit Breaker Threshold**: 5 consecutive failures trips circuit for 30 seconds before half-open probe.

---

## 3. Observability, Metrics & Log Correlation

All RPC interactions are instrumented with structured logging and Prometheus metrics.

### Log Correlation Fields

Every log statement emitted during RPC calls and failover events must include these standard correlation fields:

| Field Name | Type | Description | Example |
|---|---|---|---|
| `traceId` | String | W3C distributed trace identifier | `4bf92f3577b34da6a3ce929d0e0e4736` |
| `requestId` | String | Request UUID assigned at ingress | `f7b3a4a1-8d2a-4f6e-9b21-419b4b0e8b23` |
| `operation` | String | Soroban RPC method being executed | `getEvents`, `simulateTransaction` |
| `rpcEndpoint` | String | Sanitized host URL of active provider | `https://rpc-provider-1.stellar.org` |
| `attemptNumber` | Integer | Attempt count within the current failover cycle | `1`, `2` |
| `durationMs` | Number | Elapsed execution duration in milliseconds | `245.8` |
| `errorCode` | String | Standardized error code or HTTP status | `RPC_TIMEOUT`, `HTTP_503` |
| `isIdempotent` | Boolean | Whether the operation is safe to failover | `true`, `false` |

### Prometheus Metrics

| Metric Name | Type | Labels | Description | Alert Condition |
|---|---|---|---|---|
| `sorobanpay_rpc_requests_total` | Counter | `endpoint`, `operation`, `status` | Total RPC requests by endpoint and outcome | N/A |
| `sorobanpay_rpc_request_duration_seconds` | Histogram | `endpoint`, `operation` | RPC call latency distribution | p95 > 2.5s over 5m |
| `sorobanpay_rpc_failover_events_total` | Counter | `from_endpoint`, `to_endpoint`, `reason` | Count of failover triggers | > 5 events in 5m |
| `sorobanpay_rpc_circuit_breaker_state` | Gauge | `endpoint` | 0=Closed (Healthy), 1=Half-Open, 2=Open (Down) | State == 2 for > 2m |
| `sorobanpay_indexer_ledger_lag` | Gauge | `endpoint` | Difference between network latest ledger and indexer | Lag > 10 ledgers |

---

## 4. Evidence Collection Runbook (Pre-Switchover)

Before manually updating environment variables or altering the active RPC provider in production, operators must collect the following diagnostic artifacts:

### 1. Network & DNS Probe
```bash
# Verify DNS resolution and latency
dig +short soroban-rpc.mainnet.stellar.org
curl -w "\nLookup: %{time_namelookup}s | Connect: %{time_connect}s | Total: %{time_total}s\n" \
     -o /dev/null -s "https://soroban-rpc.mainnet.stellar.org"
```

### 2. JSON-RPC Health Probe
```bash
# Verify RPC node status and latest ledger
curl -s -X POST "https://soroban-rpc.mainnet.stellar.org" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | jq .

curl -s -X POST "https://soroban-rpc.mainnet.stellar.org" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":2,"method":"getLatestLedger"}' | jq .
```

### 3. Ledger Parity Check
Compare the returned `sequence` from the candidate provider with the official Stellar Dashboard:
- Stellar Dashboard: [https://dashboard.stellar.org](https://dashboard.stellar.org)
- If provider is > 10 ledgers behind, the node is stale; **do not switch to a stale provider**.

### 4. Credential Sanitization
Ensure command outputs and incident reports do not paste sensitive API keys:
```bash
# Correct: Redact sensitive tokens in ticket logs
curl -s -X POST "https://provider.example.com/api?api_key=[REDACTED]" ...
```

---

## 5. Active Provider Switchover Procedure

When an outage is confirmed and the primary provider remains degraded:

1. **Verify Backup Provider Health**: Run the JSON-RPC Health Probe against `BACKUP_RPC_URL` and confirm `status: "healthy"` and ledger lag < 2.
2. **Update Service Configuration**:
   ```bash
   # Kubernetes deployment patch
   kubectl set env deployment/sorobanpay-backend \
     SOROBAN_RPC_URL="https://backup-rpc.stellar.org" \
     RPC_URL="https://backup-rpc.stellar.org"
   ```
3. **Monitor Rolling Restart**:
   ```bash
   kubectl rollout status deployment/sorobanpay-backend
   ```
4. **Validate Indexer Catch-up**: Inspect backend logs for `traceId` correlation and check that `sorobanpay_indexer_ledger_lag` drops to 0.
5. **Post-Incident Review**: Record incident start, detection time, failover trigger, and duration in post-mortem documentation.
