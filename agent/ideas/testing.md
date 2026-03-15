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

### Study-scoped E2E test fixtures
* status: needs_approval
* priority: low
* source: developer
Add study-scoped sample directories to test fixtures so E2E tests can verify study green/yellow beads (availability returning 'complete'/'partial'). Currently only job-status-based beads can be E2E tested.

### Screenshot diffing for thumbnail E2E tests
* status: needs_approval
* priority: very-low
* source: developer
The thumbnail E2E tests verify URLs but not visual correctness. A screenshot comparison tool could verify the grid actually renders thumbnail-sized images vs full-res images, catching cases where the URL is correct but the image fails to load.

### WebSocket event injection test endpoint for E2E bead tests
* status: needs_approval
* priority: low
* source: qa
Adding a `/api/test/set-job-status` endpoint would enable E2E tests to verify real-time bead updates triggered by WebSocket events, covering the UAT scenario (beads updating on job completion) end-to-end. Currently only achievable via unit tests.

### TypeScript template literal scanning in disallowed-chars guard
* status: needs_approval
* priority: low
* source: developer
Extend `check-disallowed-chars.sh` to also scan TypeScript backtick template literals for disallowed chars in name-like contexts. Currently only double-quoted strings are scanned, so a regression using a template literal like `` `My Study ${copyNum} (revised)` `` would not be caught.
