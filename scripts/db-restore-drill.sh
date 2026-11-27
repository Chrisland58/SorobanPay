#!/usr/bin/env bash
# Automated PostgreSQL restore drill into an isolated database with schema,
# representative record, and RTO/RPO verification.
# Usage: ./scripts/db-restore-drill.sh [BACKUP_FILE]

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/sorobanpay}"
BACKUP_PREFIX="${BACKUP_PREFIX:-sorobanpay}"
BACKUP_FILE="${1:-${BACKUP_FILE:-}}"
RESTORE_DRILL_DATABASE_URL="${RESTORE_DRILL_DATABASE_URL:-}"
BACKUP_ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"
BACKUP_ENCRYPTION_KEY_FILE="${BACKUP_ENCRYPTION_KEY_FILE:-}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
ALERT_CHANNEL="${ALERT_CHANNEL:-#ops-alerts}"
RTO_MAX_SECONDS="${RTO_MAX_SECONDS:-900}"
RPO_MAX_SECONDS="${RPO_MAX_SECONDS:-86400}"
REQUIRED_TABLES="${REQUIRED_TABLES:-Subscription,Payment,AuditLog,_prisma_migrations}"
REPRESENTATIVE_TABLE="${REPRESENTATIVE_TABLE:-Subscription}"
MIN_REPRESENTATIVE_ROWS="${MIN_REPRESENTATIVE_ROWS:-0}"
REPORT_FILE="${REPORT_FILE:-${BACKUP_DIR}/restore-drill-report.json}"

START_EPOCH="$(date +%s)"
TEMP_SQL=""

send_alert() {
  local severity="$1"
  local message="$2"
  local payload
  payload=$(printf '{"channel":"%s","severity":"%s","service":"sorobanpay-restore-drill","timestamp":"%s","message":"%s"}' \
    "$ALERT_CHANNEL" "$severity" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$message")

  echo "[ALERT][$severity] $message" >&2
  if [[ -n "$ALERT_WEBHOOK_URL" ]]; then
    curl -fsS -X POST -H "Content-Type: application/json" -d "$payload" "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || \
      echo "[WARN] Failed to deliver alert to ALERT_WEBHOOK_URL" >&2
  fi
}

cleanup() {
  if [[ -n "$TEMP_SQL" && -f "$TEMP_SQL" ]]; then
    rm -f "$TEMP_SQL"
  fi
}

on_error() {
  local exit_code=$?
  local line_no=$1
  cleanup
  send_alert "critical" "Database restore drill failed at line ${line_no} with exit code ${exit_code}"
  exit "$exit_code"
}

trap 'on_error $LINENO' ERR
trap cleanup EXIT

resolve_encryption_key() {
  if [[ -n "$BACKUP_ENCRYPTION_KEY" ]]; then
    printf '%s' "$BACKUP_ENCRYPTION_KEY"
    return 0
  fi
  if [[ -n "$BACKUP_ENCRYPTION_KEY_FILE" && -r "$BACKUP_ENCRYPTION_KEY_FILE" ]]; then
    tr -d '\r\n' < "$BACKUP_ENCRYPTION_KEY_FILE"
    return 0
  fi
  return 1
}

if [[ -z "$RESTORE_DRILL_DATABASE_URL" ]]; then
  send_alert "critical" "RESTORE_DRILL_DATABASE_URL is not set; refusing to run restore drill"
  exit 1
fi

ENCRYPTION_KEY="$(resolve_encryption_key || true)"
if [[ -z "$ENCRYPTION_KEY" ]]; then
  send_alert "critical" "BACKUP_ENCRYPTION_KEY or readable BACKUP_ENCRYPTION_KEY_FILE is required"
  exit 1
fi

if [[ -z "$BACKUP_FILE" ]]; then
  BACKUP_FILE="$(ls -1t "${BACKUP_DIR}/${BACKUP_PREFIX}-"*.sql.gz.enc 2>/dev/null | head -n 1 || true)"
fi

if [[ -z "$BACKUP_FILE" || ! -f "$BACKUP_FILE" ]]; then
  send_alert "critical" "No encrypted backup file found in ${BACKUP_DIR}"
  exit 1
fi

CHECKSUM_FILE="${BACKUP_FILE}.sha256"
if [[ ! -f "$CHECKSUM_FILE" ]]; then
  send_alert "critical" "Missing checksum file: ${CHECKSUM_FILE}"
  exit 1
fi

echo "[INFO] Verifying checksum for ${BACKUP_FILE}"
(cd "$(dirname "$BACKUP_FILE")" && sha256sum -c "$(basename "$CHECKSUM_FILE")")

# Verify RPO (backup age)
BACKUP_MTIME="$(stat -c %Y "$BACKUP_FILE")"
BACKUP_AGE_SECONDS=$((START_EPOCH - BACKUP_MTIME))
if (( BACKUP_AGE_SECONDS > RPO_MAX_SECONDS )); then
  send_alert "critical" "RPO breached: backup age ${BACKUP_AGE_SECONDS}s exceeds RPO_MAX_SECONDS=${RPO_MAX_SECONDS}s"
  exit 1
fi

TEMP_SQL="$(mktemp /tmp/sorobanpay-restore-XXXXXX.sql)"
chmod 600 "$TEMP_SQL"

echo "[INFO] Decrypting backup into temporary file"
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:ENCRYPTION_KEY -in "$BACKUP_FILE" | gunzip -c > "$TEMP_SQL"

echo "[INFO] Restoring into isolated drill database"
psql "$RESTORE_DRILL_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$TEMP_SQL" >/dev/null

# Validate schema: ensure all required tables exist
IFS=',' read -ra TABLES <<< "$REQUIRED_TABLES"
MISSING_TABLES=()
for tbl in "${TABLES[@]}"; do
  tbl_trimmed="$(echo "$tbl" | xargs)"
  exists="$(psql "$RESTORE_DRILL_DATABASE_URL" -tAc \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${tbl_trimmed}';")"
  if [[ "$exists" != "1" ]]; then
    MISSING_TABLES+=("$tbl_trimmed")
  fi
done

if (( ${#MISSING_TABLES[@]} > 0 )); then
  send_alert "critical" "Restore schema validation failed; missing tables: ${MISSING_TABLES[*]}"
  exit 1
fi

# Validate representative records
REP_COUNT="$(psql "$RESTORE_DRILL_DATABASE_URL" -tAc "SELECT COUNT(*) FROM \"${REPRESENTATIVE_TABLE}\";")"
if (( REP_COUNT < MIN_REPRESENTATIVE_ROWS )); then
  send_alert "critical" "Representative record check failed: ${REPRESENTATIVE_TABLE} has ${REP_COUNT} rows (min ${MIN_REPRESENTATIVE_ROWS})"
  exit 1
fi

END_EPOCH="$(date +%s)"
RESTORE_DURATION_SECONDS=$((END_EPOCH - START_EPOCH))

if (( RESTORE_DURATION_SECONDS > RTO_MAX_SECONDS )); then
  send_alert "critical" "RTO breached: restore took ${RESTORE_DURATION_SECONDS}s, exceeding RTO_MAX_SECONDS=${RTO_MAX_SECONDS}s"
  exit 1
fi

mkdir -p "$(dirname "$REPORT_FILE")"
cat > "$REPORT_FILE" <<EOF
{
  "status": "passed",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "backup_file": "${BACKUP_FILE}",
  "backup_age_seconds": ${BACKUP_AGE_SECONDS},
  "rpo_max_seconds": ${RPO_MAX_SECONDS},
  "restore_duration_seconds": ${RESTORE_DURATION_SECONDS},
  "rto_max_seconds": ${RTO_MAX_SECONDS},
  "verified_tables": "${REQUIRED_TABLES}",
  "representative_table": "${REPRESENTATIVE_TABLE}",
  "representative_row_count": ${REP_COUNT}
}
EOF

echo "[INFO] Restore drill passed in ${RESTORE_DURATION_SECONDS}s (RPO age: ${BACKUP_AGE_SECONDS}s). Report: ${REPORT_FILE}"
