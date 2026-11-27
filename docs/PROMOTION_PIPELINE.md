# Multi-Environment Promotion Pipeline

SorobanPay promotes release candidates through `dev → staging → prod` using a single immutable build artifact in [`.github/workflows/promotion-pipeline.yml`](../.github/workflows/promotion-pipeline.yml).

## Immutable Artifact Digest Verification

1. **Build Once (`build-artifact`)**:
   - Builds the Soroban WASM contract and frontend once per commit.
   - Computes the SHA-256 digest (`sha256:<hex>`) of `soroban_subscription_contract.wasm` and records it in `artifact-manifest.json` (`wasm_digest`) and job outputs (`wasm_digest`).
2. **Verify at Every Stage (`deploy-dev`, `deploy-staging`, `deploy-prod`)**:
   - Each deployment job downloads the shared artifact bundle and runs [`scripts/verify-promotion-digest.sh`](../scripts/verify-promotion-digest.sh) `verify` before injecting environment-specific configuration or deploying.
   - Deployment is aborted if the downloaded binary digest does not match both `needs.build-artifact.outputs.wasm_digest` and `artifact-manifest.json`.

## Environment Approvals & Audit History

- **`dev`**: Auto-deploys on pushes to `main` and runs smoke tests.
- **`staging`**: Requires `smoke-test-dev` to pass; runs staging smoke tests.
- **`prod`**: Requires `smoke-test-staging` to pass and enforces GitHub Environment **Required Reviewers** approval.
- **Audit Retention**: `deploy-prod` records `promotion-audit-prod.json` via `scripts/verify-promotion-digest.sh record` (capturing `timestamp`, `actor`, `git_sha`, `artifact_id`, `wasm_digest`, `environment`, `promoted_from`, `workflow_run_id`, and `approval_status`) and uploads it as a workflow artifact with 365-day retention.

## Automated Verification

Run the promotion digest and audit record tests with:

```bash
bash tests/test_promotion_digest.sh
```
