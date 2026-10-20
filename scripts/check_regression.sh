#!/usr/bin/env bash
# =============================================================================
# SorobanPay — Performance Regression Check
# =============================================================================
# Compares a current benchmark result against a stored baseline and emits
# GitHub Actions warning annotations if any metric exceeds the alert threshold,
# and optionally fails the build if the hard-fail threshold is exceeded.
#
# Usage:
#   bash scripts/check_regression.sh [OPTIONS]
#
# Options:
#   --baseline PATH         Path to the baseline JSON (default: docs/performance-baseline.json)
#   --current  PATH         Path to the current benchmark JSON (default: /tmp/benchmark-current.json)
#   --fail-on-regression    Exit non-zero if any metric exceeds fail_on_increase_pct (25%)
#
# Exit codes:
#   0 — comparison ran successfully; no hard-fail regressions (or --fail-on-regression not set)
#   1 — argument/file error, OR --fail-on-regression set and a metric exceeded the hard-fail threshold
# =============================================================================
set -euo pipefail

BASELINE="${BASELINE_PATH:-docs/performance-baseline.json}"
CURRENT="${CURRENT_PATH:-/tmp/benchmark-current.json}"
FAIL_ON_REGRESSION=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --baseline)            BASELINE="$2"; shift 2 ;;
    --current)             CURRENT="$2";  shift 2 ;;
    --fail-on-regression)  FAIL_ON_REGRESSION=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required for regression checks." >&2
  exit 1
fi

if [ ! -f "$BASELINE" ]; then
  echo "::warning::Baseline file not found at '${BASELINE}'. Skipping regression check."
  echo "  No baseline found — skipping regression comparison." >&2
  exit 0
fi

if [ ! -f "$CURRENT" ]; then
  echo "::warning::Current benchmark result not found at '${CURRENT}'. Skipping regression check."
  echo "  No current results found — skipping regression comparison." >&2
  exit 0
fi

# Read thresholds from the baseline JSON.
# alert_on_increase_pct: emit a warning annotation (default 20)
# fail_on_increase_pct:  exit non-zero when --fail-on-regression is set (default 25)
ALERT_THRESHOLD=$(jq -r '.thresholds.alert_on_increase_pct // 20' "$BASELINE")
FAIL_THRESHOLD=$(jq -r  '.thresholds.fail_on_increase_pct  // 25' "$BASELINE")

WARNINGS=0
HARD_FAILURES=0

echo "Comparing metrics against baseline" >&2
echo "  warn threshold:  +${ALERT_THRESHOLD}%" >&2
echo "  fail threshold:  +${FAIL_THRESHOLD}%" >&2
echo "" >&2

# ── Helper: compare one metric ───────────────────────────────────────────────
check_metric() {
  local entry_point="$1"
  local metric="$2"
  local baseline_val current_val

  baseline_val=$(jq -r ".entry_points.${entry_point}.${metric} // 0" "$BASELINE")
  current_val=$(jq  -r ".entry_points.${entry_point}.${metric} // 0" "$CURRENT")

  # Skip comparison if baseline is zero (unset / not measured)
  if [ "${baseline_val}" = "0" ] || [ "${baseline_val}" = "null" ]; then
    echo "  [SKIP] ${entry_point}.${metric}: baseline=0 (not measured)" >&2
    return
  fi

  if [ "${current_val}" = "0" ] || [ "${current_val}" = "null" ]; then
    echo "  [SKIP] ${entry_point}.${metric}: current=0 (simulation may have failed)" >&2
    return
  fi

  # Percentage change: (current - baseline) / baseline * 100
  local pct_change pct_int
  pct_change=$(awk -v b="$baseline_val" -v c="$current_val" \
    'BEGIN { printf "%.1f", (c - b) / b * 100 }')
  pct_int=$(awk -v p="$pct_change" 'BEGIN { printf "%d", p }')

  local status="OK"

  if [ "$pct_int" -gt "$FAIL_THRESHOLD" ] 2>/dev/null; then
    status="FAIL"
    HARD_FAILURES=$((HARD_FAILURES + 1))
    WARNINGS=$((WARNINGS + 1))
    echo "::error file=contracts/subscription/src/lib.rs::Performance budget exceeded: ${entry_point}.${metric} increased by ${pct_change}% (baseline=${baseline_val}, current=${current_val}, hard-fail threshold=+${FAIL_THRESHOLD}%)"
  elif [ "$pct_int" -gt "$ALERT_THRESHOLD" ] 2>/dev/null; then
    status="WARN"
    WARNINGS=$((WARNINGS + 1))
    echo "::warning file=contracts/subscription/src/lib.rs::Performance regression detected: ${entry_point}.${metric} increased by ${pct_change}% (baseline=${baseline_val}, current=${current_val}, warn threshold=+${ALERT_THRESHOLD}%)"
  fi

  printf "  %-28s %-16s baseline=%-10s current=%-10s change=%+s%%  [%s]\n" \
    "${entry_point}" "${metric}" "${baseline_val}" "${current_val}" "${pct_change}" "${status}" >&2
}

# ── Run comparisons for all 8 entry points ───────────────────────────────────
ALL_ENTRY_POINTS=(
  subscribe
  execute_payment
  cancel
  update_subscription
  pause_subscription
  resume_subscription
  batch_execute_payment
  transfer_subscription
)

for ep in "${ALL_ENTRY_POINTS[@]}"; do
  echo "Entry point: ${ep}" >&2
  check_metric "$ep" "instructions"
  check_metric "$ep" "readBytes"
  check_metric "$ep" "writeBytes"
  check_metric "$ep" "minResourceFee"
  echo "" >&2
done

# ── Summary ───────────────────────────────────────────────────────────────────
echo "──────────────────────────────────────────" >&2
echo "SUMMARY:" >&2
echo "  Warnings (>${ALERT_THRESHOLD}%): ${WARNINGS}" >&2
echo "  Hard failures (>${FAIL_THRESHOLD}%): ${HARD_FAILURES}" >&2
echo "──────────────────────────────────────────" >&2

if [ "$HARD_FAILURES" -gt 0 ] && $FAIL_ON_REGRESSION; then
  echo "FAIL: ${HARD_FAILURES} metric(s) exceeded the +${FAIL_THRESHOLD}% budget threshold." >&2
  echo "  Review the annotations above and either optimise the code or update the baseline" >&2
  echo "  in docs/performance-baseline.json with documented justification." >&2
  exit 1
fi

if [ "$WARNINGS" -gt 0 ]; then
  echo "WARN: ${WARNINGS} metric(s) exceeded the +${ALERT_THRESHOLD}% alert threshold." >&2
else
  echo "PASS: All metrics within threshold (+${ALERT_THRESHOLD}%). No regressions detected." >&2
fi

exit 0
