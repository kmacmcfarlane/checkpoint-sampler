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

### E2E tests against isolated test stack
* status: needs_discussion
* priority: medium
* questions: what specifically would need to change in order to isolate more?
* source: unknown

There is currently no way to run E2E tests against `make up-test` (the isolated volume stack). A second target using a test-specific network would enable CI to run E2E against a fully isolated environment without touching the dev stack.

### E2E test data isolation per run
* status: approved
* priority: medium
* source: unknown

While the E2E stack recreates volumes on each run, there is no mechanism to seed the database with a known preset state before tests. Adding a "reset DB" helper endpoint (in test-only mode) or using API calls in beforeEach to set up and tear down test data would make tests more explicit and independent from each other.

### Test-E2E isolated target
* status: needs_approval
* priority: low
* source: unknown

A `make test-e2e-isolated` target could run `make up-test`, then `make test-e2e`, then `make down-test` as a fully self-contained E2E run. This would be useful for CI pipelines.
