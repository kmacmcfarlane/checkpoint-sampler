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
