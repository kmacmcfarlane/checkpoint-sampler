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

### Metadata-bearing fresh LoRA E2E fixture
* status: needs_approval
* priority: medium
* source: developer
Add a fresh (no-samples) LoRA training-run fixture whose checkpoint safetensors carries real `ss_sd_model_name`/`ss_base_model_version` metadata, plus a matching `base_model_dir` entry, so S-179's positive base-model pre-selection path can be covered by a real Playwright E2E. Requires backend fixture-seeder changes.

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

### Audit other specs for closeDrawer-before-settings-button pattern
* status: needs_approval
* priority: low
* source: developer
`settings-appearance.spec.ts` and `demo-settings.spec.ts` also click the settings button after drawer interactions. They may have the same latent timing issue under parallel shard contention and could benefit from adding `dismissOverlays` calls.

### Document NModal data-testid behavior in TEST_PRACTICES.md
* status: needs_approval
* priority: low
* source: developer
The `data-testid` set internally on an NModal component (inside the component's template) does NOT appear in the DOM due to Teleport mechanics, but `data-testid` set from outside on a component that has NModal as its root DOES appear (via fallthrough attrs). This counterintuitive behavior should be documented in TEST_PRACTICES.md to prevent future confusion and wasted debugging time.

### TypeScript template literal scanning in disallowed-chars guard
* status: needs_approval
* priority: low
* source: developer
Extend `check-disallowed-chars.sh` to also scan TypeScript backtick template literals for disallowed chars in name-like contexts. Currently only double-quoted strings are scanned, so a regression using a template literal like `` `My Study ${copyNum} (revised)` `` would not be caught.

### Apply waitForResponse pattern to study-delete.spec.ts AC3
* status: needs_approval
* priority: low
* source: developer
The study-delete.spec.ts "confirm, no data" test has the identical race condition pattern (dialog close → immediate GET) as the one fixed in B-116 for job-delete.spec.ts. Proactively applying the same `page.waitForResponse` + `Promise.all` fix would prevent future flakiness reports.

### Lint for duplicated E2E helper code across spec files
* status: needs_approval
* priority: low
* source: developer
Add a lint rule or periodic audit that detects function duplication between E2E spec files and `frontend/e2e/helpers.ts`. The `selectNaiveOptionInContainer` function was duplicated in 9+ spec files, which meant a fix in helpers.ts wouldn't propagate. A deduplication check would catch this pattern earlier.

### E2E coverage for cloneStudy shift MRU path
* status: needs_approval
* priority: low
* source: qa
The `cloneStudy` function was updated to persist shift alongside `performSave`, but neither the existing MRU E2E spec nor `study-mru-autofill.spec.ts` covers the clone workflow path. A targeted test case would close this gap.

### E2E sweep script should filter info-level HTTP request logs
* status: needs_approval
* priority: low
* source: qa
The e2e_sweep script matched HTTP info-level request/response log lines as "findings". Restricting sweep matching to `level=error` or `level=warn` lines would eliminate false positives and make the sweep output actionable.

### Add LoRA metadata resolution error to QA_ALLOWED_ERRORS.md
* status: needs_approval
* priority: low
* source: qa
Until B-139 (LoRA checkpoint metadata resolution only searches checkpoint_dirs) is fixed, the error log line for failed LoRA checkpoint resolution should be added to QA_ALLOWED_ERRORS.md to prevent false positive sweep findings in future QA cycles.

### Extend seed-jobs endpoint to support failed_item_details
* status: needs_approval
* priority: low
* source: qa
Adding an optional `failed_item_details` array to the `SeedJobRequest` payload would enable E2E tests to trigger and verify the checkpoint-level failed badge click in the Generate Samples dialog. Currently this requires real job execution with ComfyUI errors, limiting E2E coverage to the training-run-level bead path only.

### Integration test for graceful shutdown ordering
* status: needs_approval
* priority: low
* source: developer
A make test-backend integration test that spins up a real http.Server with a slow handler and a real (temp-file) DB, sends SIGTERM, and asserts a clean exit with no "database is closed" errors would give stronger confidence than the unit-level fake tests added in B-157. Currently the shutdown ordering is verified only via fake Stoppable/HTTPShutdowner doubles; a real-process test would catch wiring regressions the unit test cannot.

### Audit remaining API error paths for absolute-path leakage
* status: needs_approval
* priority: low
* source: developer
R-015 sanitized the metadata/manifest API boundaries named in its scope. Discovery/scan/validate handlers (`discovery.go`, `thumbnail.go`, `study_availability.go`) still wrap service errors that embed directory paths. A follow-up story could extend the no-absolute-path guarantee project-wide with a systematic test, rather than per-handler.

### Shared typed test-fixture module for frontend domain objects
* status: needs_approval
* priority: low
* source: developer
During R-019, a `makeStudy` test factory compiled under Vitest but failed `vue-tsc --noEmit` (missing required `Study` fields) — runtime-vs-tsc drift. A shared, strictly-typed test-fixtures module for domain objects (`Study`, `TrainingRun`, `SampleJob`) would stop each test file from re-deriving partial factories that pass runtime but fail strict type-check. Out of scope for R-019 since it spans many existing test files.

### Decide whether job-row-missing is an expected E2E reset artifact
* status: needs_approval
* priority: low
* source: qa
If the job_executor `sql: no rows in result set` finding (see B-159) is confirmed as an E2E `/api/test/reset` race artifact, add a scoped pattern to `QA_ALLOWED_ERRORS.md` (job_executor + `no rows in result set`) so future sweeps auto-filter it; otherwise fix the orphan handling. Do not broaden the existing W-006 schema-missing pattern.

### Seed comfyui-mock model lists from test-fixtures instead of compose env vars
* status: needs_approval
* priority: low
* source: qa
B-162 revealed that `comfyui-mock` served no `object_info/LoraLoader`, so no LoRA job could run to completion in E2E — the LoRA path was effectively untested end-to-end. QA fixed it by adding a `LoraLoader` handler seeded from a new `LORA_FILENAMES` env var set in `docker-compose.test.yml`. That leaves the mock's checkpoint/LoRA filename lists hardcoded in compose, free to drift from the actual `test-fixtures/` directory contents. A follow-up could have the mock enumerate `test-fixtures/` at container start so the two cannot diverge.

### Lint gate banning bare `page.waitForTimeout` in E2E specs
* status: needs_approval
* priority: medium
* source: developer
W-031 dropped `frontend/e2e/helpers.ts` to zero `waitForTimeout` calls, but 35 remain across other specs and nothing prevents the count from creeping back. TEST_PRACTICES 6.10 now mandates an inline `TEST_PRACTICES 6.10` comment on every legitimate hold-position exception, which makes the rule mechanically checkable: a `no-restricted-syntax` ESLint rule (or a CI grep gate) could reject any `page.waitForTimeout` lacking that adjacent comment. Depends on the "lint the frontend/e2e/ directory" devops idea — `e2e/` is currently eslint-ignored, so no rule can fire there today. Raised independently by both the developer and the reviewer during W-031.

### Convert the remaining ~34 spec-level fixed waits to deterministic waits
* status: needs_approval
* priority: medium
* source: developer
W-031 scoped its work to `helpers.ts` plus three named specs, leaving 35 `waitForTimeout` sites (34 after excluding the one documented 6.10 hold-position exception in `slider-playback.spec.ts`). The "poll the actual awaited state" pattern proven in W-031 applies mechanically to most of them. They cluster into recognizable categories: ~10 popup/dialog close-animation waits (`sample-generation.spec.ts` ×4, `mru-vae-te.spec.ts` ×3, `study-mru-autofill.spec.ts` ×2), retry backoffs in the `validation-*` specs, and genuine key-hold durations in `slider-keyboard-autorepeat.spec.ts` (several of which may be legitimate 6.10 exceptions). The popup-animation cluster is the best first target — it can reuse the mask/menu-detach assertion pattern directly. Worth a dedicated story rather than expanding W-031's diff. Raised by the developer, reviewer, and QA independently.

### Migrate `seed-partial-samples.spec.ts` to the shared `closeDrawer()` helper
* status: needs_approval
* priority: low
* source: reviewer
`frontend/e2e/seed-partial-samples.spec.ts:195-202` hand-rolls the exact drawer-close pattern that W-031 superseded (click → `not.toBeVisible()` → `waitForTimeout(300)`). It is now the one site that directly contradicts the rewritten TEST_PRACTICES 6.9, which tells contributors to prefer the shared helpers. Small, mechanical fix: replace with `closeDrawer(page)` from `helpers.ts`. Out of W-031's AC scope; flagged by the reviewer and confirmed still present by QA.
