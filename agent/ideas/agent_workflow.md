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
