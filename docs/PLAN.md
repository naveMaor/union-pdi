
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
Status: IN PROGRESS

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
- [ ] Install and configure Sequelize ORM
- [ ] Design database relationships
- [ ] Create Sequelize migrations
- [ ] Apply database constraints
- [ ] Run migrations successfully

#### Step 1.6 — Seed Data
- [ ] Implement CSV import
- [ ] Import 300 vehicles
- [ ] Seed default settings and quotas
- [ ] Make the seed process idempotent

#### Step 1.7 — Database Verification
- [ ] Verify 300 vehicles in PostgreSQL
- [ ] Verify 262 eligible vehicles
- [ ] Verify seed does not create duplicates
- [ ] Verify default settings

Acceptance:
300 vehicles exist in PostgreSQL.
Rerunning the seed does not create duplicates.
All required database tables and constraints exist.

### Task 2 — Recommendation Algorithm
Status: NOT STARTED

- Implement eligibility rules
- Implement FIFO sorting
- Implement HARD and FLEX quotas
- Apply daily capacity
- Persist generated plans
- Write algorithm tests

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
