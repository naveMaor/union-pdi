# AI Collaboration Log

Factual record of AI-assisted development activity on this project. Entries are added as work happens; nothing here is reconstructed or fabricated after the fact.

## Tools and models actually used

- **Claude Code** 2.1.332, orchestrator session running model `claude-sonnet-5` (Sonnet 5.5).
- Native agent spawning (`Agent` tool) with `subagent_type: general-purpose`, and native agent-to-agent messaging (`SendMessage`). The `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` setting was enabled in this environment during the successful communication experiment below; we have not independently established which of the behaviors observed (spawning named agents, direct `SendMessage` delivery, idle-notification resumption) actually require that setting versus being available without it, so the setting's enabled state is recorded as a condition present during the experiment, not confirmed as a strict requirement for every observed capability.
- External review: ChatGPT was consulted outside this session as a second opinion on the Step 1.5 constraint design, and again for reviewing the persistent agent definitions and this log; its feedback was relayed back into this session by the human developer. The human developer reported the model used for this latest review as **GPT-6.2**. The model/version used for the earlier constraint-design review was not recorded at the time and cannot be confirmed retroactively.

## Multi-agent communication experiment

Before starting Step 1.5, the orchestrator ran a small experiment to verify native agent-to-agent communication before relying on it for real implementation work.

**Setup:** two named background agents were spawned directly from the orchestrator session, `builder` (agent id `abuilder-145cc44dca7535ab`) and `validator` (agent id `avalidator-0e0e661cab25ad12`), each briefed independently (not given each other's reasoning, only each other's name to address messages to).

**What happened, in order:**

1. **builder → validator:** Builder proposed a database constraint to prevent the same vehicle appearing twice in the same daily PDI plan: a PostgreSQL partial unique index on `plan_vehicles(plan_id, vehicle_id) WHERE excluded_at IS NULL`, added via a Sequelize migration, intended to block duplicate *active* membership while letting excluded/historical rows persist across plan regeneration.
2. **validator → builder:** Validator reviewed the proposal independently and sent back five concrete technical points: (1) whether re-adding a previously-excluded vehicle should `UPDATE` the existing row's `excluded_at` rather than `INSERT` a new one, to avoid unbounded row growth; (2) the application must still catch Postgres `23505 unique_violation` for a concurrent-insert race, not rely on the index alone; (3) `plan_id`/`vehicle_id` must be explicit `NOT NULL`, since Postgres treats `NULL`s as distinct in unique indexes; (4) the down-migration must explicitly `removeIndex` the named constraint; (5) whether plan regeneration reuses the same `plan_id` in place or creates a new plan row needs to be confirmed, since that determines whether the index is the actual mechanism preserving exclusions or merely incidental.
3. **builder → validator:** Builder accepted all five points, incorporating (1), (3) and (4) as direct fixes to the design, and flagging (2) and (5) as service-layer/regeneration-design requirements the index alone cannot resolve. Validator confirmed it had no further issues with the revised proposal.

**Result:** direct bidirectional `SendMessage` delivery between two independently-running named agents succeeded — a full round trip (`builder` → `validator` → `builder`) completed with each agent acting only on content it actually received, not fabricated, and no messages were manually relayed by the orchestrator at any point.

**Limitation:** the orchestrator only observed each agent's own self-reported summary of what it sent/received (via idle notifications and direct teammate messages); there is no independent tool available to the orchestrator to inspect a raw message log, so correctness of delivery rests on each agent's own account.

## Architectural concern raised after external review (open, not yet resolved)

After the above experiment, the human developer separately consulted ChatGPT about the same constraint design. That review raised a concern not caught by Builder or Validator at the time: the partial-unique-index approach (`WHERE excluded_at IS NULL`) ties manual-exclusion state directly into the `plan_vehicles` membership table, which may be unnecessary complexity — the assignment (`docs/assignment/SPEC.md`, Section 10) calls for a **separate** manual-exclusions table and a separate decision/event audit log, and does not require plan-version history. A simpler alternative suggested: a plain composite unique constraint on `plan_vehicles(plan_id, vehicle_id)`, with manual exclusions stored in their own table, keyed independently (e.g. by `vehicle_id` + plan date) rather than as a soft-delete flag on plan membership rows.

This is recorded as an **open architectural question to evaluate during Step 1.5 design**, not as an already-resolved defect — no code or migration implementing either design exists yet. Separately, during a later protocol-sync exercise in this same session, the Validator agent — after actually reading `docs/assignment/SPEC.md` directly for the first time — independently raised the same concern on its own, before being told about the ChatGPT review. That independent convergence is noted here as supporting evidence, not as proof the concern is correct; it still needs to be resolved as part of the Builder's Step 1.5 design proposal and Validator's review of it.

## Human interventions and decisions

- Human developer rewrote `CLAUDE.md` to move the authoritative specification to `docs/assignment/SPEC.md` and define the Orchestrator/Builder/Validator collaboration protocol (commit `0cfea6b`).
- Human developer requested and reviewed the staged commit before approving it; nothing was committed or pushed without explicit approval.
- Human developer relayed the external ChatGPT review into this session.

## Remaining limitations at time of writing

- Step 1.5 (Database Schema) has not been implemented. No Sequelize dependency, models, or migrations exist yet.
- The constraint design (partial unique index vs. plain unique constraint + separate exclusions table) is unresolved and will be decided during Step 1.5's design phase (CLAUDE.md Section 8, Phase B), with Validator review before implementation.
- Persistent agent definitions (`.claude/agents/builder.md`, `.claude/agents/validator.md`) were added in this session; whether Claude Code picks them up without a session restart has not yet been confirmed (see orchestrator's report to the human developer).
