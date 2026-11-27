# CI Dependency Cache Integrity

This document describes how SorobanPay scopes CI dependency caches and enforces trust boundaries between untrusted pull-request workflows and privileged release/deployment workflows.

## Cache Key Scoping

All `actions/cache` keys must include:

1. **Operating System**: `${{ runner.os }}`
2. **Toolchain Version/Hash**:
   - Rust workflows: `${{ steps.rust-toolchain.outputs.rustc_hash }}` (from `dtolnay/rust-toolchain@stable`) or `Swatinem/rust-cache@v2` (which hashes `rustc -vV` automatically).
   - Node.js workflows: `${{ steps.setup-node.outputs.node-version }}`
3. **Lockfile Hash**:
   - Rust: `hashFiles('contracts/subscription/Cargo.toml', 'contracts/subscription/Cargo.lock')`
   - Node.js: `hashFiles('frontend/package-lock.json')` or `hashFiles('backend/package-lock.json')`

Broad `restore-keys` prefixes are disallowed on `actions/cache` steps so that lockfile or toolchain changes strictly invalidate the cache rather than falling back to stale artifacts.

## Trust-Boundary Isolation

Release and deployment workflows (`.github/workflows/promotion-pipeline.yml`, `.github/workflows/deploy-testnet.yml`, and `.github/workflows/testnet-deploy.yml`) use isolated `release-` cache namespaces:

- **Rust (`Swatinem/rust-cache@v2`)**:
  - `prefix-key: release-rust-`
  - `save-if: ${{ github.event_name != 'pull_request' }}`
- **Node.js (`actions/cache@v4`)**:
  - `key: release-npm-${{ runner.os }}-node-${{ steps.setup-node.outputs.node-version }}-${{ hashFiles('frontend/package-lock.json') }}`
  - `lookup-only: ${{ github.event_name == 'pull_request' }}`

Untrusted `pull_request` workflows (such as `.github/workflows/mutation-tests.yml`) are configured with `lookup-only: ${{ github.event_name == 'pull_request' }}` and cannot write cache entries consumed by release jobs.

## Automated Verification

Cache integrity rules are enforced by `tests/ci/test_cache_integrity.py`, which validates all `.github/workflows/*.yml` files:

```bash
python3 -m unittest tests/ci/test_cache_integrity.py
```
