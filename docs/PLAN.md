
# Union PDI — Development Plan

## Project Goal

Build the full-stack Union Motors PDI planning system
according to SPEC.md.

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

- [ ] Initialize Fastify backend
- [ ] Configure PostgreSQL using Docker
- [ ] Configure Sequelize ORM
- [ ] Design database schema
- [ ] Create database migrations
- [ ] Import 300 vehicles from CSV
- [ ] Seed initial configuration values
- [ ] Verify repeatable seed execution
- [ ] Verify 262 eligible vehicles

Acceptance:
300 vehicles exist in PostgreSQL.
Rerunning the seed does not create duplicates.

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
of SPEC.md.

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

1. SPEC.md is the source of truth.
2. Implement one task at a time.
3. Keep business rules on the server.
4. Test before moving to the next task.
5. Make meaningful Git commits throughout.
6. Review AI-generated code.
7. Never commit secrets.
