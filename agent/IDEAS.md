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

## Dev Ops

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

### SamplePresetEditor event contract documentation
The SamplePresetEditor component's events (preset-saved, preset-deleted) are not documented in the component's JSDoc or in the UI architecture docs. A lightweight contract comment above defineEmits would help future agents integrating this component know what events to listen for.

### Nested modal mount-call ordering in tests
When a child component also calls the same API on mount, the test mock order must account for it. A note in TEST_PRACTICES.md about accounting for child component API calls in integration tests would help avoid this gotcha.

### Vitest prop name casing guidance for Naive UI tests
When testing Naive UI component props, the kebab-case template syntax (e.g. `consistent-menu-width`) becomes camelCase in Vue props (e.g. `consistentMenuWidth`). A short note in TEST_PRACTICES.md about this naming convention would help future contributors write correct test assertions on the first try.

### Sandbox curl workaround for QA smoke tests
The QA agent runs inside a Docker sandbox that cannot directly reach host-mapped ports (localhost:8080). Smoke tests should use `docker compose exec <service> wget` or similar within-network commands. Documenting this pattern in TEST_PRACTICES.md section 5.5 would save future QA agents from debugging the connectivity gap.

### Tiered code review model selection
Consider using sonnet for code review on simple, pattern-following changes (small frontend-only diffs, single-component changes) and reserving opus for architectural changes, security-sensitive stories, or cross-stack modifications. This could be driven by a `complexity` field on the story or heuristically derived from the diff size and layers touched. The B-020 review used opus for a 4-file frontend-only change that was straightforward — sonnet would likely have caught the same issues at lower cost and latency.
