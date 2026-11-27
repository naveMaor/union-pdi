#!/usr/bin/env bash
# Back up the local development Postgres database (pg_dump custom format),
# verify the archive is readable, and verify it actually restores by
# restoring it into a throwaway temporary database (dropped immediately after).
#
# Usage: scripts/backup-dev-db.sh
# Env overrides: CONTAINER_NAME (default union-pdi-db-1), BACKUP_DIR (default ~/union-pdi-backups)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
CONTAINER_NAME="${CONTAINER_NAME:-union-pdi-db-1}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/union-pdi-backups}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found." >&2
  exit 1
fi

# Load POSTGRES_* from .env without exporting into the wider shell/log output.
POSTGRES_DB="$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | tail -n1 | cut -d= -f2-)"
POSTGRES_USER="$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | tail -n1 | cut -d= -f2-)"
POSTGRES_PASSWORD="$(grep -E '^POSTGRES_PASSWORD=' "$ENV_FILE" | tail -n1 | cut -d= -f2-)"

if [[ -z "$POSTGRES_DB" || -z "$POSTGRES_USER" || -z "$POSTGRES_PASSWORD" ]]; then
  echo "ERROR: POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD missing from .env." >&2
  exit 1
fi

if [[ "$POSTGRES_DB" == "union_pdi_demo" ]]; then
  echo "ERROR: refusing to back up '$POSTGRES_DB' — .env must point at the development database, not the demo database." >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "ERROR: Postgres container '$CONTAINER_NAME' is not running (docker compose up db?)." >&2
  exit 1
fi

if ! docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER_NAME" \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select 1" >/dev/null 2>&1; then
  echo "ERROR: cannot connect to database '$POSTGRES_DB' as '$POSTGRES_USER' in container '$CONTAINER_NAME'." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/${POSTGRES_DB}_${TIMESTAMP}.dump"
TMP_FILE="${BACKUP_FILE}.part"

echo "Backing up '$POSTGRES_DB' (container $CONTAINER_NAME) to $BACKUP_FILE ..."

cleanup_tmp() {
  [[ -f "$TMP_FILE" ]] && rm -f "$TMP_FILE"
}
trap cleanup_tmp EXIT

if ! docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER_NAME" \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$TMP_FILE"; then
  echo "ERROR: pg_dump failed." >&2
  exit 1
fi

chmod 600 "$TMP_FILE"
mv "$TMP_FILE" "$BACKUP_FILE"
trap - EXIT

echo "Verifying archive readability (pg_restore --list) ..."
if ! docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER_NAME" \
    pg_restore --list < "$BACKUP_FILE" > /dev/null; then
  echo "ERROR: archive failed readability check." >&2
  exit 1
fi

VERIFY_DB="backup_verify_${TIMESTAMP}"
cleanup_verify_db() {
  docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER_NAME" \
    dropdb -U "$POSTGRES_USER" --if-exists "$VERIFY_DB" >/dev/null 2>&1 || true
}
trap cleanup_verify_db EXIT

echo "Verifying restorability into isolated temporary database '$VERIFY_DB' ..."
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER_NAME" \
  createdb -U "$POSTGRES_USER" -O "$POSTGRES_USER" "$VERIFY_DB"

if ! docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER_NAME" \
    pg_restore -U "$POSTGRES_USER" -d "$VERIFY_DB" --no-owner < "$BACKUP_FILE"; then
  echo "ERROR: restore into temporary database failed." >&2
  exit 1
fi

SOURCE_VEHICLES="$(docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER_NAME" \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select count(*) from vehicles")"
RESTORED_VEHICLES="$(docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER_NAME" \
  psql -U "$POSTGRES_USER" -d "$VERIFY_DB" -tAc "select count(*) from vehicles")"

cleanup_verify_db
trap - EXIT

if [[ "$SOURCE_VEHICLES" != "$RESTORED_VEHICLES" ]]; then
  echo "ERROR: restored vehicle count ($RESTORED_VEHICLES) does not match source ($SOURCE_VEHICLES)." >&2
  exit 1
fi

echo "OK: backup verified. vehicles count matches ($SOURCE_VEHICLES)."
echo "Backup file: $BACKUP_FILE"
ls -l "$BACKUP_FILE"
