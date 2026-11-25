# Union PDI — Claude Code Instructions

## 1. Project

Full-stack PDI planning application for Union Motors, developed as part of the Full Stack AI-Native take-home assignment.

The objective is to deliver a working, tested, deployed application that satisfies the official assignment requirements.

Prioritize correctness, simplicity, maintainability and specification compliance over unnecessary complexity.

## 2. Source of Truth

@docs/assignment/SPEC.md

### Official Assignment Files

| File | Purpose |
|---|---|
| `docs/assignment/SPEC.md` | Authoritative functional and technical specification |
| `docs/assignment/PDI_FullStack_Assignment_Candidate.pdf` | Official formatted assignment |
| `docs/assignment/pdi_seed_300_vehicles.csv` | Original vehicle dataset |
| `docs/assignment/pdi_ui_reference.png` | UI design inspiration |
| `docs/assignment/README_CANDIDATE.txt` | Candidate and submission instructions |
| `docs/PLAN.md` | Project implementation plan |

### Source Priority

1. Official SPEC.md and assignment PDF.
2. Original CSV dataset.
3. UI reference mockup.

The implementation plan is a roadmap, not a replacement for the official specification.

### Specification Rules

- Every agent must independently read the relevant sections of SPEC.md before designing, implementing or validating a task.
- Reference specification section numbers when making important decisions or reporting findings.
- Use Section 14 as the basis for acceptance testing.
- Do not introduce features outside the assignment scope.
- The UI reference is inspiration only, not an additional source of requirements.
- Never modify the original assignment files.
- Escalate unresolved specification ambiguities to the human developer.
- Do not rely solely on another agent's interpretation of the specification.

## 3. Technology Stack

- Node.js 24
- JavaScript
- Fastify 5
- PostgreSQL
- Sequelize 6
- React with Vite
- Hebrew RTL interface
- Docker Compose for local PostgreSQL
- Node.js built-in test runner
- Git for version control

Do not change the approved technology stack without human approval.

## 4. Architecture

- REST API.
- Business logic in server-side services.
- Database access through Sequelize.
- PostgreSQL migrations and repeatable seed scripts.
- Fastify routes should be thin.
- Separate application initialization from server startup.
- Enforce data integrity through appropriate database constraints.
- Use transactions where related database operations must succeed or fail together.
- Prefer simple, maintainable solutions over unnecessary abstractions.
- Avoid premature optimization and overengineering.

## 5. Business Rules

- Fixed application plan date: `2026-11-23`.
- Do not derive the plan date from the system clock.
- Database design must support plans for different dates.
- Enforce one plan per date through a database constraint.
- Prevent duplicate vehicle membership within a plan.
- Eligibility, capacity, quotas, status transitions and role permissions must be enforced server-side.
- FIFO ordering uses `envelope_date`, followed by `vehicle_id`.
- Hard brand quotas are upper limits, not guaranteed allocations.
- Flexible brand quotas may be exceeded.
- Recommendation uses a single-pass algorithm.
- Shipping capacity is checked during approval, not recommendation.
- Preserve manual exclusions during plan regeneration.
- Manual additions are reset during recommendation regeneration.
- Manual exclusions and vehicle blockers are distinct concepts.
- Parameter changes must not automatically modify an existing plan.
- Shipping approval uses the current shipping capacity settings.
- Record relevant operations, decisions and status transitions.
- Never infer special treatment from `customer_segment`, `population` or requested delivery dates.
- Approved plans cannot be edited.
- Pending shipping plans cannot be edited.
- Vehicle blocker changes must follow the specific behavior defined in Section 9.
- Role simulation is not a security or authentication mechanism.

When implementing a business rule, consult the corresponding section of SPEC.md for its complete behavior.

## 6. Multi-Agent Development

The project uses a collaborative development workflow with three AI roles and a human developer.

### Human Developer

The human developer has final authority over:

- Architectural decisions.
- Technology and dependency changes.
- Unresolved requirement ambiguities.
- Destructive database operations.
- Task acceptance.
- Git commits and pushes.

### Orchestrator

The main Claude Code session acts as the orchestrator.

Responsibilities:

- Read SPEC.md and docs/PLAN.md.
- Identify the current implementation task.
- Define task scope and acceptance criteria.
- Assign responsibilities to Builder and Validator.
- Coordinate dependencies and execution order.
- Ensure agents communicate directly when available.
- Prevent conflicting file edits.
- Monitor progress and resolve disagreements using specification evidence.
- Require independent verification before declaring completion.
- Escalate unresolved findings to the human developer.
- Present final implementation and validation evidence.
- Maintain project planning and AI collaboration documentation.

The orchestrator should coordinate rather than duplicate the work assigned to teammates.

### Builder Agent

The Builder owns production implementation.

Responsibilities:

- Independently read the relevant specification sections.
- Inspect existing implementation before making changes.
- Propose a technical design before implementation.
- Explain important design decisions and trade-offs.
- Implement only the assigned task.
- Own production code, database models and migrations.
- Communicate directly with Validator.
- Address valid review findings.
- Challenge incorrect findings with specification or technical evidence.
- Report modified files and implementation decisions.
- Never weaken or remove tests to conceal defects.
- Never mark its own implementation as independently validated.

### Validator Agent

The Validator owns independent technical verification.

Responsibilities:

- Independently derive requirements from SPEC.md.
- Review Builder's proposed design before implementation.
- Challenge assumptions and unnecessary complexity.
- Identify specification violations.
- Review database integrity, constraints and relationships.
- Review business logic and edge cases.
- Own automated test files.
- Execute relevant tests and inspect actual results.
- Verify database behavior against actual PostgreSQL when required.
- Send actionable findings directly to Builder.
- Independently verify corrections.
- Report remaining risks and limitations.

The Validator must not approve implementation solely because Builder claims it is correct.

The Validator must not modify production code without explicit coordination and human approval.

## 7. Agent Communication Protocol

Use native Claude Code agent spawning and direct agent-to-agent messaging when available.

Agents should:

- Communicate directly rather than requiring the orchestrator to relay every message.
- Provide concrete, actionable feedback.
- Reference relevant specification sections.
- Include file paths and code locations when reporting defects.
- Distinguish confirmed defects from suggestions and assumptions.
- Report blockers immediately.
- Notify affected teammates when changes are ready for verification.

Do not simulate agent conversations or fabricate messages.

If direct messaging is unavailable, report the limitation and ask the orchestrator to coordinate an alternative workflow.

Persistent agent definitions, when configured, are located in:

- `.claude/agents/builder.md`
- `.claude/agents/validator.md`

Existing running agents must reload project instructions when those instructions change.

## 8. Task Execution Workflow

For each implementation task:

### Phase A — Task Preparation

1. Read SPEC.md and docs/PLAN.md.
2. Inspect existing code and Git status.
3. Identify completed and incomplete work.
4. Define task scope and acceptance criteria.
5. Preserve previously completed functionality.

### Phase B — Design

1. Builder proposes a technical design.
2. Validator independently reviews the proposal.
3. Builder and Validator discuss findings directly.
4. Resolve disagreements using specification evidence.
5. Obtain human approval for architectural changes and new dependencies.

### Phase C — Implementation

1. Builder implements the approved design.
2. Validator prepares independent tests.
3. Agents respect file ownership.
4. Coordinate operations that modify shared database state.
5. Do not implement unrelated functionality.

### Phase D — Validation

1. Validator reviews the implementation.
2. Run relevant automated tests.
3. Verify applicable database constraints and persisted data.
4. Compare actual results against acceptance criteria.
5. Report defects directly to Builder.

### Phase E — Correction Loop

1. Builder addresses valid findings.
2. Validator reruns relevant tests.
3. Validator independently verifies corrections.
4. Repeat until findings are resolved.

Allow a maximum of three automatic correction cycles before escalating unresolved issues to the human developer.

### Phase F — Completion

1. Orchestrator summarizes implementation and validation results.
2. Present changed files and relevant Git diff.
3. Report remaining risks and limitations.
4. Request human approval.
5. Update project documentation based on verified results.
6. Propose a Git commit message.

Do not automatically proceed to the next task.

## 9. File Ownership

To prevent concurrent editing conflicts:

| Area | Owner |
|---|---|
| Production code | Builder |
| Database models and migrations | Builder |
| Automated tests | Validator |
| Project plan | Orchestrator |
| AI collaboration log | Orchestrator |
| Original assignment files | Read-only for all agents |

Agents must coordinate before modifying files owned by another active agent.

Only one agent should perform database-mutating verification at a time.

## 10. Testing and Verification

- Write meaningful automated tests for business rules.
- Use acceptance criteria from Section 14 of SPEC.md.
- Test actual behavior rather than implementation details where practical.
- Include negative cases and relevant edge cases.
- Verify server-side enforcement independently of the frontend.
- Use actual PostgreSQL for database integration verification.
- Use an isolated test database where practical.
- Verify migration and seed behavior when applicable.
- Do not hardcode expected acceptance results into production logic.
- Do not modify tests merely to make failing implementations pass.
- Run existing tests to detect regressions.
- Never claim tests passed without executing them.
- Clearly report tests that could not be executed.

## 11. Git and Database Safety

- Inspect Git status before implementation.
- Preserve existing user changes.
- Never commit credentials, secrets or database connection values.
- Do not make Git commits without human approval.
- Do not push without human approval.
- Maintain meaningful incremental commit history.
- Do not squash the project into a single submission commit.
- Do not delete Docker volumes without explicit approval.
- Do not reset or destroy existing databases without explicit approval.
- Do not bypass tool permissions or organizational security policies.
- Review dependency changes before installing packages.

## 12. Documentation

### Implementation Plan

`docs/PLAN.md`

- Maintain the current implementation roadmap.
- Update progress only after verification.
- Do not mark unverified tasks as completed.
- Document significant changes to the implementation plan.

### AI Collaboration Log

`docs/AI_LOG.md`

Record meaningful AI development activities, including:

- AI tools and models actually used.
- Agent responsibilities and collaboration.
- Important technical decisions.
- Incorrect AI assumptions.
- Defects identified during review.
- How defects were corrected.
- Verification commands and results.
- Human interventions and decisions.
- Remaining limitations.

Do not fabricate AI mistakes, agent conversations, model usage or verification evidence.

Use this log as supporting material for the final README AI section required by the assignment.

### Project README

`README.md`

Maintain the documentation required by SPEC.md, including installation, configuration, migrations, seed execution, testing, design decisions and AI usage.

## 13. Definition of Done

A task is ready for human acceptance only when:

- Implementation satisfies the relevant specification requirements.
- Relevant database constraints are verified.
- Independent validation has been performed.
- Relevant automated tests pass.
- Existing functionality has not regressed.
- Review findings are resolved or explicitly documented.
- Implementation decisions and limitations are documented.
- Changed files and verification evidence have been presented.

A task is complete after human acceptance.

Git commits and pushes require separate explicit human approval.

## 14. Working Rules

1. Read docs/PLAN.md before implementing.
2. Implement one task at a time.
3. Follow the official assignment specification.
4. Explain important design decisions.
5. Write and execute meaningful tests.
6. Prefer the simplest solution that meets the requirements.
7. Ask before making architectural changes.
8. Obtain approval before introducing new dependencies.
9. Preserve completed work.
10. Never expose or commit credentials.
11. Never fabricate implementation or verification evidence.
12. Report uncertainty and limitations explicitly.
13. Do not automatically begin the next task.
14. Keep the human developer informed of important decisions.

The goal is not merely to produce working code, but to produce code that the human developer can understand, explain, maintain and confidently modify during the assignment's live coding session.