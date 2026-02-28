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
- /agent/backlog.yaml is the only source of "what to do next". Completed stories are archived in /agent/backlog_done.yaml (read-only reference; do not modify).
- /agent/backlog.yaml, /agent/QUESTIONS.md, and files under /agent/ideas/ are the only files in /agent that the agent should modify. The user is responsible for edits to the other files. If you would like to suggest an edit to these files, do so in the appropriate file under /agent/ideas/ or /agent/QUESTIONS.md
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
- **uat**: QA approved. Code is merged to main. Awaiting user acceptance testing. User may provide `uat_feedback` or manually move to `done`.
- **done**: User accepted. Story is complete.
- **blocked**: Cannot proceed. Must have a non-empty `blocked_reason`.

### 1.1 Status transitions

```
todo ──► in_progress ──► review ──► testing ──► uat ──► done (user action)
              ▲             │           │         │
              │  (changes   │           │         │ (uat_feedback)
              │  requested) │           │         │
              └────────────┘           │         │
              ▲  (issues found)         │         │
              └───────────────────────┘         │
              ▲  (uat_feedback)                   │
              └────────────────────────────────┘

Any status ──► blocked (with blocked_reason)
blocked ──► todo (when blocker is resolved by user)
```

Valid transitions — the **Deciding subagent** column shows which subagent's verdict triggers the transition. The **orchestrator** writes all status changes to backlog.yaml; subagents only report their verdict.

| Transition | Deciding subagent      | Trigger |
|---|------------------------|---|
| `todo` → `in_progress` | **Orchestrator**       | Picks up the story to begin implementation |
| `in_progress` → `review` | **Fullstack Engineer** | Implementation and tests complete |
| `in_progress` → `blocked` | **Fullstack Engineer** | Cannot continue without external input |
| `review` → `testing` | **Code Reviewer**      | Code review approved |
| `review` → `in_progress` | **Code Reviewer**      | Changes requested (feedback in `review_feedback`) |
| `testing` → `uat` | **QA Expert**          | QA approved; finalization performed (CHANGELOG, commit, merge) |
| `testing` → `in_progress` | **QA Expert**          | Issues found (feedback in `review_feedback`) |
| `uat` → `in_progress` | **Orchestrator**       | User provided `uat_feedback`; orchestrator copies to `review_feedback` and clears `uat_feedback` |
| `uat` → `done` | **User** (manual)      | User accepted; edits backlog.yaml directly |

**Ownership rules:**
- No subagent may write status changes directly to backlog.yaml. Subagents report structured verdicts; the orchestrator updates backlog.yaml.
- No subagent may update CHANGELOG, commit, or merge. These are exclusively orchestrator responsibilities (see section 4.5).
- The orchestrator enforces valid transitions by only invoking the correct subagent for the story's current status.

### 1.2 Story dependencies (`requires`)

A story may declare a `requires` field listing the IDs of stories that must be completed before it can be started. This is a structural dependency defined at planning time, distinct from the runtime `blocked` state.

- A story with `requires: [S-002, S-004]` is not eligible for selection until both S-002 and S-004 have `status: done` or `status: uat` (code is on main in both cases).
- `requires` dependencies are transitive in effect: if S-009 requires S-008, and S-008 requires S-007, then S-009 cannot start until both S-007 and S-008 are done or uat.
- A story may be both `requires`-gated and `blocked` — these are independent conditions.

### 1.3 Review feedback

When a code reviewer or QA expert returns a story to `in_progress`, they record feedback in the `review_feedback` field of the story in backlog.yaml. This field is a free-text string describing what needs to change. The fullstack engineer reads this field when resuming work on the story and clears it when setting status to `review` again.

### 1.4 UAT feedback

After a story reaches `uat`, the user may provide feedback by writing to the `uat_feedback` field in backlog.yaml. The orchestrator detects this during work selection (section 3.1). When detected, the orchestrator:
1. Copies the `uat_feedback` content into `review_feedback`.
2. Clears `uat_feedback`.
3. Sets `status: in_progress`.
4. Creates a new feature branch from `main` (since the prior branch was already merged).

This allows the fullstack engineer to use the standard `review_feedback` field without awareness of UAT. The rework follows the normal cycle: `in_progress` → `review` → `testing` → `uat`.

## 2) Subagents

The orchestrator delegates work to specialized subagents via the Task tool. Subagent definitions live in `/.claude/agents/`:

| Subagent | File | Invoked when | Verdict triggers |
|---|---|---|---|
| Fullstack Engineer | `fullstack-developer.md` | Story is `todo` or `in_progress` | → `review` (or → `blocked`) |
| Code Reviewer | `code-reviewer.md` | Story is `review` | → `testing` or → `in_progress` |
| QA Expert | `qa-expert.md` | Story is `testing` | → `uat` or → `in_progress` |
| Debugger | `debugger.md` | On demand (test failures, hard bugs) | n/a |
| Security Auditor | `security-auditor.md` | On demand (security-sensitive stories) | n/a |

Subagents report structured verdicts. The **orchestrator** writes all status changes, CHANGELOG updates, commits, and merges.

### 2.1 Invoking subagents

Use the Task tool to invoke a subagent. Pass the subagent's prompt (from its `.md` file) along with the story context (ID, acceptance criteria, branch name, and any review feedback). The subagent works within the current repository state and returns a structured result.

### 2.2 Subagent model selection

- **Fullstack Engineer**:
  - `low` complexity: Use `sonnet` (fast, sufficient for simple changes)
  - `medium` or `high` complexity: Use `opus` (deeper capabilities for refactors/architectural/cross-stack changes)
- **Code Reviewer**: Model depends on change complexity reported by the fullstack engineer:
  - `low` complexity: Use `sonnet` (fast, sufficient for pattern-following changes)
  - `medium` or `high` complexity: Use `opus` (thorough review for architectural/cross-stack changes)
  - If complexity is not reported: default to `opus`
- **QA Expert**: Use `opus` model for test execution and writing E2E tests
- **Debugger**: Use `sonnet` model for diagnosis
- **Security Auditor**: Use `opus` model for thorough analysis

## 3) Selecting work

The orchestrator must process stories in this priority order:

### 3.1 Priority: finish in-flight work first

1. **Review queue**: Find stories with `status: review`. Process the highest priority one by invoking the code reviewer.
2. **Testing queue**: Find stories with `status: testing`. Process the highest priority one by invoking the QA expert.
3. **UAT feedback queue**: Find stories with `status: uat` AND a non-empty `uat_feedback`. For the highest priority one: copy `uat_feedback` into `review_feedback`, clear `uat_feedback`, set `status: in_progress`, create a new feature branch from `main`, and then invoke the fullstack engineer to address the feedback.
4. **In-progress stories with feedback**: Find stories with `status: in_progress` AND a non-empty `review_feedback`. Process the highest priority one by invoking the fullstack engineer to address the feedback.
5. **New work**: Select a new story using the algorithm below.

### 3.2 New work selection algorithm (deterministic)

1) Filter stories with `status: todo`.
2) Exclude stories that are `blocked` (blocked=true or blocked_reason present).
3) Exclude stories whose `requires` list contains any story that does not have `status: done` or `status: uat`.
4) **Bugs first**: Partition eligible stories into bugs (id starts with `B-`) and non-bugs. If any bugs are eligible, select from bugs only.
5) Within the selected partition, choose the highest priority story (higher number = higher priority).
6) Tie-breaker: lowest id lexicographically.

If no eligible stories remain across all queues:
- Stop making changes and exit the cycle without modifying files.

## 4) Per-cycle workflow

The orchestrator performs these steps each cycle:

### 4.1 Feature Branch
- Work each story in its own feature branch (e.g. `S-123` for a story, `B-321` for a bug)
- If the story is already `in_progress`/`review`/`testing`, the branch should already exist — switch to it
- If a story becomes blocked, do not merge down the branch
- If the story reaches `uat`, the branch has already been merged into `main` (see section 4.5)
- **UAT rework**: When a `uat` story returns to `in_progress` (via `uat_feedback`), create a new feature branch from current `main`. The previous branch was already merged. Use the standard branch name (e.g., `S-123`); if it still exists from the prior merge, delete it first and recreate from `main`.

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
3. On success: extract the **Change Summary** from the fullstack engineer's verdict (see section 4.3.2). Set status to `review`, clear `review_feedback`.
4. On failure/blocked: set status to `blocked` with `blocked_reason`

#### Story status: `review`
1. Invoke the **code reviewer** subagent with:
   - Story ID, title, and acceptance criteria
   - Branch name (diff against main)
   - **Change summary** extracted from the fullstack engineer's verdict (see section 4.3.2)
2. If approved: set status to `testing`
3. If changes requested: set status to `in_progress`, record feedback in `review_feedback`

#### Story status: `testing`
1. Invoke the **QA expert** subagent with:
   - Story ID, title, and acceptance criteria
   - Branch name
   - Code reviewer's approval notes (if any)
   - **Change summary** extracted from the fullstack engineer's verdict (see section 4.3.2)
2. The QA expert will run `make test-e2e` as part of its verification. This command is self-contained — it starts an isolated backend + frontend stack (`checkpoint-sampler-e2e`), runs all Playwright tests, and tears down automatically. The orchestrator does NOT need to ensure `make up-dev` is running before dispatching to QA for E2E tests.
3. Parse the QA verdict for the story result, E2E test results, and runtime error sweep findings.
4. If approved: set status to `uat` (finalization per section 4.5)
5. If issues found: set status to `in_progress`, record feedback in `review_feedback`
6. After the story status transition, process any sweep findings per section 4.4.1.
7. After the story status transition, process any E2E failure bug tickets per section 4.4.2.

### 4.3.2 Change summary extraction and passthrough

When the fullstack engineer completes successfully, its verdict includes a "Change Summary" section listing modified files and descriptions. The orchestrator:

1. **Extracts** the change summary from the fullstack engineer's response.
2. **Stores** it in the orchestrator's working state for the current cycle.
3. **Passes** it to the code reviewer and QA expert as part of their dispatch context, formatted as:
   ```
   Change summary (from fullstack engineer):
   - <file path>: <description>
   - <file path>: <description>
   ```

This helps downstream agents orient faster by knowing which files changed and why, reducing redundant exploratory reads. The change summary does NOT replace reading actual source files — reviewers and QA must still read the code. It supplements their initial orientation.

If the fullstack engineer's response does not include a change summary (e.g., older prompt format), the orchestrator should fall back to `git diff --name-only main..HEAD` to generate a file list and pass that instead (without descriptions).

### 4.4 Update artifacts (orchestrator responsibility)

After each subagent completes, the **orchestrator** (not the subagent) performs these updates:
- Update /agent/backlog.yaml with the new status and any feedback
- Are there questions that could help decide next steps? Update /agent/QUESTIONS.md and trigger a discord notification via the MCP tool. Also indicate questions in the chat output.
- **Process improvement ideas**: If the subagent's response includes a "Process Improvements" section, route each idea to the appropriate file under `/agent/ideas/`:
  - `Features` → `agent/ideas/new_features.md` (net-new capabilities) or `agent/ideas/enhancements.md` (improvements to existing features)
  - `Dev Ops` → `agent/ideas/devops.md`
  - `Workflow` → `agent/ideas/agent_workflow.md`
  - Testing infrastructure ideas → `agent/ideas/testing.md`

  Each idea must include `* status: needs_approval`, `* priority: <value>` (using the priority suggested by the subagent), and `* source: <agent>` identifying the originating agent (`developer`, `reviewer`, `qa`, or `orchestrator`). Format:
  ```
  ### <title>
  * status: needs_approval
  * priority: <low|medium|high|very-low>
  * source: <developer|reviewer|qa|orchestrator>
  <description>
  ```
  Then send a discord notification:
  `[project] New ideas from <agent-name>: <title> — <brief description>, <title> — <brief description>.`

### 4.4.1 Processing QA runtime error sweep findings

When the QA expert's verdict includes a "Runtime Error Sweep" section with findings (sweep result: FINDINGS), the orchestrator processes them **after** the story status transition:

1. **New bug tickets**: For each bug ticket reported by QA (see /agent/BUG_REPORTING.md for quality requirements):
   - Determine the next available `B-NNN` ID by scanning existing bug IDs in backlog.yaml.
   - Add the ticket to the `stories` list in /agent/backlog.yaml with:
     - `id`: Next sequential B-NNN
     - `title`: From QA's suggested title
     - `priority`: From QA's suggested priority (default: 70)
     - `status: todo`
     - `requires: []`
     - `acceptance`: From QA's suggested acceptance criteria
     - `testing`: From QA's suggested testing commands
     - `notes`: Include the log evidence and root cause hypothesis from the QA report

2. **Improvement ideas**: For each improvement idea reported by QA:
   - Route to the appropriate file under `/agent/ideas/` (see section 4.4 for routing rules). Include `* status: needs_approval`, `* priority: <value>` (using the priority suggested by QA), and `* source: qa`.
   - Send a discord notification: `[project] New ideas from qa-expert sweep: <title> — <brief description>, <title> — <brief description>.`

3. **Discord notification**: If any bug tickets were filed, send a notification (see section 9.2).

4. **Timing**: Process sweep findings after the story status transition and before the commit. This ensures new backlog entries are included in the story's commit. If the story was REJECTED, sweep findings are still processed — they are independent of the story result.

5. **No sweep findings**: If sweep result is CLEAN or the section is absent, skip this step.

### 4.4.2 Processing QA E2E failure bug tickets

When the QA expert's verdict includes an "E2E Test Results" section with `Status: FAILED` and one or more bug tickets listed under "New E2E bug tickets", the orchestrator processes them **after** the story status transition:

1. **Story-related E2E failures**: The QA expert is expected to have already attempted to fix or investigate these during its verification cycle. If they caused rejection, the story's `review_feedback` will describe the issue — no separate ticket is needed.

2. **New E2E bug tickets**: For each unrelated (pre-existing) E2E failure reported by QA as a bug ticket (see /agent/BUG_REPORTING.md for quality requirements):
   - Determine the next available `B-NNN` ID by scanning existing bug IDs in backlog.yaml.
   - Add the ticket to the `stories` list in /agent/backlog.yaml with:
     - `id`: Next sequential B-NNN
     - `title`: From QA's suggested title
     - `priority`: From QA's suggested priority (default: 70)
     - `status: todo`
     - `requires: []`
     - `acceptance`: From QA's suggested acceptance criteria
     - `testing`: From QA's suggested testing commands
     - `notes`: Include the failing test name, error output, and root cause hypothesis from the QA report

3. **E2E result tracking**: Record the E2E pass/fail counts from the QA verdict in the story's commit notes or as a comment in the commit message (e.g., `E2E: 42 passed, 0 failed`). This provides a regression baseline visible in git history.

4. **Discord notification**: If any E2E bug tickets were filed, send a notification:
   `[project] QA E2E failures: filed <N> new ticket(s): <B-NNN> (<title>), <B-NNN> (<title>). See backlog.yaml.`
   - Sent immediately after the story status notification.

5. **Timing**: Process E2E bug tickets after the story status transition and before the commit (same as sweep findings). E2E bug tickets are processed regardless of whether the story was approved or rejected.

6. **No E2E failures**: If E2E Status is PASSED or SKIPPED, or the "New E2E bug tickets" list is absent or empty, skip this step.

### 4.5 Finalization on QA approval (orchestrator responsibility)

When the QA expert reports **APPROVED**, the orchestrator performs these steps in order:

1. **Update CHANGELOG**: Add an entry to /CHANGELOG.md for the completed story. If a CHANGELOG entry already exists for this story (e.g., from a prior UAT rework cycle), replace it rather than adding a duplicate.
2. **Update backlog**: Set `status: uat` in /agent/backlog.yaml.
3. **Commit**: Create the commit (per commit rules below).
4. **Merge**: Merge the feature branch into `main` (per the commit/merge policy in PROMPT.md).

The story enters `uat` with code on `main`. The user reviews functionality and either moves the story to `done` (manual edit) or provides `uat_feedback` to trigger a rework cycle.

These finalization actions are exclusively owned by the orchestrator. No subagent may update CHANGELOG, commit, or merge.

### 4.6 Commit rules
Default: commit when a story reaches `uat`. Finalization (commit and merge) happens immediately upon QA approval. For UAT rework cycles, use commit message format: `story(<id>): <title> (UAT rework)`.
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

### 5.1 Entry to `uat` (agent-driven)

A story may be set to `status: uat` only if all are true:

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

### 5.2 Entry to `done` (user-driven)

The user manually sets `status: done` in backlog.yaml after reviewing the deployed functionality during `uat`. Agents never set `status: done` directly.

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
- Update the appropriate file under /agent/ideas/ with ideas for features that could enhance the application
- Update /agent/backlog.yaml if stories now require each other in a new way

## 7) Safety gates

At all times:
- Respect CLAUDE.md safe-command policy.
- Never log secrets.
- Never modify infra/deploy/security-sensitive files unless the story explicitly requires it.

## 8) Stopping conditions

End the cycle when any occurs:
- The selected story reaches `uat` and is committed/merged to main.
- The selected story becomes `blocked` and backlog.yaml is updated accordingly.
- No eligible stories remain across any queue (note: `uat` stories without `uat_feedback` are NOT eligible work).
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
- **testing → uat**: `[project] <id>: testing → uat. QA approved. <title> merged to main, awaiting user acceptance.`
- **testing → in_progress**: `[project] <id>: testing → in_progress. QA found issues: <1-2 sentence summary of feedback>.`
- **uat → in_progress**: `[project] <id>: uat → in_progress. UAT feedback received: <1-2 sentence summary of uat_feedback>.`

When a story is returned to `in_progress` (from review or testing), always include a concise summary of the feedback so the user understands what went wrong without needing to check the repo.

- **QA sweep findings**: `[project] QA sweep: filed <N> new ticket(s): <B-NNN> (<title> — <1-2 sentence description>), <B-NNN> (<title> — <1-2 sentence description>). See backlog.yaml.`
  - Sent only when the QA sweep produced new bug tickets (not for improvement ideas alone).
  - Sent immediately after the story status notification.

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
- A single cycle may advance a story through multiple status transitions (e.g., `todo` → `in_progress` → `review` → `testing` → `uat`) if all subagents complete successfully within the cycle. The `uat` → `done` transition is always a manual user action.

### 10.1 Per-iteration temp directory (`.ralph-temp/`)

The `.ralph-temp/` directory is available for any ephemeral per-iteration files (logs, debug context, intermediate outputs). Key facts:

- **Auto-created**: claude-sandbox creates the directory automatically if it does not exist.
- **Emptied each iteration**: Contents are deleted at the start of each ralph iteration, unless the iteration is a `--resume` (in which case previous contents are preserved).
- **Gitignored**: The directory is in `.gitignore` — never commit its contents.
- **Not committed**: Do not include `.ralph-temp/` files in story commits.
- **Use cases**: E2E log capture, runtime context snapshots (`capture-runtime-context.sh`), any other temporary diagnostic output.
