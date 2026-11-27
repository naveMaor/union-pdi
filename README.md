
# Union PDI

Full-stack PDI (Pre-Delivery Inspection) planning
application for Union Motors.

## Technology Stack

- Node.js 24
- Fastify 5
- PostgreSQL
- Sequelize 6
- React + Vite

## Status

Under development.

See docs/PLAN.md for the implementation plan.

## Assignment

Requirements are defined in `docs/assignment/SPEC.md`.

## Development

Use Node.js 24:

```bash
nvm use
```

Further setup and deployment instructions will
be added as implementation progresses.

## Database (PostgreSQL via Docker Compose)

PostgreSQL runs locally through Docker Compose (`compose.yaml` in the
project root).

### Environment variables

Copy `.env.example` to `.env` and fill in a real password before
starting the database. Required variables:

- `POSTGRES_DB` — database name (`union_pdi`)
- `POSTGRES_USER` — database user (`pdi`)
- `POSTGRES_PASSWORD` — database password (not committed to Git)

### Start PostgreSQL

```bash
docker compose up -d db
```

### Check status

```bash
docker compose ps
```

The container is ready for connections once its status shows `healthy`
(based on a `pg_isready` health check).

### Stop PostgreSQL

```bash
docker compose stop db
```

This stops the container without deleting its data volume. To remove
the container and volume entirely (**this deletes all data**), use
`docker compose down -v` — do this only intentionally.

### Connect with psql

```bash
docker compose exec db psql -U pdi -d union_pdi
```

### Persistence

PostgreSQL stores its data files on a named Docker volume
(`pdi_db_data`), separate from the container itself. Stopping,
removing or recreating the `db` container does not delete this volume,
so data survives container restarts and recreations. The volume is
only deleted if explicitly removed (e.g. `docker compose down -v`).

## Demo database

A disposable second database (`union_pdi_demo`) and backup/reset scripts
for trying things out or running a live demo without touching the
development database. See `docs/DEMO_DB.md`.

## Authentication

The application uses simulated demo roles.
Role simulation is not a production security
or authentication mechanism.
