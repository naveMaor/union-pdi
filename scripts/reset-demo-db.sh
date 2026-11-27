#!/usr/bin/env bash
# (Re)create the disposable demo database 'union_pdi_demo', migrate and seed it,
# and verify the expected acceptance counts (SPEC.md section 14, #1-#2).
#
# Usage: scripts/reset-demo-db.sh [--yes]
#   --yes   skip the interactive confirmation prompt when the demo DB already
#           exists (still requires it to carry this script's ownership marker).
#
# Never touches the development database. Refuses to act on any database that
# does not carry this script's ownership marker, or while the demo backend
# (port 3002) or any other session is connected to the demo database.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$REPO_ROOT/server"
ENV_FILE="$REPO_ROOT/.env"
CONTAINER_NAME="${CONTAINER_NAME:-union-pdi-db-1}"
DEMO_DB="union_pdi_demo"
MARKER="managed-by:union-pdi/reset-demo-db.sh"
AUTO_YES=0

for arg in "$@"; do
  case "$arg" in
    --yes) AUTO_YES=1 ;;
    *) echo "ERROR: unknown argument '$arg'" >&2; exit 1 ;;
  esac
done

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found." >&2
  exit 1
fi

POSTGRES_DB_DEV="$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | tail -n1 | cut -d= -f2-)"
POSTGRES_USER="$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | tail -n1 | cut -d= -f2-)"
POSTGRES_PASSWORD="$(grep -E '^POSTGRES_PASSWORD=' "$ENV_FILE" | tail -n1 | cut -d= -f2-)"

if [[ -z "$POSTGRES_DB_DEV" || -z "$POSTGRES_USER" || -z "$POSTGRES_PASSWORD" ]]; then
  echo "ERROR: POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD missing from .env." >&2
  exit 1
fi

if [[ "$DEMO_DB" == "$POSTGRES_DB_DEV" ]]; then
  echo "ERROR: demo database name collides with the development database name. Refusing." >&2
  exit 1
fi

psql_demo_admin() {
  # psql against the 'postgres' maintenance database (for create/drop/catalog queries).
  docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER_NAME" \
    psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 "$@"
}

psql_demo() {
  docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER_NAME" \
    psql -U "$POSTGRES_USER" -d "$DEMO_DB" -v ON_ERROR_STOP=1 "$@"
}

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "ERROR: Postgres container '$CONTAINER_NAME' is not running (docker compose up db?)." >&2
  exit 1
fi

if ! psql_demo_admin -tAc "select 1" >/dev/null 2>&1; then
  echo "ERROR: cannot connect to Postgres as '$POSTGRES_USER' in container '$CONTAINER_NAME'." >&2
  exit 1
fi

# Refuse if the demo backend (or anything else) is listening on 3002.
if (exec 3<>"/dev/tcp/127.0.0.1/3002") 2>/dev/null; then
  exec 3>&- 3<&-
  echo "ERROR: something is listening on port 3002. Stop the demo backend before resetting." >&2
  exit 1
fi

EXISTS="$(psql_demo_admin -tAc "select 1 from pg_database where datname = '$DEMO_DB'")"

if [[ "$EXISTS" == "1" ]]; then
  MARKER_FOUND="$(psql_demo_admin -tAc \
    "select coalesce(shobj_description(oid, 'pg_database'), '') from pg_database where datname = '$DEMO_DB'")"

  if [[ "$MARKER_FOUND" != "$MARKER" ]]; then
    echo "ERROR: database '$DEMO_DB' exists but does not carry this script's ownership marker." >&2
    echo "Refusing to drop a database this script did not create. Investigate manually." >&2
    exit 1
  fi

  ACTIVE_CONNECTIONS="$(psql_demo_admin -tAc \
    "select count(*) from pg_stat_activity where datname = '$DEMO_DB' and pid <> pg_backend_pid()")"

  if [[ "$ACTIVE_CONNECTIONS" != "0" ]]; then
    echo "ERROR: $ACTIVE_CONNECTIONS active connection(s) to '$DEMO_DB'. Stop the demo backend/clients first." >&2
    exit 1
  fi

  if [[ "$AUTO_YES" != "1" ]]; then
    echo "Database '$DEMO_DB' already exists and will be DROPPED and recreated."
    read -r -p "Type 'yes' to confirm: " CONFIRM < /dev/tty
    if [[ "$CONFIRM" != "yes" ]]; then
      echo "Aborted. No changes made."
      exit 1
    fi
  fi

  echo "Dropping '$DEMO_DB' ..."
  psql_demo_admin -c "drop database \"$DEMO_DB\""
else
  echo "Database '$DEMO_DB' does not exist yet. Creating."
fi

echo "Creating '$DEMO_DB' ..."
psql_demo_admin -c "create database \"$DEMO_DB\" owner \"$POSTGRES_USER\""
psql_demo_admin -c "comment on database \"$DEMO_DB\" is '$MARKER'"

echo "Running migrations against '$DEMO_DB' ..."
(
  cd "$SERVER_DIR"
  POSTGRES_DB="$DEMO_DB" POSTGRES_USER="$POSTGRES_USER" POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    ./node_modules/.bin/sequelize-cli db:migrate
)

echo "Seeding '$DEMO_DB' ..."
(
  cd "$SERVER_DIR"
  POSTGRES_DB="$DEMO_DB" POSTGRES_USER="$POSTGRES_USER" POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    node src/scripts/seed.js
)

echo "Verifying seeded data in '$DEMO_DB' ..."

VEHICLE_COUNT="$(psql_demo -tAc "select count(*) from vehicles")"
ELIGIBLE_COUNT="$(psql_demo -tAc "select count(*) from vehicles where customs_released = true and active_blocker = 'NONE'")"
NOT_RELEASED_COUNT="$(psql_demo -tAc "select count(*) from vehicles where customs_released = false")"
BLOCKED_COUNT="$(psql_demo -tAc "select count(*) from vehicles where active_blocker <> 'NONE'")"
PLAN_COUNT="$(psql_demo -tAc "select count(*) from plans")"
DAILY_CAPACITY="$(psql_demo -tAc "select daily_capacity from settings where id = 1")"
QUOTA_COUNT="$(psql_demo -tAc "select count(*) from brand_quotas")"
SHIPPING_COUNT="$(psql_demo -tAc "select count(*) from shipping_capacities where capacity = 65")"

FAIL=0
check() {
  local label="$1" actual="$2" expected="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "MISMATCH: $label = $actual (expected $expected)" >&2
    FAIL=1
  else
    echo "OK: $label = $actual"
  fi
}

check "vehicles"                "$VEHICLE_COUNT"      300
check "eligible"                "$ELIGIBLE_COUNT"      262
check "customs not released"    "$NOT_RELEASED_COUNT"  9
check "active blocker"          "$BLOCKED_COUNT"       29
check "plans"                   "$PLAN_COUNT"          0
check "settings.daily_capacity" "$DAILY_CAPACITY"      200
check "brand_quotas rows"       "$QUOTA_COUNT"         5
check "shipping_capacities @65" "$SHIPPING_COUNT"      4

if [[ "$FAIL" != "0" ]]; then
  echo "Demo database reset completed but failed verification. See mismatches above." >&2
  exit 1
fi

echo "Demo database '$DEMO_DB' reset and verified successfully."
