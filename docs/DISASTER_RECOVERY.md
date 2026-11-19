# Disaster Recovery (DR) Exercise & Objectives

## Recovery Objectives

| Objective | Target | Notes |
| --- | --- | --- |
| **RTO (Recovery Time Objective)** | `300000 ms` (5 minutes) | Total elapsed time across all 4 recovery phases. |
| **RPO (Recovery Point Objective)** | `60000 ms` (1 minute) | Maximum acceptable data loss window. |

### Phase Targets

| Phase | Target (ms) | Scope |
| --- | ---: | --- |
| `database_restoration` | 120,000 | Restore non-production database snapshot and verify schema checksum. |
| `indexer_rebuild` | 90,000 | Rebuild or restore indexer state from checkpoint and verify cursor. |
| `service_startup` | 60,000 | Start backend and worker services and verify `/healthz`. |
| `traffic_verification` | 30,000 | Execute synthetic read/write traffic against the non-production API. |

## Scheduled Non-Production Exercise

The GitHub Actions workflow [`.github/workflows/disaster-recovery-exercise.yml`](../.github/workflows/disaster-recovery-exercise.yml) runs weekly on Sundays at `04:00 UTC` (and can be triggered manually via `workflow_dispatch`).

- **Production Safety:** `scripts/dr-exercise.mjs` enforces `assertNonProduction()`, refusing to execute if `ENVIRONMENT` or `NODE_ENV` is `production`/`prod` or if `DATABASE_URL` points to a production/mainnet host.
- **Evidence Capture:** Each run outputs `reports/dr-exercise-report.md` and `reports/dr-exercise-report.json` with per-phase elapsed times, RTO comparison, and identified gaps, and uploads them as workflow artifacts (`dr-exercise-report`, retained for 90 days).
- **Actionable Follow-Up:** Any phase failure or RTO breach fails the workflow and automatically opens a GitHub issue labeled `disaster-recovery` and `ops` with the exact gaps and a link to the workflow run.

## Running Locally

```bash
ENVIRONMENT=non-prod-dr node scripts/dr-exercise.mjs
```

To run the automated unit tests:

```bash
node --test tests/dr-exercise.test.mjs
```
