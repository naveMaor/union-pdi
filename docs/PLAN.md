
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
Status: IN PROGRESS

Batch A (Steps 5.1–5.4) is complete. The human approved Design B and the
three browser captures. Batch B (Steps 5.5–5.9) is pending.

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
- [ ] Generate/regenerate action with explicit confirmation when a plan
  already exists (409 `CONFIRMATION_REQUIRED` handling)

#### Step 5.6 — Exclusions and replacement recovery
- [ ] Manual exclusion with required reason code (and note when `OTHER`),
  suggested-replacement display and confirmation, recovery via
  `GET /plan/replacement` after refresh, cancel-exclusion

#### Step 5.7 — Blocker management
- [ ] Add/remove vehicle blockers, warning display on in-plan members

#### Step 5.8 — Submission and lifecycle
- [ ] Submit-for-shipping action and resulting status/locking reflected in
  the UI (no further edits once PENDING_SHIPPING/APPROVED)

#### Step 5.9 — Integration, UX and acceptance tests
- [ ] End-to-end frontend coverage against the real backend; SPEC §14
  scenarios exercised through the UI

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
