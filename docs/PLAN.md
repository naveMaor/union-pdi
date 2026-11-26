
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
Status: COMPLETE

#### Step 3.1 — Shared planner validation and locking
- [x] Shared helper(s) for PLANNER role enforcement and editable-status checks (DRAFT/RETURNED), reused by exclusion/replacement/blocker/regeneration operations
- [x] Shared transaction/advisory-lock pattern reused from planService.js, not reimplemented

#### Step 3.2 — Manual exclusions and cancellation
- [x] Manual exclusion with required reason code, nonblank comment when reason is OTHER, actor name/role, timestamp (SPEC §8.3)
- [x] Cancel an active exclusion, logged, vehicle returns to eligibility on the next regeneration only (not auto-added to the current draft)
- [x] Audit events for exclusion and cancellation

#### Step 3.3 — Replacement suggestions and confirmation
- [x] Compute the single FIFO replacement candidate after an exclusion (SPEC §8.4): first eligible vehicle by envelope_date/vehicle_id not in the plan, not excluded, not breaching a HARD quota, using the plan's own capacity/quota snapshot
- [x] Explicit confirmation step adds the suggested vehicle only (no free-form addition)
- [x] Server recomputes and revalidates the replacement inside the transaction immediately before insertion; rejects a stale or arbitrary vehicle_id

#### Step 3.4 — Exclusion/replacement tests
- [x] Integration tests against real PostgreSQL in isolated test databases covering SPEC §14 tests 6-8 and relevant edge cases

Verification:
- `server/src/services/planEditService.js` (new): `excludeVehicle`,
  `cancelExclusion`, `confirmReplacement`, `computeSuggestedReplacement`.
  `planService.js` refactored (no behavior change) to export shared
  `assertPlannerRole`/`assertEditablePlan`/`acquirePlanLock`/
  `EDITABLE_STATUSES` helpers, reused here.
- SPEC §14 tests 6-8 reproduced exactly, both by Builder's self-test and
  independently by Validator and the orchestrator (separately, in their own
  throwaway databases): excluding PDI-195 (Zeekr/FLEX) suggests PDI-200;
  excluding PDI-281 (Toyota/HARD) suggests PDI-107; regeneration keeps an
  excluded vehicle out, cancel does not re-add it to the current plan, a
  further regeneration brings it back.
- `OTHER` reason now genuinely requires a non-blank note (service-layer
  enforcement — this closes the gap Step 1.5 had left as DB-unenforced and
  explicitly deferred).
- Replacement suggestion confirmed to use the plan's own frozen
  `brand_quotas_snapshot`, not live settings, even after live quotas are
  changed post-generation (SPEC §5.3 non-retroactivity).
- Stale-suggestion rejection confirmed: a vehicle_id that no longer matches
  a freshly recomputed suggestion (plan state changed since the suggestion
  was shown) is rejected (`STALE_SUGGESTION`), not blindly inserted.
- `server/src/services/planEditService.test.js` (new, Validator-owned): 12
  tests. Full suite: 47/47 passing.
- Orchestrator independently reran the full suite and its own separate
  end-to-end script against a disposable database, reproducing both §14
  numbers and all rejection paths directly.
- Not yet implemented (Steps 3.5-3.8, out of scope for this round):
  blockers, submission/regeneration integration beyond what's above, API
  routes, frontend.

#### Step 3.5 — Vehicle blockers
- [x] Add/remove blockers, SPEC §9 behavior including warning-only states and submission blocking

#### Step 3.6 — Submission and regeneration integration
- [x] Submit-to-shipping transition, regeneration integration with exclusions/blockers

#### Step 3.7 — Planner REST API
- [x] Fastify routes exposing Steps 3.1-3.6 to the frontend

#### Step 3.8 — Integration tests and acceptance
- [x] End-to-end acceptance tests for all planner operations (SPEC §8-§9)

Verification:
- New files: `server/src/services/blockerService.js` (addBlocker/removeBlocker,
  no plan-status gating per SPEC §9's last line), `server/src/services/
  planReadService.js` (plan summary + vehicle list/search/filter/sort/tabs,
  recomputed from live `plan_vehicles` state, not a cached algorithm run),
  `server/src/routes/planRoutes.js` (thin Fastify routes under `/api`),
  `server/src/utils/errorStatusMap.js` (PlanServiceError code -> HTTP
  status). Changed: `planService.js` (+`submitForShipping`, +`getCurrentPlan`),
  `app.js` (registers routes + central error handler).
- Demo role resolution: `x-demo-role` header (PLANNER/SHIPPING/ADMIN),
  server resolves the fixed actor name from SPEC §4's table — never trusts
  a client-supplied name (independently confirmed: a bogus actorName in a
  request body was ignored, the fixed demo name was recorded in the audit
  trail instead).
- Regeneration confirmation: `POST /api/plan/generate` returns 409
  `CONFIRMATION_REQUIRED` if a plan already exists and the body lacks
  `confirm: true`.
- SPEC §14 tests 6, 7, 8, 10, 11 all reproduced exactly through the full
  HTTP layer (`app.inject()`), independently by Builder, Validator, and the
  orchestrator (three separate runs, three separate throwaway databases):
  PDI-195->PDI-200, PDI-281->PDI-107, exclusion preserved/cancel-restored
  across regeneration, a locked (`PENDING_SHIPPING`) plan rejects a direct
  exclude call (409), and a blocker on an in-plan vehicle surfaces as a
  warning, blocks submission until resolved, and does not remove the
  vehicle from the plan.
- `server/src/routes/planRoutes.test.js` (new, Validator-owned): 18 tests.
  Full suite: 65/65 passing.
- Not yet implemented (Task 4, out of scope here): shipping approval,
  admin settings endpoints, React/frontend.

Acceptance:
All planner operations satisfy sections 8 and 9.

### Task 4 — Shipping and Administration
Status: COMPLETE

#### Step 4.1 — Shipping approval
- [x] SHIPPING-only approval from PENDING_SHIPPING, checking actual per-source counts against current shipping capacities (SPEC §5.2, §8.1)
- [x] Approval blocked server-side if any source exceeds its capacity
- [x] APPROVED is final: no further edits or transitions

#### Step 4.2 — Return for correction
- [x] SHIPPING-only return from PENDING_SHIPPING back to RETURNED, with a required nonblank comment (SPEC §5.2, §8.1)
- [x] Return without a comment is rejected server-side
- [x] Returned plan is editable again by the planner; return comment is visible

#### Step 4.3 — Administrative settings
- [x] ADMIN-only updates to daily capacity, brand quotas/types, shipping capacities per source, and envelope warning thresholds (SPEC §5.3)
- [x] Validate integers, minimums (capacity >= 1, others >= 0) and allowed quota types
- [x] Parameter changes never modify an existing plan; they only affect the next recommendation run

#### Step 4.4 — REST API
- [x] Fastify routes for shipping approval/return and admin settings read/update, reusing existing demo-actor resolution and error handling

#### Step 4.5 — Integration tests
- [x] Integration tests against real PostgreSQL in isolated test databases covering SPEC §14 test 9 and relevant edge cases

#### Step 4.6 — Backend acceptance
- [x] All of SPEC §§4, 5.2, 5.3, 8.1, 9 satisfied end-to-end through the HTTP API, with full regression suite passing

Verification:
- New files: `server/src/services/settingsService.js` (getSettings/updateSettings,
  strict integer/range/enum validation, SETTINGS_CHANGED audit event with
  before/after diff), `server/src/routes/settingsRoutes.js` (GET open to any
  valid demo role, PUT ADMIN-only), `server/src/routes/demoRoleHook.js`
  (factored out of planRoutes.js so settingsRoutes.js reuses the same
  actor-resolution logic, no duplication).
- Changed: `server/src/services/planService.js` (+`assertShippingRole`,
  +`assertAdminRole`, +`assertPendingShipping`, +`approveForShipping`,
  +`returnToPlanner`), `server/src/routes/planRoutes.js` (+`/plan/approve`,
  +`/plan/return`), `server/src/utils/errorStatusMap.js`
  (+`PLAN_NOT_PENDING_SHIPPING`, +`SHIPPING_CAPACITY_EXCEEDED`,
  +`COMMENT_REQUIRED`, +`INVALID_SETTING_VALUE`), `server/src/app.js`
  (registers settingsRoutes).
- Shipping-capacity approval check reads live `shipping_capacities` rows
  inside the transaction — deliberately not the plan's frozen
  `capacity_snapshot`/`brand_quotas_snapshot`, since SPEC §5.3 explicitly
  requires approval to use current capacity settings, unlike every other
  snapshot-based rule in the system.
- APPROVED finality required no new status-machine code: it is already
  covered by the existing `EDITABLE_STATUSES`/`assertEditablePlan` pattern
  shared by generation, submission and all of planEditService.js. Verified,
  not assumed, by firing every mutating endpoint (exclude, cancel-exclusion,
  confirm-replacement, regenerate, submit, re-approve, return) against an
  APPROVED plan and confirming each is rejected.
- Blocker add/remove confirmed to remain warning-only and status-unrestricted
  even on an APPROVED plan's member — membership and status unchanged.
- One design finding from orchestrator review, corrected before acceptance:
  GET /api/settings was initially ADMIN-only. Since planReadService.js never
  exposes the envelope warning thresholds or shipping capacities anywhere
  else, and SPEC §5.1/§5.2 require the planner and shipping screens to
  display values derived from them, GET was loosened to accept any valid
  demo role; PUT remains ADMIN-only. Validator re-confirmed after the change.
- Bug found and fixed in Builder's own self-test cycle (not by Validator or
  orchestrator): `updateSettings`'s final read used a different pooled
  connection than the one holding the uncommitted write inside the
  transaction, returning stale pre-commit data. Fixed by threading the
  transaction through to the read. Confirmed fixed by rerunning the full
  self-test from a fresh database.
- SPEC §14 test 9 reproduced exactly, independently by Builder, Validator and
  the orchestrator (three separate throwaway databases): shipping capacity
  of נמל חיפה set to 45 against 52 planned vehicles there -> approval
  rejected 409 `SHIPPING_CAPACITY_EXCEEDED`; return without a comment ->
  400 `COMMENT_REQUIRED`; return with a comment -> 200, status `RETURNED`,
  note visible via `GET /api/plan`.
- Concurrency: two simultaneous approval calls on the same plan correctly
  serialize via the existing plan-date advisory lock — exactly one
  `APPROVED` row and one matching audit event, verified directly against
  Postgres rows.
- Non-retroactivity confirmed end-to-end: a settings change leaves an
  existing plan's snapshot and membership untouched; a subsequent
  regeneration picks up the new values (reproducing SPEC §14 test 5's exact
  195-capacity numbers after changing only the capacity setting).
- `server/src/routes/shippingSettingsRoutes.test.js` (new, Validator-owned):
  10 tests. Full suite: 75/75 passing.
- Orchestrator independently reran the full suite and a separate end-to-end
  script against a disposable database (migrated/seeded fresh, dropped
  after), reproducing SPEC §14 test 9, role-gating on both settings and
  approval/return, APPROVED finality across every mutating endpoint, and the
  blocker-as-warning behavior directly.
- Not yet implemented (Tasks 5-7, out of scope for this round): React
  frontend, deployment, broader QA.

#### Post-Task-4 enhancement — replacement-suggestion recovery
- Added `GET /api/plan/replacement`, reusing `computeSuggestedReplacement()`
  from `planEditService.js` unchanged (no duplicated business logic). New
  `getReplacementSuggestion({actorRole})` in `planEditService.js` enforces
  PLANNER role and editable status (DRAFT/RETURNED) via the existing
  `assertPlannerRole`/`assertEditablePlan` helpers, wraps the read in a
  `db.sequelize.transaction` for the same sequential-query consistency
  `computeSuggestedReplacement` already requires, and performs no advisory
  lock (read-only, no plan mutation to serialize against), no write, and no
  audit event. Returns `{ suggestedReplacement }`, matching the shape already
  returned inline by exclude/confirm, or `{ suggestedReplacement: null }`
  when nothing is currently suggested.
- New `server/src/routes/planReplacementGet.test.js` (6 tests, orchestrator-
  authored since this was a small, self-contained addition handled directly
  per the human's instruction not to spawn agents unless necessary): refresh
  recovery returns the identical suggestion exclude returned and makes no
  plan_vehicles/audit_events change; a changed-eligibility case (blocking the
  previously suggested vehicle) returns a different suggestion and a stale
  confirm is still rejected (`STALE_SUGGESTION`); a genuinely-exhausted case
  (every eligible vehicle already in the plan, achieved by raising capacity
  to 262 so all FLEX-eligible candidates are absorbed) returns `null`; role
  rejection (`403` for SHIPPING/ADMIN); no-plan-yet rejection (`404`
  `PLAN_NOT_FOUND`); and locked-plan rejection (`409` `PLAN_LOCKED` once
  submitted to PENDING_SHIPPING).
- One bug in the test file itself was found and fixed before results were
  trustworthy, not a defect in the implementation: an initial `beforeEach`
  blanket-reset all vehicles' `active_blocker` to `NONE`, silently wiping the
  29 CSV-seeded blockers and producing a wrong suggested vehicle — the same
  class of mistake Validator caught in its own fixture during Task 3;
  removed the reset entirely.
- **Genuine pre-existing defect found on human review, corrected**:
  `computeSuggestedReplacement()` never checked SPEC §8.4's "room in
  capacity" (יש מקום בקיבולת) condition — present since Task 3, not
  introduced by this GET endpoint. A plan already at its `capacity_snapshot`
  still had a next-FIFO FLEX candidate suggested, because only
  eligibility/exclusion/HARD-quota were checked. Fixed: the function now
  returns `null` immediately once current membership reaches
  `capacity_snapshot`. Because `confirmReplacement()` already recomputes the
  suggestion fresh under its own locked transaction, this single fix also
  makes confirmation reject any addition attempted once the plan is full
  (`409 STALE_SUGGESTION`), with no separate capacity check needed there.
- `getReplacementSuggestion()` upgraded to `REPEATABLE READ` isolation so
  every query inside `computeSuggestedReplacement` observes one consistent
  snapshot of plan state; `confirmReplacement` is unaffected and still
  revalidates transactionally under the advisory lock before any insert.
- Both SPEC §14 replacement scenarios re-verified unaffected (exclusion
  brings membership to 199, one below the 200 capacity_snapshot, so the new
  capacity check never blocks either case): test 6 (PDI-195 Zeekr/FLEX ->
  PDI-200) and test 7 (PDI-281 Toyota/HARD -> PDI-107).
- `planReplacementGet.test.js` now has 8 tests: the 6 above, a restored
  full-capacity regression test (baseline plan reaches 200/200 on first
  generation with nothing excluded -> `null`), and a new
  `POST /plan/replacement/confirm` test confirming any addition attempt is
  rejected and nothing is inserted once the plan is at capacity. The earlier
  "genuinely exhausted eligible candidates" test (capacity raised to 262) is
  retained as a separate scenario — its `null` is due to exhausted
  eligibility, not capacity.
- Full suite: 83/83 passing (81 prior + 2 new). `git diff --check` clean.
  Dev DB confirmed untouched (300 vehicles, 0 plans) and no stray test
  database left behind.
- No new dependencies, no schema changes, no duplicated business logic, no
  additional agents spawned.

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
