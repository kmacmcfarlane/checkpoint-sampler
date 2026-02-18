# AGENT_FLOW.md  development contract

This file defines the deterministic workflow the agent must follow. It is designed for “fresh context” Ralph-style loops: each cycle starts with no conversational memory and must re-derive state from repo files.

## 0) Inputs and sources of truth

At the start of every cycle, read:
- /CLAUDE.md
- /agent/PRD.md
- /agent/backlog.yaml
- /agent/TEST_PRACTICES.md
- /agent/DEVELOPMENT_PRACTICES.md
- /CHANGELOG.md

Rules:
- /agent/backlog.yaml is the only source of “what to do next”.
- /agent/backlog.yaml and /agent/QUESTIONS.md are the only files in /agent that the agent should modify. The user is responsible for edits to the other files. If you would like to suggest an edit to these files, do so in /agent/IDEAS.md or /agent/QUESTIONS.md
- /agent/PRD.md defines product requirements and scope.
- /agent/TEST_PRACTICES.md and /agent/DEVELOPMENT_PRACTICES.md define standards.

If two docs conflict:
1) PRD overrides other non-process docs
2) TEST/DEVELOPMENT practices override convenience
3) CLAUDE.md overrides everything for safety rules
4) AGENT_FLOW.md governs process

## 1) Story lifecycle

Each story in backlog.yaml moves through these states:
- TODO (default): done=false and not blocked
- IN PROGRESS: done=false and agent has started implementation work in the current branch
- DONE: done=true after all DoD conditions are satisfied
- BLOCKED: done=false with a non-empty blocked_reason (or the schema equivalent)

The agent must work on exactly one story at a time.

## 2) Selecting work

Selection algorithm (deterministic):
1) Filter stories with done=false.
2) Exclude stories that are blocked (blocked=true or blocked_reason present, per schema).
3) Choose the highest priority story (higher number = higher priority unless backlog schema states otherwise).
4) Tie-breaker: lowest id lexicographically.

If no unblocked stories remain:
- Stop making changes and exit the cycle without modifying files.

## 3) Per-cycle workflow

For the selected story, perform in order:

### 3.1 Feature Branch
- Work each story in its own feature branch (e.g. `S-123` for a story, `B-321` for a bug)
- If a story becomes blocked, and you are halting, do not merge down the branch
- If the story is complete and the user has approved it after reviewing, merge the branch into `main` after commiting

### 3.2 Check for requirements changes
- Inspect the git commit history (or working set) for changes to the /agent/PRD.md or answers provided in /agent/QUESTIONS.md

### 3.3 Confirm scope and plan
- Re-read the story acceptance criteria and explicit constraints.
- Identify impacted modules and files.
- Define a minimal plan that satisfies acceptance criteria with the smallest change set.
- Ensure plan matches PRD scope.

### 3.4 Implement incrementally
- Apply changes in small, reviewable steps.
- Maintain backend layering boundaries:
    - internal/model for domain
    - internal/service for business logic
    - internal/store for persistence and provider clients
    - internal/api for transport/goa glue
    - internal/api/gen is generated and must not be edited
- Maintain frontend/backend separation:
    - frontend only calls backend API
    - provider calls occur only in backend store/provider packages
- For features marked as stubs in the PRD:
    - create/keep interfaces and return explicit "not implemented" errors
    - do not add unofficial workarounds unless backlog explicitly changes PRD

### 3.5 Update and add tests
- Encode acceptance criteria in tests.
- Ensure tests do not send real messages:
    - use dry-run and mocks/stubs
    - no network calls in unit tests
- Follow /agent/TEST_PRACTICES.md for structure, naming, and coverage expectations.

### 3.6 Run verification
- Run the relevant test and lint commands (per Makefiles and CLAUDE.md).
- Dev ergonomics targets must be maintained:
    - FE watch tests: `npm run test:watch`
    - BE watch tests: `ginkgo watch` (race where feasible)
- If tests fail:
    - fix the failure and re-run
    - do not disable or weaken tests to force green

### 3.7 Update artifacts
- Update /CHANGELOG.md with a concise entry for this story under “Unreleased” (or current top section).
- Update /agent/backlog.yaml:
    - Set done=true only when Definition of Done (DoD) is satisfied.
    - If blocked, record a concrete blocked_reason and stop.
    - If partially complete but not done, keep done=false and add a note field if schema supports it.
- Update /agent/QUESTIONS.md with any requirement questions
- Update /agent/IDEAS.md with ideas for features that could enhance the application

### 3.8 Commit rules
Default: commit when a story reaches DONE and the user has reviewed the changes. Wait for review before commiting.
- Create a single commit per story unless the story explicitly requires multiple commits.
- Commit message format:
    - `story(<id>): <title>`
- The commit must include:
    - code changes
    - passing tests for primary acceptance criteria
    - backlog.yaml updates
    - changelog entry

## 4) Definition of Done (DoD)

A story may be marked done=true only if all are true:
1) All acceptance criteria are satisfied.
2) Required tests are present and meaningful.
3) All relevant test suites pass locally.
4) Lint/typecheck passes where applicable (per story scope).
5) /CHANGELOG.md updated with the story entry.
6) Work committed with correct message format (unless story explicitly overrides).
7) No scope violations:
    - no generated code edits in internal/api/gen or **/mocks or inside node_modules or any other generated/external code
    - no unofficial workarounds for stubbed features
    - no secrets added to repo or logs

## 5) Blocking rules

A story is BLOCKED when:
- A required dependency is missing (e.g., unresolved design decision, missing schema detail) AND
- Progress cannot continue without inventing requirements or violating PRD.

When blocked:
- Do not mark done=true.
- Record blocked_reason with:
    - what is blocked
    - why it is blocked
    - what decision/input is needed
- Stop further implementation work for that story in the same cycle.
- Add questions to /agent/QUESTIONS.md to get clarification and prompt the user to update /agent/PRD.md

## 6) Safety gates

At all times:
- Respect CLAUDE.md safe-command policy.
- Never log secrets.
- Never modify infra/deploy/security-sensitive files unless the story explicitly requires it.

## 7) Stopping conditions

End the cycle when any occurs:
- The selected story reaches DONE and is committed.
- The selected story becomes BLOCKED and backlog.yaml is updated accordingly.
- No unblocked stories remain.
- A hard failure prevents continuing safely (e.g., irreconcilable test failures); record a blocker note and stop.

## 8) Discord notifications

If the `send_discord_notification` MCP tool is available, use it to notify the user at these points:

- **Start story**: When starting a story, send a notification with a basic summary of the story being worked.
- **Input needed**: Before displaying a claude permission request, send a notification to discord to get my attention.
- **Story implemented**: Include the story ID, title, and a brief summary of what changed.
- **Story merged down**: If you are running in non-interactive mode, send another message when committing and merging down.
- **Story blocked**: When a story becomes BLOCKED (section 5). Include the story ID and the blocked reason.
- **Cycle ending with no work**: When no unblocked stories remain (section 2). State that the backlog is empty or fully blocked.

Keep messages concise (1–3 sentences). Do not include secrets, file paths, or code in notifications. If the tool is unavailable or fails, continue normally — notifications are best-effort and must not block the workflow.

## 9) Ralph loop expectations

The agent must assume:
- Context is cleared between cycles.
- The only persisted state is the repository content and git history.
- Therefore, always re-read the input files in section 0 before acting.
