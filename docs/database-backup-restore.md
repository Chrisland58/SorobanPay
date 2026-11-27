# Database Backup & Restore Drill Operations

This document describes the automated encrypted PostgreSQL backup and isolated restore drill pipeline for SorobanPay.

## Overview

- **Encrypted Backups** ([scripts/db-backup.sh](../scripts/db-backup.sh)): Dumps the PostgreSQL database with `pg_dump`, compresses with `gzip`, and encrypts with AES-256-CBC + PBKDF2 (`openssl enc`). Generates a `.sha256` checksum and enforces retention policies.
- **Isolated Restore Drills** ([scripts/db-restore-drill.sh](../scripts/db-restore-drill.sh)): Verifies checksum integrity, checks RPO compliance, decrypts and restores into an isolated drill database (`RESTORE_DRILL_DATABASE_URL`), validates schema and representative records, measures RTO compliance, and writes a JSON verification report.
- **Scheduled Automation** ([.github/workflows/db-backup-restore-drill.yml](../.github/workflows/db-backup-restore-drill.yml)): Runs daily at `03:00 UTC` (and on-demand via `workflow_dispatch`) against isolated PostgreSQL service containers, uploading `restore-drill-report.json` as a build artifact.

## Recovery Objectives

| Objective | Default Threshold | Environment Variable |
| --- | --- | --- |
| **RPO** (Recovery Point Objective) | 24 hours (`86400` seconds) | `RPO_MAX_SECONDS` |
| **RTO** (Recovery Time Objective) | 15 minutes (`900` seconds) | `RTO_MAX_SECONDS` |

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes (backup) | — | Source PostgreSQL connection string |
| `RESTORE_DRILL_DATABASE_URL` | Yes (drill) | — | Isolated target PostgreSQL connection string |
| `BACKUP_ENCRYPTION_KEY` | Yes* | — | Passphrase for AES-256-CBC + PBKDF2 encryption |
| `BACKUP_ENCRYPTION_KEY_FILE` | Yes* | — | Path to file containing encryption passphrase |
| `BACKUP_DIR` | No | `/var/backups/sorobanpay` | Directory for encrypted backups and reports |
| `BACKUP_RETENTION_DAYS` | No | `30` | Maximum age in days before pruning old backups |
| `BACKUP_RETENTION_MIN_COUNT` | No | `7` | Minimum number of recent backups to always retain |
| `REQUIRED_TABLES` | No | `Subscription,Payment,AuditLog,_prisma_migrations` | Comma-separated tables verified during restore |
| `REPRESENTATIVE_TABLE` | No | `Subscription` | Table queried for representative row count |
| `MIN_REPRESENTATIVE_ROWS` | No | `0` | Minimum expected rows in `REPRESENTATIVE_TABLE` |
| `ALERT_WEBHOOK_URL` | Recommended | — | Webhook URL for operational failure alerts |
| `ALERT_CHANNEL` | No | `#ops-alerts` | Target operational channel included in alert payloads |

\* Either `BACKUP_ENCRYPTION_KEY` or `BACKUP_ENCRYPTION_KEY_FILE` must be set.

## Alerting

Both `db-backup.sh` and `db-restore-drill.sh` send a JSON alert payload to `ALERT_WEBHOOK_URL` on any failure, including:
- Missing credentials or encryption keys
- `pg_dump` or `psql` execution errors
- SHA-256 checksum mismatches or decryption failures
- Missing required schema tables or representative record count failures
- RPO or RTO threshold breaches

## Automated Coverage

Run the unit/integration test suite (uses mocked `pg_dump`, `psql`, and `curl`):

```bash
bash tests/db-backup-restore.test.sh
```
