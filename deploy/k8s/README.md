# deploy/k8s — Kubernetes manifests

Production-grade Kubernetes manifests for all three SorobanPay backend
workloads. Apply everything with:

```bash
kubectl apply -k deploy/k8s/
```

## Directory structure

| File | Purpose |
|---|---|
| `namespace.yaml` | `sorobanpay` namespace |
| `rbac.yaml` | ServiceAccounts, Role, RoleBindings (RBAC) |
| `configmap.yaml` | Non-secret env vars (RPC\_URL, CONTRACT\_ID, …) |
| `secrets.yaml` | **Placeholder** secrets — replace before applying |
| `indexer-deployment.yaml` | Event indexer (1 replica, Recreate strategy) |
| `api-deployment.yaml` | REST API (2 replicas min, HPA to 10) |
| `webhook-worker-deployment.yaml` | Webhook worker (2 replicas, RollingUpdate) |
| `api-service.yaml` | ClusterIP service + Ingress with TLS |
| `hpa.yaml` | HPA: CPU ≥ 70% or Memory ≥ 80% |
| `postgres-statefulset.yaml` | PostgreSQL (dev/CI only — use managed DB in prod) |
| `redis-statefulset.yaml` | Redis reference (future roadmap) |
| `kustomization.yaml` | Kustomize root — applies all of the above |

---

## RBAC design

`rbac.yaml` implements least-privilege RBAC for the three backend workloads.

### ServiceAccounts

One dedicated `ServiceAccount` per workload:

| ServiceAccount | Workload |
|---|---|
| `sorobanpay-indexer` | `indexer-deployment.yaml` |
| `sorobanpay-api` | `api-deployment.yaml` |
| `sorobanpay-webhook-worker` | `webhook-worker-deployment.yaml` |

`automountServiceAccountToken: false` is set on every ServiceAccount to
prevent the default auto-mount of the API server token into every pod.
Workloads that genuinely need to call the Kubernetes API should use a
projected `ServiceAccountToken` volume with a specific audience instead.

### Role

A single namespace-scoped `Role` named `sorobanpay-runtime` is shared by
all three workloads. It grants the minimum permissions needed at runtime:

| Resource | Verbs | Reason |
|---|---|---|
| `secrets` | `get`, `list` | Read database credentials, JWT keys, webhook secrets |
| `configmaps` | `get`, `list` | Read non-secret runtime config (RPC URL, CONTRACT\_ID) |

No write permissions are granted. No cluster-level (`ClusterRole`) access
is used. Pod/Deployment management is left entirely to the control plane.

### RoleBindings

One `RoleBinding` per ServiceAccount binds it to `sorobanpay-runtime`:

| RoleBinding | ServiceAccount |
|---|---|
| `sorobanpay-indexer-runtime` | `sorobanpay-indexer` |
| `sorobanpay-api-runtime` | `sorobanpay-api` |
| `sorobanpay-webhook-worker-runtime` | `sorobanpay-webhook-worker` |

### Extending permissions

If a workload needs additional permissions (e.g., the indexer needs to read
`leases` for leader-election), add a new `Role` + `RoleBinding` scoped to
that workload's `ServiceAccount` rather than broadening `sorobanpay-runtime`.
This keeps the blast radius of any privilege escalation minimal.

---

## Secret management

`secrets.yaml` contains **placeholder base64-encoded values** and must
**never** be applied to a real cluster as-is. Recommended approaches:

- **External Secrets Operator** (recommended): sync from AWS Secrets Manager,
  GCP Secret Manager, or HashiCorp Vault. Replace `secrets.yaml` with an
  `ExternalSecret` CRD.
- **Sealed Secrets**: `kubeseal --format yaml < secrets.yaml > secrets-sealed.yaml`
- **`kubectl create secret`**: generate secrets on-the-fly in CI/CD.

See [`docs/security.md`](../../docs/security.md) for full guidance.

---

## Quick start — minikube

```bash
# 1. Start minikube
minikube start --cpus=4 --memory=4096

# 2. Enable nginx ingress
minikube addons enable ingress

# 3. Build the backend image inside minikube's Docker daemon
eval $(minikube docker-env)
docker build -t sorobanpay/backend:latest backend/

# 4. Create real secrets
kubectl create secret generic sorobanpay-secrets \
  --from-literal=DATABASE_URL="postgresql://sorobanpay:sorobanpay@postgres:5432/sorobanpay?schema=public" \
  --from-literal=WEBHOOK_SECRET="$(openssl rand -hex 32)" \
  --from-literal=ADMIN_JWT_SECRET="$(openssl rand -hex 32)" \
  -n sorobanpay --dry-run=client -o yaml > /tmp/sorobanpay-secrets.yaml

# 5. Apply all manifests
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f /tmp/sorobanpay-secrets.yaml
kubectl apply -k deploy/k8s/

# 6. Verify RBAC
kubectl get serviceaccounts -n sorobanpay
kubectl get roles -n sorobanpay
kubectl get rolebindings -n sorobanpay

# 7. Verify rollouts
kubectl rollout status deployment/sorobanpay-api           -n sorobanpay
kubectl rollout status deployment/sorobanpay-indexer        -n sorobanpay
kubectl rollout status deployment/sorobanpay-webhook-worker -n sorobanpay
```
