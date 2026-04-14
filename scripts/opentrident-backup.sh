#!/bin/bash
# OpenTrident automated backup + sync script
# Run via cron: 0 3 * * * /usr/local/bin/opentrident-backup

BACKUP_DIR="${OPENTRIDENT_BACKUP_DIR:-/opt/backups}"
STATE_DIR="${OPENTRIDENT_STATE_DIR:-/home/node/.opentrident}"
MAX_BACKUPS="${OPENTRIDENT_MAX_BACKUPS:-7}"
TIMESTAMP=$(date +%Y-%m-%dT%H-%M-%S.%3NZ)
ARCHIVE_NAME="${TIMESTAMP}-openclaw-backup.tar.gz"
ARCHIVE_PATH="${BACKUP_DIR}/${ARCHIVE_NAME}"

mkdir -p "${BACKUP_DIR}"

docker exec opentrident-gateway openclaw backup create \
  --output "${ARCHIVE_PATH}" \
  --verify \
  --json > "${BACKUP_DIR}/${TIMESTAMP}-backup-result.json" 2>&1

if [ $? -eq 0 ]; then
  echo "[$(date)] Backup created: ${ARCHIVE_NAME}"
else
  echo "[$(date)] Backup failed - check ${BACKUP_DIR}/${TIMESTAMP}-backup-result.json"
  exit 1
fi

cd "${BACKUP_DIR}" || exit 1
ls -1t *.tar.gz 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs rm -f 2>/dev/null

echo "[$(date)] Backup rotation complete. Kept ${MAX_BACKUPS} most recent."

# Sync runtime repo to GitHub
cd /opt/opentrident && git push origin opentrident-prune 2>&1 | tail -3
