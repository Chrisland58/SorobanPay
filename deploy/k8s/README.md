# Kubernetes Manifests — SorobanPay

This directory contains Kubernetes manifests for deploying SorobanPay backend
services to a cluster.

## Network Policies (issue #1441)

[NetworkPolicy](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
resources restrict pod-to-pod communication in the `sorobanpay` namespace
to only what is needed for the application to function.

### Prerequisites

- A CNI (Container Network Interface) plugin that enforces NetworkPolicy,
  e.g. [Calico](https://docs.tigera.io/calico), [Cilium](https://cilium.io),
  or WeaveNet. Without an enforcing CNI, NetworkPolicy resources are silently
  ignored and all traffic is allowed.
- `kubectl` configured against the target cluster.
- [kustomize](https://kustomize.io) (built into `kubectl` ≥ 1.14).

### Policy overview

| Policy | Applies to | Ingress | Egress |
|--------|-----------|---------|--------|
| `default-deny-all` | All pods in `sorobanpay` namespace | Deny all | Deny all |
| `api-network-policy` | `app=api` pods | Ingress controller only (`ingress-nginx` namespace) → port 3001 | DNS (UDP/TCP 53), PostgreSQL (TCP 5432), external HTTPS (TCP 443) |
| `indexer-network-policy` | `app=indexer` pods | None (pull-only) | DNS (53), PostgreSQL (5432), Soroban RPC HTTPS (443) |
| `webhook-worker-network-policy` | `app=webhook-worker` pods | None (worker) | DNS (53), PostgreSQL (5432), external HTTPS (443) for webhooks |
| `postgresql-network-policy` | `app=postgresql` pods | API, indexer, webhook-worker → port 5432 only | DNS only |

The `default-deny-all` policy is the baseline: it denies all ingress and egress
for every pod in the namespace. Each workload-specific policy then re-opens
only the ports and destinations required for that workload.

### Traffic matrix

```
                ┌─────────────┐
                │ ingress-nginx │
                └──────┬──────┘
                       │ :3001
                       ▼
              ┌────────────────┐
              │   API pod       │
              └──┬───────────┬──┘
                 │ 5432      │ 443
                 ▼           ▼
          ┌──────────┐   ┌───────────────┐
          │PostgreSQL │   │ Soroban RPC    │
          └────▲─────┘   └───────▲───────┘
               │ 5432            │ 443
          ┌────┴─────┐   ┌───────┴───────┐
          │Indexer   │   │Webhook Worker  │
          └──────────┘   └───────────────┘
                          │ 443
                          ▼
                     External HTTPS (webhooks)
```

### Apply

```bash
kubectl apply -k deploy/k8s/
```

### Verify

#### List policies

```bash
kubectl get networkpolicies -n sorobanpay
```

#### Describe a policy

```bash
kubectl describe networkpolicy api-network-policy -n sorobanpay
```

### Testing in minikube with Calico CNI

This section reproduces the acceptance criterion: _Tested in minikube with
Calico CNI_.

#### 1. Start minikube with Calico

```bash
minikube start --cni=calico --cpus=2 --memory=4096
```

Confirm Calico is running:

```bash
kubectl get pods -n kube-system -l k8s-app=calico-node
```

#### 2. Create the `sorobanpay` namespace and label it

```bash
kubectl create namespace sorobanpay
kubectl label namespace sorobanpay kubernetes.io/metadata.name=sorobanpay
```

#### 3. Deploy test pods with matching labels

```bash
# PostgreSQL stub pod
kubectl run postgresql --image=postgres:16-alpine \
  --namespace=sorobanpay \
  --labels=app=postgresql \
  --env=POSTGRES_PASSWORD=test \
  --port=5432

# API stub pod
kubectl run api --image=busybox \
  --namespace=sorobanpay \
  --labels=app=api \
  --command -- sleep 3600

# Indexer stub pod
kubectl run indexer --image=busybox \
  --namespace=sorobanpay \
  --labels=app=indexer \
  --command -- sleep 3600

# Webhook worker stub pod
kubectl run webhook-worker --image=busybox \
  --namespace=sorobanpay \
  --labels=app=webhook-worker \
  --command -- sleep 3600
```

#### 4. Apply the network policies

```bash
kubectl apply -k deploy/k8s/
```

#### 5. Verify allowed connectivity

```bash
# API → PostgreSQL should succeed (port 5432)
kubectl exec -n sorobanpay api -- \
  nc -zv postgresql 5432

# Indexer → API should fail (no ingress on API from indexer)
kubectl exec -n sorobanpay indexer -- \
  nc -zv api 3001  # expected: timeout / connection refused

# Webhook worker → API should fail (no ingress on API from webhook-worker)
kubectl exec -n sorobanpay webhook-worker -- \
  nc -zv api 3001  # expected: timeout / connection refused
```

#### 6. Verify denied connectivity (default deny)

```bash
# API → Indexer should fail (no egress to indexer, no ingress on indexer)
kubectl exec -n sorobanpay api -- \
  nc -zv indexer 3001  # expected: timeout / connection refused

# API → Webhook worker should fail
kubectl exec -n sorobanpay api -- \
  nc -zv webhook-worker 3001  # expected: timeout / connection refused
```

#### 7. Clean up

```bash
minikube delete
```

---

## Redis StatefulSet (issue #1444)

Redis is used for:
- **Distributed rate limiting** — `ioredis` + `rate-limiter-flexible` in the
  backend so rate limits are shared across all backend replicas.
- **MRR analytics caching** — Payout summary queries are cached in Redis to
  reduce database load during report generation.

### Files

| File | Purpose |
|------|---------|
| `redis-config.yaml` | ConfigMap with `redis.conf` tuned for caching (256MB max, LRU eviction) |
| `redis-service.yaml` | ClusterIP (`redis`) + headless (`redis-headless`) services |
| `redis-statefulset.yaml` | StatefulSet with PVC, resource limits (256Mi / 0.25 CPU), health probes |

### Resource limits

Per the issue acceptance criteria:

| Resource | Request | Limit |
|----------|---------|-------|
| CPU | 125m | 250m (0.25) |
| Memory | 128Mi | 256Mi |

### Health probes

| Probe | Command | Initial Delay | Period | Failure Threshold |
|-------|---------|--------------|--------|-------------------|
| Startup | `redis-cli PING` | 5s | 5s | 6 (30s max) |
| Liveness | `redis-cli PING` | 10s | 15s | 3 |
| Readiness | `redis-cli PING` | 5s | 10s | 3 |

### Configuration

The Redis instance is configured via the `redis-config` ConfigMap. Key settings:

| Setting | Value | Rationale |
|---------|-------|-----------|
| `maxmemory` | 256mb | Matches container memory limit |
| `maxmemory-policy` | allkeys-lru | Evict least-recently-used keys; safe for ephemeral cache |
| `save` | `""` (disabled) | No RDB persistence — cache data is not durable |
| `appendonly` | no | No AOF — same reason |

To enable persistence for disaster recovery, change `save` and `appendonly`
in `redis-config.yaml` and increase the PVC size in `redis-statefulset.yaml`.

### Apply

```bash
kubectl apply -k deploy/k8s/
```

### Verify

```bash
# Check the StatefulSet
kubectl get statefulset redis -n sorobanpay

# Check the pods
kubectl get pods -n sorobanpay -l app=redis

# Verify Redis responds
kubectl exec -n sorobanpay redis-0 -- redis-cli PING
# Expected: PONG
```

### Backend integration

The backend connects to Redis using the `REDIS_URL` environment variable:

```env
REDIS_URL=redis://redis.sorobanpay.svc.cluster.local:6379
```

When `REDIS_URL` is set:
- Rate limiting uses `rate-limiter-flexible` with `ioredis` (distributed)
- MRR/summary queries are cached in Redis (60s TTL)
- The `/health` endpoint reports Redis connectivity status

When `REDIS_URL` is unset:
- Rate limiting falls back to in-memory (per-replica, not shared)
- Caching is disabled (all queries hit the database directly)
- The `/health` endpoint reports `redis: "disabled"` (not a failure)

## All files

| File | Purpose |
|------|---------|
| `kustomization.yaml` | Kustomize manifest listing all resources |
| `network-policy-default-deny.yaml` | Baseline deny-all ingress + egress for the namespace |
| `network-policy-api.yaml` | API pod: ingress from ingress controller, egress to DB + RPC |
| `network-policy-indexer.yaml` | Indexer pod: no ingress, egress to RPC + DB |
| `network-policy-webhook-worker.yaml` | Webhook worker: no ingress, egress to DB + external HTTPS |
| `network-policy-postgresql.yaml` | PostgreSQL: ingress from API, indexer, webhook-worker only |
| `redis-config.yaml` | ConfigMap with redis.conf for caching |
| `redis-service.yaml` | Redis ClusterIP + headless Services |
| `redis-statefulset.yaml` | Redis StatefulSet with PVC, probes, resource limits |
