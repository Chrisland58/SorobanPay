#!/usr/bin/env bash
set -euo pipefail

# Validates environment-scoped workflow concurrency rules and partial-rollout guards
# across SorobanPay's deployment pipelines.

WORKFLOW_DIR=".github/workflows"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

assert_contains() {
  local file="$1"
  local pattern="$2"
  local msg="$3"
  if ! grep -qE "$pattern" "$file"; then
    fail "$msg (missing /$pattern/ in $file)"
  fi
}

# 1. Testnet preview/push workflow cancels superseded runs and guards against partial rollouts
DEPLOY_TESTNET="$WORKFLOW_DIR/deploy-testnet.yml"
assert_contains "$DEPLOY_TESTNET" "^concurrency:" "deploy-testnet.yml must define concurrency"
assert_contains "$DEPLOY_TESTNET" "group:[[:space:]]*deploy-testnet-" "deploy-testnet.yml must scope concurrency group to deploy-testnet"
assert_contains "$DEPLOY_TESTNET" "cancel-in-progress:[[:space:]]*true" "deploy-testnet.yml should cancel superseded testnet runs"
assert_contains "$DEPLOY_TESTNET" "^  verify-rollout:" "deploy-testnet.yml must include verify-rollout job"
assert_contains "$DEPLOY_TESTNET" "needs\.deploy-contract\.result.*!=.*\"success\"" "verify-rollout must fail if deploy-contract did not succeed"
assert_contains "$DEPLOY_TESTNET" "needs\.deploy-frontend\.result.*!=.*\"success\"" "verify-rollout must fail if deploy-frontend did not succeed"

# 2. Testnet full deployment workflow queues rather than interrupting mid-deploy
TESTNET_DEPLOY="$WORKFLOW_DIR/testnet-deploy.yml"
assert_contains "$TESTNET_DEPLOY" "^concurrency:" "testnet-deploy.yml must define concurrency"
assert_contains "$TESTNET_DEPLOY" "group:[[:space:]]*testnet-deployment" "testnet-deploy.yml must scope concurrency group to testnet-deployment"
assert_contains "$TESTNET_DEPLOY" "cancel-in-progress:[[:space:]]*false" "testnet-deploy.yml must not cancel mid-deploy"

# 3. Promotion/production pipeline must never silently interrupt running releases
PROMOTION="$WORKFLOW_DIR/promotion-pipeline.yml"
assert_contains "$PROMOTION" "^concurrency:" "promotion-pipeline.yml must define concurrency"
assert_contains "$PROMOTION" "group:[[:space:]]*\"promotion-" "promotion-pipeline.yml must scope concurrency group to promotion"
assert_contains "$PROMOTION" "cancel-in-progress:[[:space:]]*false" "promotion-pipeline.yml must never cancel a running promotion"

echo "PASS: All deployment workflow concurrency and rollout-guard checks passed."
