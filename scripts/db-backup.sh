#!/usr/bin/env bash
# Encrypted PostgreSQL backup script with retention management and failure alerting.
# Usage: ./scripts/db-backup.sh [--dry-run]

set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

BACKUP_DIR="${BACKUP_DIR:-/var/backups/sorobanpay}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_RETENTION_MIN_COUNT="${BACKUP_RETENTION_MIN_COUNT:-7}"
DATABASE_URL="${DATABASE_URL:-}"
BACKUP_ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY:-}"
BACKUP_ENCRYPTION_KEY_FILE="${BACKUP_ENCRYPTION_KEY_FILE:-}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
ALERT_CHANNEL="${ALERT_CHANNEL:-#ops-alerts}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_PREFIX="${BACKUP_PREFIX:-sorobanpay}"
BACKUP_FILE="${BACKUP_DIR}/${BACKUP_PREFIX}-${TIMESTAMP}.sql.gz.enc"
CHECKSUM_FILE="${BACKUP_FILE}.sha256"

send_alert() {
  local severity="$1"
  local message="$2"
  local payload
  payload=$(printf '{"channel":"%s","severity":"%s","service":"sorobanpay-db-backup","timestamp":"%s","message":"%s"}' \
    "$ALERT_CHANNEL" "$severity" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$message")

  echo "[ALERT][$severity] $message" >&2
  if [[ -n "$ALERT_WEBHOOK_URL" ]]; then
    curl -fsS -X POST -H "Content-Type: application/json" -d "$payload" "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || \
      echo "[WARN] Failed to deliver alert to ALERT_WEBHOOK_URL" >&2
  fi
}

on_error() {
  local exit_code=$?
  local line_no=$1
  rm -f "${BACKUP_FILE}.tmp" "$BACKUP_FILE" "$CHECKSUM_FILE" 2>/dev/null || true
  send_alert "critical" "Database backup failed at line ${line_no} with exit code ${exit_code}"
  exit "$exit_code"
}

trap 'on_error $LINENO' ERR

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

if [[ -z "$DATABASE_URL" ]]; then
  send_alert "critical" "DATABASE_URL is not set; cannot perform database backup"
  exit 1
fi

ENCRYPTION_KEY="$(resolve_encryption_key || true)"
if [[ -z "$ENCRYPTION_KEY" ]]; then
  send_alert "critical" "BACKUP_ENCRYPTION_KEY or readable BACKUP_ENCRYPTION_KEY_FILE is required"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[DRY-RUN] Would dump DATABASE_URL to ${BACKUP_FILE} (AES-256-CBC + PBKDF2)"
  echo "[DRY-RUN] Would enforce retention: ${BACKUP_RETENTION_DAYS} days, min ${BACKUP_RETENTION_MIN_COUNT} backups"
  exit 0
fi

echo "[INFO] Starting encrypted database backup to ${BACKUP_FILE}"
pg_dump "$DATABASE_URL" --no-owner --no-acl \
  | gzip -c \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -pass env:ENCRYPTION_KEY -out "${BACKUP_FILE}.tmp"

mv "${BACKUP_FILE}.tmp" "$BACKUP_FILE"
chmod 600 "$BACKUP_FILE"

sha256sum "$BACKUP_FILE" > "$CHECKSUM_FILE"
chmod 600 "$CHECKSUM_FILE"

echo "[INFO] Backup completed: ${BACKUP_FILE} ($(wc -c < "$BACKUP_FILE") bytes)"

# Enforce retention while preserving at least BACKUP_RETENTION_MIN_COUNT recent backups
mapfile -t all_backups < <(ls -1t "${BACKUP_DIR}/${BACKUP_PREFIX}-"*.sql.gz.enc 2>/dev/null || true)
total_count="${#all_backups[@]}"

if (( total_count > BACKUP_RETENTION_MIN_COUNT )); then
  mapfile -t expired_backups < <(find "$BACKUP_DIR" -maxdepth 1 -name "${BACKUP_PREFIX}-*.sql.gz.enc" -type f -mtime "+${BACKUP_RETENTION_DAYS}" | sort)
  remaining="$total_count"
  for old_file in "${expired_backups[@]}"; do
    if (( remaining <= BACKUP_RETENTION_MIN_COUNT )); then
      break
    fi
    rm -f "$old_file" "${old_file}.sha256"
    echo "[INFO] Pruned expired backup: ${old_file}"
    remaining=$((remaining - 1))
  done
fi

echo "[INFO] Retention check complete."
