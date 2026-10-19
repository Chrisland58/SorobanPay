# Kubernetes Network Policies — SorobanPay

This directory contains [Kubernetes NetworkPolicy](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
resources that restrict pod-to-pod communication in the SorobanPay cluster
to only what is needed for the application to function.

## Prerequisites

- A CNI (Container Network Interface) plugin that enforces NetworkPolicy,
  e.g. [Calico](https://docs.tigera.io/calico), [Cilium](https://cilium.io),
  or WeaveNet. Without an enforcing CNI, NetworkPolicy resources are silently
  ignored and all traffic is allowed.
- `kubectl` configured against the target cluster.
- [kustomize](https://kustomize.io) (built into `kubectl` ≥ 1.14).

## Policy overview

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

## Apply

```bash
kubectl apply -k deploy/k8s/
```

Or, if you maintain a base `kustomization.yaml` higher in the tree, add the
`deploy/k8s/` directory as a resource:

```yaml
# kustomization.yaml (top-level)
resources:
  - deploy/k8s/
```

### Namespace label

The `default-deny-all` policy uses a namespace selector to allow DNS egress
to the `kube-system` namespace. The CNI must populate the
`kubernetes.io/metadata.name` label, which is standard for Calico and Cilium
clusters running Kubernetes ≥ 1.21.

## Verify

### List policies

```bash
kubectl get networkpolicies -n sorobanpay
```

### Describe a policy

```bash
kubectl describe networkpolicy api-network-policy -n sorobanpay
```

## Testing in minikube with Calico CNI

This section reproduces the acceptance criterion: _Tested in minikube with
Calico CNI_.

### 1. Start minikube with Calico

```bash
minikube start --cni=calico --cpus=2 --memory=4096
```

Confirm Calico is running:

```bash
kubectl get pods -n kube-system -l k8s-app=calico-node
```

### 2. Create the `sorobanpay` namespace and label it

```bash
kubectl create namespace sorobanpay
kubectl label namespace sorobanpay kubernetes.io/metadata.name=sorobanpay
```

### 3. Deploy test pods with matching labels

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

### 4. Apply the network policies

```bash
kubectl apply -k deploy/k8s/
```

### 5. Verify allowed connectivity

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

### 6. Verify denied connectivity (default deny)

```bash
# API → Indexer should fail (no egress to indexer, no ingress on indexer)
kubectl exec -n sorobanpay api -- \
  nc -zv indexer 3001  # expected: timeout / connection refused

# API → Webhook worker should fail
kubectl exec -n sorobanpay api -- \
  nc -zv webhook-worker 3001  # expected: timeout / connection refused
```

### 7. Clean up

```bash
minikube delete
```

## Files

| File | Purpose |
|------|---------|
| `kustomization.yaml` | Kustomize manifest listing all NetworkPolicy resources |
| `network-policy-default-deny.yaml` | Baseline deny-all ingress + egress for the namespace |
| `network-policy-api.yaml` | API pod: ingress from ingress controller, egress to DB + RPC |
| `network-policy-indexer.yaml` | Indexer pod: no ingress, egress to RPC + DB |
| `network-policy-webhook-worker.yaml` | Webhook worker: no ingress, egress to DB + external HTTPS |
| `network-policy-postgresql.yaml` | PostgreSQL: ingress from API, indexer, webhook-worker only |
