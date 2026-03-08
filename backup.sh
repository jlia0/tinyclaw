#!/bin/bash
# Backup TinyClaw SQLite database daily
# Usage: ./backup.sh or add to crontab: 0 2 * * * /path/to/backup.sh

set -e

TINYCLAW_HOME="${TINYCLAW_HOME:-$HOME/.tinyclaw}"
DB_FILE="$TINYCLAW_HOME/tinyclaw.db"
BACKUP_DIR="$TINYCLAW_HOME/backups"
RETENTION_DAYS=7

# Create backup directory if needed
mkdir -p "$BACKUP_DIR"

# Check if database exists
if [ ! -f "$DB_FILE" ]; then
    echo "WARNING: Database file not found: $DB_FILE"
    exit 1
fi

# Create timestamped backup
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/tinyclaw_${TIMESTAMP}.db"

# Atomic hot-backup using SQLite's built-in backup API
# Safe while database is actively being written to (WAL mode)
sqlite3 "$DB_FILE" ".backup '$BACKUP_FILE'"

# Verify backup is valid (can open it)
if ! sqlite3 "$BACKUP_FILE" ".tables" >/dev/null 2>&1; then
    echo "ERROR: Backup verification failed for $BACKUP_FILE"
    rm -f "$BACKUP_FILE"*
    exit 1
fi

echo "✓ Backup created: $BACKUP_FILE"

# Delete old backups (keep 7 days)
find "$BACKUP_DIR" -name "tinyclaw_*.db" -mtime +$RETENTION_DAYS -delete 2>/dev/null || true

# Log backup count
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/tinyclaw_*.db 2>/dev/null | wc -l)
echo "Backup count: $BACKUP_COUNT (retention: ${RETENTION_DAYS} days)"
