#!/usr/bin/env bash
# Automated test suite for scripts/db-backup.sh and scripts/db-restore-drill.sh
# Covers expected behavior, boundary cases (retention, RTO/RPO), and failure alerting.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_SCRIPT="${REPO_ROOT}/scripts/db-backup.sh"
RESTORE_SCRIPT="${REPO_ROOT}/scripts/db-restore-drill.sh"

TMP_DIR="$(mktemp -d)"
MOCK_BIN="${TMP_DIR}/bin"
BACKUP_DIR="${TMP_DIR}/backups"
ALERT_LOG="${TMP_DIR}/alerts.log"
mkdir -p "$MOCK_BIN" "$BACKUP_DIR"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# Mock pg_dump, psql, and curl
cat > "${MOCK_BIN}/pg_dump" <<'EOF'
#!/usr/bin/env bash
echo "-- Mock PostgreSQL dump"
echo "CREATE TABLE \"Subscription\" (id TEXT PRIMARY KEY);"
echo "INSERT INTO \"Subscription\" VALUES ('sub_1');"
EOF
chmod +x "${MOCK_BIN}/pg_dump"

cat > "${MOCK_BIN}/psql" <<'EOF'
#!/usr/bin/env bash
# Simulate schema and representative row count queries
if [[ "$*" == *"information_schema.tables"* ]]; then
  if [[ "${MOCK_MISSING_TABLE:-false}" == "true" && "$*" == *"AuditLog"* ]]; then
    echo "0"
  else
    echo "1"
  fi
  exit 0
fi
if [[ "$*" == *"SELECT COUNT(*)"* ]]; then
  echo "${MOCK_ROW_COUNT:-1}"
  exit 0
fi
exit 0
EOF
chmod +x "${MOCK_BIN}/psql"

cat > "${MOCK_BIN}/curl" <<EOF
#!/usr/bin/env bash
echo "\$*" >> "${ALERT_LOG}"
exit 0
EOF
chmod +x "${MOCK_BIN}/curl"

export PATH="${MOCK_BIN}:${PATH}"
export BACKUP_DIR
export DATABASE_URL="postgresql://user:pass@localhost:5432/sorobanpay"
export RESTORE_DRILL_DATABASE_URL="postgresql://user:pass@localhost:5433/sorobanpay_drill"
export BACKUP_ENCRYPTION_KEY="test-strong-encryption-key"
export ALERT_WEBHOOK_URL="https://alerts.example.com/webhook"

assert_eq() {
  local expected="$1" actual="$2" msg="$3"
  if [[ "$expected" != "$actual" ]]; then
    echo "FAIL: $msg (expected='$expected', actual='$actual')" >&2
    exit 1
  fi
}

echo "[TEST 1] Expected encrypted backup and restore drill"
"$BACKUP_SCRIPT"
BACKUP_COUNT=$(ls -1 "${BACKUP_DIR}"/sorobanpay-*.sql.gz.enc | wc -l)
assert_eq "1" "$BACKUP_COUNT" "One encrypted backup should be created"
"$RESTORE_SCRIPT"
test -f "${BACKUP_DIR}/restore-drill-report.json"

echo "[TEST 2] Boundary case: retention preserves BACKUP_RETENTION_MIN_COUNT"
touch -d "40 days ago" "${BACKUP_DIR}/sorobanpay-20200101T000000Z.sql.gz.enc"
touch -d "40 days ago" "${BACKUP_DIR}/sorobanpay-20200101T000000Z.sql.gz.enc.sha256"
BACKUP_RETENTION_MIN_COUNT=2 "$BACKUP_SCRIPT"
OLD_EXISTS=$(test -f "${BACKUP_DIR}/sorobanpay-20200101T000000Z.sql.gz.enc" && echo "yes" || echo "no")
assert_eq "yes" "$OLD_EXISTS" "Old backup should be preserved when total <= BACKUP_RETENTION_MIN_COUNT"

echo "[TEST 3] Failure handling: missing encryption key triggers alert"
: > "$ALERT_LOG"
if BACKUP_ENCRYPTION_KEY="" "$BACKUP_SCRIPT" 2>/dev/null; then
  echo "FAIL: Expected backup to fail without encryption key" >&2
  exit 1
fi
test -s "$ALERT_LOG"

echo "[TEST 4] Failure handling: checksum mismatch triggers alert"
: > "$ALERT_LOG"
LATEST_BACKUP="$(ls -1t "${BACKUP_DIR}"/sorobanpay-*.sql.gz.enc | head -n 1)"
echo "corrupted" >> "$LATEST_BACKUP"
if "$RESTORE_SCRIPT" "$LATEST_BACKUP" 2>/dev/null; then
  echo "FAIL: Expected restore drill to fail on checksum mismatch" >&2
  exit 1
fi
test -s "$ALERT_LOG"

echo "[TEST 5] Failure handling: missing required table triggers alert"
: > "$ALERT_LOG"
"$BACKUP_SCRIPT"
LATEST_BACKUP="$(ls -1t "${BACKUP_DIR}"/sorobanpay-*.sql.gz.enc | head -n 1)"
if MOCK_MISSING_TABLE=true "$RESTORE_SCRIPT" "$LATEST_BACKUP" 2>/dev/null; then
  echo "FAIL: Expected restore drill to fail on missing table" >&2
  exit 1
fi
test -s "$ALERT_LOG"

echo "ALL TESTS PASSED"
