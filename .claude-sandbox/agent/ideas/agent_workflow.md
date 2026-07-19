# Agent Workflow

Changes to agent processes, orchestrator behavior, story writing, and handoff patterns. Only items requiring user approval belong here — routine improvements should be implemented directly by agents.

## Required fields for new entries

Every idea appended by agents must include:
- `status: needs_approval` — default for all new ideas. The user changes this to `approved`, `rejected`, etc.
- `priority: <low|medium|high|very-low>` — the agent's suggested priority based on impact and effort.
- `source: <developer|reviewer|qa|orchestrator>` — which agent originated the idea.

Example:
```
### <Title>
* status: needs_approval
* priority: medium
* source: developer
<Description — 1-3 sentences>
```

## Ideas

### Fix pre-existing TypeScript errors in frontend test files
* status: needs_approval
* priority: medium
* source: developer
SamplePresetEditor.test.ts has 28 pre-existing vue-tsc errors (.vm and .props on WrapperLike). These should be fixed with proper type casting to avoid masking new errors during type checks.

### Update PRD.md to use "stopped" instead of "paused" in state machine documentation
* status: needs_approval
* priority: low
* source: qa
PRD.md still references "paused" in the job state machine and database schema documentation. These should be updated to match the renamed "stopped" status after the S-049 terminology change.

### Register E2E Discord notification format in AGENT_FLOW.md section 9.2
* status: needs_approval
* priority: low
* source: qa
The E2E failure notification format defined in AGENT_FLOW.md section 4.4.2 item 4 (`[project] QA E2E failures: filed <N> new ticket(s)...`) is not registered in section 9.2 "Status transition notifications" alongside the existing "QA sweep findings" notification. Listing it in 9.2 would maintain a single reference point for all notification templates.

### Backlog linting for acceptance criteria numeric fields
* status: needs_approval
* priority: very-low
* source: developer
A lightweight lint step that scans acceptance criteria text for the words "CFG", "steps", or "seed" and warns when the expected format (float/integer) is not mentioned. This would enforce DEVELOPMENT_PRACTICES.md section 4.10 automatically at story authoring time rather than relying on agent memory.

### Lint check for agent markdown files
* status: needs_approval
* priority: very-low
* source: developer
A CI step that validates agent prompt files (.claude/agents/*.md) for required sections (e.g., "Change Summary", "Root Cause Analysis") to catch drift between AGENT_FLOW.md requirements and subagent definitions before it reaches the code review phase.

### Audit other agent docs for stale smoke test references
* status: needs_approval
* priority: very-low
* source: developer
A pass over `agent/AGENT_FLOW.md` and other `.claude/agents/` files (code-reviewer.md, debugger.md) to confirm no remaining references to "manual curl" as a standard verification gate after the W-004 E2E-first standardization. Currently out of scope for W-004 but easy to miss.

### Reviewer audit of nil-guard error types against Goa DSL declarations
* status: needs_approval
* priority: low
* source: developer
A systematic check comparing nil-guard error types in API handler methods against each method's `Error(...)` declarations in the Goa DSL would catch mismatches automatically rather than relying on reviewer spot-checks. E.g., the `Show` method may still use `MakeServiceUnavailable` without declaring it in the DSL.

### Auto-update ResetDB table list on new migrations
* status: needs_approval
* priority: low
* source: developer
When a new migration adds a table, the developer must remember to update the table list in `ResetDB()`. A code review checklist item or a linter rule could catch this automatically.

### E2E test impact analysis for UI behavior changes
* status: needs_approval
* priority: low
* source: developer
When a story introduces an intermediate dialog or changes a user flow (like S-093's confirmation dialog), the developer should proactively search for E2E specs that exercise the affected journey (e.g., `grep -r 'submitButton.click' frontend/e2e/`) and update them in the same story. This would prevent downstream E2E failures from being discovered during QA of a subsequent story.

### Naive UI prop vs option-level rendering reference in DEVELOPMENT_PRACTICES.md
* status: needs_approval
* priority: low
* source: developer
Add a note to DEVELOPMENT_PRACTICES.md clarifying that Naive UI NSelect uses component-level props (`render-label`, `render-option`, `render-tag`) rather than per-option render functions, to prevent similar misapplications in the future. B-098 wasted a review cycle because the initial implementation placed `renderLabel` on option objects (a no-op).

### Pre-existing E2E failure tracking
* status: superseded
* priority: medium
* source: developer
Superseded by W-025: the workflow now enforces zero tolerance for pre-existing failures. QA must file B-tickets and fix all failures — no concept of "known failures" list.

### Pre-sweep stability threshold for QA agent
* status: needs_approval
* priority: low
* source: developer
Before filing E2E failure bugs from a sweep, the QA agent should verify the failure is reproducible with a second targeted run (`make test-e2e SPEC=<file>`). A single-occurrence failure in a high-contention shard environment should not trigger a bug ticket without confirmation.

### Ralph multi-worker parallelism (cross-repo)
* status: needs_approval
* priority: high
* source: orchestrator

Ralph integration for concurrent story processing. Requires cross-repo coordination
between claude-sandbox (worker management) and checkpoint-sampler (agent workflow).

**Requirements:**
- Ralph spawns N concurrent workers, each in its own git worktree (via .claude-sandbox/scripts/worktree/worktree.py)
- Each worker runs a single orchestrator cycle (one story) independently
- Workers claim stories via backlog.py next-work --claim <worker-id> to prevent double-pickup
- Worker lifecycle: spawn → claim story → create worktree → run orchestrator → merge → cleanup worktree → exit
- Graceful shutdown: when quota exhausted or .ralph/stop touched, workers finish current subagent step then exit
- Quota distribution: Ralph tracks cumulative cost across workers, stops spawning when approaching threshold
- Log aggregation: each worker writes to .ralph/runlogs/rawlog_<timestamp>_worker<N>_iter<M>; runlog.json gains workerId field
- Lock contention: N workers competing for agent/backlog.lock — ensure timeouts and retry logic prevent deadlocks
- Stop-file semantics: .ralph/stop halts new worker spawns; existing workers drain gracefully
- Worker crash recovery: Ralph detects dead workers (PID gone, worktree orphaned), restarts or marks for recovery via worktree.py detect-stale
- Configuration: ralph.toml gains max_workers (default 1), quota_reserve_usd (budget headroom), worker_timeout (max wall-time per worker)

**Cross-repo scope:**
- claude-sandbox: Worker process spawning, PID tracking, quota monitoring, crash detection, ralph.toml schema update, log file routing
- checkpoint-sampler: Agent workflow docs (AGENT_FLOW.md, PROMPT.md), stop-file multi-worker semantics, runlog.json schema update

**Prerequisites:** W-023 (worktree lifecycle + backlog locking), W-024 (Docker isolation + merge handling)

**Edge cases:**
- All N workers pick stories that touch the same files — merge conflicts cascade
- Quota exhausted mid-subagent — worker must not leave worktree in corrupt state
- Ralph killed (SIGKILL) — orphaned workers continue running; next Ralph start must detect and manage them
- Network partition during git push from worktree — retry with backoff, don't re-merge
- Worker finishes but can't acquire backlog lock (another worker holds it for extended write) — timeout and retry

**Testing considerations:**
- Integration test: 2 workers claim different stories, run to completion, merge without conflict
- Integration test: 2 workers produce merge conflict, one resolves trivially, other goes back to developer
- Unit test: Ralph quota tracking stops spawning at threshold
- Unit test: crash recovery detects orphaned worktree and reports it
- Manual testing required for cross-repo coordination (user-driven)

### Parallel agent orchestrator integration
* status: needs_approval
* priority: medium
* source: developer
The worktree + locking infrastructure (W-023) is now in place, but the orchestrator (PROMPT.md) still assumes single-agent sequential operation. A follow-up story should update the orchestrator to use `--claim` and worktrees when multiple agents are active, including the cycle-start stale detection and recovery flow.

### Orchestrator merge integration test
* status: needs_approval
* priority: medium
* source: developer
Create an integration test that runs the full orchestrator merge flow (create two branches, merge one, create conflict, verify merge helper resolves it) to validate the end-to-end workflow documented in AGENT_FLOW.md 4.1.3.

### Backlog deduplication check before story assignment
* status: needs_approval
* priority: medium
* source: developer
R-010 was filed to address the same root cause as B-115 but was not closed when B-115 shipped. The orchestrator should check if a story's acceptance criteria are already satisfied before dispatching work, or flag stories whose notes reference a root cause addressed by a recently completed story.

### Complete testing→blocked transition documentation
* status: needs_approval
* priority: low
* source: qa
Add the `testing → blocked` row to the status transitions table in AGENT_FLOW.md section 1.1, add the corresponding Discord notification template in section 9.2, and update section 4.4.2 step 5 to mention BLOCKED alongside approved/rejected. Minor polish gaps from W-025.

### Clarify QA cycle-count signal
* status: needs_approval
* priority: low
* source: qa
The `review_feedback` field is shared between code reviewer and QA feedback, making QA cycle counting ambiguous. Consider adding a dedicated `qa_cycle_count` field or separate `qa_feedback` field so QA agents can reliably count prior QA cycles without conflating code reviewer feedback.

### Auto-verify ACs before dispatching developer
* status: needs_approval
* priority: low
* source: developer
The orchestrator could run a quick verification (e.g., `make test-e2e` for E2E-focused stories) before dispatching to a developer agent, avoiding wasted cycles on stories where the issue is already resolved by prior commits.

### Docs-drift CI check for api.md
* status: needs_approval
* priority: low
* source: developer
A lightweight script that enumerates `Service(...)`/`Method(...)` from `backend/internal/api/design/*.go` and asserts each appears in `docs/api.md` would catch service/endpoint documentation drift automatically at PR time, rather than relying on periodic manual refresh stories (e.g. M-001, M-002). Could live as a `make docs-check` target.

### Clarify `make test-e2e SPEC=` semantics
* status: needs_approval
* priority: low
* source: developer
`make test-e2e SPEC=<file>` still runs the full sharded suite rather than the single spec; only `make test-e2e-serial SPEC=` honors the filter. Developer guidance ("run targeted specs with `make test-e2e SPEC=`") should point at `test-e2e-serial`, or `test-e2e` should respect `SPEC`.

### Contract-drift lint check for Goa Enum vs frontend TS union
* status: needs_approval
* priority: low
* source: developer
Add a periodic automated check (small script) comparing Goa design `Enum(...)` values against corresponding frontend TS union literals to catch design/implementation contract drift before code review. This class of drift recurred in B-171 across two independent locations.

### Bulk string-refactor tooling for agents
* status: needs_approval
* priority: low
* source: developer
Wide mechanical renames (e.g. S-171's ~90 near-identical `/api/` → `/api/v1/` edits) require a Read+Edit round-trip per file due to the "must Read before Edit" guard and the no-`sed` policy. A sanctioned, auditable bulk find/replace helper (with an exclusion pattern, e.g. preserve `/api/test/`) would make wide mechanical renames far cheaper and less error-prone.

### Sandbox cannot reach host-published Docker ports for host-browser verification
* status: needs_approval
* priority: low
* source: developer
Agents dispatched inside the claude-sandbox cannot `curl`/fetch a `docker compose`-published host port to confirm host-browser reachability (connection refused despite `docker port` confirming the correct binding), because the sandbox container's network namespace doesn't route loopback back to the host Docker daemon's published ports. This is fine for `make test-e2e` (container-to-container), but any story asking to "verify from the host browser" cannot be closed out by the agent alone. Suggest AGENT_FLOW.md / story-writing guidance phrase such acceptance criteria as "verify via `docker port` + internal container logs" or flag them as human UAT steps rather than implying a literal host browser round-trip.

### Triage pass for low-confidence "noise" bug reports before full dispatch
* status: needs_approval
* priority: low
* source: developer
When QA files a bug it already suspects is environmental noise (as with B-173, where the ticket notes themselves said "may well close as no-change"), the ticket still consumes a full todo → in_progress → review cycle. A lightweight convention — e.g. a `suspected_noise: true` field, or a `triage` status — would let the orchestrator run a single cheap confirmation pass instead of a full developer + reviewer dispatch on a ticket that is likely to close with no code change.

### Verify each reported path/symptom individually when closing an investigation ticket
* status: needs_approval
* priority: low
* source: reviewer
B-173 listed four 404 paths; three matched pre-S-171 routes exactly, but the fourth (`/api/settings`) never existed anywhere in repo history — it was a paraphrase in the sweep report, not a captured path. The developer's writeup treated all four as a block and didn't reconcile the outlier. Guidance for investigation tickets should require each cited symptom be checked individually against history, with any that don't map called out explicitly — a symptom that doesn't match anything is exactly the one most likely to indicate a second, unrelated cause.
