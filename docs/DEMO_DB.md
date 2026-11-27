# Local Demo Database Workflow

Tools for backing up the development database and running a second, disposable
database (`union_pdi_demo`) side by side with normal development — for trying
things out, running a live demo, or recovering from a mistake, without ever
touching the real dev database (`union_pdi`).

Everything here is local-only tooling. It does not touch `.env`, application
code, business logic or the database schema.

## Prerequisites

- The Postgres container from `compose.yaml` is running (`docker compose up -d db`).
- Root `.env` has `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` set (this
  defines the development database; the demo database name is always the
  fixed value `union_pdi_demo`, regardless of `.env`).

## `scripts/backup-dev-db.sh`

Backs up the development database (`union_pdi`) with `pg_dump` (custom
format), then verifies the backup is actually usable before trusting it:

1. Dumps `union_pdi` via `docker exec ... pg_dump -Fc`.
2. Saves the archive outside the repo, under `~/union-pdi-backups/` by
   default, timestamped (e.g. `union_pdi_20261127_124457.dump`), `chmod 600`
   on the file and `700` on the directory.
3. Checks the archive is readable with `pg_restore --list`.
4. Restores it into a throwaway temporary database and compares the vehicle
   count against the source, then drops the temporary database.

```bash
scripts/backup-dev-db.sh

# custom backup location:
BACKUP_DIR=/path/outside/repo scripts/backup-dev-db.sh
```

Never writes credentials to disk or stdout; the Postgres password is only
passed as a `docker exec` environment variable for the duration of each call.

## `scripts/reset-demo-db.sh`

Creates (or recreates) the disposable database `union_pdi_demo`, migrates it,
seeds it from the original CSV, and verifies the acceptance counts from
`SPEC.md` §14 #1–2.

Safety checks, in order:

- Refuses if port `3002` is in use (the demo backend must be stopped first).
- If `union_pdi_demo` already exists, it must carry this script's own
  ownership marker (a `COMMENT ON DATABASE` set the first time it was
  created) — otherwise the script refuses to touch it, in case the name was
  reused by something else.
- Refuses if there are other active connections to `union_pdi_demo`.
- Requires typed `yes` confirmation before dropping an existing demo
  database (skip the prompt with `--yes`, e.g. once a reset has already been
  approved).

After recreating the database it runs the existing migrations and
`src/scripts/seed.js` against `union_pdi_demo` only (via environment-variable
overrides — never by changing `.env`), then checks: 300 vehicles, 262
eligible, 9 not customs-released, 29 with an active blocker, 0 plans, and
default settings (capacity 200, 5 brand quotas, 4 shipping capacities at 65).

```bash
# interactive (prompts for confirmation if the demo DB already exists)
scripts/reset-demo-db.sh

# non-interactive, e.g. after you've already decided to reset
scripts/reset-demo-db.sh --yes
```

It never touches `union_pdi` and never deletes the Docker volume.

## Running the demo environment

```bash
# 1. Create/reset the demo database
scripts/reset-demo-db.sh

# 2. Start the demo backend on port 3002 (reads union_pdi_demo, not union_pdi)
cd server && npm run demo

# 3. In another terminal, start Vite against the demo API on 5173
cd client && VITE_API_BASE_URL=http://localhost:3002/api npm run dev -- --port 5173

# 4. Verify the browser is actually talking to the demo API/DB
curl -s http://localhost:3002/ping
docker exec -e PGPASSWORD="$(grep POSTGRES_PASSWORD .env | cut -d= -f2-)" union-pdi-db-1 \
  psql -U pdi -d union_pdi_demo -tAc "select count(*) from plans"

# 5. Stop the demo: Ctrl+C the backend and Vite processes above
#    Reset again any time you want a clean slate:
scripts/reset-demo-db.sh --yes

# 6. Back to normal development (port 3001 / union_pdi)
cd server && npm run dev
cd client && npm run dev
```

## Why this exists

Having a second database with the same schema lets you reset to a known-good
state (300 vehicles, correct eligibility split, zero plans) on demand —
useful for rehearsing the live-change session in SPEC.md §13 or recovering
from an experiment — without any risk to the development data you're
actually working against day to day.
