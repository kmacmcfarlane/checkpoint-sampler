# IDEAS

Ideas are organized by category. Agents append here; the user curates and promotes ideas to backlog stories.

## Features

### Preset auto-close on save
When the user saves a preset in the "Manage Presets" sub-modal, it could automatically close the sub-modal and return focus to the job launch dialog, reducing the required clicks to complete the launch flow.

### Preset preview in selector
The job launch dialog's preset dropdown could show a tooltip or inline summary (images per checkpoint, sampler count) when hovering over a preset option, helping users pick the right preset without opening the editor.

### E2E test for dropdown width
A Playwright test that opens the TrainingRunSelector with a 128+ character training run name and asserts the dropdown option is not truncated (i.e., scrollWidth === clientWidth) would give stronger confidence in the dropdown width fix without relying purely on prop assertions.

### E2E test for sample generation batch
Add a Playwright E2E test that exercises the full sample generation flow: select a training run, configure a preset, launch a job, and verify images appear in the grid. This depends on a running ComfyUI instance and will be slow compared to other E2E tests, so it should be behind a separate test tag or only run on demand. Needs design work around how to mock or connect to ComfyUI in CI and how to handle the long execution time.

### Test-E2E isolated target
A `make test-e2e-isolated` target could run `make up-test`, then `make test-e2e`, then `make down-test` as a fully self-contained E2E run. This would be useful for CI pipelines.

### E2E tests against isolated test stack
There is currently no way to run E2E tests against `make up-test` (the isolated volume stack). A second target using a test-specific network would enable CI to run E2E against a fully isolated environment without touching the dev stack.

### Playwright HTML report as secondary reporter
Adding an HTML report alongside the list reporter (e.g., `reporter: [['list'], ['html', { open: 'never' }]]`) would provide richer failure analysis for complex E2E failures without changing pass/fail behavior.

### E2E screenshot on failure
Consider adding `screenshot: 'only-on-failure'` to `playwright.config.ts` to capture screenshots for debugging failed tests. Currently no visual evidence is captured on failure.

### E2E test result parsing in orchestrator
The orchestrator currently has no structured mechanism to accumulate E2E pass/fail trends over time. Adding a simple log of E2E results per story to `.ralph-debug/` could enable spotting regressions before they become endemic.

## Dev Ops

### Playwright test isolation via shared fixture
Each E2E test in the lightbox suite repeats the full `setupGridWithImages` flow (~2.5s per test). A shared test fixture that loads the grid once and then runs each test via Playwright's `test.beforeEach` scoped to a `describe` block could reduce total E2E run time.

### Playwright browser pre-warming
The `npm ci` on every E2E test invocation adds 5-10 seconds. Consider building a custom image `FROM mcr.microsoft.com/playwright:...` with `npm ci` baked in as a project-maintained Docker image to speed up CI.

### Old Docker Compose stack migration helper
When the implicit project name changed from directory-derived `checkpoint-sampler` to explicit `checkpoint-sampler-dev`, existing running stacks are orphaned. A one-time migration note or a `make migrate-dev-stack` helper would prevent confusion.

### Network name constant for E2E compose
The string `checkpoint-sampler-dev_default` appears in both `docker-compose.e2e.yml` and documentation. If the project name ever changes, both must be updated in sync. A single source of truth (e.g., `.env` variable) would reduce drift risk.

### E2E cold-build startup time
The backend uses `Dockerfile.dev` (air with `go generate` + `go build`) which can take 5+ minutes cold. A production-mode E2E image or pre-compiled binary could dramatically speed up CI runs.

### npm audit warnings in playwright run
The `npm ci` in the playwright container produces 5 high severity vulnerability warnings on every run. These are pre-existing but should be addressed to clean up CI output.

### Update .air.toml to use build.entrypoint
The air hot-reload configuration uses the deprecated `build.bin` setting, producing a startup warning on every dev container launch. Migrating to `build.entrypoint` would silence this warning and keep the config current with the air toolchain.

### Suppress Docker Compose orphan container warning in test-e2e
Running `make test-e2e` after `make up-dev` produces a Docker Compose orphan container warning. Adding `--remove-orphans` to the `COMPOSE_E2E` run command, or documenting it as expected behavior in TEST_PRACTICES.md, would remove the noise.

### Playwright E2E smoke tests for QA
Add Playwright for end-to-end testing that verifies the full application stack (frontend rendering, API routing, service wiring) works beyond what unit tests can catch. This would replace the manual `curl`-based smoke tests in the QA phase with proper browser-driven verification.

#### Setup sketch
- Install: `npm install -D @playwright/test` in `/frontend`, then `npx playwright install --with-deps chromium` for headless Chromium
- Config: `playwright.config.ts` with `baseURL: 'http://localhost:3000'`, no `webServer` block (assume `make up-dev` is already running), optional `globalSetup` that polls `/api/health` until ready
- Tests live in `frontend/e2e/` (e.g. `smoke.spec.ts`)
- Makefile target: `make test-e2e` wraps `cd frontend && npx playwright test --reporter=list`

#### Minimal smoke test coverage
- Frontend loads and Vue app hydrates (verify a known element like the app title renders)
- `/api/health` returns 200 through the frontend proxy
- Key API endpoints return valid JSON (training runs, presets, etc.)
- Initial UI state renders correctly (e.g. "Select a training run" prompt visible)

#### Agent/QA workflow integration
The QA subagent would run E2E tests as part of its verification:
1. Orchestrator runs `make up-dev` before dispatching to QA
2. QA runs `npx playwright test --reporter=list` (plain-text output the agent can parse)
3. Orchestrator runs `make down` after QA completes

#### Sandbox considerations
- The claude-sandbox (Debian bookworm-slim + Node.js 22) can run Playwright headless — no display server needed
- `npx playwright install --with-deps chromium` requires root/sudo for apt-get of system libs (libglib, libnss, libatk, etc.) — either pre-bake into the sandbox Dockerfile or use `npx playwright install-deps chromium` separately
- Use `--only-shell` flag for smaller disk footprint (~150MB vs ~400MB for full Chromium)
- Chromium sandboxing may need `chromiumSandbox: false` in config if running as root inside Docker
- Browser version is pinned to the Playwright npm package version — always use the bundled browser, not system Chrome

## Workflow

### Document NDrawer mask click-blocking issue in TEST_PRACTICES.md
The pattern of closing the NDrawer before clicking grid elements in E2E tests is non-obvious and will trip up future E2E test authors. Adding a note to TEST_PRACTICES.md section 6.5 about NDrawer's mask intercepting pointer events would save debugging time.

### Add unit tests for button-triggered zoom actions in ImageLightbox
The new zoom buttons (zoomIn, zoomOut, resetZoom) added to ImageLightbox.vue are covered by E2E tests, but the unit test suite in ImageLightbox.test.ts only tests mouse-wheel zoom. Adding Vitest unit tests for the button click paths would ensure fast, isolated regression coverage without depending on the E2E stack.

### E2E blocking policy escalation
Consider adding a backlog-level flag (e.g., `e2e_story: true`) on stories that touch E2E tests, so the orchestrator can automatically tell the QA agent whether E2E failures are blocking — rather than relying on the QA agent to infer it from the change summary.

### E2E sweep log capture for self-contained stacks
The current runtime error sweep procedure (TEST_PRACTICES.md 5.7.1) assumes the app is still running when the sweep is performed. Since `make test-e2e` tears down the stack automatically, logs cannot be captured post-teardown. Consider augmenting the sweep procedure to optionally pipe E2E compose logs to a temp file during the run, so the sweep can inspect them even after teardown completes.

### QA smoke test consolidation
The qa-expert.md now has three different ways to satisfy the smoke test requirement (make up-dev + curl, make test-e2e for frontend stories, or both). A future refactor could unify them into a single explicit decision tree to reduce confusion.

### AC sandbox interpretation clarity
Story acceptance criteria mentioning "works in the claude-sandbox" should clarify whether they mean "directly in the sandbox process" or "from the sandbox environment via Docker". The Docker approach follows existing project patterns but the distinction matters for implementation.

### SamplePresetEditor event contract documentation
The SamplePresetEditor component's events (preset-saved, preset-deleted) are not documented in the component's JSDoc or in the UI architecture docs. A lightweight contract comment above defineEmits would help future agents integrating this component know what events to listen for.

### Nested modal mount-call ordering in tests
When a child component also calls the same API on mount, the test mock order must account for it. A note in TEST_PRACTICES.md about accounting for child component API calls in integration tests would help avoid this gotcha.

### Vitest prop name casing guidance for Naive UI tests
When testing Naive UI component props, the kebab-case template syntax (e.g. `consistent-menu-width`) becomes camelCase in Vue props (e.g. `consistentMenuWidth`). A short note in TEST_PRACTICES.md about this naming convention would help future contributors write correct test assertions on the first try.

### Sandbox curl workaround for QA smoke tests
The QA agent runs inside a Docker sandbox that cannot directly reach host-mapped ports (localhost:8080). Smoke tests should use `docker compose exec <service> wget` or similar within-network commands. Documenting this pattern in TEST_PRACTICES.md section 5.5 would save future QA agents from debugging the connectivity gap.

### Fixture-aware smoke test
The existing smoke test assumes no specific data. Now that test fixtures always exist in the E2E stack, the smoke test could be enhanced to verify a training run is listed in the API response as a basic sanity check.

### Document /health vs /api/health discrepancy
The smoke test instructions in TEST_PRACTICES.md section 5.5 reference checking a "health or root endpoint" but do not specify the exact path. The actual health endpoint is `/health` (direct backend path), while the frontend Vite proxy exposes it at `/health`. Documenting the canonical health check path would prevent confusion in future QA cycles.

### Drawer auto-collapse on image grid interaction
The NDrawer mask blocks pointer events on grid cells when the drawer is open. Consider auto-collapsing the drawer when the user starts interacting with the grid (e.g., after axis assignment), reducing friction for both real users and tests.

### Lightbox keyboard navigation
The lightbox could support arrow-key navigation between images in the grid, which is a common UX pattern for lightboxes and would be a high-value enhancement.

### Tiered code review model selection
Consider using sonnet for code review on simple, pattern-following changes (small frontend-only diffs, single-component changes) and reserving opus for architectural changes, security-sensitive stories, or cross-stack modifications. This could be driven by a `complexity` field on the story or heuristically derived from the diff size and layers touched. The B-020 review used opus for a 4-file frontend-only change that was straightforward — sonnet would likely have caught the same issues at lower cost and latency.
