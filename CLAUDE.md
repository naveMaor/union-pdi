# Union PDI - Claude Code Instructions

## Project
Full-stack PDI planning application for Union Motors.

## Source of Truth
Read SPEC.md before implementation.
Do not introduce features outside its scope.

## Stack
- Node.js 24
- JavaScript
- Fastify 5
- PostgreSQL
- Sequelize 6
- React with Vite
- Hebrew RTL interface

## Architecture
- REST API
- Business logic in server-side services
- Database access through Sequelize
- PostgreSQL migrations and repeatable seed scripts
- Fastify routes should be thin

## Business Rules
- Fixed plan date: 2026-11-23
- Eligibility, capacity, quotas and status rules enforced server-side
- Shipping capacity is checked during approval, not recommendation
- Record all relevant operations and decisions
- Preserve manual exclusions during plan regeneration
- Never infer special treatment from customer_segment

## Working Rules
1. Read docs/PLAN.md before implementing.
2. Implement one task at a time.
3. Explain important design decisions.
4. Write tests for business rules.
5. Run tests before claiming completion.
6. Do not make Git commits without my approval.
7. Never commit credentials.
8. Ask before making architectural changes.
