
# Union PDI

Full-stack PDI (Pre-Delivery Inspection) planning application for Union
Motors, built for the Full Stack AI-Native take-home assignment. The full
specification is in `docs/assignment/SPEC.md` (Hebrew, authoritative).

## Live deployment

- **Application:** <https://union-pdi-web.onrender.com>
- **API:** <https://union-pdi.onrender.com> (health check: `/ping`)

Both run on Render's free tier:

- **Cold start:** the backend web service sleeps after a period of
  inactivity. The first request after a period of inactivity can take tens
  of seconds while it wakes up and the page may need a refresh; subsequent
  requests are immediate. The static frontend has no server process and
  does not sleep.
- **Database lifetime:** the free PostgreSQL instance expires 30 days
  after creation (created 2026-11-27, expires 2026-12-27). If it has
  expired, the database needs to be recreated and the backend's database
  environment variables updated accordingly — the application code itself
  requires no changes for this.

## Role simulation is not authentication

The application has no login. A role switcher in the header lets the
browser act as one of three fixed demo users (`PLANNER`, `SHIPPING`,
`ADMIN`) by sending an `x-demo-role` header with every request. **This is a
demonstration convenience for the assignment, not a security or
authentication mechanism.** The server enforces which role may perform
which action, but it trusts whatever role header the client sends — there
is no identity verification behind it. See SPEC §4.

## Technology stack

- Node.js 24, Fastify 5, PostgreSQL, Sequelize 6 (backend)
- React 19 + Vite (frontend)
- Hebrew RTL interface throughout; technical identifiers (VINs, vehicle
  IDs) render LTR
- Docker Compose for local PostgreSQL
- Node.js built-in test runner (`node --test`) for the backend test suite

## Project layout

- `server/` — Fastify REST API, Sequelize models/migrations, services
  (recommendation algorithm, plan lifecycle, blockers), route tests
- `client/` — React + Vite frontend for all three roles
- `docs/assignment/` — the official, read-only assignment files
- `docs/PLAN.md` — the implementation roadmap and task-by-task log
- `docs/AI_LOG.md` — the AI collaboration log referenced below
- `docs/DEMO_DB.md` — optional local tooling for a second, disposable demo
  database; not required for normal development or testing

## Install and run locally

Prerequisites: Node.js 24 (`nvm use`), Docker, Docker Compose.

1. **Install dependencies**

   ```bash
   cd server && npm install
   cd ../client && npm install
   ```

2. **Configure environment variables**

   Copy the example files and fill in real values where placeholders are
   given (see [Environment variables](#environment-variables) below for
   what each one does — no values are listed here, only names). The
   server (including the database connection it opens through Sequelize)
   reads only the repository-root `.env` — there is no separate
   `server/.env`:

   ```bash
   cp .env.example .env               # used by docker compose and by the server
   cp client/.env.example client/.env # used by the Vite dev server
   ```

3. **Start PostgreSQL**

   ```bash
   docker compose up -d db
   docker compose ps   # wait for status "healthy"
   ```

4. **Run migrations and seed the database**

   ```bash
   cd server
   npm run db:migrate
   npm run db:seed
   ```

   The seed script imports the 300 vehicles from
   `docs/assignment/pdi_seed_300_vehicles.csv` and the default settings
   (daily capacity, brand quotas, shipping capacities, envelope
   thresholds). It is safe to run more than once: vehicles are inserted
   only if missing, and already-changed settings are never reset back to
   their defaults.

5. **Start the backend**

   ```bash
   cd server
   npm run dev     # or: npm start
   ```

   Listens on `http://127.0.0.1:3001` by default (see env vars below).

6. **Start the frontend**

   ```bash
   cd client
   npm run dev
   ```

   Open the printed Vite URL (default `http://localhost:5173`).

## Environment variables

Names only — see `.env.example` and `client/.env.example` for the exact
files and their defaults for local development. Never commit a `.env` file
with real values.

Root `.env` (read by `docker compose`, and by the server via
`dotenv`/Sequelize's config — both the server and Sequelize CLI resolve
this same root file; there is no separate `server/.env`):

- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` — database
  connection credentials, used both by the Docker Compose Postgres
  container and by the server to connect to it
- `DB_HOST`, `DB_PORT` — database host/port (defaults match the Docker
  Compose service)
- `PORT` — port the Fastify server listens on
- `HOST` — interface the Fastify server binds to
- `CORS_ORIGIN` — the single frontend origin allowed to call the API
- `NODE_ENV` — `development` or `test`; also set automatically by the test
  suite
- `DEMO_RESET_ENABLED`, `DEMO_RESET_TOKEN` — off by default; see
  [Demo Reset](#demo-reset) below

`client/.env`:

- `VITE_API_BASE_URL` — base URL the frontend uses to reach the API

## Demo Reset

An off-by-default Admin feature for restoring the database to its original
seed state (all 300 vehicles, settings, brand quotas and shipping
capacities back to their exact CSV/default values, and no plans, plan
membership, manual exclusions or prior audit history) — useful for
resetting between interview/demo sessions. **It is a demo convenience, not
a security mechanism**, and it is a genuinely destructive, irreversible
action.

It is gated by three independent layers: `DEMO_RESET_ENABLED=true` must be
set, or the server never registers the endpoint at all; a separate
`DEMO_RESET_TOKEN` (recommended: a long random string, generated
independently of any other secret; the server enforces only a minimum of
8 characters) must be supplied in an `x-demo-reset-token` header on every
request — the `ADMIN` demo role alone is not sufficient, since role
simulation is explicitly not authentication (see above); and an explicit
confirmation is required on every call. Failed token attempts and
successful resets are both rate-limited. The token is never embedded in
the frontend bundle, never pre-filled, and never persisted client-side —
the Admin operator types it by hand each time into a password-style input.

**Finding it in the UI:** the section is hidden by default and adds no
visible clutter for the other two roles. In Admin mode, click the "PDI"
badge in the header (next to "UNION MOTORS") to reveal it; click it again,
switch roles, or reload the page to hide it — any of these also clears
whatever was typed into the password/confirmation fields, so nothing
lingers in memory. The badge is a real, keyboard-operable `<button>`
(disabled outside Admin mode), not a hidden gesture.

## Running tests

Backend (110 tests at time of writing — model/service unit tests and
Fastify route integration tests, run against real, isolated,
PID-suffixed PostgreSQL databases that are created and dropped per test
file; the shared development database is never touched):

```bash
cd server
npm test
```

Frontend: there is no dedicated frontend unit/component test suite.
Frontend correctness was verified during development through:

- `npm run build` and `npm run lint` (`oxlint`) in `client/`, both clean
- `client/scripts/verify-batch-b2.cjs`, a retained end-to-end browser
  verifier. It launches a real headless `google-chrome` (controlled
  directly over the Chrome DevTools Protocol, no browser-automation
  dependency), a real Fastify server, a real Vite dev server, and a real,
  disposable, CSV-seeded PostgreSQL database, then drives all three role
  screens through the SPEC §14 acceptance scenarios and compares
  before/after fingerprints of every development table. It is not wired
  into `npm test` or CI and must be run manually:

  ```bash
  node client/scripts/verify-batch-b2.cjs
  ```

  Requires `google-chrome` on `PATH` (or set `PDI_CHROME_BIN` to a Chrome
  executable). Add `--screenshots` to refresh all retained screenshots in
  `docs/design/`, or one of `--admin-screenshots` /
  `--shipping-screenshots` / `--b3-screenshots` to refresh a subset.

## Design decisions and tradeoffs

- **Single-pass recommendation algorithm** (`server/src/services/
  recommendation.js`) is a pure function with no database or HTTP
  dependency, so it is unit-testable in isolation from persistence (SPEC
  §7).
- **Plan snapshots**: `capacity_snapshot` and `brand_quotas_snapshot` are
  frozen on every recommendation run so that a later Admin settings change
  never silently alters an already-generated plan (SPEC §5.3); shipping
  capacity is deliberately read live, only at approval time.
- **Manual exclusions** live in their own table and are reapplied on every
  regeneration; manual additions are not persisted as a separate concept
  and are cleared on regeneration, per SPEC §8.2.
- **Role enforcement** happens entirely server-side off the `x-demo-role`
  header; the actor's display name is resolved server-side from the role,
  never trusted from client input, so the audit log cannot be forged by
  the client.
- **No automated frontend test suite** — this was a deliberate scope
  tradeoff to avoid adding a new test-framework dependency mid-project;
  frontend correctness instead relies on TypeScript-free build/lint checks
  plus the real-browser verifier described above. This is a known gap, not
  an oversight.

## AI usage (SPEC §11)

AI tools were used throughout this project's development, coordinated as
three Claude Code roles (an orchestrator session plus named `builder` and
`validator` agents communicating directly) working against the shared
specification in `docs/assignment/SPEC.md`. The full, chronological,
factual record — including specific defects found and how they were fixed,
agent disagreements, and human interventions — is in `docs/AI_LOG.md`;
this section summarizes it.

**Tools and models.** Claude Code, running Claude Sonnet 5 (orchestrator
and both named agents). External review from ChatGPT (model version
confirmed for only one of the two consultations — see `docs/AI_LOG.md`
for exactly what is and isn't confirmed) was used twice as a second
opinion, relayed into the session by the human developer; no other AI
tool or model was used on this project, and no image-generation tool was
used — the UI reference mockup is the one supplied with the assignment,
not AI-generated.

**How collaboration worked.** The Builder proposed each design (database
schema, service logic, API contracts, UI); the Validator independently
re-derived the same requirements from SPEC.md before reviewing Builder's
code, rather than reviewing against Builder's own reasoning, and owned all
automated tests. Disagreements were resolved directly between the two
agents over native agent-to-agent messaging, with specification evidence
cited on both sides; the human developer approved every architectural
decision, every new dependency and every commit. Nothing was committed or
deployed without explicit human approval at each step.

**Where AI agents made mistakes, and how they were caught.** Concrete,
non-exhaustive examples from `docs/AI_LOG.md` (see that file for the full
list and exact detail):

- Builder's first schema draft typed `vehicles.population` as `INTEGER`
  from the SPEC's prose alone, without checking the actual CSV; the human
  developer caught this by parsing the CSV directly, and Builder then
  re-verified every other column's real values against the CSV before the
  schema was finalized.
- Two Sequelize models (`planVehicle.js`, `manualExclusion.js`) silently
  failed every `.create()` call because they left Sequelize's default
  `createdAt: true` active against migrations that never created a
  `created_at` column — caught by Validator's first integration test run,
  not by earlier manual SQL checks.
- A concurrency bug in `planService.js` (concurrent `Promise.all` reads on
  a single `pg` connection, which does not support that) was found and
  fixed by Builder during its own self-test, before handoff to Validator.
- An off-by-one in the recommendation algorithm selected one vehicle when
  daily capacity was configured to `0`, found by Validator, independently
  reproduced by the orchestrator, and fixed by Builder with a dedicated
  regression test added.
- A Builder agent ran a full migrate/rollback/migrate cycle against the
  shared development database instead of an isolated test database during
  self-verification; investigated directly rather than assumed, and
  traced to an instruction-scoping gap (the isolation rule had been
  repeated to the Validator but not to the Builder for that round). No
  data loss occurred, but the orchestrator's instructions to agents were
  corrected going forward to always restate the rule explicitly.

**What the human developer wrote or changed manually.** The human
developer authored `CLAUDE.md`'s collaboration protocol, reviewed and
approved every design proposal and commit, made the final call on every
open architectural question raised by agents or by external review (for
example, the manual-exclusions table design), and directly inspected the
database and ran independent verification commands at multiple
checkpoints rather than relying solely on agent self-reports. `docs/
AI_LOG.md` records specific human interventions inline, including the two
defects the human developer caught personally (the `population` column
type and the dev-database rollback incident) before Builder or Validator
caught them independently.

## Remaining limitations

- No dedicated automated frontend test suite (see above).
- Free-tier hosting: see [Live deployment](#live-deployment) above for
  cold-start and database-expiry limitations. See `docs/PLAN.md` Task 7
  for the full deployment and verification history.
