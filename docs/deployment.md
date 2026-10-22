# SorobanPay — Production Deployment Guide

This guide covers all deployment targets: mainnet smart contract, Docker, Kubernetes, monitoring with Prometheus and Grafana, contract upgrade procedures, and rollback.

---

## Table of Contents

1. [Mainnet Deployment Checklist](#1-mainnet-deployment-checklist)
2. [Deploying the Smart Contract](#2-deploying-the-smart-contract)
3. [Docker Deployment](#3-docker-deployment)
4. [Kubernetes Production Guide](#4-kubernetes-production-guide)
5. [Monitoring with Prometheus and Grafana](#5-monitoring-with-prometheus-and-grafana)
6. [Contract Upgrade Procedure](#6-contract-upgrade-procedure)
7. [Rollback Procedure](#7-rollback-procedure)
8. [Environment Variables Reference](#8-environment-variables-reference)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Mainnet Deployment Checklist

Complete every item before going live on Stellar Mainnet.

### Smart contract

- [ ] Run `make build` — WASM compiles without errors.
- [ ] Run `make test` — all contract unit and property tests pass.
- [ ] Run `bash scripts/integration-test.sh` — full subscribe → execute → cancel lifecycle passes.
- [ ] Deploy to **Testnet** first and exercise the full user flow manually.
- [ ] Capture the deployed testnet contract address and verify all entry points in Stellar Expert.
- [ ] Repeat the full deploy + smoke test on mainnet with a small amount before announcing.

### Frontend

- [ ] Run `npm run type-check` in `frontend/` — no TypeScript errors.
- [ ] Run `npm run build` — Next.js production build succeeds.
- [ ] Set all three required env vars in production:
  - `NEXT_PUBLIC_CONTRACT_ID`
  - `NEXT_PUBLIC_RPC_URL` (use a reliable mainnet RPC — not the public testnet endpoint)
  - `NEXT_PUBLIC_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015`
- [ ] Verify Freighter connects and a test subscription can be signed on Mainnet.

### Backend

- [ ] All secrets stored in a secret manager — not in `.env` files committed to Git.
- [ ] `DATABASE_URL` points to a production database with backups enabled.
- [ ] `CONTRACT_ID` matches the deployed mainnet contract address.
- [ ] `OPERATOR_SECRET` set only if `PaymentScheduler` is actively needed.
- [ ] `/health` endpoint returns `200 OK`.
- [ ] Event indexer is polling successfully (check indexer lag metric).

### Security

- [ ] Review [docs/security.md](./security.md) — all secrets managed correctly.
- [ ] `NEXT_PUBLIC_` variables contain no private keys or secrets.
- [ ] Testnet keys rotated before mainnet deployment.
- [ ] `cargo audit` and `npm audit --audit-level=high` passing in CI.
- [ ] Merchant production accounts use multisig (2-of-N).

### Legal and compliance

> These templates are **not legal advice**. Consult qualified legal counsel before publishing.

- [ ] Customize and publish a **Privacy Policy** (template: [docs/templates/privacy-policy.md](./templates/privacy-policy.md)).
- [ ] Customize and publish **Terms of Service** (template: [docs/templates/terms-of-service.md](./templates/terms-of-service.md)).
- [ ] Fill in all `[PLACEHOLDER]` sections in both documents.
- [ ] Link both documents from your product's footer or onboarding flow.

### Monitoring

- [ ] Alerting configured for RPC endpoint availability.
- [ ] Alerting configured for event indexer lag exceeding 2 × poll interval.
- [ ] Error tracking (e.g., Sentry) configured for the frontend.
- [ ] Uptime monitoring on the backend `/health` endpoint.

---

## 2. Deploying the Smart Contract

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust (stable) | ≥ 1.75 | https://rustup.rs |
| `wasm32-unknown-unknown` target | — | `rustup target add wasm32-unknown-unknown` |
| Stellar CLI | ≥ 21.x | https://developers.stellar.org/docs/tools/stellar-cli |

### Build

```bash
make build
```

Produces: `contracts/target/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm`

### Deploy to testnet

```bash
# 1. Generate identity (one-time)
stellar keys generate alice --network testnet

# 2. Fund via Friendbot (testnet only)
stellar keys fund alice --network testnet

# 3. Deploy
CONTRACT_ID=$(bash deploy/deploy.sh)
echo "Testnet contract: $CONTRACT_ID"
```

### Deploy to mainnet

Mainnet requires a real funded account. There is no Friendbot on mainnet.

```bash
# 1. Generate mainnet identity (one-time)
stellar keys generate my-mainnet-id --network mainnet

# 2. Print the public key and fund with real XLM (minimum ~2 XLM for base reserve + fee)
stellar keys address my-mainnet-id

# 3. Deploy
STELLAR_NETWORK=mainnet STELLAR_IDENTITY=my-mainnet-id bash deploy/deploy.sh
```

Capture the output contract address and store it securely — you will need it for the frontend and backend configuration.

```bash
CONTRACT_ID=$(STELLAR_NETWORK=mainnet STELLAR_IDENTITY=my-mainnet-id bash deploy/deploy.sh)
echo "Mainnet contract: $CONTRACT_ID"
```

### Smoke test after deploy

```bash
bash deploy/smoke_test.sh
```

Verifies: `version` and `contract_name` entry points return expected values, and a full subscribe → execute_payment → cancel lifecycle completes without errors.

---

## 3. Docker Deployment

### Directory structure

```
SorobanPay/
├── backend/
│   ├── Dockerfile          # Node.js backend image
│   └── .env.example
├── frontend/
│   ├── Dockerfile          # Next.js frontend image
│   └── .env.example
└── docker-compose.yml      # Local and staging compose config
```

### Backend Dockerfile

```dockerfile
# backend/Dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

EXPOSE 3001
USER node
CMD ["node", "dist/index.js"]
```

### Frontend Dockerfile

```dockerfile
# frontend/Dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

ARG NEXT_PUBLIC_CONTRACT_ID
ARG NEXT_PUBLIC_RPC_URL
ARG NEXT_PUBLIC_NETWORK_PASSPHRASE
ENV NEXT_PUBLIC_CONTRACT_ID=$NEXT_PUBLIC_CONTRACT_ID
ENV NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL
ENV NEXT_PUBLIC_NETWORK_PASSPHRASE=$NEXT_PUBLIC_NETWORK_PASSPHRASE

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./

EXPOSE 3000
USER node
CMD ["npm", "start"]
```

### docker-compose.yml (staging / local)

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: sorobanpay
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: sorobanpay
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sorobanpay"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    env_file: ./backend/.env
    environment:
      DATABASE_URL: postgres://sorobanpay:${POSTGRES_PASSWORD}@postgres:5432/sorobanpay
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "3001:3001"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        NEXT_PUBLIC_CONTRACT_ID: ${NEXT_PUBLIC_CONTRACT_ID}
        NEXT_PUBLIC_RPC_URL: ${NEXT_PUBLIC_RPC_URL}
        NEXT_PUBLIC_NETWORK_PASSPHRASE: ${NEXT_PUBLIC_NETWORK_PASSPHRASE}
    depends_on:
      - backend
    ports:
      - "3000:3000"
    restart: unless-stopped

volumes:
  postgres_data:
```

### Build and run

```bash
# Build images
docker compose build

# Start services (detached)
docker compose up -d

# View logs
docker compose logs -f backend
docker compose logs -f frontend

# Check health
curl http://localhost:3001/health
curl http://localhost:3000

# Stop
docker compose down
```

### Production image best practices

- Pin base image to a specific digest: `FROM node:20-alpine@sha256:abc123...`
- Run containers as a non-root user (`USER node`).
- Use multi-stage builds to keep the final image minimal.
- Never copy `.env` files into the image — inject environment variables at runtime via Docker secrets or platform env dashboard.
- Scan images for vulnerabilities: `docker scout cves sorobanpay-backend:latest`

---

## 4. Kubernetes Production Guide

### Cluster requirements

- Kubernetes ≥ 1.27
- Helm ≥ 3.12
- A managed PostgreSQL instance (AWS RDS, GCP Cloud SQL, Azure Database for PostgreSQL)
- A Kubernetes secret store integration (External Secrets Operator or Sealed Secrets)
- An ingress controller (nginx-ingress or AWS ALB Ingress Controller)
- `cert-manager` for TLS certificate management

### Namespace

```bash
kubectl create namespace sorobanpay
```

### Secrets

Use External Secrets Operator to sync secrets from AWS Secrets Manager (see [docs/security.md](./security.md#external-secrets-operator-kubernetes)):

```bash
# Verify secrets are synced
kubectl get externalsecrets -n sorobanpay
kubectl get secrets -n sorobanpay
```

### Backend deployment

```yaml
# k8s/backend-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: sorobanpay
  labels:
    app: sorobanpay-backend
    version: "1.0.0"
spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: sorobanpay-backend
  template:
    metadata:
      labels:
        app: sorobanpay-backend
        version: "1.0.0"
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/path: "/metrics"
        prometheus.io/port: "3001"
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
      containers:
        - name: backend
          image: your-registry/sorobanpay-backend:1.0.0
          imagePullPolicy: Always
          ports:
            - containerPort: 3001
          envFrom:
            - secretRef:
                name: sorobanpay-backend-secrets
          env:
            - name: NODE_ENV
              value: production
            - name: PORT
              value: "3001"
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /health
              port: 3001
            initialDelaySeconds: 10
            periodSeconds: 10
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /health
              port: 3001
            initialDelaySeconds: 30
            periodSeconds: 30
            failureThreshold: 3
```

### Backend service

```yaml
# k8s/backend-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: backend
  namespace: sorobanpay
spec:
  selector:
    app: sorobanpay-backend
  ports:
    - name: http
      port: 3001
      targetPort: 3001
```

### Frontend deployment

```yaml
# k8s/frontend-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: sorobanpay
  labels:
    app: sorobanpay-frontend
spec:
  replicas: 2
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: sorobanpay-frontend
  template:
    metadata:
      labels:
        app: sorobanpay-frontend
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
      containers:
        - name: frontend
          image: your-registry/sorobanpay-frontend:1.0.0
          imagePullPolicy: Always
          ports:
            - containerPort: 3000
          env:
            - name: NODE_ENV
              value: production
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 30
```

### Ingress with TLS

```yaml
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: sorobanpay-ingress
  namespace: sorobanpay
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  tls:
    - hosts:
        - app.yourdomain.com
        - api.yourdomain.com
      secretName: sorobanpay-tls
  rules:
    - host: app.yourdomain.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend
                port:
                  number: 3000
    - host: api.yourdomain.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: backend
                port:
                  number: 3001
```

### Horizontal Pod Autoscaler

```yaml
# k8s/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: backend-hpa
  namespace: sorobanpay
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: backend
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

### Apply all manifests

```bash
kubectl apply -f k8s/backend-deployment.yaml
kubectl apply -f k8s/backend-service.yaml
kubectl apply -f k8s/frontend-deployment.yaml
kubectl apply -f k8s/frontend-service.yaml
kubectl apply -f k8s/ingress.yaml
kubectl apply -f k8s/hpa.yaml

# Verify rollouts
kubectl rollout status deployment/backend -n sorobanpay
kubectl rollout status deployment/frontend -n sorobanpay

# Check pods
kubectl get pods -n sorobanpay
```

---

## 5. Monitoring with Prometheus and Grafana

### Prometheus setup

The backend exposes a `/metrics` endpoint in Prometheus exposition format. Ensure the `prometheus.io/scrape: "true"` annotation is present on the backend Pod (already included in the manifest above).

```yaml
# prometheus/scrape-config-addition.yaml
# Add to your existing Prometheus scrape_configs:
scrape_configs:
  - job_name: "sorobanpay-backend"
    kubernetes_sd_configs:
      - role: pod
        namespaces:
          names: ["sorobanpay"]
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: "true"
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
        action: replace
        target_label: __metrics_path__
        regex: (.+)
      - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
        action: replace
        regex: ([^:]+)(?::\d+)?;(\d+)
        replacement: $1:$2
        target_label: __address__
```

### Key metrics to monitor

| Metric | Type | Alert threshold |
|--------|------|-----------------|
| `sorobanpay_events_indexed_total` | Counter | — (track rate) |
| `sorobanpay_indexer_lag_ledgers` | Gauge | Alert if > 100 ledgers |
| `sorobanpay_payment_success_total` | Counter | — (track rate) |
| `sorobanpay_payment_failure_total` | Counter | Alert if > 10 failures/min |
| `sorobanpay_http_request_duration_seconds` | Histogram | Alert if p99 > 2s |
| `sorobanpay_rpc_errors_total` | Counter | Alert if > 5/min |
| `process_resident_memory_bytes` | Gauge | Alert if > 80% of limit |

### Prometheus alert rules

```yaml
# prometheus/alerts.yaml
groups:
  - name: sorobanpay
    rules:
      - alert: IndexerLagHigh
        expr: sorobanpay_indexer_lag_ledgers > 100
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Event indexer lag is high ({{ $value }} ledgers)"
          description: "The indexer is more than 100 ledgers behind. Check RPC connectivity."

      - alert: PaymentFailureRateHigh
        expr: rate(sorobanpay_payment_failure_total[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High payment failure rate ({{ $value | humanize }}/s)"
          description: "More than 10% of payment attempts are failing. Check subscriber balances."

      - alert: BackendDown
        expr: up{job="sorobanpay-backend"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "SorobanPay backend is down"
          description: "Backend pod is not scraping. Check pod status."

      - alert: RPCErrorRateHigh
        expr: rate(sorobanpay_rpc_errors_total[5m]) > 0.083
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "RPC error rate is high"
          description: "More than 5 RPC errors per minute. Check RPC endpoint availability."
```

### Grafana dashboard

Import or build a dashboard with the following panels:

1. **Subscription overview:** total active subscriptions, new subscriptions per hour, cancellations per hour.
2. **Payment collection:** successful payments per hour, failed payments per hour, failure rate (%).
3. **Indexer health:** indexer lag (ledgers), events indexed per minute, last successful poll timestamp.
4. **HTTP API:** request rate, p50/p95/p99 latency, error rate (5xx).
5. **Infrastructure:** CPU usage, memory usage, pod count, restart count.

**Quick start with docker-compose:**

```yaml
# Add to docker-compose.yml
  prometheus:
    image: prom/prometheus:v2.45.0
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    command:
      - "--config.file=/etc/prometheus/prometheus.yml"
      - "--storage.tsdb.retention.time=30d"
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana:10.0.0
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD}
    volumes:
      - grafana_data:/var/lib/grafana
    ports:
      - "3003:3000"
    depends_on:
      - prometheus

volumes:
  prometheus_data:
  grafana_data:
```

```yaml
# monitoring/prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: "sorobanpay-backend"
    static_configs:
      - targets: ["backend:3001"]
    metrics_path: /metrics
```

---

## 6. Contract Upgrade Procedure

Soroban contracts are **immutable** once deployed. There is no in-place upgrade — a fix requires deploying a new contract instance and migrating all consumers. This is the SorobanPay two-phase upgrade procedure.

### When to upgrade

- Critical bug fix in contract logic.
- New entry points or features required.
- Breaking change in the Soroban SDK that requires a recompile.

### Phase 1 — Prepare

1. **Branch and develop:** Create a feature branch, write the fix, write tests.
2. **Test thoroughly:**
   ```bash
   make test
   bash scripts/integration-test.sh
   ```
3. **Deploy to testnet first:**
   ```bash
   CONTRACT_ID_TESTNET=$(bash deploy/deploy.sh)
   echo "New testnet contract: $CONTRACT_ID_TESTNET"
   ```
4. **Smoke test the new testnet contract:**
   ```bash
   CONTRACT_ID=$CONTRACT_ID_TESTNET bash deploy/smoke_test.sh
   ```
5. **Document the migration plan:** List all consumers (frontend, backend, merchant integrations) and the order in which they will be updated.

### Phase 2 — Deploy to mainnet

```bash
# Build the new WASM
make build

# Deploy
NEW_CONTRACT_ID=$(STELLAR_NETWORK=mainnet STELLAR_IDENTITY=my-mainnet-id bash deploy/deploy.sh)
echo "New mainnet contract: $NEW_CONTRACT_ID"
```

### Phase 3 — Migrate consumers

Perform the following steps in order. Do not skip ahead — consumers pointing to the old contract should continue to work until they are individually migrated.

1. **Update backend:**
   ```bash
   # Update CONTRACT_ID environment variable and restart
   # Fly.io:
   flyctl secrets set CONTRACT_ID="$NEW_CONTRACT_ID"
   flyctl restart

   # Kubernetes:
   kubectl set env deployment/backend CONTRACT_ID="$NEW_CONTRACT_ID" -n sorobanpay
   kubectl rollout restart deployment/backend -n sorobanpay
   kubectl rollout status deployment/backend -n sorobanpay
   ```

2. **Update frontend:**
   ```bash
   # Update NEXT_PUBLIC_CONTRACT_ID in production env and redeploy
   # Vercel:
   vercel env rm NEXT_PUBLIC_CONTRACT_ID production
   vercel env add NEXT_PUBLIC_CONTRACT_ID production
   vercel --prod

   # Docker Compose / Kubernetes: rebuild the frontend image with the new ARG value
   docker build --build-arg NEXT_PUBLIC_CONTRACT_ID="$NEW_CONTRACT_ID" -t frontend:new ./frontend
   ```

3. **Notify merchants with direct integrations:**
   - Send email/webhook notification with the new contract address.
   - Provide a migration deadline (recommend 30 days).
   - Publish migration instructions.

4. **Instruct subscribers:**
   - Existing subscriptions on the old contract are **not portable**.
   - Subscribers must create new subscriptions on the new contract.
   - Announce via status page, Discord, email, and in-app notification.

5. **Verify the new contract is receiving traffic:**
   - Check the backend indexer is picking up events from the new `CONTRACT_ID`.
   - Verify at least one successful `subscribe` and `execute_payment` on the new contract.

### Phase 4 — Deprecate the old contract

Once all consumers have migrated (or after the migration deadline):

1. Announce a final sunset date for the old contract.
2. The old contract continues to function on-chain indefinitely (it is immutable), but SorobanPay will no longer support it.
3. Update the README, changelogs, and all documentation with the new contract address.

---

## 7. Rollback Procedure

### Rolling back the backend

If a backend deployment introduces a bug, roll back to the previous image:

```bash
# Kubernetes — roll back to the previous ReplicaSet
kubectl rollout undo deployment/backend -n sorobanpay
kubectl rollout status deployment/backend -n sorobanpay

# Fly.io
flyctl releases list               # find the previous release number
flyctl deploy --image <old-image>

# Docker Compose
docker compose pull backend        # pull previous tag
docker compose up -d --force-recreate backend
```

### Rolling back the frontend

```bash
# Kubernetes
kubectl rollout undo deployment/frontend -n sorobanpay

# Vercel — instant rollback to previous deployment
vercel rollback <deployment-url>

# Docker Compose — tag the previous image and redeploy
docker compose up -d --force-recreate frontend
```

### Rolling back a contract deployment

**There is no on-chain rollback for Soroban contracts.** A deployed contract is immutable and cannot be reverted. The only remediation is:

1. Deploy the previous WASM to a new contract address.
2. Migrate all consumers to the previous contract address (following the same procedure as a forward upgrade).

This is why testnet validation and thorough testing are mandatory before every mainnet deployment.

### Emergency rollback checklist

- [ ] Identify the bug and confirm it is not also present in the rollback target.
- [ ] Notify the team before rolling back (to avoid conflicting actions).
- [ ] Roll back the backend first (no user-visible change).
- [ ] Verify `/health` returns `200 OK` after rollback.
- [ ] Roll back the frontend.
- [ ] Verify the frontend loads and Freighter connects.
- [ ] Monitor error rates for 15 minutes post-rollback.
- [ ] File a post-mortem issue describing the bug and how the rollback was triggered.

---

## 8. Environment Variables Reference

### Contract deployment

| Variable | Default | Description |
|----------|---------|-------------|
| `STELLAR_NETWORK` | `testnet` | Target network: `testnet` or `mainnet` |
| `STELLAR_IDENTITY` | `alice` | Stellar CLI identity alias used to sign and pay fees |

### Frontend

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_CONTRACT_ID` | ✅ | Deployed contract address (`C…`) |
| `NEXT_PUBLIC_RPC_URL` | ✅ | Soroban RPC endpoint |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | ✅ | Must match Freighter's selected network |

### Backend

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `CONTRACT_ID` | ✅ | Deployed contract address |
| `RPC_URL` | ✅ | Soroban RPC endpoint for event indexing |
| `NETWORK_PASSPHRASE` | ✅ | Stellar network passphrase |
| `PORT` | No (default: 3001) | HTTP server port |
| `OPERATOR_SECRET` | No | Stellar secret key for `PaymentScheduler` — omit if not needed |
| `WEBHOOK_SECRET` | No | HMAC-SHA256 key for webhook signatures |

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `ERROR: Contract build failed` | Missing Rust toolchain or `wasm32` target | `rustup target add wasm32-unknown-unknown` |
| `ERROR: WASM artifact not found` | Build output missing | Check `make build`; ensure `opt-level = "z"` in `Cargo.toml` |
| `ERROR: Contract deployment failed` | Identity not funded or CLI misconfigured | Fund account; verify with `stellar keys address <identity>` |
| `ERROR: Unknown STELLAR_NETWORK` | Typo in env var | Allowed values: exactly `testnet` or `mainnet` |
| Empty contract ID returned | RPC unreachable or rate-limited | Retry; check RPC URL connectivity |
| Frontend shows "Contract not configured" | `NEXT_PUBLIC_CONTRACT_ID` not set | Set in `.env.local` and restart dev server |
| Backend `/health` returns 500 | `DATABASE_URL` wrong or DB unreachable | Check connection string; verify DB is running |
| Indexer lag growing | RPC endpoint slow or unresponsive | Switch to backup RPC; check network status |
| `PaymentNotDue` on valid subscription | Merchant calling too early | Query `get_subscription` to check `next_payment` timestamp |
| `NoActiveSubscription` on known pair | Entry TTL expired | Subscriber must re-subscribe; see [README Storage TTL](../README.md#storage-ttl) |
| Pods stuck in `Pending` | Insufficient cluster resources | Increase node count or resource limits |
| Pod `OOMKilled` | Memory limit too low | Increase `resources.limits.memory` in deployment manifest |
