# Dev Ops

Build pipeline, CI, Docker, linting, and infrastructure improvements. Only items requiring user approval belong here — routine improvements should be implemented directly by agents.

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

### Generate TypeScript API types from Goa design for E2E tests
* status: needs_approval
* priority: low
* source: developer
E2E tests manually type API payload field names (e.g., `workflow_filename` vs `workflow_name`), which can silently diverge from the Goa API design. Generate a lightweight TypeScript types file from the Goa design so E2E tests can import typed payloads rather than guessing field names by hand.

### Validate mock server PNG checksum in CI
* status: needs_approval
* priority: low
* source: developer
Add a startup validation step to the ComfyUI mock that verifies its PNG data passes Go's CRC check before tests run, preventing silent thumbnail failures if the PNG is ever modified again.

### Fix playwright-report and test-results root ownership
* status: needs_approval
* priority: low
* source: developer
The `playwright` service in `docker-compose.test.yml` writes root-owned `frontend/playwright-report/` and `frontend/test-results/` to the host-mounted directory. These could be isolated to named volumes or the playwright service could use a `user:` directive to avoid the same class of root-ownership problem fixed by B-087.

### Accessibility audit as a separate CI step
* status: needs_approval
* priority: low
* source: developer
The axe E2E tests currently run as part of the full E2E suite. A dedicated accessibility audit step that runs accessibility.spec.ts before other E2E tests could catch regressions earlier in CI.

### Add lint-disallowed-chars to CI pipeline
* status: needs_approval
* priority: low
* source: developer
Once the disallowed character set is stable, add `make lint-disallowed-chars` as a pre-merge CI check so it runs automatically when `disallowedNameChars` is modified, rather than relying on developers to run it manually.

### E2E parallel shard DNS stability
* status: needs_approval
* priority: medium
* source: qa
The parallel E2E runner occasionally fails all shards due to Docker DNS not resolving the `frontend` hostname during simultaneous shard startup. Investigate adding a DNS readiness check or startup delay/retry in the shard orchestration before running tests.

### StudyHasSamples path alignment
* status: needs_approval
* priority: medium
* source: qa
The `StudyAvailabilityService.StudyHasSamples` method checks `{sampleDir}/{studyName}/` but samples are stored at `{sampleDir}/{runName}/{studyName}/`. This means the immutability dialog in StudyEditor is effectively unreachable through normal usage. Should align the path or document the intended behavior clearly.

### E2E log directory creation reliability in make test-e2e
* status: needs_approval
* priority: low
* source: qa
The `mkdir -p .ralph/temp/e2e-logs` step in the Makefile test-e2e recipe may execute after teardown or fail silently. Verify the log capture step runs before `docker compose down -v` so logs are always available for the runtime error sweep.

### Automatic E2E baseline tracking per-story
* status: needs_approval
* priority: low
* source: developer
When the orchestrator commits a story, automatically record the passing E2E count in the commit message in a structured format. This would allow automated detection of stories that introduced new failures vs. pre-existing ones, reducing false-positive bug reports like B-117.

### Backlog and worktree test runner Makefile targets
* status: needs_approval
* priority: low
* source: developer
There is no `make test-backlog` or `make test-worktree` target — Python script tests must be run manually via `python3 -m unittest`. Adding Makefile targets would improve discoverability and consistency with `make test-backend` / `make test-frontend`.

### Serialize /api/test/reset endpoint for parallel E2E safety
* status: needs_approval
* priority: medium
* source: qa
The DB reset endpoint races under 12-shard parallel load, causing UNIQUE constraint failures on schema_migrations. Adding a mutex or SQLite-level serialization would eliminate the most common source of E2E flakiness. Related: B-122.

### E2E shard DNS failure resilience
* status: needs_approval
* priority: low
* source: qa
Shard-3 suffered a complete DNS resolution failure (`ENOTFOUND frontend`) affecting all tests in that shard. Consider adding a startup health check that retries DNS resolution before the Playwright process starts, to surface infrastructure failures more clearly and potentially retry the shard.

### Reduce default E2E shard count or add per-host override
* status: needs_approval
* priority: medium
* source: qa
The Makefile hardcodes 12 shards, which can exhaust host resources (12 shards × ~6 containers = ~72 containers). Under load, CPU starvation causes Naive UI popup race conditions and timeout failures. A lower default (4-6 shards) or a `SHARDS_HOST` env var read from a local `.env` file would prevent recurrence.
