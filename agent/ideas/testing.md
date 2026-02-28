# Testing Infrastructure

Major test infrastructure changes requiring design or user buy-in — not routine test additions. Only items requiring user approval belong here — routine improvements should be implemented directly by agents.

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

### Add "queued" status (yellow bead) test case to JobLaunchDialog status bead tests
* status: needs_approval
* priority: low
* source: qa
The `_status`/`_color` metadata test covers empty/complete/running but does not exercise the queued path (pending or paused job). Adding a `pendingJob` fixture for a training run with status `pending` and asserting `_status: 'queued'` and `_color: '#f0a020'` would complete the 4-of-4 coverage for the `beadColor()` function.

### Add Vite ws proxy ECONNREFUSED to QA_ALLOWED_ERRORS.md
* status: needs_approval
* priority: very-low
* source: qa
During startup, the frontend Vite dev server briefly logs `Error: connect ECONNREFUSED` for its WebSocket proxy before the backend is ready. This is a benign startup timing race and could be added to the allowlist to prevent future QA agents from investigating it.

### Automated panic detection in E2E log scan
* status: needs_approval
* priority: medium
* source: developer
The QA agent currently searches E2E backend logs for panics manually. A lightweight shell script or Makefile target that exits non-zero when `panic:` appears in E2E logs would make panic-free criteria machine-verifiable and prevent regressions silently passing review.
