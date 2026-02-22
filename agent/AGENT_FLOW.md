# AGENT_FLOW.md  development contract

This file defines the deterministic workflow the orchestrator agent must follow. It is designed for "fresh context" Ralph-style loops: each cycle starts with no conversational memory and must re-derive state from repo files.

## 0) Inputs and sources of truth

At the start of every cycle, read:
- /CLAUDE.md
- /agent/PRD.md
- /agent/backlog.yaml
- /agent/TEST_PRACTICES.md
- /agent/DEVELOPMENT_PRACTICES.md
- /CHANGELOG.md

Rules:
- /agent/backlog.yaml is the only source of "what to do next".
- /agent/backlog.yaml and /agent/QUESTIONS.md are the only files in /agent that the agent should modify. The user is responsible for edits to the other files. If you would like to suggest an edit to these files, do so in /agent/IDEAS.md or /agent/QUESTIONS.md
- /agent/PRD.md defines product requirements and scope.
- /agent/TEST_PRACTICES.md and /agent/DEVELOPMENT_PRACTICES.md define standards.

If two docs conflict:
1) PRD overrides other non-process docs
2) TEST/DEVELOPMENT practices override convenience
3) CLAUDE.md overrides everything for safety rules
4) AGENT_FLOW.md governs process

## 1) Story lifecycle

Each story in backlog.yaml has a `status` field with one of these values:

- **todo** (default): Not started. Eligible for selection by the fullstack engineer.
- **in_progress**: Fullstack engineer is actively implementing.
- **review**: Implementation complete. Pending code review.
- **testing**: Code review passed. Pending QA testing.
- **done**: All gates passed. Story is complete.
- **blocked**: Cannot proceed. Must have a non-empty `blocked_reason`.

### 1.1 Status transitions

```
todo ──────────► in_progress ──────────► review ──────────► testing ──────────► done
                     ▲                     │                   │
                     │    (changes requested)                  │ (issues found)
                     └─────────────────────┘                   │
                     ▲                                         │
                     └─────────────────────────────────────────┘

Any status ──► blocked (with blocked_reason)
blocked ──► todo (when blocker is resolved by user)
```

Valid transitions — the **Deciding subagent** column shows which subagent's verdict triggers the transition. The **orchestrator** writes all status changes to backlog.yaml; subagents only report their verdict.

| Transition | Deciding subagent | Trigger |
|---|---|---|
| `todo` → `in_progress` | **Fullstack Engineer** | Picks up the story to begin implementation |
| `in_progress` → `review` | **Fullstack Engineer** | Implementation and tests complete |
| `in_progress` → `blocked` | **Fullstack Engineer** | Cannot continue without external input |
| `review` → `testing` | **Code Reviewer** | Code review approved |
| `review` → `in_progress` | **Code Reviewer** | Changes requested (feedback in `review_feedback`) |
| `testing` → `done` | **QA Expert** | QA approved, all gates passed |
| `testing` → `in_progress` | **QA Expert** | Issues found (feedback in `review_feedback`) |

**Ownership rules:**
- No subagent may write status changes directly to backlog.yaml. Subagents report structured verdicts; the orchestrator updates backlog.yaml.
- No subagent may update CHANGELOG, commit, or merge. These are exclusively orchestrator responsibilities (see section 4.5).
- The orchestrator enforces valid transitions by only invoking the correct subagent for the story's current status.

### 1.2 Story dependencies (`requires`)

A story may declare a `requires` field listing the IDs of stories that must be completed before it can be started. This is a structural dependency defined at planning time, distinct from the runtime `blocked` state.

- A story with `requires: [S-002, S-004]` is not eligible for selection until both S-002 and S-004 have `status: done`.
- `requires` dependencies are transitive in effect: if S-009 requires S-008, and S-008 requires S-007, then S-009 cannot start until both S-007 and S-008 are done.
- A story may be both `requires`-gated and `blocked` — these are independent conditions.

### 1.3 Review feedback

When a code reviewer or QA expert returns a story to `in_progress`, they record feedback in the `review_feedback` field of the story in backlog.yaml. This field is a free-text string describing what needs to change. The fullstack engineer reads this field when resuming work on the story and clears it when setting status to `review` again.

## 2) Subagents

The orchestrator delegates work to specialized subagents via the Task tool. Subagent definitions live in `/.claude/agents/`:

| Subagent | File | Invoked when | Verdict triggers |
|---|---|---|---|
| Fullstack Engineer | `fullstack-engineer.md` | Story is `todo` or `in_progress` | → `review` (or → `blocked`) |
| Code Reviewer | `code-reviewer.md` | Story is `review` | → `testing` or → `in_progress` |
| QA Expert | `qa-expert.md` | Story is `testing` | → `done` or → `in_progress` |
| Debugger | `debugger.md` | On demand (test failures, hard bugs) | n/a |
| Security Auditor | `security-auditor.md` | On demand (security-sensitive stories) | n/a |

Subagents report structured verdicts. The **orchestrator** writes all status changes, CHANGELOG updates, commits, and merges.

### 2.1 Invoking subagents

Use the Task tool to invoke a subagent. Pass the subagent's prompt (from its `.md` file) along with the story context (ID, acceptance criteria, branch name, and any review feedback). The subagent works within the current repository state and returns a structured result.

### 2.2 Subagent model selection

- **Fullstack Engineer**: Use `sonnet` model for implementation speed
- **Code Reviewer**: Use `opus` model for thorough review
- **QA Expert**: Use `sonnet` model for test execution
- **Debugger**: Use `sonnet` model for diagnosis
- **Security Auditor**: Use `opus` model for thorough analysis

## 3) Selecting work

The orchestrator must process stories in this priority order:

### 3.1 Priority: finish in-flight work first

1. **Review queue**: Find stories with `status: review`. Process the highest priority one by invoking the code reviewer.
2. **Testing queue**: Find stories with `status: testing`. Process the highest priority one by invoking the QA expert.
3. **In-progress stories with feedback**: Find stories with `status: in_progress` AND a non-empty `review_feedback`. Process the highest priority one by invoking the fullstack engineer to address the feedback.
4. **New work**: Select a new story using the algorithm below.

### 3.2 New work selection algorithm (deterministic)

1) Filter stories with `status: todo`.
2) Exclude stories that are `blocked` (blocked=true or blocked_reason present).
3) Exclude stories whose `requires` list contains any story that does not have `status: done`.
4) Choose the highest priority story (higher number = higher priority unless backlog schema states otherwise).
5) Tie-breaker: lowest id lexicographically.

If no eligible stories remain across all queues:
- Stop making changes and exit the cycle without modifying files.

## 4) Per-cycle workflow

The orchestrator performs these steps each cycle:

### 4.1 Feature Branch
- Work each story in its own feature branch (e.g. `S-123` for a story, `B-321` for a bug)
- If the story is already `in_progress`/`review`/`testing`, the branch should already exist — switch to it
- If a story becomes blocked, do not merge down the branch
- If the story reaches `done` and the user has approved it, merge the branch into `main` after committing

### 4.2 Check for requirements changes
- Inspect the git commit history (or working set) for changes to the /agent/PRD.md or answers provided in /agent/QUESTIONS.md

### 4.3 Dispatch to subagent

Based on the story's current status, invoke the appropriate subagent:

#### Story status: `todo` or `in_progress`
1. Set status to `in_progress` in backlog.yaml if currently `todo`
2. Invoke the **fullstack engineer** subagent with:
   - Story ID, title, and acceptance criteria
   - Any `review_feedback` (if returning from review/QA)
   - Branch name
3. On success: set status to `review`, clear `review_feedback`
4. On failure/blocked: set status to `blocked` with `blocked_reason`

#### Story status: `review`
1. Invoke the **code reviewer** subagent with:
   - Story ID, title, and acceptance criteria
   - Branch name (diff against main)
2. If approved: set status to `testing`
3. If changes requested: set status to `in_progress`, record feedback in `review_feedback`

#### Story status: `testing`
1. Invoke the **QA expert** subagent with:
   - Story ID, title, and acceptance criteria
   - Branch name
   - Code reviewer's approval notes (if any)
2. If approved: set status to `done`
3. If issues found: set status to `in_progress`, record feedback in `review_feedback`

### 4.4 Update artifacts (orchestrator responsibility)

After each subagent completes, the **orchestrator** (not the subagent) performs these updates:
- Update /agent/backlog.yaml with the new status and any feedback
- Are there questions that could help decide next steps? Update /agent/QUESTIONS.md and trigger a discord notification via the MCP tool. Also indicate questions in the chat output.
- Update /agent/IDEAS.md with ideas for features that could enhance the application

### 4.5 Finalization on QA approval (orchestrator responsibility)

When the QA expert reports **APPROVED**, the orchestrator performs these steps in order:

1. **Update CHANGELOG**: Add an entry to /CHANGELOG.md for the completed story.
2. **Update backlog**: Set `status: done` in /agent/backlog.yaml.
3. **Commit**: Create the commit (per commit rules below).
4. **Merge**: Merge the feature branch into `main` (per the commit/merge policy in PROMPT.md).

These finalization actions are exclusively owned by the orchestrator. No subagent may update CHANGELOG, commit, or merge.

### 4.6 Commit rules
Default: commit when a story reaches `done` and the user has reviewed the changes. Wait for review before committing.
- Create a single commit per story unless the story explicitly requires multiple commits.
- Commit message format:
    - `story(<id>): <title>`
- Do not add "Co-Authored-By" trailers or any other attribution lines to commit messages.
- The commit must include:
    - code changes
    - passing tests for primary acceptance criteria
    - backlog.yaml updates
    - changelog entry

## 5) Definition of Done (DoD)

A story may be set to `status: done` only if all are true:

**Verified by subagents (before QA approval):**
1) All acceptance criteria are satisfied.
2) Required tests are present and meaningful.
3) All relevant test suites pass locally.
4) Lint/typecheck passes where applicable (per story scope).
5) Code review passed (story went through `review` → `testing` transition).
6) QA testing passed (QA expert reports APPROVED).
7) No scope violations:
    - no generated code edits in internal/api/gen or **/mocks or inside node_modules or any other generated/external code
    - no unofficial workarounds for stubbed features
    - no secrets added to repo or logs

**Performed by the orchestrator (after QA approval):**
8) /CHANGELOG.md updated with the story entry.
9) Work committed with correct message format (unless story explicitly overrides).
10) Feature branch merged to main (per commit/merge policy in PROMPT.md).

## 6) Blocking rules

A story is BLOCKED when:
- A required dependency is missing (e.g., unresolved design decision, missing schema detail) AND
- Progress cannot continue without inventing requirements or violating PRD.

When blocked:
- Set `status: blocked`.
- Record blocked_reason with:
    - what is blocked
    - why it is blocked
    - what decision/input is needed
- Update /agent/IDEAS.md with ideas for features that could enhance the application
- Update /agent/backlog.yaml if stories now require each other in a new way

## 7) Safety gates

At all times:
- Respect CLAUDE.md safe-command policy.
- Never log secrets.
- Never modify infra/deploy/security-sensitive files unless the story explicitly requires it.

## 8) Stopping conditions

End the cycle when any occurs:
- The selected story reaches `done` and is committed.
- The selected story becomes `blocked` and backlog.yaml is updated accordingly.
- No eligible stories remain across any queue.
- A hard failure prevents continuing safely (e.g., irreconcilable test failures); record a blocker note and stop.

## 9) Discord notifications

If the `send_discord_notification` MCP tool is available, use it to notify the user on every status transition and at key workflow points.

### 9.1 Message format

Every message MUST start with the project name in brackets: `[project-name]`. The project name comes from the `project` field in backlog.yaml.

Example: `[checkpoint-sampler] S-028: todo → in_progress. Starting XY grid corner-based cell resizing.`

### 9.2 Status transition notifications

Send a notification on every story status change:

- **todo → in_progress**: `[project] <id>: todo → in_progress. Starting: <title>.`
- **in_progress → review**: `[project] <id>: in_progress → review. Implementation complete: <brief summary of what changed>.`
- **in_progress → blocked**: `[project] <id>: in_progress → blocked. <blocked_reason>.`
- **review → testing**: `[project] <id>: review → testing. Code review approved.`
- **review → in_progress**: `[project] <id>: review → in_progress. Changes requested: <1-2 sentence summary of feedback>.`
- **testing → done**: `[project] <id>: testing → done. QA approved. <title> is complete.`
- **testing → in_progress**: `[project] <id>: testing → in_progress. QA found issues: <1-2 sentence summary of feedback>.`

When a story is returned to `in_progress` (from review or testing), always include a concise summary of the feedback so the user understands what went wrong without needing to check the repo.

### 9.3 Other notifications

- **Input needed**: Before displaying a claude permission request. `[project] Input needed — waiting for approval.`
- **Story merged down**: If running in non-interactive mode, when committing and merging. `[project] <id>: Committed and merged to main.`
- **Cycle ending with no work**: When no eligible stories remain. `[project] No eligible stories — backlog is empty or fully blocked.`

### 9.4 Rules

- Keep messages concise (1-3 sentences).
- Do not include secrets, file paths, or code in notifications.
- If the tool is unavailable or fails, continue normally — notifications are best-effort and must not block the workflow.

## 10) Ralph loop expectations

The agent must assume:
- Context is cleared between cycles.
- The only persisted state is the repository content and git history.
- Therefore, always re-read the input files in section 0 before acting.
- A single cycle may advance a story through multiple status transitions (e.g., `todo` → `in_progress` → `review` → `testing` → `done`) if all subagents complete successfully within the cycle.
