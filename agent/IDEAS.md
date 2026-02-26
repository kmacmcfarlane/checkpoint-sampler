# IDEAS

Ideas are organized by category. Agents append here; the user curates and promotes ideas to backlog stories.

## Features

### Preset auto-close on save
When the user saves a preset in the "Manage Presets" sub-modal, it could automatically close the sub-modal and return focus to the job launch dialog, reducing the required clicks to complete the launch flow.

### Preset preview in selector
The job launch dialog's preset dropdown could show a tooltip or inline summary (images per checkpoint, sampler count) when hovering over a preset option, helping users pick the right preset without opening the editor.

### E2E test for dropdown width
A Playwright test that opens the TrainingRunSelector with a 128+ character training run name and asserts the dropdown option is not truncated (i.e., scrollWidth === clientWidth) would give stronger confidence in the dropdown width fix without relying purely on prop assertions.

### Combo filter "Solo" click in E2E tests
The `DimensionFilter` component supports clicking a value text to "solo" it (select only that value). This workflow wasn't covered by E2E tests. A future story could add coverage for the solo interaction as it's a power-user feature.

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

### WebSocket path documentation
The project has no documented contract for which URL paths carry WebSocket traffic. A short note in /docs/api.md listing /api/ws would make it easier to audit nginx configs in the future.

## Dev Ops

### CSS variable linting
A stylelint rule (e.g., a custom plugin or stylelint-no-undefined-variables) that warns when a color property does not use a --text-color or --bg-* variable could prevent low-contrast issues from being introduced in the first place.

### nginx config validation in CI
Adding an `nginx -t` config syntax check step to the build pipeline (e.g., in the frontend Dockerfile build stage or a Makefile target) would catch nginx config errors before they reach a running container.

### Integration smoke test for WebSocket via nginx
A Playwright E2E test that asserts the "Live" status indicator is shown (not "Disconnected") after page load would automate WebSocket connectivity verification and catch any future nginx regressions.

### Automated nginx WebSocket validation
A test or CI step could verify the presence of required WebSocket headers in nginx.conf at build time (e.g., a simple grep/lint step in the Makefile), preventing accidental removal of the headers in future changes.

### E2E log capture before teardown
Consider adding a `make test-e2e-logs` target or `--always-save-logs` option that captures docker compose logs to a file before teardown, enabling the QA runtime error sweep even for self-contained E2E runs.

### Shared E2E test helper module
The helper functions `selectTrainingRun`, `selectNaiveOption`, `closeDrawer`, `expandFiltersSection`, and `expandDimensionFilter` are duplicated across multiple E2E spec files. A shared E2E helper module at `frontend/e2e/helpers.ts` would reduce duplication and make tests easier to maintain.

### Playwright test isolation via shared fixture
Each E2E test in the lightbox suite repeats the full `setupGridWithImages` flow (~2.5s per test). A shared test fixture that loads the grid once and then runs each test via Playwright's `test.beforeEach` scoped to a `describe` block could reduce total E2E run time.

### Playwright browser pre-warming
The `npm ci` on every E2E test invocation adds 5-10 seconds. Consider building a custom image `FROM mcr.microsoft.com/playwright:...` with `npm ci` baked in as a project-maintained Docker image to speed up CI.

### E2E test data isolation per run
While the E2E stack recreates volumes on each run, there is no mechanism to seed the database with a known preset state before tests. Adding a "reset DB" helper endpoint (in test-only mode) or using API calls in beforeEach to set up and tear down test data would make tests more explicit and independent from each other.

### Old Docker Compose stack migration helper
When the implicit project name changed from directory-derived `checkpoint-sampler` to explicit `checkpoint-sampler-dev`, existing running stacks are orphaned. A one-time migration note or a `make migrate-dev-stack` helper would prevent confusion.

### Network name constant for E2E compose
The string `checkpoint-sampler-dev_default` appears in both `docker-compose.e2e.yml` and documentation. If the project name ever changes, both must be updated in sync. A single source of truth (e.g., `.env` variable) would reduce drift risk.

### E2E cold-build startup time
The backend uses `Dockerfile.dev` (air with `go generate` + `go build`) which can take 5+ minutes cold. A production-mode E2E image or pre-compiled binary could dramatically speed up CI runs.

### E2E CSS class stability for Naive UI
Naive UI internal CSS classes (like `.n-dynamic-tags__add`) can change between library versions and break E2E tests silently. Adding `data-testid` attributes to interactive Naive UI sub-elements in the component wrapper would make E2E selectors stable and independent of Naive UI internals.

### npm audit warnings in playwright run
The `npm ci` in the playwright container produces 5 high severity vulnerability warnings on every run. These are pre-existing but should be addressed to clean up CI output.

### Frontend lint step in test-frontend pipeline
Running `npm run lint` before tests would catch TypeScript type errors and ESLint issues before test execution. Adding a lint step to `make test-frontend` or a pre-test hook would surface type errors earlier.

### Update .air.toml to use build.entrypoint
The air hot-reload configuration uses the deprecated `build.bin` setting, producing a startup warning on every dev container launch. Migrating to `build.entrypoint` would silence this warning and keep the config current with the air toolchain.

### make test-backend with run --rm instead of exec
The Makefile's `test-backend` target uses `exec` which requires the dev stack to be running, making it unusable as a one-shot command when the stack is down. Changing it to `run --rm` would align documentation with implementation and make it usable without a running stack.

### OpenFile log level for os.ErrNotExist
The `FileSystem.OpenFile()` method logs at error level for all open failures. For the sidecar-first metadata reading pattern, file-not-found is an expected condition for pre-existing images. Downgrading not-found errors to debug level while keeping error level for unexpected failures would reduce log noise significantly.

### fileformat package linting
The new `internal/fileformat` package has no tests of its own (the type is tested indirectly). Adding a linting rule to enforce all packages in `internal/` have test files would catch this early.

### NSlider type declaration verification in CI
The `keyboard` prop is present in NSlider's JS source but it would be useful to have a lint step that validates all naive-ui props against their TypeScript declarations to catch silent prop mismatches.

### Auto-unmount in all test files
The `enableAutoUnmount(afterEach)` pattern from @vue/test-utils should be added to all test files (or in a shared vitest setup file) by default. Many test files mount components without explicitly calling `wrapper.unmount()`, which can lead to subtle test interference from stale event listeners.

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

### Review feedback DOM structure hints
Review feedback that requests changes to UI interaction patterns should include expected DOM structures or links to Naive UI docs, reducing assumption-making during rework cycles.

### Story notes numeric format spec
Story notes mentioning "add input validation to reject non-numeric characters" should specify how trailing zeros should be handled (e.g., should `7.0` round-trip as `7` or `7.0`). Explicit formatting requirements in acceptance criteria would avoid ambiguity.

## Workflow

### Global localStorage.clear() in Vitest setup
Adding a global `beforeEach` in a Vitest setup file that clears localStorage would prevent cross-test contamination without requiring per-file boilerplate. Currently test isolation depends on individual files adding `localStorage.clear()`.

### Remote LAN testing as explicit UAT step
Acceptance criteria that require physical multi-host network verification (e.g., "WebSocket works from remote LAN host") cannot be automated in the agent pipeline. These should be explicitly flagged as manual UAT steps in the story so reviewers and QA know they are out-of-band checks.

### E2E test timeout in playwright.config.ts
The default Playwright timeout is 30 seconds, matching what the tests use. Consider explicitly setting `timeout: 30000` in `playwright.config.ts` alongside `use:` so it is visible and intentional, reducing ambiguity when diagnosing timeout failures.

### Document NDrawer mask click-blocking issue in TEST_PRACTICES.md
The pattern of closing the NDrawer before clicking grid elements in E2E tests is non-obvious and will trip up future E2E test authors. Adding a note to TEST_PRACTICES.md section 6.5 about NDrawer's mask intercepting pointer events would save debugging time.

### Add unit tests for button-triggered zoom actions in ImageLightbox
The new zoom buttons (zoomIn, zoomOut, resetZoom) added to ImageLightbox.vue are covered by E2E tests, but the unit test suite in ImageLightbox.test.ts only tests mouse-wheel zoom. Adding Vitest unit tests for the button click paths would ensure fast, isolated regression coverage without depending on the E2E stack.

### E2E blocking policy escalation
Consider adding a backlog-level flag (e.g., `e2e_story: true`) on stories that touch E2E tests, so the orchestrator can automatically tell the QA agent whether E2E failures are blocking — rather than relying on the QA agent to infer it from the change summary.

### E2E sweep log capture for self-contained stacks
The current runtime error sweep procedure (TEST_PRACTICES.md 5.7.1) assumes the app is still running when the sweep is performed. Since `make test-e2e` tears down the stack automatically, logs cannot be captured post-teardown. Consider augmenting the sweep procedure to optionally pipe E2E compose logs to a temp file during the run, so the sweep can inspect them even after teardown completes.

### Retain E2E logs before teardown for runtime error sweep
The `make test-e2e` target tears down the compose stack immediately after tests complete, which prevents post-run log capture for the runtime error sweep. Adding a `docker compose logs --tail=200` step before `$(COMPOSE_E2E) down -v` in the Makefile (or a separate `make logs-e2e` target) would allow the QA agent to capture runtime error evidence even after a successful run.

### QA smoke test consolidation
The qa-expert.md now has three different ways to satisfy the smoke test requirement (make up-dev + curl, make test-e2e for frontend stories, or both). A future refactor could unify them into a single explicit decision tree to reduce confusion.

### AC sandbox interpretation clarity
Story acceptance criteria mentioning "works in the claude-sandbox" should clarify whether they mean "directly in the sandbox process" or "from the sandbox environment via Docker". The Docker approach follows existing project patterns but the distinction matters for implementation.

### ImageClickContext export convention
Exporting an interface from a `.vue` file (as done with `ImageClickContext` in XYGrid.vue) is a slightly unusual pattern. A dedicated `types.ts` file in the components directory would be a cleaner convention for shared component types.

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

### Lightbox slider with dimension label
The slider in the lightbox currently shows a generic "Slider" label. It would be more informative to show the actual slider dimension name (e.g., "cfg", "checkpoint") — this would require passing the dimension name through as another prop.

### XYGrid image:click emit test for full context payload
The `image:click` event in `XYGrid.vue` now emits a full `ImageClickContext` (cellKey, sliderValues, currentSliderValue, imagesBySliderValue), but XYGrid.test.ts has no test asserting the shape of this payload. Adding one test for `image:click` emit context would catch regressions if the payload structure changes.

### E2E fixture with multiple slider values for lightbox slider testing
The test-fixtures data currently has only one `cfg` value, so E2E tests cannot exercise the lightbox slider. Adding a second cfg value to the fixture images would allow an E2E test verifying the lightbox slider appears and changes the displayed image.

### Preset state persistence after dialog close
Currently, when the Manage Presets modal is closed, JobLaunchDialog re-fetches presets and auto-selects the last saved preset. A user flow improvement would be to also show the preset that was last edited/deleted as the currently selected option in the job dialog, rather than always auto-selecting saved presets.

### Slider dimension with more than 2 values in test fixtures
The test fixture only supports 2 slider values (landscape/portrait). Adding a third value like `seed=42,seed=99` would enable richer slider tests (e.g., advance past index 1, non-looping stop at end).

### Acceptance criteria map in E2E test docblocks
Consider requiring that each acceptance criterion be explicitly referenced in the test or docblock (e.g., `// AC: Test drags or steps master slider and verifies all image cells update`). This would make QA traceability verification faster for the QA agent.

### AC-to-test annotation in unit tests
The acceptance criterion about not interfering with page scrolling (AC5) is verified indirectly (no global keydown listener, preventDefault scoped to focused cells). Adding inline comments linking specific tests to acceptance criteria would make traceability explicit for future maintainers and QA.

### Acceptance criteria gap for SliderBar wrap-around
The S-038 story specifies wrap-around for ImageCell and MasterSlider but does not mention SliderBar. A note clarifying SliderBar's intended boundary behavior would prevent ambiguity for future implementors.

### Playback test timeout budgeting documentation
The playback advancement tests use `{ timeout: 5000 }` with a 0.25s playback speed, giving a 20x safety margin. Document this as the recommended approach for timing-sensitive E2E assertions in TEST_PRACTICES.md section 6.5 ("set speed to minimum, use generous timeouts, avoid waitForTimeout except for hold-position verification").

### SliderBar wrap-around consistency
SliderBar could optionally support wrap-around behavior (configurable via a prop) so keyboard navigation on the SliderBar is consistent with the ImageCell. Currently they differ at boundaries.

### Multiple MasterSlider keyboard conflict guard
If multiple MasterSlider components are ever mounted simultaneously, their document-level keydown listeners would conflict (both would handle the same arrow key). A future improvement would be to use a global singleton or priority system for which slider captures keyboard input.

### Capture-phase handler ordering documentation
The pattern in ImageLightbox.vue where capture-phase listeners with stopImmediatePropagation are used to prevent MasterSlider's bubble-phase handler from double-firing is well-commented but could be documented in a project-wide keyboard event handling guide to help future developers understand the intentional ordering.

### XYGrid keyboard integration test
Add a test to XYGrid.test.ts that triggers a keydown on an ImageCell component within XYGrid and asserts that update:sliderValue is emitted with the correct cell key and new value. This would make the event-wiring path explicitly tested.

### Log-level tuning for other "expected miss" paths
The `ListPNGFiles` and `ListSafetensorsFiles` functions also log at error unconditionally on directory-not-found. Those paths may have similar "expected miss" scenarios (e.g., a checkpoint directory configured but not yet mounted). A follow-up could apply the same debug-level pattern there.

### Sidecar reader for metadata display
The current `parseSidecarJSON` returns all values as strings, which means numeric fields like `seed` come back as JSON numbers serialized to strings. A dedicated API response type could differentiate string vs numeric fields for richer frontend display.

### Sidecar migration tool
For existing images generated before S-039, there's no way to generate sidecars retroactively. A background migration endpoint or CLI tool that generates sidecars for existing PNG images using their embedded tEXt metadata would improve backward compatibility.

### NegativePrompt model field sequencing
The `NegativePrompt` field on `SampleJobItem` required a DB migration as part of S-039. Stories touching sidecar formats should include schema prerequisites in their AC list to minimize migration churn.

### AC completeness check for cross-cutting concerns
Acceptance criteria mentioning sidecar fields should explicitly call out any missing model fields or DB columns as prerequisites, so implementers don't discover them mid-story.

### Bug reports should include call site context
Bug descriptions should include the call chain (e.g., "called from `image_metadata.go` sidecar lookup") so the developer immediately understands the scope of the issue, not just the symptom.

### Tiered code review model selection
Consider using sonnet for code review on simple, pattern-following changes (small frontend-only diffs, single-component changes) and reserving opus for architectural changes, security-sensitive stories, or cross-stack modifications. This could be driven by a `complexity` field on the story or heuristically derived from the diff size and layers touched. The B-020 review used opus for a 4-file frontend-only change that was straightforward — sonnet would likely have caught the same issues at lower cost and latency.

### Root cause documentation in story notes
Story notes should include richer root cause analysis (e.g., "NSlider's handleStepValue uses activeIndex === -1 guard") to help the developer focus immediately on the correct fix rather than investigating alternative approaches.

### Review feedback should specify capture-phase requirements
When review feedback involves event handler conflicts, include a note about listener registration order and whether capture phase is needed. The B-027 review suggested stopImmediatePropagation alone, but the actual fix also required capture: true to work regardless of mount order.

### E2E slider keyboard test coverage
The existing slider-playback.spec.ts E2E test exercises keyboard navigation but focuses on playback advancement. A dedicated E2E spec for keyboard-only slider navigation (without mouse focus on the slider) would add an extra safety net for this regression class of bugs.

### Accessibility audit tool
A Lighthouse or axe-core integration in the CI pipeline would catch low-contrast issues like B-023 automatically before they reach UAT, reducing the number of purely visual bug stories entering the backlog.

### Theme-aware variable reference in DEVELOPMENT_PRACTICES.md
Adding a short section documenting the canonical CSS variables (--text-color, --text-secondary, --bg-color, --bg-surface, --accent-color, --border-color) would help future contributors choose the right variable without needing to grep App.vue.

### Persist Has Samples filter preference in localStorage
The `hasSamplesFilter` state in TrainingRunSelector is transient — it resets to the default on every page load. A user who prefers to see all runs (unchecked) will have to uncheck it every session. Consider persisting this preference the same way training run selection is persisted via localStorage.

### Bead count in sidebar
The "Generate Samples" button in the header could show a colored bead indicating whether the current sidebar-selected run has samples/jobs, giving a quick visual hint without opening the dialog.

### Training run list refresh in dialog
When the dialog is already open and a job completes (via WebSocket), the dialog's training run options and beads should refresh automatically. Currently they are fetched once on mount.

### make gen root-level target
There is no root-level `make gen` target — codegen requires either a full `docker compose ... run --rm backend sh -c "cd /build && make gen"` invocation or being inside the backend dev container. A root-level `make gen` target would simplify the codegen step for agents and developers alike.

### Unused import detection in Vue SFCs
The TypeScript compiler doesn't always catch unused imports in `<script setup>` blocks. An ESLint rule for Vue SFCs could catch this automatically during lint.

### Test ID for training run options bead
The status bead rendering inside `NSelect` option slots cannot be easily asserted in unit tests because Naive UI renders the dropdown lazily. A `data-testid` on each run option row in a custom lightweight selector component would make bead color assertions testable.

### Checkpoint filtering as a separate story
The `checkpoint_filenames` and `clear_existing` backend features are fairly complex alongside the UI story. Breaking them into a "backend only" sub-story and a "frontend UI" sub-story would allow smaller, more focused reviews.

### Checkpoint regeneration status bead differentiation
The queued bead color (yellow/amber) covers both `pending` and `paused` job statuses, but these could be visually differentiated (e.g., paused = orange, queued = yellow) for a richer user experience.

### NDynamicTags default value display in E2E
The E2E tests currently rely on NDynamicTags defaults being populated (from resetForm()). A small E2E assertion that the default tags are actually visible before proceeding to save would make the tests more robust against regressions in default values.

### CFG trailing-zero display
When a user enters `7.0` as a CFG value, it displays as `7` after the tag is committed due to `parseFloat` normalization. A custom `formatNumber` function that preserves one decimal place for CFG values would provide a better UX.

### Last training run restore in Generate Samples dialog
The dialog currently restores the last workflow and model-type inputs but not the last selected training run. A future enhancement could remember and restore the last training run selection, providing a more complete "resume where I left off" experience.

### Per-model-type workflow preference
Users who use different workflows for different model types (e.g., qwen-image.json for Qwen models) would benefit from the workflow selection also being scoped per model type rather than global.
