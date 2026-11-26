
# Union PDI — Development Plan

## Project Goal

Build the full-stack Union Motors PDI planning system
according to docs/assignment/SPEC.md.

## Technology Stack

- Node.js 24
- Fastify 5
- JavaScript
- PostgreSQL
- Sequelize 6
- React + Vite
- Docker
- Claude Code

## Development Tasks


### Task 1 — Project Foundation and Database
Status: COMPLETE

#### Step 1.1 — Development Environment
- [x] Verify Node.js, npm, Git and Docker
- [x] Configure Node.js 24 using NVM
- [x] Fix project directory permissions

#### Step 1.2 — Project Initialization
- [x] Initialize Git repository on main branch
- [x] Create project directory structure
- [x] Add SPEC.md and vehicle CSV
- [x] Create CLAUDE.md
- [x] Create docs/PLAN.md
- [x] Create initial README.md and .gitignore
- [x] Create initial Git commit

#### Step 1.3 — Fastify Backend
- [x] Initialize Node.js backend
- [x] Install Fastify and CORS
- [x] Create application factory (src/app.js)
- [x] Create server entry point (src/index.js)
- [x] Add GET /ping endpoint
- [x] Configure npm dev and start scripts
- [x] Configure Node.js built-in test runner
- [x] Write and pass /ping API test

Verification:
- Fastify starts successfully on port 3001.
- GET /ping returns HTTP 200.
- npm test: 1 passed, 0 failed.

#### Step 1.4 — PostgreSQL
- [x] Start PostgreSQL using Docker
- [x] Configure persistent database storage
- [x] Configure database environment variables
- [x] Verify database connection

Verification:
- `docker compose up -d db` starts `postgres:17`, container `union-pdi-db-1`.
- Health check (`pg_isready`) reports `healthy`.
- `psql` via the container confirms database `union_pdi`, user `pdi`, PostgreSQL 17.12.
- Container restart verified: health returns to `healthy` and the database/user query succeeds again.
- Data persists in the named volume `union-pdi_pdi_db_data`.

#### Step 1.5 — Database Schema
- [x] Install and configure Sequelize ORM
- [x] Design database relationships
- [x] Create Sequelize migrations
- [x] Apply database constraints
- [x] Run migrations successfully

Verification:
- 8 tables (vehicles, settings, brand_quotas, shipping_capacities, plans,
  plan_vehicles, manual_exclusions, audit_events) migrated successfully
  against `union_pdi` (dev DB), which remains at 0 rows.
- `server/src/db.test.js`: 12/12 passing, run against an isolated,
  uniquely-named disposable database (`union_pdi_test_<pid>`) created and
  dropped by the test itself; a guard assertion refuses to run unless the
  resolved name matches that pattern and differs from `POSTGRES_DB`.
- `audit_events` confirmed to persist `actor_name`, `actor_role` (NOT NULL,
  CHECK'd) and `created_at` (NOT NULL) on every event.
- `git diff --check`: clean.

Deferred business-rule enforcement (schema/DB-level only; NOT yet
implemented — do not treat as satisfied until service-layer code exists):
- `manual_exclusions.note` is not NOT-NULL-enforced for `reason_code=OTHER`
  (SPEC 8.3). Must be enforced in the service layer before Task 3.
- `plans.capacity_snapshot` / `brand_quotas_snapshot` columns exist but
  their population/validation (SPEC 5.3 — parameter changes must not affect
  an existing plan) is not implemented; required in Task 2.
- Unique-violation handling (Postgres `23505` on `plans.plan_date` and
  `plan_vehicles`/`manual_exclusions` unique indexes) is enforced at the DB
  level only; the API must translate these into clean 409/validation
  responses in Task 2/3, not raw DB errors.

#### Step 1.6 — Seed Data
- [x] Implement CSV import
- [x] Import 300 vehicles
- [x] Seed default settings and quotas
- [x] Make the seed process idempotent

#### Step 1.7 — Database Verification
- [x] Verify 300 vehicles in PostgreSQL
- [x] Verify 262 eligible vehicles
- [x] Verify seed does not create duplicates
- [x] Verify default settings

Acceptance:
300 vehicles exist in PostgreSQL.
Rerunning the seed does not create duplicates.
All required database tables and constraints exist.

Verification:
- `npm run db:seed` (from `server/`) ran against the dev DB (`union_pdi`):
  300 vehicles, 1 settings row (200/9/14), 5 brand_quotas rows (Toyota
  55/HARD, Lexus 36/HARD, Geely 32/FLEX, GAC 22/HARD, Zeekr 28/FLEX), 4
  shipping_capacities rows (65 each) — matches SPEC §5.3/§7.
- SPEC §14 test 2: 262 eligible / 38 ineligible (9 not customs-released, 29
  with an active blocker, confirmed disjoint), verified directly via SQL
  against the dev DB.
- SECURITY_FORCES present on exactly PDI-220/260/270 (SPEC §9 examples).
- Reran `npm run db:seed` a second time against the dev DB: still exactly
  300 vehicles / 300 distinct `vehicle_id`s, 1/5/4 config rows — no
  duplicates, confirming idempotency on the actual dev DB, not only in test
  DBs.
- `server/src/seed.test.js` (new): 4 tests, covering fresh-seed counts/field
  values, §14 eligibility split, idempotency, and non-destructive reseed
  (seed does not overwrite settings/brand_quotas/shipping_capacities/vehicle
  fields already changed from defaults) — run against an isolated,
  PID-suffixed disposable database, never the dev DB.
- Full suite: `npm test` → 16/16 passing (12 from Step 1.5 + 4 new).

### Task 2 — Recommendation Algorithm
Status: COMPLETE

#### Step 2.1 — Eligibility and exclusion reasons
- [x] Implement eligibility rule (customs_released=true AND active_blocker=NONE AND not manually excluded for the plan date)
- [x] Produce a specific reason for every non-selected vehicle (SPEC §5.1 examples: active blocker, not customs-released, hard quota exhausted, over capacity, manually excluded)

#### Step 2.2 — Deterministic FIFO sorting
- [x] Sort eligible vehicles by envelope_date ascending, tie-broken by vehicle_id ascending (SPEC §6/§7)

#### Step 2.3 — Single-pass recommendation algorithm, quotas, capacity and summaries
- [x] Single pass over the sorted list (no reservation/backtracking)
- [x] HARD brand quotas as a ceiling (skip and continue when exhausted)
- [x] FLEX brand quotas allowed to be exceeded, with an over-quota indicator
- [x] Stop at daily capacity or when candidates are exhausted
- [x] Return selected vehicles, non-selection reasons, brand quota utilization (incl. FLEX overage), and source_location counts
- [x] Never special-case customer_segment, population, or requested_delivery_date

#### Step 2.4 — Algorithm unit tests
- [x] Unit tests against the real CSV dataset, covering SPEC §14 scenarios 2-5, FIFO tie-breaking, manual exclusions, zero/exhausted HARD quotas, FLEX overflow, insufficient eligible candidates, and independence from shipping capacity and display-only fields

Verification:
- `server/src/services/recommendation.js` (pure CommonJS, no DB/HTTP) exports
  `generateRecommendation({ vehicles, excludedVehicleIds, brandQuotas,
  dailyCapacity })`.
- Orchestrator independently reran the module against the raw CSV: SPEC §14
  tests 2-5 reproduced exactly (262/38 eligibility; 200-cap: Toyota 55,
  Lexus 36, GAC 22, Geely 44 (+12), Zeekr 43 (+15); source counts נמל חיפה
  52/נמל אשדוד 51/בונדד אשדוד 49/בונדד חיפה 48; 195-cap: Toyota 55, Lexus
  36, GAC 20, Geely 42, Zeekr 42).
- `server/src/services/recommendation.test.js` (new, Validator-owned): 10
  unit tests (FIFO tie-break, manual exclusion, zero/exhausted HARD quota,
  FLEX overflow, insufficient candidates, display-field/shipping-capacity
  independence, `dailyCapacity: 0` regression). Full suite: 26/26 passing.
- Edge case found and fixed: `dailyCapacity <= 0` originally selected 1
  vehicle instead of 0 (capacity-reached flag set one vehicle too late).
  Not reachable via the real app (Step 1.5's `settings.daily_capacity >= 1`
  CHECK constraint), but fixed anyway (direct `selected.length >=
  dailyCapacity` check per iteration) since it was a one-line, no-risk
  correction. Reverified: SPEC §14 scenarios still reproduce exactly, no
  regressions.

#### Step 2.5 — Recommendation service and transactional persistence
- [x] Wire the pure algorithm into a service that reads current settings/quotas/vehicles/exclusions and persists a Plan + PlanVehicles transactionally

#### Step 2.6 — Integration tests and acceptance
- [x] End-to-end integration tests against PostgreSQL covering SPEC §14 acceptance scenarios

Verification:
- `server/src/services/planService.js` (new): `generatePlan({ actorName,
  actorRole })`, fixed `PLAN_DATE='2026-11-23'`, enforces PLANNER role
  (`PlanServiceError('FORBIDDEN_ROLE')`), creates DRAFT on first run,
  regenerates only in DRAFT/RETURNED (`PlanServiceError('PLAN_LOCKED')`
  otherwise, status preserved), clears both ALGORITHM and MANUAL
  `plan_vehicles` on regen and reinserts the fresh ALGORITHM selection,
  leaves `manual_exclusions` untouched, writes `capacity_snapshot` and
  `brand_quotas_snapshot` (quota_target + quota_type) every run, records
  `STATUS_TRANSITION` (first run) and `RECOMMENDATION_RUN` audit events,
  and serializes concurrent calls with `pg_advisory_xact_lock`.
- Bug found and fixed by Builder during self-test: concurrent `Promise.all`
  reads on a shared transaction connection (pg does not support concurrent
  queries on one connection) — changed to sequential awaits.
- `server/src/services/planService.test.js` (new, Validator-owned): 9
  tests against real PostgreSQL in an isolated, PID-suffixed test database,
  covering SPEC §14 tests 3-5 end-to-end, regeneration semantics (exclusion
  preservation, manual-addition reset, one-plan-per-date), snapshot
  immutability, status/role rejection, shipping-capacity independence,
  concurrency, and transaction rollback on forced failure.
- Orchestrator independently reran the full suite (35/35 passing) and ran
  an independent end-to-end check in its own throwaway database: SPEC §14
  baseline reproduced exactly, exclusion preserved and manual addition
  cleared on regen, one Plan row across two generations, role and
  lock rejection both verified. Dev DB confirmed untouched (0 plans, 0
  audit_events, 300 vehicles unchanged) and no stray test database left
  behind.
- Not yet implemented (explicitly out of scope for 2.5-2.6): replacement
  suggestions (§8.4), manual exclude/add/blocker operations, shipping
  approval, API routes, frontend.

Acceptance:
200 selected vehicles, matching section 14
of docs/assignment/SPEC.md.

### Task 3 — Planner Operations
Status: NOT STARTED

- Manual exclusions with required reasons
- Cancel exclusions
- Suggested replacements
- Manual replacement confirmation
- Add and remove blockers
- Regenerate plans
- Record audit events

Acceptance:
All planner operations satisfy sections 8 and 9.

### Task 4 — Shipping and Administration
Status: NOT STARTED

- Implement plan status transitions
- Implement role authorization
- Shipping approval and return
- Shipping capacity checks
- Administrative settings
- Enforce plan locking

Acceptance:
Invalid actions are rejected server-side.

### Task 5 — Planner Frontend
Status: NOT STARTED

- React RTL layout
- Vehicle table
- Search and filters
- Planning summaries
- Planner actions and dialogs
- Submission workflow

### Task 6 — Shipping and Admin Frontends
Status: NOT STARTED

- Shipping approval screen
- Admin settings screen
- Demo role selector
- Error and validation feedback

### Task 7 — QA and Deployment
Status: NOT STARTED

- Automated acceptance tests
- Persistence testing
- Public deployment
- README documentation
- AI workflow documentation
- Live-change rehearsal

## Development Rules

1. docs/assignment/SPEC.md is the source of truth.
2. Implement one task at a time.
3. Keep business rules on the server.
4. Test before moving to the next task.
5. Make meaningful Git commits throughout.
6. Review AI-generated code.
7. Never commit secrets.
