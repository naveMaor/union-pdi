
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
Status: COMPLETE

Steps 5.1–5.9 are complete and accepted. The human approved the Planner
acceptance results and all four Batch B3 browser captures.

Stack: React + Vite, plain JavaScript (no TypeScript), plain CSS (no
component library), native `fetch` via a centralized API client. Hebrew RTL
throughout; technical identifiers (vehicle_id, demo_vin) rendered LTR.
`client/.env` holds `VITE_API_BASE_URL` (default `http://localhost:3001/api`).
Dev server fixed to port 5173 with `strictPort`.

#### Step 5.1 — Contract and scaffold verification
- [x] Verify HEAD/git status, scaffold `client/` with Vite + React, verify
  Node 24 compatibility, retain lockfile, no engine warnings
- [x] Document exact API contracts (routes, roles, request/response shapes,
  field casing, error codes, status values) from the real backend source
- [x] Resolve targeted contract gaps: tab values/default/count semantics,
  exclusion-metadata read exposure, no-plan tab behavior

#### Step 5.2 — RTL foundation and API client
- [x] Hebrew RTL shell (`dir="rtl"`, `lang="he"`), fixed plan date display,
  role switcher (PLANNER only is functional this round; SHIPPING/ADMIN
  reserved for Task 6)
- [x] Centralized `fetch` API client: injects `x-demo-role`, parses
  `{error, message}` bodies, configurable base URL

#### Step 5.3 — Vehicle table, search and filters
- [x] Table of vehicles with the four tabs (`all`/`in_plan`/
  `eligible_not_in_plan`/`ineligible`), search (vehicle_id/demo_vin),
  brand/source filters, envelope-date sort
- [x] Global SPEC-aligned stat counts (300/262/38/200) kept visually
  distinct from the current filtered table count
- [x] Guard against stale filter responses overriding newer ones (request
  sequencing/abort)

#### Step 5.4 — Planning summaries and status
- [x] Plan status, returned note, brand quota utilization (with FLEX
  overage), source-location counts against live shipping capacities,
  blocker warnings, capacity (selected/target)
- [x] Explicit `{plan: null}` (no-plan-yet) state handled distinctly from a
  generated plan
- [x] Loading/error/empty states for every fetch; no fabricated data and no
  nonfunctional action buttons presented as working

Verification:
- Contract gaps found during Step 5.1 verification (orchestrator, directly
  against real backend source and a disposable database, no agents
  spawned): (1) `GET /vehicles`'s `count` is always the filtered-set count,
  never a global count — confirmed `tab=all&brand=Toyota` returns `count:
  90`, not 300; the frontend must derive SPEC-aligned global counts from a
  separate unfiltered `tab=all` fetch, never from the currently filtered
  response. (2) Persisted exclusion `reason_code`/`note`/actor/timestamp are
  returned only once, inline in the `POST /exclude` response, and are never
  retrievable again from any GET endpoint — confirmed directly: after
  excluding PDI-195 with `SECURITY_FORCES`, `GET /vehicles` shows only
  `reason: 'MANUALLY_EXCLUDED'` with no trace of the stored reason code, and
  `GET /plan` has no exclusions field at all. Flagged as a genuine backend
  gap against SPEC §5.1/§14 test 12 (a second browser window or a refresh
  cannot show *why* a vehicle was excluded); not fixed this round pending a
  human decision, per explicit instruction not to modify the backend
  without approval. (3) Before any plan exists, `capacitySnapshot` defaults
  to 0, so every eligible vehicle is misleadingly reported with `reason:
  'OVER_CAPACITY'` instead of reflecting that there is simply no plan yet —
  confirmed directly (all 262 eligible vehicles affected pre-generation).
  Also not fixed this round; the frontend must special-case `plan === null`
  and never surface this reason text verbatim.
- `client/` scaffolded via `npm create vite@latest . -- --template react`;
  `@types/react`/`@types/react-dom` removed (unneeded for a plain-JS
  project). `npm install` succeeded with 0 vulnerabilities and no Node-24
  engine warnings; `package-lock.json` retained. Vite dev server verified to
  start on port 5173 with `strictPort` and respond 200.
- **Batch A (Steps 5.2-5.4) build**: new `client/src/api/client.js` (centralized
  fetch wrapper), `client/src/constants.js`, `client/src/hooks/{useApiResource,
  useApi}.js`, `client/src/components/{StatusMessage,StatTiles,
  PlanSummaryPanel,VehicleFilters,VehicleTable}.jsx`, `client/src/screens/
  {PlannerScreen,ComingSoonScreen}.jsx`. Changed: `client/index.html`
  (`lang="he" dir="rtl"`), `client/src/App.jsx` (role switcher, fixed plan-date
  banner), `client/src/{App,index}.css`.
- Global stat tiles (300/262/38/N-in-plan) are derived client-side from one
  unfiltered `tab=all` fetch (`useAllVehicles`), never from the currently
  filtered table response's own `count` — independently confirmed by the
  orchestrator and Validator that `GET /vehicles?tab=all&brand=Toyota`
  returns `count: 90`, not 300, so this separation is load-bearing, not
  cosmetic.
- Plan's frozen `capacity_snapshot`/`brand_quotas_snapshot` (from `GET /plan`)
  and live `shippingCapacities`/envelope thresholds (from `GET /settings`)
  are kept as two separate data sources in `PlanSummaryPanel`, never
  conflated, per SPEC §5.3.
- `{plan: null}` renders a distinct "not generated yet" message, and the
  confirmed pre-generation `OVER_CAPACITY` backend quirk (Step 5.1 finding)
  is suppressed client-side via a `hasPlan` flag rather than displayed
  verbatim.
- Stale-response guarding in `useApiResource`: AbortController per request
  plus a request-id check, so neither an aborted nor a slow-but-unaborted
  older response can overwrite a newer one.
- **Defect found during Validator's live HTTP testing, fixed**: the API
  client unconditionally sent `Content-Type: application/json` even for
  no-body requests, which Fastify rejects (`FST_ERR_CTP_EMPTY_JSON_BODY`)
  and the backend's current error handler surfaces as a misleading `500`
  instead of `400`/`404`. Didn't affect this round's read-only UI (no
  action buttons exist yet) but would have broken every no-body mutating
  call in Batch B. Fixed client-side only (`Content-Type` set only when a
  body is actually present) per explicit orchestrator instruction to keep
  this round's fix within `client/` scope. Independently reproduced both the
  bug and the fix by the orchestrator directly against a disposable
  database: a no-body `POST /plan/submit` without the JSON header returned
  `404 PLAN_NOT_FOUND` with the corrected client behavior. The old header
  behavior produced a 500. The backend error handler was fixed in the
  integration correction batch below.
- `npm run build` and `npm run lint` (oxlint) both verified clean by the
  orchestrator independently (0 errors; 2 pre-existing benign warnings in
  the generic fetch hook, a standard pattern for this kind of hook, not a
  bug).
- Orchestrator independently reran the full backend regression suite
  (83/83 passing) and a separate end-to-end script against a disposable
  database (migrated/seeded fresh, dropped after), reproducing SPEC §14
  tests 2/3/4's exact numbers (38 ineligible; Toyota 55/Lexus 36/GAC
  22/Geely 44+12/Zeekr 43+15; נמל חיפה 52/נמל אשדוד 51/בונדד אשדוד
  49/בונדד חיפה 48) live through the real HTTP layer, and confirmed the dev
  DB remained untouched throughout (300 vehicles, 0 plans) with no stray
  test database left behind.
- Remaining limitation: no automated frontend test suite exists yet
  (Vitest/RTL would be a new dependency requiring approval); verification
  this round relied on direct code review, `build`/`lint`, and live
  manual/scripted HTTP integration checks against the real backend rather
  than component-level automated tests.
- Local preview: `cd client && npm run dev` (serves on `http://localhost:5173`
  with `strictPort`), with the backend running separately
  (`cd server && npm run dev`, listening on `127.0.0.1:3001`) and a plan
  already generated in the target database for the "generated plan" view
  (otherwise the UI correctly shows the no-plan empty state).
- Not yet implemented (Steps 5.5-5.9, Task 6, deployment): recommendation
  generation action, exclusions/replacement UI, blocker management UI,
  submission UI, shipping/admin frontends.

#### Integration correction batch (post-Batch-A, pre-Batch-B)
Human-approved targeted fix of 5 confirmed items, touching both `server/`
and `client/` (no new dependencies, no schema/migration changes, no new
endpoints):
1. `GET /api/vehicles` now returns persisted active-exclusion metadata per
   vehicle: `exclusion: {reason_code, note, excluded_by_name,
   excluded_by_role, excluded_at} | null`, built from the single
   `activeExclusions` query `listVehicles()` already ran (no N+1 added).
2. Fixed the misleading pre-generation `OVER_CAPACITY` reason:
   `computeNotInPlanReason` now returns `null` (not a fabricated code) once
   customs/blocker/exclusion checks pass and no plan exists yet — HARD-quota
   and capacity checks are skipped entirely pre-generation since they don't
   apply without a plan.
3. Fixed `app.js`'s global error handler to add a middle tier: domain
   `PlanServiceError` codes still map via the unchanged `ERROR_STATUS_MAP`;
   a genuine Fastify framework-level error (`error.code` starts with
   `FST_ERR_` and carries its own legitimate 4xx `error.statusCode`) now
   passes through as-is instead of collapsing to 500; anything else still
   sanitizes to the generic `500 INTERNAL_ERROR` with no leaked internals.
4. Frontend reconciled: `VehicleTable.jsx` renders the real `reason` (via
   `REASON_LABELS`) or a neutral "טרם תוכנן" chip only when `reason` is
   actually `null`; a new collapsible exclusion-detail panel displays the
   persisted exclusion metadata per excluded row.
5. `StatTiles.jsx`'s `isEligible()` now also requires no active `exclusion`
   (SPEC §7 step 1's full eligibility definition), independent of plan
   membership (`inPlan`), which remains a separate, untouched count.
6. Lint: both `useApiResource.js` warnings were genuine false positives
   given the hook's intentional design; suppressed using oxlint's actual
   disable-comment syntax (`oxlint-disable-next-line`, confirmed to differ
   from and not be satisfied by ESLint's own syntax — verified by actually
   re-running lint after adding each comment, not assumed), each with a
   one-line justification. `npm run lint`: 0 warnings, 0 errors.
- **New defect found during this round's own review** (Validator, confirmed
  independently by the orchestrator via source read): the new
  exclusion-detail panel initially mislabeled SPEC §8.3's 6 manual-exclusion
  reason codes using `REASON_LABELS` (a different, non-overlapping code
  space — "why isn't this vehicle in the plan"), rendering raw English
  constant names instead of Hebrew. Fixed with a new, correctly-scoped
  `EXCLUSION_REASON_LABELS` map in `constants.js` using SPEC §8.3's own
  Hebrew text.
- Human's 3 exact acceptance scenarios reproduced independently by the
  orchestrator (separate disposable database, own script, not reusing
  either agent's test run): baseline generate -> 262 eligible / 200 in-plan.
  Exclude a selected vehicle -> 261 eligible / 199 in-plan. Regenerate ->
  exclusion metadata and 261/200 (vehicle stays out) confirmed to survive
  regeneration via a fresh, independent `GET /vehicles` call (SPEC §8.2).
  Cancel that exclusion -> `exclusion` becomes `null` on the next GET, and
  (in a from-scratch sequence replicating the human's exact ordering)
  cancelling WITHOUT an intervening regeneration leaves 199 in-plan
  (unchanged, SPEC §8.3 no-auto-readd) / 262 eligible (back up). Separately:
  baseline plan, add a blocker to a currently-selected vehicle -> 261
  eligible / 200 in-plan (membership unaffected, SPEC §9).
- Error handler's 3 distinct paths independently reproduced: a known domain
  error (`PLAN_NOT_PENDING_SHIPPING`) unchanged; the Batch-A no-body-request
  finding now correctly returns a proper domain 4xx instead of 500; and a
  genuinely forced internal failure (orchestrator dropped the `vehicles`
  table in its own disposable database, the deliberately-last destructive
  step before teardown) still sanitizes to `500 {"error":"INTERNAL_ERROR",
  "message":"Unexpected server error"}` with no leaked DB internals.
- `server/src/routes/vehicleCorrectionBatch.test.js` (new, Validator-owned):
  6 tests. Full backend suite: 89/89 passing (83 prior + 6 new).
- `npm run build`/`npm run lint` in `client/` independently reconfirmed
  clean by the orchestrator (0 errors, 0 warnings).
- Orchestrator confirmed no stray test databases left behind and the dev DB
  untouched throughout (300 vehicles, 0 plans, unchanged).
- Remaining limitation (unchanged from Batch A): no automated frontend
  component-test suite exists yet (would need a new dependency); frontend
  correctness relies on direct code review, build/lint, and live
  backend-integration checks of the data the frontend consumes.
- Not committed, not pushed. Batch B (Steps 5.5-5.9), Task 6, and
  deployment remain out of scope and unstarted.

#### Batch A visual refinement — complete

- The human approved Design B's full-width vehicle workspace and requested Design A's compact quota bars and restrained styling. The [selected concept](design/task-5a-table-first-workspace.png) shows illustrative data.
- The Planner shows the fixed date, demo identity and role disclaimer. Capacity, vehicle totals, plan status, brand quotas, current shipping limits and any return note sit above the table. Existing plans use the saved capacity and quota snapshots. Before generation, the limits come from current settings.
- The RTL table shows all SPEC §6 display fields and isolates technical identifiers LTR. Envelope age uses the fixed date and warning thresholds from the settings API. Desktop filters stay above an internally scrolling table with sticky headers. Smaller screens use page scrolling and keep horizontal scrolling inside the table.
- Search, brand, source, sorting and the four table tabs use the vehicle API. The eligibility tabs now account for active manual exclusions. The Planner derives global badges from its separate unfiltered response. Exclusion details and warnings for blocked plan members remain visible.
- Chrome verified the seeded no-plan, draft and returned states at 1920 × 1080, desktop sizing at 1366 × 768, and scrolling behavior at 390 × 844. The human approved all three desktop captures. [No plan](design/task-5a-browser-no-plan.png) · [Draft](design/task-5a-browser-draft.png) · [Returned](design/task-5a-browser-returned.png)
- Frontend build and lint passed. The isolated backend suite passed all 91 tests after adding two API regressions for exclusion, cancellation and blocked membership. The browser used a separately migrated and seeded database. Cleanup removed it, and read-only fingerprints of all eight development tables matched before and after browser verification.

#### Step 5.5 — Recommendation generation
- [x] Generate/regenerate action with explicit confirmation when a plan
  already exists (409 `CONFIRMATION_REQUIRED` handling)

The frontend, screenshots and concurrent-generation correction are approved.

- The Planner toolbar creates the first recommendation and opens a native confirmation dialog for DRAFT and RETURNED plans. The app refreshes plan, settings and vehicle reads without resetting filters. Generation is unavailable for PENDING_SHIPPING and APPROVED.
- Headless Chrome verified the SPEC §14 totals, reload persistence, cancel and Escape, preservation of manual exclusions, clearing of manual additions, live settings and blocker use, RETURNED status, locked plans, duplicate clicks, a 500 response and recovery from a 409 confirmation conflict. Frontend build and lint and all 94 backend tests passed.
- The route previously checked plan existence before acquiring the advisory lock. The service now checks plan existence, status and explicit confirmation inside the locked transaction. Two concurrent unconfirmed requests yield one successful run and one `409 CONFIRMATION_REQUIRED` with the existing response shape. Locked plans return `409 PLAN_LOCKED` whether or not the request includes confirmation.
- Browser evidence [Create recommendation](design/task-5b1-create-recommendation.png) · [First-generation draft](design/task-5b1-first-generation-draft.png) · [Regeneration confirmation](design/task-5b1-regeneration-confirmation.png)

#### Step 5.6 — Exclusions and replacement recovery
- [x] Manual exclusion with required reason code (and note when `OTHER`),
  suggested-replacement display and confirmation, recovery via
  `GET /plan/replacement` after refresh, cancel-exclusion

#### Step 5.7 — Blocker management
- [x] Add/remove vehicle blockers, warning display on in-plan members

Batch B2 is complete and accepted. The human approved the verification
results and all five browser captures.

- Independent Chrome fixtures verified (§14) PDI-195 → PDI-200 and PDI-281 → PDI-107. Each exclusion left 199 members, and each explicit replacement restored 200. Cancelling an exclusion in a separate case restored eligibility and left membership at 199.
- Chrome verified the six exclusion reasons, `OTHER` note validation, persisted details after reload, replacement recovery in DRAFT and RETURNED, replacement read failures, stale or concurrently full suggestions and exhaustion with spare capacity. The browser also verified duplicate suppression, keyboard dismissal and rapid filter changes.
- Blocker add and remove refresh eligibility, warnings and the suggested replacement. Chrome verified unchanged membership and status in DRAFT, PENDING_SHIPPING and APPROVED, including a failed request and retry. Locked plans retain vehicle blocker controls and hide membership actions and the replacement panel.
- All 94 backend tests and frontend build and lint passed. The retained Chrome verifier uses fresh Vite and Fastify listeners and an isolated CSV-seeded database. Development-table fingerprints matched before and after verification.
- Browser evidence [Exclusion dialog](design/task-5b2-exclusion-dialog.png) · [Replacement panel](design/task-5b2-replacement-panel.png) · [Persisted exclusion](design/task-5b2-persisted-exclusion.png) · [Blocker controls](design/task-5b2-blocker-controls.png) · [Locked-plan warning](design/task-5b2-blocker-warning.png)

To reproduce the Chrome checks, use Node.js 24, install the locked
dependencies in both `client/` and `server/` with `npm ci`, and have
`google-chrome` on `PATH` or set `PDI_CHROME_BIN` to the Chrome executable.
With the local PostgreSQL instance running, configure the root `.env` and
ensure the development schema is migrated. The configured database role
needs to read the development tables for fingerprints and create and drop
its own disposable database. The script creates, migrates, seeds and
drops that database. Run it separately from other PostgreSQL-backed
tests because cleanup checks for remaining test databases. See the
[local database setup](../README.md#database-postgresql-via-docker-compose).

From the repository root, run `node client/scripts/verify-batch-b2.cjs`.
The retained verifier includes the Batch B2 and Batch B3 cases. Add
`--b3-screenshots` to update the four Batch B3 captures, or
`--screenshots` to update all retained captures under
`docs/design/`.

#### Step 5.8 — Submission and lifecycle
- [x] Submit eligible, nonempty DRAFT and RETURNED plans. Reflect
  PENDING_SHIPPING and APPROVED locks on membership operations, and
  retain vehicle blocker controls and warnings.

#### Step 5.9 — Integration, UX and acceptance tests
- [x] Run the retained Chrome verifier against the actual API and a
  CSV-seeded disposable PostgreSQL database.

Planner acceptance against SPEC §14

| Scenario | Verified through the Planner in Chrome | Other verification or Task 6 coverage |
| --- | --- | --- |
| 1. Seed | The UI lists 300 vehicles. | The backend suite covers idempotent seeding. |
| 2. Eligibility | 262 eligible and 38 ineligible, with 29 blocker and 9 customs reasons. | |
| 3–4. Baseline | First generation produces a 200-vehicle DRAFT with the exact brand and source totals. | |
| 5. Capacity 195 | Generation selects 195 with the exact specified brand totals. | ADMIN API sets capacity. The settings UI belongs to Task 6. |
| 6–7. Replacements | PDI-195 → PDI-200 and PDI-281 → PDI-107 independently move 200 → 199 → 200. | |
| 8. Regeneration | A rerun preserves an exclusion. Cancellation alone does not add the vehicle, and a subsequent rerun restores it. | |
| 9. Shipping overflow | Haifa 52/45 is shown as a warning. Submission succeeds and the Planner displays the return note. | ADMIN API sets the limit. SHIPPING API rejects approval and blank returns, and accepts a nonblank return. Their UIs belong to Task 6. |
| 10. Locking | PENDING_SHIPPING and APPROVED hide submission, regeneration, exclusion, cancellation and replacement confirmation. | Direct Planner API requests return `409 PLAN_LOCKED`. SHIPPING API prepares APPROVED. |
| 11. Selected blocker | The row is flagged, membership stays unchanged and submission is disabled. Removing the blocker restores eligibility. A stale submission is rejected and refreshes the UI. | Direct API returns `409 INELIGIBLE_VEHICLES_IN_PLAN`. |
| 12. Two browser contexts | After reload both contexts show matching plan status, capacity, exclusion details and shipping settings. A stale resubmission refreshes the second context to PENDING_SHIPPING. | Shipping and Admin mutations use their APIs. Their UIs belong to Task 6. |

The Chrome run also verified empty-plan rejection, submission with 200
and 199 vehicles, returned-plan editing, resubmission with a replacement
still available, duplicate and conflicting writes, mutation failures,
rapid filters and network cancellation, role switching, keyboard dialogs,
RTL/LTR, a sticky desktop table and narrow viewport scrolling. Browser
coverage used headless Chrome. All 94 backend tests and frontend build and
lint passed. The HTTP probe and the Chrome verifier both matched the
fingerprints of all eight development tables before and after.

Browser evidence [Submission with overflow](design/task-5b3-submission.png) ·
[PENDING_SHIPPING](design/task-5b3-pending-shipping.png) ·
[Blocked submission](design/task-5b3-blocked-submission.png) ·
[RETURNED](design/task-5b3-returned.png)

### Task 6 — Shipping and Admin Frontends
Status: COMPLETE — Steps 6.1–6.8 accepted, including both batches, validation fixes and browser evidence.

#### Step 6.1 — Shipping/Admin API contract verification
- [x] Verify `GET /api/plan`, `GET /api/settings`, the Admin-only `PUT /api/settings`, and the Shipping-only approval and return transitions against isolated PostgreSQL. Approval uses a bodyless `POST /api/plan/approve`. Return uses `POST /api/plan/return` with a nonblank string `comment`. Both writes return `{ plan }`.
- [x] Correct both malformed-input gaps found by the probe. Missing, non-string or blank return comments receive `400 COMMENT_REQUIRED`. A null, scalar or array `shippingCapacities` receives `400 INVALID_SETTING_VALUE`. Existing role and lifecycle guards, valid notes and valid partial settings updates retain their behavior.

#### Step 6.2 — Shipping read-only plan review
- [x] Activate the simulated Shipping user יוסי כהן with `x-demo-role: SHIPPING`. For PENDING_SHIPPING and APPROVED, show selected vehicles, blocker warnings and live limits for all four sources. Show status and applicable messages for a missing plan, DRAFT and RETURNED.

#### Step 6.3 — Shipping approval and return workflows
- [x] Approve pending plans within live shipping limits. Return pending plans through a keyboard-accessible dialog with a required note. Refresh after writes and report server rejections in Hebrew. Keep post-submission blockers as warnings.

#### Step 6.4 — Shipping integration and acceptance
- [x] Extend the retained Chrome verifier and run the Shipping acceptance matrix below. Use the Admin API for test setup.

| Case | Browser verification | Direct API or persistence verification |
| --- | --- | --- |
| SPEC §14 baseline and locking | Planner generates and submits 200 vehicles. Shipping approves the read-only plan and shows APPROVED after reload. Planner membership controls stay locked. | Direct API calls verify that role guards reject out-of-role writes. |
| SPEC §14 scenario 9 | Haifa 52/45 blocks approval after refresh. The return dialog rejects whitespace, supports Escape and submits a valid note. Planner sees the note, excludes a vehicle and resubmits 199. | Stale approval and direct approval return `SHIPPING_CAPACITY_EXCEEDED`. Omitted and whitespace notes return `COMMENT_REQUIRED`. Admin settings changes preserve membership. |
| SPEC §§8.1 and 9 | A blocker added after submission appears in the summary and vehicle row. Shipping can still approve. | The blocker write preserves status and membership. The approval audit identifies the Shipping demo user. |
| Lifecycle and interaction | No-plan, DRAFT, RETURNED and APPROVED states. Duplicate and conflicting actions, network failure feedback, stale status refresh and role-switch request cancellation. Keyboard dialog, RTL/LTR, sticky desktop table and narrow viewport scrolling. | A competing return makes stale approval fail. The client refreshes to the persisted status. |
| Malformed API inputs | Shipping dialog requires a nonblank note and submits a string. | Route regressions verify both HTTP 400 error codes, unchanged plan, membership, settings and audit rows after each rejection, and successful valid return, resubmission and partial settings update. |

Use the Chrome and PostgreSQL setup documented in Task 5. From the repository root, run `node client/scripts/verify-batch-b2.cjs` for all retained Planner and Shipping checks. Add `--shipping-screenshots` to refresh the four Shipping captures or `--screenshots` to refresh every retained capture. The verifier uses a disposable CSV-seeded database and compares fingerprints of all eight development tables.

Frontend build and lint, all 96 backend tests, and the complete retained headless Chrome verifier passed after the validation fixes. The Validator also passed all 12 focused route tests. The backend suite and Chrome used disposable databases, and all eight development-table fingerprints and the original seed matched before and after verification. The approved screenshots were preserved. Admin coverage used the API for test setup and contract checks. Browser coverage used headless Chrome.

Shipping browser evidence

- [Pending approval](design/task-6a-pending-approval.png)
- [Shipping overflow](design/task-6a-shipping-overflow.png)
- [Return dialog](design/task-6a-return-dialog.png)
- [Approved](design/task-6a-approved.png)

#### Step 6.5 — Admin settings screen
- [x] Activate the ADMIN demo role for רונית שמש. Load daily capacity, five brand targets and types, four shipping limits and both envelope thresholds from the server. Group the Hebrew form by how each setting takes effect.

#### Step 6.6 — Settings validation and persistence
- [x] Save only changed settings. Each changed brand sends the target and type required by the API. Keep invalid drafts editable, announce errors, and protect against duplicate saves. An explicit reload discards edits after confirmation and reads the persisted settings again.
- [x] Reject malformed `brandQuotas` maps and values outside the PostgreSQL `INTEGER` range with HTTP 400 `INVALID_SETTING_VALUE`. Preserve the minimum of 1 for daily capacity and 0 for quotas, shipping limits and envelope thresholds. The `INTEGER` storage maximum is 2,147,483,647. Yellow and red thresholds can still be set in either order. The form sends a complete object for each changed brand and rejects unrepresentable values before writing.

#### Step 6.7 — Snapshot versus live settings behavior
- [x] Preserve existing plan membership and the capacity and quota snapshots. Generate or regenerate from current capacity and brand settings. Use current shipping limits for approval and current envelope thresholds for display.

#### Step 6.8 — Cross-role integration and Task 6 acceptance
- [x] Extend the retained Chrome verifier to exercise all three interfaces against a CSV-seeded disposable PostgreSQL database.
- [x] Human accepted the Settings validation follow-up and all of Task 6, and approved the three Batch 6B local commits.

| SPEC §14 and supplemental checks | Browser acceptance | Direct API, database or backend tests |
| --- | --- | --- |
| 1. Seed | Planner lists all 300 vehicles. | Backend verifies PostgreSQL import and idempotent reseeding. |
| 2. Eligibility | Planner shows 262 eligible and 38 ineligible, with 29 blocker and 9 customs reasons. | |
| 3. Baseline recommendation | Planner generates 200. Brand counts and flexible quota overages match the specification. | |
| 4. Source distribution | Shipping shows 51 Ashdod, 52 Haifa, 49 bonded Ashdod and 48 bonded Haifa. | |
| 5. Capacity 195 | Admin saves 195. Planner keeps the existing 200 / 200 until confirmed regeneration, then shows 195 / 195. The retained Planner case also checks the displayed brand counts. | Direct plan read after the cross-role regeneration verifies Toyota 55, Lexus 36, GAC 20, Geely 42 and Zeekr 42. |
| 6. Flexible replacement | In Planner, excluding PDI-195 offers PDI-200 and confirmation restores 200 members. | |
| 7. Hard replacement | In Planner, excluding PDI-281 offers PDI-107 and confirmation restores 200 members. | |
| 8. Regeneration | Planner retains the exclusion on regeneration. Cancellation and a subsequent explicit rerun restore the vehicle. | |
| 9. Shipping overflow | Admin saves Haifa 45, Planner submits, and Shipping blocks approval at 52 / 45. Shipping returns the plan with a note. Admin restores the limit, then Planner resubmits and Shipping approves. | Direct approval over capacity and a return without a note are rejected. |
| 10. Plan locking | Planner membership actions stay unavailable in PENDING_SHIPPING and APPROVED. | A direct exclusion request receives `409 PLAN_LOCKED`. |
| 11. Selected blocker | Planner warns and blocks submission. Shipping warns for a blocker added after submission and can approve within live capacities. | |
| 12. Two contexts | Separate Chrome contexts and reloads agree on persisted settings. Retained Planner checks compare plan status and exclusion details across contexts. | Database checks verify persisted membership, the Admin audit actor and patch scope. |
| Settings validation follow-up | Admin prevents requests for invalid fields. Injected HTTP 400 and 500 responses exercise error feedback and preserving the draft for retry. | Backend route tests verify the actual HTTP 400 contract for malformed quota maps and out-of-range integers in every settings column. Mixed updates are atomic. Valid boundaries and partial updates persist. Rejections leave settings, plan snapshots, membership and audit records unchanged. |

The verifier also covers Geely target and type changes before and after regeneration, envelope colors without membership changes, local validation, failed writes, discard and reload, duplicate saves, role switches, cancelled reads, keyboard focus and a narrow viewport.

After the settings validation fixes, all 99 backend tests, the independent 15-test focused route run, frontend build and lint, and the complete headless Chrome run passed. The API probe, backend tests and Chrome verifier used disposable PostgreSQL databases. All eight development-table fingerprints and the tracked seed CSV matched before and after verification. Browser verification used Chrome only. The three approved Admin captures were preserved byte for byte.

Use the existing Task 5 Chrome and PostgreSQL setup. From the repository root, run `node client/scripts/verify-batch-b2.cjs`. Add `--admin-screenshots` to refresh only the three Admin captures. `--screenshots` refreshes all retained captures. Run `npm test` in `server/` and `npm run lint` and `npm run build` in `client/`.

Admin browser evidence

- [Default settings](design/task-6b-admin-default-settings.png)
- [Validation](design/task-6b-admin-validation.png)
- [Saved changes](design/task-6b-admin-saved-changes.png)

### Task 7 — QA and Deployment
Status: IN PROGRESS

#### Step 7.1 — SPEC compliance and acceptance audit
- [x] Independently audit SPEC §§4-15 and all 12 acceptance scenarios
  against the actual implementation and retained tests

#### Step 7.2 — Code quality, security and release readiness
- [x] Independent release audit: reproducibility, security, configuration,
  documentation and deployment gaps; review lint suppressions, Chrome-only
  coverage and the retained browser verifier

#### Step 7.3 — Repository cleanup and reproducible installation
- [x] Address Batch 7A findings classified as release blockers: CORS origin
  and server bind host are now env-configurable (`CORS_ORIGIN`, `HOST`,
  same defaults); root `.env.example` documents all 9 production env vars;
  reproducible clean-checkout install/migrate/seed/test verified twice
- [x] Repository hygiene: removed unused `client/README.md` (stock Vite
  boilerplate); local AI tooling (`.agents/`, `.claude/skills/`,
  `skills-lock.json`) gitignored, not deleted; superseded
  `task-5a-enterprise-dashboard.png` design draft moved out of the repo,
  preserved locally

#### Step 7.4 — Final README and AI documentation
- [x] Complete README (install/run/test/design decisions) and SPEC §11 AI
  section

#### Step 7.5 — Deployment architecture and hosting selection
- [x] Choose a hosting approach for the app and PostgreSQL: Render, free
  tier only (web service, static site, PostgreSQL), private GitHub repo
  connected via Render's GitHub App. The human accepted the free Postgres
  instance's limited lifetime (historically ~30-90 days before expiry) as
  a known risk, with recreation/upgrade as the contingency if it expires
  before the recruitment process concludes.

**Render configuration (approved, not yet provisioned):**

Root Directory is left **blank** on both Render services (repo root is
checked out in full), so `server/src/scripts/seed.js`'s CSV path
(`../../../docs/assignment/pdi_seed_300_vehicles.csv` relative to
`server/src/scripts`) and the single root `.env`/`.env.example` stay
reachable exactly as they are locally — no code changes needed for this.

| | Backend (`union-pdi-api`, Web Service) | Frontend (`union-pdi-web`, Static Site) |
|---|---|---|
| Root Directory | (blank) | (blank) |
| Build Command | `npm ci --include=dev --prefix server` | `npm ci --include=dev --prefix client && npm run build --prefix client` |
| Start / Publish | `npm run db:migrate --prefix server && npm run db:seed --prefix server && npm start --prefix server` | Publish Directory: `client/dist` |
| Env vars | `POSTGRES_DB`/`POSTGRES_USER`/`POSTGRES_PASSWORD`/`DB_HOST`/`DB_PORT` (from Render's internal Postgres connection fields), `HOST=0.0.0.0`, `CORS_ORIGIN=<static site URL>`, `NODE_ENV=production`, `NODE_VERSION=24`. `PORT` left unset (Render injects its own; already read via `process.env.PORT`). | `VITE_API_BASE_URL=<backend URL>/api` (build-time only), `NODE_VERSION=24` |

`sequelize-cli` stays in `devDependencies` (no reclassification); `npm ci
--include=dev` installs it regardless of `NODE_ENV`, verified directly
(`NODE_ENV=production npm ci --include=dev --prefix server` and `npm run
db:migrate --prefix server` both run correctly from the repo root).
`NODE_VERSION=24` is set directly as a Render env var rather than adding
per-directory `.node-version` files (the existing root `.nvmrc` isn't
read with a blank Root Directory setup, but `NODE_VERSION` always is).

No internal-database SSL configuration needed (same private network).
Two-step deploy order: create the backend first to learn its URL for the
static site's `VITE_API_BASE_URL`, then create the static site, then set
the backend's `CORS_ORIGIN` to the static site's exact URL and redeploy
the backend once.

**Verified in a disposable database, `NODE_ENV=production`, before
approving this plan:** migrations are idempotent (rerunning `db:migrate`
against an already-migrated DB: "No migrations were executed, database
schema was already up to date"). A full production-mode cycle — migrate,
seed, generate a 199-vehicle recommendation, add a blocker, manually
exclude a vehicle, change a setting as Admin — followed by a second
migrate+seed pass against the *same populated database* (simulating a
Render redeploy/restart, where there is no one-off job support) left all
eight development-table fingerprints identical (vehicles 300, settings 1,
brand_quotas 5, shipping_capacities 4, plans 1, plan_vehicles 199,
manual_exclusions 1, audit_events 5) and preserved the Admin's changed
`daily_capacity` setting exactly. Confirms `findOrCreate`/
`ignoreDuplicates` in `seed.js` make repeated migrate+seed on every
restart safe for all existing plans, settings, membership, exclusions,
blockers and audit records.

Pre-push review (secrets, git history, `.gitignore`, untracked assets):
no secrets found in any tracked file or the full git history; `.env` is
gitignored, only placeholder `.env.example` files are tracked; the
human-discovered CORS defect is correctly attributed in `docs/AI_LOG.md`.
Four confirmed-unused untracked scaffold assets (`client/public/icons.svg`,
`client/src/assets/{hero.png,react.svg,vite.svg}` — none referenced
anywhere in source, confirmed by grep and by a clean build/lint after
deleting them) were removed.

#### Step 7.6 — Deployment
- [ ] Deploy to the chosen public host

#### Step 7.7 — Deployed application acceptance
- [ ] Verify the live deployment against SPEC §14

#### Step 7.8 — Demonstration and interview preparation
- [ ] Prepare for the live 60-minute presentation (SPEC §13)

#### Step 7.9 — Final submission review
- [ ] Final check of repo, README, links before submission

Acceptance: deployed, tested application matching SPEC §14; complete README
and AI documentation; reproducible local setup.

## Development Rules

1. docs/assignment/SPEC.md is the source of truth.
2. Implement one task at a time.
3. Keep business rules on the server.
4. Test before moving to the next task.
5. Make meaningful Git commits throughout.
6. Review AI-generated code.
7. Never commit secrets.
