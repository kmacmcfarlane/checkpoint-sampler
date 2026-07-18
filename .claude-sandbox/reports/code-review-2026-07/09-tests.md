# Aspect 9: Test coverage & quality

- **[high]** [coverage-tooling] `frontend/package.json` — vitest --coverage fails: @vitest/coverage-v8 not installed; no coverage script. No visibility into frontend coverage. Fix: add devDep + test:coverage script.
- **[high]** [coverage-gap] `frontend/src/stores/imageCube.ts` (584 lines) — only Pinia store, no direct unit test; data backbone of XY grid. Fix: dedicated imageCube.test.ts (dimension mapping, filters, empty cube).
- **[medium]** [coverage-gap] `backend/cmd/server` — 6.4% coverage on 416 lines (bootstrap/wiring/shutdown). Fix: extract buildServer(cfg), test composition.
- **[medium]** [coverage-gap] `backend/internal/model` — 57.7%, 194 test lines vs 740 source. Fix: DescribeTable tests for behavior methods.
- **[medium]** [flaky-pattern] `frontend/e2e/lightbox-slider-sync.spec.ts:83-230` (9x waitForTimeout(200)), ~40 total sites incl. shared `e2e/helpers.ts:163,174,193,229,261,580`, `job-delete.spec.ts:116`, `sample-generation.spec.ts:424` (3000ms) — contrary to own TEST_PRACTICES 6.10; helpers.ts multiplies across all 83 specs. Fix: expect.poll/locator auto-wait.
- **[medium]** [determinism] `backend/internal/store/comfyui_client_test.go:399,423` — 30ms time.Sleep for concurrency timing; can flake under CI/-race. Fix: channels.
- **[low]** [slow-suite] backend/internal/store — 21s (real SQLite temp dirs; slowest by 20x). Fix: shared migrated template or in-memory.
- **[low]** [weak-assertion] `backend/internal/service/hub_test.go:146` — asserts nothing ("should not panic").
- **[low]** [coverage-gap] `frontend/src/composables/presetWarnings.ts` — only untested composable.
- **[info]** Only 1 skip (legit root check); no .only/todo; network rule compliance good (httptest, t.TempDir); mocks at boundaries, no test-the-mock.

Coverage: service 88.1%, config 95.9%, fileformat 82.8%, store 72.8%, api 70.4%, cmd/server 6.4%, model 57.7%. 83 E2E specs, comprehensive flows.

**Verdict:** Backend test health strong; E2E comprehensive but waitForTimeout-heavy. Material risks: unmeasurable frontend coverage, untested imageCube store.
