# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### S-056: E2E log capture before teardown
- `Makefile`: Added `E2E_LOG_DIR` variable and log capture to `test-e2e` target — backend and frontend logs saved to `.ralph-temp/e2e-logs/` before teardown while preserving exit status; added new `test-e2e-logs` convenience target for manual log capture from a running stack
- `CLAUDE.md`: Updated section 8 quick commands to document log capture in `make test-e2e` and new `make test-e2e-logs` target
- `agent/TEST_PRACTICES.md`: Updated section 5.7.1 to list auto-captured E2E log files as preferred option for the runtime error sweep
- 26 E2E tests pass

### W-004: QA smoke test standardization — E2E tests as primary verification
- `agent/TEST_PRACTICES.md`: Restructured section 5.5 to "E2E smoke test (PRIMARY — REQUIRED)" making `make test-e2e` the primary acceptance gate; renamed section 5.6 to "Manual HTTP verification (secondary — debugging aid only)" reserving curl for debugging; updated section 5.7.1 with explicit `make down` teardown after log capture; simplified section 5.8 to supporting details referencing 5.5 as authority
- `.claude/agents/qa-expert.md`: Updated steps and checklist to make E2E the primary smoke test; changed E2E test authoring from "ENCOURAGED" to "REQUIRED for uncovered acceptance criteria"; updated application smoke test section to E2E-first with manual curl as fallback/debugging only; updated runtime error sweep with explicit teardown
- 26 E2E tests pass

### W-003: Story notes improvements — root cause documentation and numeric format spec
- `agent/AGENT_FLOW.md`: Added section 4.3.3 "Bug fix story notes — root cause documentation" requiring B-NNN story verdicts to include which function/guard/condition caused the bug, why it triggered, and where the fix is applied; updated sections 4.4.1 and 4.4.2 to cross-reference the root cause format for QA-filed bug tickets
- `.claude/agents/fullstack-developer.md`: Added "Root Cause Analysis (REQUIRED for bug fix stories)" section with structured template for B- story verdicts
- `agent/DEVELOPMENT_PRACTICES.md`: Added section 4.10 "Numeric field format specification" defining CFG as floating point, steps as integer, and seeds as non-negative integer, with a requirement that acceptance criteria explicitly state the expected format

### W-002: E2E test result parsing — QA addresses failures and files bug tickets
- `.claude/agents/qa-expert.md`: Updated E2E test execution from "non-blocking for non-E2E stories" to "active triage required" — QA must now investigate each E2E failure and classify as story-related (blocking) or pre-existing (non-blocking bug ticket)
- Added structured "New E2E bug tickets" section to QA verdict template with fields for failing test, error output, root cause hypothesis, priority, and acceptance criteria
- Story-related failures must be resolved before approval; pre-existing failures are filed as backlog entries by the orchestrator
- `agent/AGENT_FLOW.md`: Added section 4.4.2 "Processing QA E2E failure bug tickets" defining orchestrator procedure for creating backlog entries from QA's E2E bug reports, recording E2E pass/fail counts in commit messages, and sending Discord notifications
- 26 E2E tests pass

### W-001: Update QA agent to write/modify E2E tests and file ideas for unrelated coverage
- `.claude/agents/qa-expert.md`: Added `Write` and `Edit` tools to the agent frontmatter, enabling the QA agent to create and modify Playwright E2E test files during verification cycles
- Changed default model from `sonnet` to `opus` to support complex E2E test authoring
- Added "E2E test authoring (ENCOURAGED — story-scoped)" section with tiered model selection guidance (sonnet for simple additions, opus for complex authoring)
- Added "Coverage gap ideas" section directing the QA agent to file unrelated coverage improvements as ideas rather than acting on them during the current cycle
- Preserved existing autonomous empowerment for E2E helpers, fixtures, and config tweaks
- 26 E2E tests pass

### B-032: Dark mode contrast issues in job cards and sample preset editor
- Removed all hardcoded light-mode color fallbacks (`var(--variable, #hex)` → `var(--variable)`) across 14 component files: `JobProgressPanel.vue`, `SamplePresetEditor.vue`, `JobLaunchDialog.vue`, `ComboFilter.vue`, `DimensionFilter.vue`, `DimensionPanel.vue`, `ZoomControl.vue`, `PresetSelector.vue`, `ImageCell.vue`, `XYGrid.vue`, `MasterSlider.vue`, `SliderBar.vue`, `TrainingRunSelector.vue`, and `App.vue`
- All CSS colors now use theme-aware CSS custom properties defined in `App.vue` for both light and dark modes, eliminating contrast issues in dark mode
- Added 8 new unit tests verifying theme-aware styling (5 in `JobProgressPanel.test.ts`, 3 in `SamplePresetEditor.test.ts`)
- 664 frontend tests pass; 26 E2E tests pass

### B-031: Generate Samples dialog doesn't sync preset selection to manage presets sub-dialog
- `frontend/src/components/JobLaunchDialog.vue`: Added `:initial-preset-id="selectedPreset"` prop binding to pass current preset selection to SamplePresetEditor sub-dialog
- `frontend/src/components/SamplePresetEditor.vue`: Added `initialPresetId` prop with null default, emit contract comments, and auto-selection logic in `onMounted` that pre-selects the matching preset after loading
- `frontend/src/components/__tests__/JobLaunchDialog.test.ts`: Added 4 new tests for preset selection sync between parent and sub-dialog
- `frontend/src/components/__tests__/SamplePresetEditor.test.ts`: Added 5 new tests for initialPresetId prop pre-selection behavior
- 655 frontend tests pass; 26 E2E tests pass

### B-030: Top nav elements unavailable on narrow screens until drawer opens
- `frontend/src/App.vue`: Added `eagerAutoSelect()` function that eagerly loads saved training run from localStorage on mount (independent of drawer state), and added idempotency guard to `onTrainingRunSelect` to prevent redundant scans when the same run is re-selected
- `frontend/src/__tests__/App.test.ts`: Added 8 new tests in "Eager auto-select on narrow screens" describe block covering eager loading, header button visibility, no-data fallback, stale data handling, drawer sync, idempotency, wide screen behavior, and API failure graceful handling
- 646 frontend tests pass; 555 backend tests pass; 26 E2E tests pass

### B-036: Job status does not report failed items — add error reporting, completed_with_errors status, and failed-checkpoint regeneration flow
- `backend/internal/model/sample_job.go`: Added `SampleJobStatusCompletedWithErrors` constant, `ItemStatusCounts` and `FailedItemDetail` types, updated `JobProgress` struct with item counts and failed details
- `backend/internal/model/event.go`: Added `EventJobProgress` constant and `JobProgressEventData` struct for structured WebSocket broadcasting with status, failed_items, pending_items
- `backend/internal/service/sample_job.go`: Added `GetItemCounts` method computing completed/failed/pending counts on-the-fly from items; rewrote `GetProgress` to include item status counts and failed item details grouped by checkpoint
- `backend/internal/service/job_executor.go`: Updated `completeJob` to transition to `completed_with_errors` when any items failed; updated `broadcastJobProgress` to use structured `JobProgressEventData`
- `backend/internal/api/design/sample_jobs.go`: Added `completed_with_errors` to status enum; added `failed_items`, `pending_items`, `failed_item_details` response fields
- `backend/internal/api/design/ws.go`: Added `failed_items`, `pending_items`, `status` fields to WebSocket event response
- `backend/internal/api/sample_jobs.go`: Updated `sampleJobToResponse` to populate item counts and failed details; removed redundant `GetItemCounts` call in `List` (uses `progress.ItemCounts`)
- `backend/internal/api/ws.go`: Updated `writePump` to extract `JobProgressEventData` and populate response fields
- `frontend/src/api/types.ts`: Added `completed_with_errors` to `SampleJobStatus`, added `FailedItemDetail` interface and `failed_items`/`pending_items`/`failed_item_details` to `SampleJob`
- `frontend/src/api/wsClient.ts`: Updated `isValidJobProgressEvent` to validate `failed_items` and `pending_items` as required number fields
- `frontend/src/App.vue`: Updated `handleJobProgress` to propagate `failed_items` and `pending_items` in job updates
- `frontend/src/components/JobProgressPanel.vue`: Added item counts display (completed/failed/pending), `completed_with_errors` warning tag, expandable error section with errors grouped by message and affected checkpoint lists
- `frontend/src/components/JobLaunchDialog.vue`: Added failed checkpoint awareness with red status beads, auto-selection of failed checkpoints, `clear_existing` auto-enable, failed badges with error tooltips, and zero-checkpoint validation
- 555 backend tests pass (126 API + 29 Config + 292 Service + 108 Store); 638 frontend tests pass; 26 E2E tests pass

### B-034: High-severity npm audit vulnerabilities in frontend dependencies (rollup path traversal, minimatch ReDoS)
- `frontend/package.json`: Added `overrides` block pinning `minimatch` to `>=9.0.7` to force patched versions across all transitive dependencies, eliminating 5 ReDoS CVEs (GHSA-3ppc-4f35-3m26, GHSA-7r86-cg39-jmmj, GHSA-23c5-xmqv-rm74)
- `frontend/package-lock.json`: Regenerated by `npm audit fix` upgrading rollup 4.57.1 → 4.59.0 (fixing GHSA-mw96-cpmx-2vgc path traversal) and applying minimatch override
- 622 frontend tests pass; 26 E2E tests pass

### B-035: Job executor never receives ComfyUI completion events — jobs stuck in running (UAT rework)
- `backend/internal/store/comfyui_ws.go`: Added `clientID` field (UUID generated at construction) and appended `?clientId=<uuid>` to WebSocket URL via updated `DeriveWebSocketURL(url, clientID)` signature; added `GetClientID()` method — ComfyUI requires a matching `clientId` in both the WS connection and prompt request to route prompt-specific events (executing, executed, execution_success)
- `backend/internal/service/job_executor.go`: Added `GetClientID() string` to `ComfyUIWS` interface; updated `processItem` to include `ClientID: e.comfyuiWS.GetClientID()` in every `PromptRequest`
- `backend/internal/service/job_executor_test.go`: Updated mock with `clientID` field and `GetClientID()` method; added test verifying WebSocket client_id flows through to prompt submissions
- `backend/internal/store/comfyui_ws_test.go`: Updated `DeriveWebSocketURL` table entries for new `clientID` parameter; added tests for unique client ID generation, non-empty client ID, and `clientId` appearing in derived URL
- 622 frontend tests pass; 536 backend tests pass; 26 E2E tests pass

### B-033: Negative prompt not injected into workflow substitution (UAT rework)
- `backend/internal/service/job_executor.go`: Fixed `CSRoleNegativePrompt` case in `substituteNode()` to inject `item.NegativePrompt` into workflow inputs when non-empty; added `activeJobID` guard in `processNextItem()` to prevent new pending jobs from preempting a running job during the `completeJob` race window
- `backend/internal/service/job_executor_test.go`: Added `DescribeTable` with 3 entries covering negative prompt injection (with text, empty text, no default), standalone test for missing negative_prompt role, and 2 new tests for non-preemption guard (pending stays pending when activeJobID set, auto-starts once cleared)
- 622 frontend tests pass; 521 backend tests pass; 26 E2E tests pass

### B-029: Sample jobs stuck in pending — backend should auto-start and execute jobs (UAT rework)
- `backend/internal/service/job_executor.go`: Added `SetDisconnectHandler` to `ComfyUIWS` interface; added `handleDisconnect` method that sets `connected = false` and clears stale active item/prompt state when the WebSocket connection drops unexpectedly; registered disconnect handler in `Start()`
- `backend/internal/service/job_executor_test.go`: Added `SetDisconnectHandler` and `SimulateDisconnect` to mock; added 6 new tests in "WebSocket disconnect handling" block covering disconnect detection, stale state cleanup, idempotency, and reconnect-resume flows
- `backend/internal/store/comfyui_ws.go`: Added `disconnectHandler` field to `ComfyUIWSClient`; implemented `SetDisconnectHandler` method; updated `readLoop` to track `unexpectedExit` and call disconnect handler when exiting due to a read error
- 622 frontend tests pass; 544 backend tests pass; 26 E2E tests pass

### S-051: Workflows documentation (docs/workflows.md)
- `docs/workflows.md`: New file documenting how to create and annotate ComfyUI workflow templates for use with checkpoint-sampler — covers the `cs_role` annotation system, complete role reference table with field substitutions, step-by-step instructions for adding a new workflow, annotated JSON example based on `qwen-image.json`, validation rules, and troubleshooting
- `README.md`: Added "Workflow templates" section with brief explanation that specially annotated workflows are required and link to docs/workflows.md
- 619 frontend tests pass; 509 backend tests pass; 26 E2E tests pass
- Token usage: 192699 input, 0 output

### S-050: Remember last workflow and model-type-specific inputs in Generate Samples dialog
- `frontend/src/composables/useGenerateInputsPersistence.ts`: New composable providing typed read/write access to `checkpoint-sampler:generate-inputs` localStorage key, storing `lastWorkflowId` (global) and `byModelType` (keyed by `ss_base_model_version`) with full validation/corruption handling
- `frontend/src/components/JobLaunchDialog.vue`: Added persistence integration — restores last workflow on mount, fetches first checkpoint metadata to determine model type, restores model-type-specific VAE/CLIP/shift inputs, persists all selections on change with stale-value fallback
- `frontend/src/composables/__tests__/useGenerateInputsPersistence.test.ts`: 26 tests covering all composable functions and edge cases (corrupt data, missing keys, wrong types)
- `frontend/src/components/__tests__/JobLaunchDialog.test.ts`: 11 new integration tests for localStorage persistence (workflow restore, model input restore, stale fallback, persist on selection)
- 619 frontend tests pass; 26 E2E tests pass
- Token usage: 234348 input, 0 output

### S-048: Sample preset steps/cfg/seeds as multi-value tag inputs with validation
- `frontend/src/components/SamplePresetEditor.vue`: Replaced NInput comma-separated text fields for steps, CFG, and seeds with NDynamicTags multi-value tag inputs; added `numericInputProps` with `allowInput` regex to restrict entry to digits and `.` only; changed default steps from 20 to 30; removed `parseNumberList`/`formatNumberList` helpers
- `frontend/src/components/__tests__/SamplePresetEditor.test.ts`: Updated all tests for NDynamicTags; replaced `steps-input`/`cfgs-input`/`seeds-input` selectors with `steps-tags`/`cfgs-tags`/`seeds-tags`; added tests for input validation, round-tripping, and preset loading
- `frontend/e2e/preset-crud.spec.ts`: Replaced `fillField()` helper with `addTagToNDynamicTags()` for NDynamicTags interaction; updated default step value comments from 20 to 30
- 582 frontend tests pass; 26 E2E tests pass

### S-049: Generate Samples dialog — own training run selector with status beads and regeneration support (UAT rework)
- Renamed job status "paused" to "stopped" across the full stack: backend model constant `SampleJobStatusPaused` → `SampleJobStatusStopped`, Goa DSL enum, service Stop/Resume methods, frontend TypeScript type, Vue components, and all tests
- `frontend/src/components/JobProgressPanel.vue`: Changed stopped status display from yellow (warning) to red (error) NTag for clearer visual signal that the job is not progressing
- 538 backend tests pass; 622 frontend tests pass; 26 E2E tests pass

### B-025: Has Samples filter should default to checked
- `frontend/src/components/TrainingRunSelector.vue`: Changed `hasSamplesFilter` default from `ref(false)` to `ref(true)` so the "Has Samples" checkbox is checked on initial load and the initial API call filters to training runs with samples
- `frontend/src/components/__tests__/TrainingRunSelector.test.ts`: Updated 4 tests in the `has-samples filter` describe block to reflect the new default
- 565 frontend tests pass; 26 E2E tests pass
- Token usage: 100403 input, 0 output

### B-023: Generate Samples dialog summary text unreadable (low contrast)
- `frontend/src/components/JobLaunchDialog.vue`: Added `color: var(--text-color, #333333)` to `.summary p` CSS rule so summary text uses the theme-aware text color variable, ensuring readable contrast against the `--bg-surface` background in both dark and light themes
- 565 frontend tests pass; 26 E2E tests pass
- Token usage: 111788 input, 0 output

### B-027: Slider keyboard navigation only selects first or last value
- `frontend/src/components/MasterSlider.vue`: Added `:keyboard="false"` to NSlider to disable built-in arrow key handling, added `event.stopPropagation()` to custom `onKeydown` handler, added document-level `keydown` listener (`onDocumentKeydown`) with input-element and contentEditable focus guard so arrow keys work without explicit focus on the slider
- `frontend/src/components/SliderBar.vue`: Added `:keyboard="false"` to NSlider and `event.stopPropagation()` to the `onKeydown` handler to prevent double-firing
- `frontend/src/components/ImageLightbox.vue`: Extended document-level `onKeyDown` to handle ArrowLeft/ArrowRight/ArrowUp/ArrowDown for slider navigation; uses capture-phase listener with `e.stopImmediatePropagation()` to prevent MasterSlider's document handler from double-firing when lightbox is open
- `frontend/src/components/__tests__/MasterSlider.test.ts`: Added keyboard=false test, 5 document-level keyboard navigation tests, afterEach cleanup, integration test for MasterSlider + ImageLightbox dual-handler isolation
- `frontend/src/components/__tests__/SliderBar.test.ts`: Added keyboard=false test
- `frontend/src/components/__tests__/ImageLightbox.test.ts`: Added enableAutoUnmount(afterEach), 5 slider navigation tests for document-level arrow key handling
- 565 frontend tests pass; 501 backend tests pass; 26 E2E tests pass
- Token usage: 341164 input, 0 output

### B-026: WebSocket fails on remote LAN hosts (nginx missing upgrade headers) (UAT rework)
- `frontend/nginx.conf`: Changed `server_name localhost` to `server_name _` to accept requests from any hostname; added dedicated `location = /api/ws` block with 1-hour read/send timeouts to keep long-lived WebSocket tunnels alive
- `backend/internal/api/ws.go`: Added immediate `stream.Send()` with `Type: "connected"` to trigger Goa's deferred HTTP 101 WebSocket upgrade right when a client connects, preventing the Go HTTP server's WriteTimeout from closing the connection before any events fire
- `backend/internal/api/ws_test.go`: New test file with 5 tests covering immediate upgrade, error propagation, hub registration/unregistration lifecycle, and event delivery
- 622 frontend tests pass; 526 backend tests pass; 26 E2E tests pass

### B-024: Sample Preset Editor crashes when adding second prompt
- `frontend/src/components/SamplePresetEditor.vue`: Added `createPromptItem()` function returning `{name: '', text: ''}` and wired it as `:on-create` handler on NDynamicInput; added null-guards (`p != null &&`) in `computedTotalImages`, `canSave`, and `savePreset()` to prevent TypeError on null prompt entries
- `frontend/src/components/__tests__/SamplePresetEditor.test.ts`: Added tests for onCreate returning correct shape, adding multiple prompts without console errors, null-safe computedTotalImages counting, and canSave handling empty prompts
- 552 frontend tests pass; 26 E2E tests pass

### B-022: FileSystem.OpenFile logs at error level for expected sidecar miss (file not found)
- `backend/internal/store/filesystem.go`: Changed `OpenFile` error handler to log at `debug` level when `os.IsNotExist(err)` is true, retaining `error` level for all other failures (e.g., permission denied)
- `backend/internal/store/filesystem_test.go`: Added 4 new `OpenFile` tests covering happy-path read, file-not-found error return, file-not-found logs at debug (not error), and permission-denied logs at error level
- 501 backend tests pass (121 API + 29 Config + 247 Service + 104 Store); 26 E2E tests pass

### S-039: JSON sidecar metadata per image
- `backend/internal/fileformat/sidecar.go`: New file — defines `SidecarMetadata` external file format type with JSON tags for sidecar files written alongside generated images
- `backend/internal/model/sample_job.go`: Added `NegativePrompt` field to `SampleJobItem` domain model
- `backend/internal/service/job_executor_fs.go`: Added `RenameFile` method to `FileSystemWriter` interface and `RealFileSystemWriter` implementation for atomic sidecar writes
- `backend/internal/service/job_executor.go`: Added `writeSidecar()` method with atomic temp+rename write pattern, called from `handleItemCompletionAsync` after saving images
- `backend/internal/service/image_metadata.go`: Added `parseSidecarJSON` function; updated `GetMetadata` to read from .json sidecar first, falling back to PNG tEXt chunks
- `backend/internal/service/sample_job.go`: Populated `NegativePrompt` from preset when expanding job items
- `backend/internal/store/migrations.go`: Added migration 7 for `negative_prompt` column on `sample_job_items`
- `backend/internal/store/sample_job.go`: Added `NegativePrompt` to persistence entity, updated SQL queries and mappers
- `backend/internal/store/filesystem_test.go`: New file — unit tests for `ListPNGFiles` ignoring .json files
- 497 backend tests pass (121 API + 29 Config + 247 Service + 100 Store); 26 E2E tests pass

### S-038: Keyboard navigation for sliders
- `frontend/src/components/ImageCell.vue`: Added optional `sliderValues` and `currentSliderValue` props, keyboard event handler (`onKeydown`) with wrap-around left/right/up/down arrow navigation, `slider:change` emit, conditional `tabindex="0"` for focusability, and CSS `:focus` outline for visual focus indicator
- `frontend/src/components/MasterSlider.vue`: Updated `onKeydown` to wrap around at boundaries — ArrowRight at last value emits first value, ArrowLeft at first value emits last value (consistent with playback loop behavior)
- `frontend/src/components/XYGrid.vue`: Updated all four ImageCell usages (X+Y grid, Y-only grid, X-only grid, flat grid) to pass `sliderValues` and `currentSliderValue` props and wire the `@slider:change` event
- `frontend/src/components/__tests__/ImageCell.test.ts`: 12 new tests covering arrow key stepping, wrap-around, non-arrow key passthrough, missing/empty sliderValues, and visual focus indicator
- `frontend/src/components/__tests__/MasterSlider.test.ts`: Updated boundary tests to verify wrap-around behavior instead of no-emit
- 548 frontend tests pass; 26/26 E2E tests pass

### S-046: E2E test: slider and playback controls
- Added `frontend/e2e/slider-playback.spec.ts` with 5 Playwright E2E tests covering the slider and playback workflow: assigning a dimension to the Slider role and verifying the master slider appears, keyboard navigation (ArrowRight/ArrowLeft) stepping through slider values, verifying all image cells update synchronously when the master slider steps, starting playback at 0.25s speed and observing at least 2 automatic advances with loop, and stopping playback and verifying the slider holds its position
- 26 E2E tests pass (5 new slider-playback + 21 existing); 536 frontend unit tests pass; 477 backend specs pass

### S-045: E2E test: sample preset CRUD via job launch dialog
- Added `frontend/e2e/preset-crud.spec.ts` with 5 Playwright E2E tests covering the full sample preset CRUD lifecycle: opening the Generate Samples dialog, opening the Manage Presets editor, creating a new preset with all required fields and verifying it appears in the preset selector dropdown, editing a preset name and saving the update, and deleting a preset with confirmation dialog handling and verifying removal from both the editor and job dialog dropdowns
- `frontend/src/components/SamplePresetEditor.vue`: Added 4 `data-testid` attributes (`preset-editor-select`, `new-preset-button`, `save-preset-button`, `delete-preset-button`) for reliable E2E test targeting
- 21 E2E tests pass (5 new preset-crud + 16 existing); 536 frontend unit tests pass; 477 backend specs pass

### S-037: Slider navigation in image lightbox
- `frontend/src/components/XYGrid.vue`: Added `ImageClickContext` interface export and changed `image:click` emit to carry full cell context (imageUrl, cellKey, sliderValues, currentSliderValue, imagesBySliderValue) so the lightbox receives enough info to render a slider
- `frontend/src/App.vue`: Added `lightboxContext` ref, `onLightboxSliderChange` handler that updates per-cell slider override and lightbox image URL, passed all slider context props to `ImageLightbox`
- `frontend/src/components/ImageLightbox.vue`: Added `SliderBar` import, 4 new props (`cellKey`, `sliderValues`, `currentSliderValue`, `imagesBySliderValue`), `slider-change` emit, `hasSlider` computed, adjacent image preloading via `Image()` constructor, and `.lightbox-slider-panel` CSS
- `frontend/src/components/__tests__/ImageLightbox.test.ts`: 9 new tests in `slider navigation` describe block covering slider rendering, no-slider cases (empty values, null cellKey, single value), prop passing, slider-change emission, zoom/pan coexistence, metadata coexistence, and adjacent image preloading
- 536 frontend tests pass; 16/16 E2E tests pass

### S-044: E2E test: dimension filtering and combo filters
- Added `frontend/e2e/dimension-filtering.spec.ts` with 4 Playwright E2E tests covering the dimension configuration and filtering workflow: opening the dimension panel and changing X/Y axis assignments, verifying the grid updates to reflect new axis dimensions, applying a combo filter (deselecting a value) to reduce grid columns, and clearing the filter to restore the full grid state
- 16 E2E tests pass (4 new dimension-filtering + 12 existing); no application code modified

### S-043: E2E test: image lightbox interaction
- Added `frontend/e2e/lightbox.spec.ts` with 6 Playwright E2E tests covering the image lightbox user journey: clicking an image cell to open the lightbox, verifying the full-size image displays, zoom controls (zoom in, zoom out, reset) visibility and functionality, metadata panel toggle, close button dismissal, and Escape key dismissal
- Updated `frontend/src/components/ImageLightbox.vue`: added explicit zoom in, zoom out, and reset zoom buttons with `aria-label` attributes and corresponding `zoomIn()`, `zoomOut()`, `resetZoom()` functions to enable E2E testing of zoom controls
- 12 E2E tests pass (6 new lightbox + 6 existing); 527 frontend unit tests pass; 477 backend specs pass

### S-047: Integrate Playwright E2E tests into QA subagent workflow
- Updated `.claude/agents/qa-expert.md`: added `make test-e2e` as step 4 in verification steps, added E2E test execution section with blocking/non-blocking rules, updated smoke test section for frontend-only stories, added "E2E Test Results" section to structured verdict format
- Updated `agent/TEST_PRACTICES.md`: added section 5.8 documenting E2E test execution as a QA gate, self-contained execution, blocking vs non-blocking failure rules, and frontend-only story handling
- Updated `agent/AGENT_FLOW.md`: documented that `make test-e2e` is self-contained (no `make up-dev` needed from orchestrator), added E2E test results to parsed verdict sections
- 6 E2E tests pass; workflow-only change (no application code modified)

### S-042: E2E test: training run selection and XY grid display
- Added `frontend/e2e/training-run-grid.spec.ts` with 4 Playwright E2E tests covering the core user journey: selecting a training run, assigning dimension axes, verifying the XY grid renders with dimension labels, and verifying image cells appear
- Redesigned `docker-compose.e2e.yml` to be a fully self-contained E2E stack with backend, frontend, and playwright services using deterministic test fixture data — `make test-e2e` no longer requires `make up-dev` to be running
- Added `test-fixtures/` directory with checkpoint stubs, minimal PNG sample images, and a test config.yaml for reproducible E2E testing
- Updated Makefile `test-e2e` target to start the E2E stack, run Playwright, then tear down automatically; added `down-e2e` target
- Updated CLAUDE.md and TEST_PRACTICES.md to document the new self-contained E2E approach
- 6 E2E tests pass (4 new + 2 existing smoke tests); 527 frontend unit tests pass

### S-041: Playwright E2E test infrastructure setup
- Added `make up-test` / `make down-test` targets with isolated Docker Compose project (`checkpoint-sampler-test`) and separate named volumes, so test environment resets don't affect `make up-dev`
- Added `make test-e2e` target using official Playwright Docker image (`mcr.microsoft.com/playwright:v1.58.2-noble`) that connects to the running dev stack via external Docker network
- Installed `@playwright/test ^1.58.2` as frontend dev dependency with `playwright.config.ts` (headless Chromium, list reporter, `chromiumSandbox: false` for Docker compatibility)
- Created `frontend/e2e/smoke.spec.ts` with 2 smoke tests: app loads with correct title, health endpoint returns 200 through the frontend proxy
- Docker Compose stacks now use explicit project names (`checkpoint-sampler-dev`, `checkpoint-sampler-test`) for full volume isolation
- Vitest config properly extends `configDefaults.exclude` to avoid dropping default exclusions
- CLAUDE.md section 8 and TEST_PRACTICES.md section 6 updated with E2E testing documentation
- 527 frontend tests pass; 477 backend specs pass; 2 E2E smoke tests pass

### B-018: Training run selector dropdown too narrow to read long names
- TrainingRunSelector.vue: Added `filterable` prop to NSelect so users can type to filter training runs; set `consistent-menu-width="false"` and `menu-props` with `min-width: 320px; max-width: min(600px, 100vw)` so the dropdown popover is wide enough for long names without exceeding viewport width on small screens
- TrainingRunSelector.test.ts: 3 new tests covering filterable, consistentMenuWidth, and menuProps style constraints
- 527 frontend tests pass; 477 backend specs pass

### Workflow improvements (2026-02-24)
- S-040: Fullstack developer now produces a structured "Change Summary" in its verdict; orchestrator extracts and passes it to code-reviewer and qa-expert for faster orientation
- All 5 subagent prompts now require a "What I did NOT check (and why)" section for audit transparency
- Orchestrator now records timing data (dispatch/return timestamps, elapsed) per subagent invocation
- Discord notifications made mandatory for all IDEAS.md additions (process improvements, QA sweep ideas)
- 8 new backlog stories: S-040 (change summary), S-041–S-046 (Playwright E2E infrastructure + feature tests), S-047 (QA workflow integration)
- IDEAS.md: added tiered code review model selection, E2E test for sample generation batch

### B-020: Sample preset editor not visible or accessible in the Generate Samples UI
- SamplePresetEditor.vue: Added `preset-saved` and `preset-deleted` events via `defineEmits` so parent components can react to preset CRUD operations
- JobLaunchDialog.vue: Added "Manage Presets" button inline with preset dropdown; opens a nested NModal containing SamplePresetEditor with full create/edit/delete capabilities; auto-refreshes preset list and auto-selects saved presets
- JobLaunchDialog.test.ts: 4 new tests covering Manage Presets button rendering, modal opening, preset save+refresh+auto-select flow, and preset delete+clear-selection flow
- 524 frontend tests pass; 477 backend specs pass across 4 suites with race detection

### B-019: Workflow templates not loading — config nesting error and missing Docker volume mount
- docker-compose.yml: Added `./workflows:/app/workflows:ro` volume mount so the backend container can access workflow template JSON files in production mode
- docker-compose.dev.yml: Added `./workflows:/build/workflows:ro` volume mount so the backend container can access workflow template JSON files in development mode
- config.yaml.example and config.yaml already had workflow_dir correctly nested under comfyui: section (no changes needed — story notes indicated a nesting issue, but it had already been resolved)
- Verified: GET /api/workflows returns the loaded workflow templates (e.g., qwen-image.json) when the directory is correctly mounted
- 477 backend specs pass across 4 suites (121 API + 29 Config + 235 Service + 92 Store) with race detection; 520 frontend tests pass; composite coverage 73.0%

### B-021: ComfyUI config: replace host+port with url field to support HTTPS reverse proxies
- backend/internal/model/config.go: Replaced `Host string` + `Port int` with single `URL string` field in ComfyUIConfig struct; no serialization tags per architecture standards
- backend/internal/config/config.go: Updated `yamlComfyUIConfig` to use `url` YAML field instead of `host` + `port`; `parseComfyUIConfig` applies default `http://localhost:8188`; added `parseAndValidateURL` helper validating URL format (must have scheme http/https, must have host); removed port range validation
- backend/internal/config/config_test.go: Updated ComfyUI config tests — DescribeTable for URL validation covering happy path (http, https, with ports), defaults, and error cases (missing scheme, invalid scheme, missing host)
- backend/internal/store/comfyui_client.go: `NewComfyUIHTTPClient` accepts `baseURL string` directly instead of constructing from host+port
- backend/internal/store/comfyui_client_test.go: Updated to use `httptest.Server.URL` instead of manually extracting host/port
- backend/internal/store/comfyui_ws.go: `NewComfyUIWSClient` accepts HTTP URL and derives WebSocket URL via exported `DeriveWebSocketURL` function; converts http→ws and https→wss scheme, appends `/ws` path
- backend/internal/store/comfyui_ws_test.go: New test file with 4-entry DescribeTable verifying URL derivation (http→ws, https→wss, with various host/port combinations)
- backend/cmd/server/main.go: Updated ComfyUI client initialization to pass `cfg.ComfyUI.URL` instead of separate host and port
- config.yaml.example: Updated to show `url: http://localhost:8188` under `comfyui:` section with documentation about scheme requirement
- 477 backend specs pass across 4 suites (121 API + 29 Config + 235 Service + 92 Store) with race detection; 520 frontend tests pass; composite coverage 73.0%

### B-017: Backend crash-loops when ComfyUI is unreachable, preventing all API requests
- backend/cmd/server/main.go: Changed `jobExecutor.Start()` from fatal error to warning; server continues startup when ComfyUI is unreachable; log message warns that sample jobs may not work until ComfyUI is available
- backend/internal/service/job_executor.go: Made `Start()` resilient to ComfyUI unavailability — attempts initial WebSocket connection but continues on failure; added `tryConnect()` helper with `connected` state tracking under mutex; added background reconnection loop (every 10 seconds) in `run()` goroutine; `processNextItem()` skips processing when not connected; added `IsConnected()` public method; added `started` guard in `Stop()` to prevent panics when `Start()` was never called; `resumeRunningJobs()` logs at Warn level when disconnected; added `isConnectionError()` helper detecting connection-related failures (refused, reset, EOF, broken pipe, timeout); `processItem()` sets `connected=false` on ComfyUI connection errors to trigger reconnect loop
- backend/internal/service/sample_job.go: Added `IsConnected() bool` to `SampleJobExecutor` interface; `Start()` and `Resume()` both check `IsConnected()` before transitioning jobs to running, returning "ComfyUI not connected" error when unavailable
- backend/internal/api/design/sample_jobs.go: Added `service_unavailable` error type with HTTP 503 mapping to `start` and `resume` methods
- backend/internal/api/sample_jobs.go: Added `isServiceUnavailable()` helper; `Start()` and `Resume()` handlers map "ComfyUI not connected" errors to `MakeServiceUnavailable()` (HTTP 503) for clear frontend error handling, distinct from `MakeInvalidState()` (HTTP 400)
- backend/internal/service/job_executor_test.go: 6 resilient startup tests: start with failing WS connection, connected status after success, no item processing when disconnected, graceful Stop without Start, graceful Stop after failed Start, disconnected-to-connected reconnection transition
- backend/internal/service/sample_job_test.go: Added test verifying "ComfyUI not connected" error from Start when executor is disconnected
- 469 backend specs pass across 4 suites (121 API + 26 Config + 235 Service + 87 Store) with race detection; 520 frontend tests pass; composite coverage 72.9%

### R-003: Refactor image serving and metadata endpoints to idiomatic Goa with SkipResponseBodyEncodeDecode
- backend/internal/api/design/images.go: New Goa DSL defining images service with download method (SkipResponseBodyEncodeDecode for streaming) and metadata method (standard JSON encoding); ImageDownloadResult type with Content-Type, Content-Length, Cache-Control response headers; ImageMetadataResponse type with metadata map; not_found and bad_request error responses for both methods
- backend/internal/api/images_service.go: New ImagesService implementing generated interface; Download method opens image file, detects content type via http.DetectContentType, seeks back to start, and returns *os.File as io.ReadCloser for Goa to stream; Cache-Control set to 'max-age=31536000, immutable'; isPathSafe helper rejects '..', '.', absolute paths, and empty paths; secondary resolved-path check validates within sampleDir; Metadata method delegates to ImageMetadataService with error classification
- backend/internal/api/http.go: Added ImagesEndpoints to HTTPHandlerConfig and wired Goa-generated images server; added imageMetadataRewriteMiddleware that transparently rewrites /api/images/{path}/metadata to /api/_images_metadata/{path} to work around chi router wildcard limitation (chi does not support wildcard parameters followed by additional path segments); removed manual mux.Handle for custom image handler; debug middleware and mount logging applied to images server
- backend/internal/api/http_test.go: Updated createAllEndpoints to include ImagesEndpoints; added integration test verifying URL rewrite middleware correctly routes metadata requests through the full middleware stack
- backend/internal/api/images_service_test.go: 13 unit tests covering Download (successful with correct headers, content type detection, not_found for nonexistent files, bad_request for path traversal/absolute/empty/dot paths, directory rejection) and Metadata (successful retrieval with tEXt chunks, empty metadata, not_found, bad_request for traversal/absolute paths)
- backend/cmd/server/main.go: Wired ImagesService with sampleDir, imageMetadataSvc, and logger; created ImagesEndpoints and passed to HTTPHandlerConfig; removed old ImageHandler wiring
- Deleted backend/internal/api/images.go (custom ImageHandler), backend/internal/api/image_metadata.go (custom ImageMetadataHandler), backend/internal/api/image_metadata_test.go (old handler tests)
- Both endpoints appear in generated OpenAPI 3.0 spec and Swagger UI at /docs
- Frontend unchanged — API contract preserved via URL rewrite middleware
- 462 backend specs pass across 4 suites (121 API + 26 Config + 228 Service + 87 Store) with race detection; 520 frontend tests pass; composite coverage 71.6%

### B-016: Frontend swallows API error messages due to field name mismatch and missing Goa Debug middleware
- frontend/src/api/types.ts: Fixed ApiErrorResponse interface to match Goa's actual JSON field names (lowercase `name`, `message`, `id`, `temporary`, `timeout`, `fault` instead of uppercase `Code` and `Message`)
- frontend/src/api/client.ts: Fixed normalizeError() to map Goa's `name` field to ApiError.code and `message` field to ApiError.message; refactored from response.json() to response.text() + JSON.parse() to enable body fallback; unknown errors now include the response body text in the error message for debugging; fixed isApiErrorResponse() type guard to check for lowercase field names
- frontend/src/api/__tests__/client.test.ts: Updated all error test mocks to use Goa's actual error JSON shape ({ name, message, id, temporary, timeout, fault }); added text() to mock fetch responses; verified body inclusion in unknown error messages; removed unused variable
- backend/internal/api/http.go: Added Goa Debug middleware (goahttpmiddleware.Debug) to all 10 HTTP servers when cfg.Debug is true; middleware applied via server.Use() before Mount() calls per Goa pattern; logs full HTTP request/response headers and bodies to stdout for development debugging
- backend/internal/api/http_test.go: Added 2 tests verifying debug middleware wiring — handler works correctly with debug enabled (debug output visible in logs) and disabled (no debug output)
- 460 backend specs pass across 4 suites with race detection; 520 frontend tests pass; composite coverage 71.5%

### B-015: Backend service errors not logged to container stdout
- backend/internal/api/error_logging.go: New ErrorLoggingMiddleware capturing HTTP error responses (4xx/5xx) with structured logrus logging; statusCapturingWriter wraps response writer to intercept status codes and buffer error response bodies; logErrorResponse extracts error messages from JSON response bodies (falls back to truncated raw text for non-JSON); implements http.Hijacker delegation for WebSocket compatibility; logrus warn level for 4xx client errors, error level for 5xx server errors
- backend/internal/api/http.go: Integrated ErrorLoggingMiddleware into HTTP handler chain after RequestID middleware to ensure request IDs are available for correlation
- backend/internal/api/error_logging_test.go: 20 unit tests covering 2xx/3xx no-logging, 4xx warn level, 5xx error level, required log fields (request_id, method, path, status_code, error_message), JSON error message extraction, non-JSON body truncation, empty body handling, missing request ID default, implicit 200 status, DescribeTable for HTTP methods
- backend/internal/api/error_logging_integration_test.go: 6 integration tests validating full middleware stack with RequestID middleware, non-empty request ID assertion, correct log levels, error message extraction in production-like handler chains, multiple HTTP method coverage
- 458 backend specs pass across 4 suites (117 API + 26 Config + 228 Service + 87 Store) with race detection; 520 frontend tests pass; composite coverage 68.7%

### B-014: API returns bare 500 errors without JSON error body
- backend/internal/api/design/presets.go: Added internal_error error type and 500 response mapping to all four methods (list, create, update, delete)
- backend/internal/api/design/sample_presets.go: Added internal_error error type and 500 response mapping to all four methods (list, create, update, delete)
- backend/internal/api/design/sample_jobs.go: Added internal_error error type and 500 response mapping to list, show, and delete methods
- backend/internal/api/design/workflows.go: Added internal_error error type and 500 response mapping to list method
- backend/internal/api/presets.go: Replaced bare fmt.Errorf in List (line 28) and Delete (line 67) with genpresets.MakeInternalError() for proper Goa JSON error responses
- backend/internal/api/sample_presets.go: Replaced bare fmt.Errorf in List and Delete with gensamplepresets.MakeInternalError()
- backend/internal/api/sample_jobs.go: Replaced bare fmt.Errorf in List, Show (2 paths), and Delete with gensamplejobs.MakeInternalError()
- backend/internal/api/workflows.go: Replaced bare err return in List with genworkflows.MakeInternalError()
- backend/internal/api/presets_test.go: Added 3 ErrorName() assertion tests verifying Goa ServiceError structure; extracted shared errorNamer interface at file level
- backend/internal/api/sample_presets_test.go: Added 3 ErrorName() assertion tests (List internal_error, Delete internal_error, Delete not_found)
- backend/internal/api/sample_jobs_test.go: Added 5 ErrorName() assertion tests (List internal_error, Show internal_error, Show not_found, Delete internal_error, Delete not_found)
- backend/internal/api/workflows_test.go: Added 1 ErrorName() assertion test (List internal_error)
- All seven API implementation files audited (training_runs.go, checkpoints.go, comfyui.go already clean); zero bare Go errors escape to transport layer
- 432 backend specs pass across 4 suites (91 API + 26 Config + 228 Service + 87 Store) with race detection; 520 frontend tests pass; composite coverage 68.4%

### B-013: Migration 6 fails with duplicate column 'height' on existing databases
- backend/internal/store/db.go: Modified Migrate() to handle SQLite "duplicate column name" errors gracefully; when an ALTER TABLE ADD COLUMN migration encounters a pre-existing column, the migration is recorded as applied and execution continues; added isDuplicateColumnError() helper for error detection and recordMigrationOutsideTx() for recording migration versions outside a failed transaction (necessary because SQLite auto-commits ALTER TABLE even inside transactions)
- backend/internal/store/db_test.go: Added 2 new tests — generic duplicate column idempotency test (simulates missing migration record with pre-existing column) and specific migrations 5/6 test (creates sample_job_items table, manually adds width/height columns, then runs all migrations successfully); full foreign key chain validated with sample_preset → sample_job → sample_job_item inserts
- 420 backend specs pass across 4 suites (79 API + 26 Config + 228 Service + 87 Store) with race detection; composite coverage 67.5%

### S-035: Sample job launch and progress UI
- frontend/src/components/JobLaunchDialog.vue: Modal dialog for creating sample jobs; workflow template dropdown (filtered to valid only), sample preset dropdown, VAE and CLIP model dropdowns populated from ComfyUI API, conditional shift value input (hidden when workflow has no shift role), confirmation summary showing training run name, checkpoint count, images per checkpoint, and total images; form validation disables submit until all required fields filled; error display on submission failure
- frontend/src/components/JobProgressPanel.vue: Modal panel displaying sample jobs sorted by creation date (newest first); per-job display with training run name, status badge (color-coded: info/warning/success/error/default), workflow name, creation timestamp, progress bar with percentage, completed/total items; checkpoint-level progress details (checkpoints completed/total, current checkpoint name, current checkpoint image progress, estimated completion time); stop button for running jobs, resume button for paused jobs; refresh button, empty state, loading states
- frontend/src/api/types.ts: Added SampleJobStatus, SampleJob, JobProgress, SampleJobDetail, CreateSampleJobPayload, WorkflowSummary, WorkflowDetail, JobProgressMessage types
- frontend/src/api/client.ts: Added listWorkflows, listSampleJobs, getSampleJob, createSampleJob, stopSampleJob, resumeSampleJob, deleteSampleJob API client methods
- frontend/src/api/wsClient.ts: Extended WebSocket client with job progress event support; onJobProgress/offJobProgress listener management; isValidJobProgressEvent validator checking type discriminator, required fields (job_id, status, total_items, completed_items, checkpoints_completed, total_checkpoints); FS and job progress events dispatched to separate listener channels
- frontend/src/App.vue: Added "Generate Samples" button (prominent primary type for training runs without samples); integrated JobLaunchDialog and JobProgressPanel components; WebSocket job progress handler updates job list and checkpoint-level progress in real-time; auto-fetches job list when progress panel opened; stop/resume handlers with console.warn error logging
- 12 JobLaunchDialog tests: modal rendering, data fetching, workflow filtering, shift input visibility, summary calculations, form validation, submit enable/disable, payload construction, shift inclusion, success emission, error display
- 14 JobProgressPanel tests: modal rendering, empty state, job list display and sorting, status badge types, progress percentage, stop/resume button visibility, event emissions, error messages, loading states, metadata display
- 8 wsClient job progress tests: valid message dispatching, event isolation (FS vs job), required field validation (4 fields), optional field handling, listener removal
- 520 frontend tests pass across 27 test files; 418 backend tests pass (no backend changes)

### S-034: Sample job execution engine
- backend/internal/model/comfyui.go: New file defining ComfyUI protocol types in model layer (PromptRequest, PromptResponse, HistoryResponse, HistoryEntry, ComfyUIEvent, ComfyUIEventHandler); no serialization tags per architecture standards
- backend/internal/service/job_executor.go: Background job executor with goroutine loop processing work items sequentially; workflow template cloning and substitution for all 9 cs_role types (unet_loader, clip_loader, vae_loader, sampler, positive_prompt, negative_prompt, shift, latent_image, save_image); ComfyUI prompt submission and WebSocket progress monitoring; output image download and disk persistence with query-encoded filenames; job progress tracking and WebSocket broadcast to frontend clients; stop/resume with ComfyUI prompt cancellation; graceful error handling (mark failed, continue next); startup resume of running jobs; path traversal protection on output paths; proper mutex management releasing lock before all blocking I/O
- backend/internal/service/job_executor_fs.go: FileSystemWriter interface (MkdirAll, WriteFile, Stat) with RealFileSystemWriter production implementation; enables testability without real filesystem I/O
- backend/internal/service/job_executor_test.go: 225+ service specs covering workflow substitution (all cs_roles), output filename generation, output path construction with traversal protection, item completion flow, download error handling, stop/resume logic, ComfyUI error handling, WebSocket event processing (completion and error events)
- backend/internal/service/sample_job.go: Added SampleJobExecutor interface and SetExecutor(); Start() method transitioning pending→running; expandJobItems() populates Width/Height from sample preset
- backend/internal/service/sample_job_test.go: Added Start method tests (happy path, not found, invalid state)
- backend/internal/model/sample_job.go: Added Width and Height int fields to SampleJobItem
- backend/internal/store/migrations.go: Migration v5 (width column) and v6 (height column) on sample_job_items with DEFAULT 512
- backend/internal/store/sample_job.go: Updated queries and entity mappings for width/height columns
- backend/internal/store/sample_job_test.go: Added width/height round-trip persistence tests
- backend/internal/store/comfyui_client.go: Added DownloadImage() with proper URL encoding via net/url.Values; added CancelPrompt() via ComfyUI queue delete API; refactored public methods to accept/return model types with internal entity types for JSON serialization
- backend/internal/store/comfyui_ws.go: Refactored to use model.ComfyUIEvent type with internal entity mapping
- backend/internal/store/db_test.go: Updated migration count expectation to 6
- backend/internal/api/design/sample_jobs.go: Added start endpoint (POST /api/sample-jobs/{id}/start)
- backend/internal/api/sample_jobs.go: Added Start method implementation
- backend/cmd/server/main.go: Wired JobExecutor with RealFileSystemWriter; connected to SampleJobService via SetExecutor; start/stop on server lifecycle
- 418 backend specs pass across 4 suites (79 API + 26 Config + 228 Service + 85 Store) with race detection; 485 frontend tests pass; composite coverage 67.4%

### S-033: Sample job orchestration
- backend/internal/store/migrations.go: Migration v3 creating sample_jobs table (id, training_run_name, sample_preset_id FK to sample_presets, workflow_name, vae, clip, shift, status, total_items, completed_items, error_message, created_at, updated_at); Migration v4 creating sample_job_items table (id, job_id FK with CASCADE DELETE, checkpoint_filename, comfyui_model_path, prompt_name, prompt_text, steps, cfg, sampler_name, scheduler, seed, status, comfyui_prompt_id, output_path, error_message, created_at, updated_at)
- backend/internal/model/sample_job.go: SampleJob domain type with all fields; SampleJobStatus enum (pending, running, paused, completed, failed); SampleJobItem domain type for individual work items; SampleJobItemStatus enum (pending, running, completed, failed, skipped); JobProgress type for progress metrics (CheckpointsCompleted, TotalCheckpoints, CurrentCheckpoint, CurrentCheckpointProgress, CurrentCheckpointTotal, EstimatedCompletionTime); no serialization tags
- backend/internal/store/sample_job.go: SampleJobStore with full CRUD operations for jobs (List, Get, Create, Update, Delete) and items (List, Create, Update); sampleJobEntity and sampleJobItemEntity with nullable field handling (NullString, NullFloat64); entity-to-model conversion; structured logrus logging
- backend/internal/service/sample_job.go: SampleJobService with job creation expanding sample preset parameters × training run checkpoints into individual work items; state machine (Stop: running→paused, Resume: paused→running); progress computation grouping items by checkpoint with deterministic sorted iteration; SampleJobStore and PathMatcher interfaces defined in consumer package
- backend/internal/service/checkpoint_path_matcher.go: CheckpointPathMatcher querying ComfyUI for available UNETs and matching checkpoint filenames by suffix; handles directory-prefixed paths; ComfyUIModelsProvider interface
- backend/internal/api/design/sample_jobs.go: Goa DSL defining sample_jobs service with list (GET /api/sample-jobs), show (GET /api/sample-jobs/{id}), create (POST), stop (POST /api/sample-jobs/{id}/stop), resume (POST /api/sample-jobs/{id}/resume), delete (DELETE /api/sample-jobs/{id}); SampleJobResponse, SampleJobDetailResponse with JobProgressResponse, CreateSampleJobPayload types
- backend/internal/api/sample_jobs.go: SampleJobsService implementation mapping Goa types to domain model; integrates with DiscoveryService for training run checkpoint lookup
- backend/internal/api/http.go: Added SampleJobsEndpoints to HTTPHandlerConfig; wired sample_jobs server into NewHTTPHandler
- backend/cmd/server/main.go: Wired CheckpointPathMatcher, SampleJobService, and SampleJobsService into dependency graph; hoisted modelDiscovery variable to outer scope for cross-block access
- 47 service tests: job creation with item expansion, total items calculation, path matching integration, skipped items for unmatched checkpoints, state transitions (stop/resume valid + invalid), progress computation, CRUD operations (list/get/delete), error handling
- 6 path matcher tests: exact filename match, directory prefix handling, multiple matches, not found error, ComfyUI query failure, empty model list
- 23 store tests: SampleJob CRUD (create all fields, nullable fields, duplicate ID, FK constraint, list empty/ordering, get found/not found, update fields/nullable/not found, delete found/not found/cascade), SampleJobItem CRUD (create all fields/nullable/FK constraint, list empty/ordered/filtered, update fields/nullable/not found)
- 393 backend specs pass across 4 suites (79 API + 26 Config + 207 Service + 81 Store); composite coverage 71.4%

### S-032: Sample setting presets
- backend/internal/model/sample_preset.go: SamplePreset domain type with all fields (ID, Name, Prompts, NegativePrompt, Steps, CFGs, Samplers, Schedulers, Seeds, Width, Height, timestamps); NamedPrompt type for prompt name/text pairs; ImagesPerCheckpoint() computed method calculating total images as len(prompts) × len(steps) × len(cfgs) × len(samplers) × len(schedulers) × len(seeds); no serialization tags
- backend/internal/store/migrations.go: Migration v2 creating sample_presets table (id, name, prompts JSON, negative_prompt, steps JSON, cfgs JSON, samplers JSON, schedulers JSON, seeds JSON, width INTEGER, height INTEGER, created_at, updated_at)
- backend/internal/store/sample_preset.go: SamplePresetStore with full CRUD operations (List, Get, Create, Update, Delete); samplePresetEntity with JSON marshaling/unmarshaling for array fields; entity-to-model conversion; structured logrus logging at trace/debug/info/error levels
- backend/internal/service/sample_preset.go: SamplePresetService with business logic; comprehensive validation (name required, at least one prompt/step/cfg/sampler/scheduler/seed, positive width/height, positive step/cfg values, non-empty sampler/scheduler strings, prompt name/text required); UUID generation; SamplePresetStore interface defined in consumer package
- backend/internal/api/design/sample_presets.go: Goa DSL defining sample_presets service with list (GET /api/sample-presets), create (POST), update (PUT /api/sample-presets/{id}), delete (DELETE /api/sample-presets/{id}); SamplePresetResponse includes computed images_per_checkpoint field; NamedPrompt, CreateSamplePresetPayload, UpdateSamplePresetPayload types; invalid_payload and not_found errors
- backend/internal/api/sample_presets.go: SamplePresetsService implementation mapping Goa types to domain model; reuses existing isNotFound helper
- backend/internal/api/http.go: Added SamplePresetsEndpoints to HTTPHandlerConfig; wired sample_presets server into NewHTTPHandler
- backend/cmd/server/main.go: Wired SamplePresetService and SamplePresetsService into dependency graph
- frontend/src/api/types.ts: Added SamplePreset, NamedPrompt, CreateSamplePresetPayload, UpdateSamplePresetPayload types
- frontend/src/api/client.ts: Added listSamplePresets, createSamplePreset, updateSamplePreset, deleteSamplePreset methods
- frontend/src/components/SamplePresetEditor.vue: Full preset editor with preset selector dropdown, name input, NDynamicInput for prompts (name+text pairs), negative prompt textarea, comma-separated number inputs for steps/CFGs/seeds, multi-select NSelect dropdowns for samplers/schedulers populated from ComfyUI API, NInputNumber for width/height, computed total images per checkpoint displayed prominently, save/load/edit/delete/new operations, form validation, error handling, loading states
- 31 service tests: List (3), Create (5), DescribeTable validation (21 entries covering all rules), Update (3), Delete (2), ImagesPerCheckpoint (1)
- 12 store tests: JSON round-trip marshaling (2), CRUD operations with temp SQLite (Create, List empty/populated, Get/Update/Delete success + not found)
- 20 frontend tests: rendering, preset fetching, ComfyUI model loading, preset selection, computed total calculation, create/update/delete operations, form reset, comma-separated parsing, error handling, loading states, manual sampler/scheduler entry, empty prompt filtering
- 343 backend specs pass across 4 suites; 485 frontend tests pass across 25 test files

### S-031: Workflow template management
- backend/internal/model/workflow.go: WorkflowTemplate domain type with Name, Path, Workflow JSON map, Roles map (role name → node IDs), ValidationState (valid/invalid), Warnings; CSRole enum with all 9 known roles (save_image, unet_loader, clip_loader, vae_loader, sampler, positive_prompt, negative_prompt, shift, latent_image); KnownCSRoles() and IsKnownRole() helpers; no serialization tags
- backend/internal/service/workflow_loader.go: WorkflowLoader service loads and validates ComfyUI workflow JSON files from configured workflow_dir; List() reads all .json files, skips non-JSON and subdirectories; Get() returns single workflow by name with path traversal protection (rejects .., /, \); extractRoles() parses _meta.cs_role tags from workflow nodes; validate() requires save_image role (marks invalid if missing); unknown cs_role values flagged as warnings; EnsureWorkflowDir() creates directory with MkdirAll if it doesn't exist; structured logrus logging throughout
- backend/internal/api/design/workflows.go: Goa DSL defining workflows service with list (GET /api/workflows) and show (GET /api/workflows/{name}) methods; WorkflowSummary type (name, validation_state, roles, warnings); WorkflowDetails type (adds full workflow JSON); not_found error for show
- backend/internal/api/workflows.go: WorkflowService implements generated interface; nil-safe disabled mode when ComfyUI not configured (returns empty list for List, not-found for Show); WorkflowLoader interface defined in consumer package
- backend/internal/api/http.go: Added WorkflowsEndpoints to HTTPHandlerConfig; wired workflows server into NewHTTPHandler
- backend/cmd/server/main.go: Wired WorkflowLoader and WorkflowService when ComfyUI is configured; calls EnsureWorkflowDir() on startup; creates disabled WorkflowService when ComfyUI is absent
- 150 service tests: directory creation/idempotency, workflow loading (valid, invalid JSON, non-JSON files, subdirectories), role extraction (all 9 known roles via DescribeTable, multiple nodes per role, missing _meta, empty cs_role), validation (save_image required, all roles present), Get by name (with/without .json extension), path traversal rejection, missing directory handling
- 11 API tests: disabled service List/Show, enabled List (happy path, empty, error), Show (happy path, not found), model-to-Goa type mapping, service construction
- 298 backend specs pass across 4 suites; 465 frontend tests pass

### B-012: Training run selector dropdown not populating
- frontend/src/components/TrainingRunSelector.vue: Changed default `hasSamplesFilter` from `true` to `false` so all training runs load on page load instead of only those with samples; users can opt-in to filtering by checking the "Has samples" checkbox
- Root cause: The default filter excluded training runs without samples, leaving the dropdown empty when no runs had sample directories yet
- Updated 5 TrainingRunSelector tests to reflect the new default behavior
- 255 backend specs pass; 465 frontend tests pass

### S-036: Structured logging with logrus
- backend/go.mod: Added logrus v1.9.4 dependency
- backend/cmd/server/main.go: LOG_LEVEL env var parsing (default: info) with logrus TextFormatter; replaced stdlib log with structured logrus logger throughout initialization
- docker-compose.yml: Added LOG_LEVEL=info for production mode
- docker-compose.dev.yml: Added LOG_LEVEL=trace for development mode
- backend/internal/service/preset.go: Added logrus logger with trace entry/exit, debug intermediate values, info on data writes, warn on validation failures, error on store failures
- backend/internal/service/discovery.go: Added logrus logger with trace/debug/error logging for training run discovery
- backend/internal/service/scanner.go: Added logrus logger with trace/debug/error logging for filesystem scanning
- backend/internal/service/checkpoint_metadata.go: Added logrus logger with trace/debug/error logging for safetensors metadata parsing
- backend/internal/service/image_metadata.go: Added logrus logger with trace/debug/error logging for PNG metadata extraction
- backend/internal/service/comfyui_models.go: Added logrus logger with trace/debug/error logging for ComfyUI model discovery
- backend/internal/service/hub.go: Added logrus logger with trace/debug/info logging for WebSocket client management
- backend/internal/service/watcher.go: Added logrus logger with trace/debug/info/error logging for filesystem watching
- backend/internal/store/store.go: Updated constructor to accept logrus logger; trace/info logging for migrations
- backend/internal/store/preset.go: Added logrus logger with trace/debug/info/error logging for preset CRUD operations
- backend/internal/store/filesystem.go: Added logrus logger with trace/debug/error logging for filesystem operations
- backend/internal/store/comfyui_client.go: Added logrus logger with trace/debug/info/error logging for ComfyUI HTTP client
- backend/internal/store/comfyui_ws.go: Replaced stdlib log.Logger with logrus logger for WebSocket client
- backend/internal/api/http.go: Updated to use logrus.Logger; logrusAdapter bridges Goa middleware to logrus; "component" field used consistently
- All log messages use WithField()/WithFields() builder pattern with contextual fields (component, preset_id, training_run, checkpoint, etc.)
- 6 new PresetService logging tests using logrus/hooks/test: verify trace entry/exit, info on create, error on store failure, debug for intermediate values, warn for validation, debug for not-found
- agent/DEVELOPMENT_PRACTICES.md: Added section 3.6 "Logging" documenting logrus usage, log level definitions, WithField() pattern, LOG_LEVEL env var, and callee logging rule
- 255 backend specs pass across 4 suites; 465 frontend tests pass across 24 test files

### S-030: ComfyUI configuration, client, and model discovery
- backend/internal/model/config.go: Added ComfyUIConfig domain type (Host, Port, WorkflowDir) without serialization tags
- backend/internal/config/config.go: Added optional comfyui YAML section parsing with defaults (localhost:8188, ./workflows); validation rejects invalid port range (1-65535)
- backend/internal/store/comfyui_client.go: ComfyUI HTTP client with HealthCheck (GET /system_stats), SubmitPrompt (POST /prompt), GetHistory (GET /history), GetQueueStatus (GET /queue), GetObjectInfo (GET /object_info/{node_type}); custom QueueItem UnmarshalJSON for ComfyUI's array-based response format
- backend/internal/store/comfyui_ws.go: ComfyUI WebSocket client for real-time progress and execution events; connect, disconnect, event handler registration, goroutine-based read loop
- backend/internal/service/comfyui_models.go: Model discovery service querying ComfyUI for available VAEs (VAELoader), CLIPs (CLIPLoader), UNETs (UNETLoader), samplers and schedulers (KSampler); depends on ObjectInfoGetter interface for testability
- backend/internal/api/design/comfyui.go: Goa DSL defining comfyui service with status (GET /api/comfyui/status) and models (GET /api/comfyui/models?type=) endpoints
- backend/internal/api/comfyui.go: ComfyUIService implementation using ComfyUIHealthChecker and ComfyUIModelLister interfaces; graceful degradation when ComfyUI is disabled (returns enabled:false or empty models)
- backend/cmd/server/main.go: Wired ComfyUI client, model discovery, and API service; disabled when config section absent
- frontend/src/components/ComfyUIStatus.vue: Connection status indicator using NTag with success/default type; polls /api/comfyui/status every 10 seconds; hidden when ComfyUI is disabled
- frontend/src/api/client.ts: Added getComfyUIStatus() and getComfyUIModels(type) methods
- frontend/src/api/types.ts: Added ComfyUIStatus, ComfyUIModels, and ComfyUIModelType types
- 3 config tests: ComfyUI defaults, optional section, port validation
- 17 store tests: HTTP client methods with httptest.NewServer (health check, submit prompt, history, queue status, object info, QueueItem deserialization)
- 18 service tests: model discovery for all types, input parsing, error handling, node type mapping (DescribeTable)
- 9 API tests: disabled/enabled status, model queries for all types, error handling
- 6 frontend tests: hidden state, online/offline status, periodic polling, error handling, cleanup
- 249 backend specs pass across 4 suites; 465 frontend tests pass across 24 test files

### S-029: Collapse all dimension filters into single expandable 'Filters' section
- frontend/src/App.vue: Added unified 'Filters' section with expand/collapse toggle wrapping all DimensionFilter components; collapsed by default; clickable header with rotating arrow icon; accessible aria-expanded and aria-label attributes; theme-aware styling using CSS custom properties
- 6 new App component tests: filters section header rendering, collapsed by default, expand on click, collapse on second click, accessible aria-label, arrow rotation class
- 459 total frontend tests pass across 23 test files

### S-028: XY grid corner-based cell resizing
- frontend/src/components/XYGrid.vue: Added fixed corner resize handle (bottom-right) that allows dragging to adjust grid cell size; both width and height update simultaneously via single cellSize prop; maintains aspect ratio by default (averages X/Y deltas) with freeform mode available via `maintainAspectRatio` prop; size constrained to 100px–600px; handle hidden in flat mode (no axes assigned); visual feedback with diagonal cursor, hover scale, and dragging state; proper event listener cleanup on mouseup and component unmount
- frontend/src/App.vue: Connected `@update:cell-size` event from XYGrid to existing cellSize reactive state
- 12 new XYGrid tests: resize handle rendering and ARIA attributes, drag emission with delta calculation, dragging CSS class, min/max bounds enforcement, aspect ratio mode, freeform mode, event listener cleanup on mouseup and unmount, zero-delta suppression, uniform cell updates, cursor styling, flat mode exclusion
- 453 total frontend tests pass across 23 test files

### B-011: Auto-load previously used dimension preset from localStorage
- frontend/src/composables/usePresetPersistence.ts: New composable managing persistence of last-used preset and training run in localStorage; saves preset ID and training run ID on preset selection; validates stored data structure and types on restore; clears storage on preset deletion or stale data
- frontend/src/components/PresetSelector.vue: Added `autoLoadPresetId` prop; on mount, auto-loads the matching preset if it exists; emits `delete` event for stale/non-existent presets to trigger cleanup
- frontend/src/components/TrainingRunSelector.vue: Added `autoSelectRunId` prop; on mount, auto-selects the matching training run if it exists in the fetched list
- frontend/src/App.vue: Integrated usePresetPersistence composable; passes saved training run ID and preset ID to selectors; saves selection on preset load/save; clears on preset delete
- 11 usePresetPersistence tests: save/restore, clear, overwrite, invalid JSON, missing fields, wrong types, primitives, null handling
- 5 new TrainingRunSelector tests: auto-select success, stale run, null/undefined props, single execution guarantee
- 4 new PresetSelector tests: auto-load success, stale preset cleanup, null/undefined props, single execution guarantee
- 441 total frontend tests pass across 23 test files

### B-010: WebSocket live updates always displays 'disconnected'
- frontend/vite.config.ts: Added `ws: true` to Vite dev proxy configuration for `/api` routes; enables WebSocket upgrade forwarding so the `/api/ws` endpoint connects correctly during development
- Root cause: Vite's proxy was not configured to handle WebSocket protocol upgrades, causing all WebSocket connections to fail immediately and the status indicator to permanently show "Disconnected"
- 4 new App component tests: status indicator hidden when no training run, initial "Disconnected" state, "Live" when connection opens, "Disconnected" when connection closes
- 1 new useWebSocket composable test: connected state on immediate initialization
- 420 total frontend tests pass across 22 test files

### B-009: XY grid header solo click should hide non-selected values from grid
- frontend/src/components/XYGrid.vue: Changed `xValues` and `yValues` computed properties to filter dimension values based on `comboSelections`; when a header is soloed (single value selected), only that column/row renders in the grid; when all values are selected or selections are empty, all columns/rows render
- 8 new XYGrid tests for header solo filtering: solo X column, solo Y row, solo both, all selected X/Y, empty selections, zero-size Set, reactive prop updates
- 415 total frontend tests pass across 22 test files

### B-008: Checkpoint selector in metadata slideout has unreadable background
- frontend/src/components/CheckpointMetadataPanel.vue: Removed hardcoded CSS fallback values from all `var()` calls in checkpoint selector styling (border, hover, selected, heading, step, resize handle, metadata key, status, error); added explicit `color: var(--text-color)` to `.cp-filename` for proper dark mode text readability
- 5 new CheckpointMetadataPanel tests: checkpoint list items, filenames, step numbers, list border/heading, and selected state all verified to use theme-aware CSS classes without inline color overrides
- 407 total frontend tests pass across 22 test files

### B-007: Checkpoint metadata panel dark mode text unreadable
- frontend/src/components/CheckpointMetadataPanel.vue: Removed hardcoded `#333` color fallback from `.metadata-value` CSS rule; now uses `var(--text-color)` without fallback so dark mode text is readable (light text on dark background)
- 2 new CheckpointMetadataPanel tests: theme-aware styling class verification, inline color override absence check
- 402 total frontend tests pass across 22 test files

### B-006: No zoom/scale control for grid cell size
- frontend/src/components/ZoomControl.vue: New component providing a zoom slider (NSlider) with range 100px–600px in 10px steps; displays current size label; accessible with ARIA labels and role="group"; responsive layout
- frontend/src/components/XYGrid.vue: Replaced drag-divider resizing with `cellSize` prop driving both cellWidth and cellHeight as computed properties; removed divider elements, mousedown/mousemove/mouseup handlers, and divider CSS; grid uses `gap: 4px` for spacing
- frontend/src/App.vue: Integrated ZoomControl in sticky controls area above MasterSlider; cellSize ref (default 200px) passed to XYGrid; renamed `.master-slider-sticky` to `.controls-sticky`
- 19 new ZoomControl tests: rendering, props, events, min/max/step config, data-driven range validation, proportional sizing, accessibility
- 4 new XYGrid tests for cellSize prop controlling column widths, row heights, reactive updates, and gap spacing
- Updated existing XYGrid tests to use cellSize prop and remove divider-related assertions
- 400 total frontend tests pass across 22 test files

### B-005: X/Y grid layout breaks with different configurations
- frontend/src/components/XYGrid.vue: Replaced flexbox grid layout with CSS Grid (`display: grid`) for consistent cell alignment regardless of content or configuration; all items are now direct children of the grid container with explicit `grid-row`/`grid-column` placement
- frontend/src/components/XYGrid.vue: Removed wrapper elements (`.xy-grid__header-row`, `.xy-grid__row`) — flattened template structure eliminates per-row flex containers that caused misalignment
- frontend/src/components/XYGrid.vue: Grid template columns/rows computed dynamically from cell dimensions (cellWidth/cellHeight refs), with 6px divider tracks between data columns/rows and `auto` tracks for headers
- frontend/src/components/XYGrid.vue: Column dividers now span all rows (`grid-row: 1 / -1`) and row dividers span all columns (`grid-column: 1 / -1`) — single divider element per gap instead of per-row duplicates
- frontend/src/components/XYGrid.vue: Empty/placeholder cells maintain consistent sizing since CSS Grid enforces uniform track sizes across all rows and columns
- frontend/src/components/XYGrid.vue: Grid renders correctly with 1x1, 1xN, Nx1, NxM, X-only, and Y-only configurations
- frontend/src/components/XYGrid.vue: Flat mode (no axes) now uses CSS Grid with `repeat(auto-fill, cellWidthpx)` and `grid-auto-rows: cellHeightpx` for consistent cell sizing
- frontend/src/components/XYGrid.vue: Existing divider-based cell resizing continues to work — dragging dividers updates cellWidth/cellHeight refs which feed into `grid-template-columns`/`grid-template-rows`
- 10 new CSS Grid alignment tests: 1x1/1xN/Nx1/NxM grid template verification, empty placeholder cell grid placement, X-only grid without row header column, Y-only grid without column header row, flat mode CSS Grid with consistent sizing, grid container display and template properties
- Updated existing tests for flattened structure: removed `.xy-grid__header-row` references, updated divider count expectations (1 per gap instead of per-row), updated grid template style assertions
- 388 total frontend tests pass across 21 test files

### S-027: Responsive design polish
- frontend/src/components/AppDrawer.vue: Drawer width is now responsive — uses 100% width on mobile screens (<768px) and 360px on wider screens; uses matchMedia listener to detect viewport changes dynamically
- frontend/src/components/MasterSlider.vue: Changed mobile breakpoint from 599px to 767px for consistent mobile stacking; added flex-wrap on loop controls at mobile breakpoint
- frontend/src/components/DimensionFilter.vue: Reduced min-width from 150px to 120px; added max-width: 100% and box-sizing: border-box to prevent overflow
- frontend/src/components/DimensionPanel.vue: Dimension rows now flex-wrap for narrow containers; reduced dimension name min-width from 120px to 80px with text-overflow ellipsis; NSelect elements use CSS classes instead of inline styles for consistent sizing
- frontend/src/components/TrainingRunSelector.vue: Added flex-wrap for wrapping on narrow screens; NSelect uses flex: 1 with min-width: 150px (down from 200px) for responsive fill
- frontend/src/components/PresetSelector.vue: NSelect uses flex: 1 with min-width: 150px (down from 200px) for responsive fill
- frontend/src/components/ImageLightbox.vue: Added mobile media query (<768px) — metadata panel expands to full viewport width; metadata content takes 100vw with no border radius
- frontend/src/components/XYGrid.vue: Reduced grid corner and row header min-width from 100px to 60px; flat grid cells have max-width: 100% to prevent overflow
- frontend/src/App.vue: Added overflow-x: hidden on root .app container to prevent horizontal scrolling; added mobile media query (<768px) for reduced header padding, smaller h1 font size (1.125rem), and reduced main padding
- 4 new AppDrawer responsive width tests: 360px on wide screens, 100% on mobile, media query transitions in both directions
- Updated 6 existing AppDrawer tests to use async mount helper for reliable onMounted execution
- 382 total frontend tests pass across 21 test files

### S-026: Checkpoint metadata panel improvements
- frontend/src/components/CheckpointMetadataPanel.vue: Slideout panel is now resizable by dragging its left edge; a 6px drag handle with col-resize cursor is positioned on the left side of the NDrawer; mousedown/mousemove/mouseup events on document track drag state and update the drawer width reactively
- frontend/src/components/CheckpointMetadataPanel.vue: Width constrained to min 300px and max 80vw during drag resize; values clamped in mousemove handler
- frontend/src/components/CheckpointMetadataPanel.vue: Full viewport width at narrow screens (<768px); uses matchMedia listener to detect breakpoint transitions; resize handle hidden at narrow breakpoint since panel is already full width
- frontend/src/components/CheckpointMetadataPanel.vue: Replaced NDataTable side-by-side table layout with stacked key-value layout using dl/dt/dd elements; each metadata field displays the key as an uppercase header (dt) above the value (dd); keys sorted alphabetically
- frontend/src/components/CheckpointMetadataPanel.vue: Removed NDataTable and DataTableColumn imports; removed tableColumns and tableData computed properties
- frontend/src/components/CheckpointMetadataPanel.vue: Resize handle has role="separator", aria-orientation="vertical", and aria-label="Resize metadata panel" for accessibility
- 22 CheckpointMetadataPanel tests: updated metadata display test from NDataTable to stacked dt/dd layout; added stacked layout structure test; added 9 new tests for resize handle rendering on wide/narrow screens, full-width on narrow screens, default width on wide screens, mousemove width update during drag, min 300px clamp, max 80vw clamp, mouseup stops resize, media query transition response

### B-004: Lightbox backdrop close broken and missing close button
- frontend/src/components/ImageLightbox.vue: Fixed backdrop click-to-close bug — added onContentClick handler on `.lightbox-content` so clicking the area around the image (outside the image itself) now correctly closes the lightbox; the previous onBackdropClick handler on `.lightbox-backdrop` never fired because `.lightbox-content` fills the entire backdrop area (width/height 100%)
- frontend/src/components/ImageLightbox.vue: Added X close button (NButton, quaternary circle) positioned in the top-left corner with `aria-label="Close lightbox"`; uses fixed positioning at top:12px, left:12px with z-index 1002 to stay above other lightbox elements
- frontend/src/components/ImageLightbox.vue: Escape key continues to close the lightbox (unchanged)
- Updated existing backdrop close test to verify clicking `.lightbox-content` (the actual clickable area) emits close; added test that clicking the image itself does not emit close; added test for X close button click and aria-label; added test verifying close button renders; 29 total ImageLightbox tests pass

### S-025: Main slider layout improvements
- frontend/src/components/MasterSlider.vue: Slider is now 100% width of the main content area (removed max-width: 400px constraint); slider fills all available horizontal space via flex: 1
- frontend/src/components/MasterSlider.vue: Play button moved inline with the slider in a single row layout; on small mobile (≤599px) the slider stacks below the label and play button via flex-wrap
- frontend/src/components/MasterSlider.vue: Loop controls (loop checkbox + speed selector) are now hidden by default; pressing Play reveals them, stopping playback hides them (v-if="playing")
- frontend/src/components/MasterSlider.vue: Loop is now enabled by default (was disabled)
- frontend/src/components/MasterSlider.vue: Added 0.25s (250ms) and 0.33s (330ms) speed options; full set: 0.25s, 0.33s, 0.5s, 1s (default), 2s, 3s
- frontend/src/App.vue: Master slider remains sticky-positioned at top of viewport (position: sticky, top: 0, z-index: 10) — unchanged from S-024
- 39 MasterSlider tests: updated loop checkbox default to checked, updated speed options to 6 entries, added tests for play/stop visibility toggle of loop controls, inline play button in main row, slider full-width layout, all existing keyboard/playback tests updated for new structure

### S-024: X/Y grid improvements
- frontend/src/components/XYGrid.vue: Removed independent grid overflow (no max-height or overflow:auto on grid container); entire page scrolls together instead of the grid scrolling independently
- frontend/src/components/XYGrid.vue: Grid cells now have explicit width/height styles derived from resizable cell dimensions (default 200px)
- frontend/src/components/XYGrid.vue: Added column dividers between X columns (vertical separators with col-resize cursor); dragging any column divider changes all column widths together uniformly
- frontend/src/components/XYGrid.vue: Added row dividers between Y rows (horizontal separators with row-resize cursor); dragging any row divider changes all row heights together uniformly
- frontend/src/components/XYGrid.vue: Column and row headers now emit header:click events when clicked; accessible cursor:pointer and hover styles on headers
- frontend/src/components/XYGrid.vue: Dividers have role="separator" with appropriate aria-orientation for accessibility
- frontend/src/App.vue: Added onHeaderClick handler implementing solo/unsolo behavior — clicking a header solos that value (selects only that value); clicking an already-soloed header re-selects all values for that dimension
- frontend/src/App.vue: Wired header:click event from XYGrid to the solo/unsolo handler
- frontend/src/App.vue: Master slider wrapped in a sticky-positioned container (position:sticky, top:0, z-index:10) so it remains visible when the grid extends below the viewport
- frontend/src/components/ImageCell.vue: Changed from fixed min-width/min-height to 100% width/height to fill parent cell dimensions set by XYGrid
- 13 new XYGrid tests: header:click emission for X column headers, Y row headers, X-only grid headers; column/row header style classes; column divider rendering between X columns; row divider rendering between Y rows; separator roles and aria-orientation; cell width/height styles; header width/height styles; column/row divider mousedown triggers document listeners; no dividers for single-value axes; no row dividers in X-only grid; column dividers in X-only grid
- Updated scrolling test: verifies container has no independent overflow (no overflow:auto or max-height)

### S-023: Dimension filter modes (Hide/Single/Multi)
- frontend/src/api/types.ts: Added FilterMode type ('hide' | 'single' | 'multi') for dimension filter mode control
- frontend/src/composables/useDimensionMapping.ts: Added filterModes ref tracking per-dimension filter mode; setFilterMode and getFilterMode functions; dimensions assigned to X/Y/Slider always use 'multi' filter mode (enforced on role assignment); displaced dimensions revert to 'hide'; filter modes initialized to 'hide' for new dimensions; filter modes cleaned up when dimensions disappear
- frontend/src/components/DimensionFilter.vue: New component replacing ComboFilter with mode-aware filtering; Hide mode renders nothing; Single mode renders NSelect for one value at a time; Multi mode renders NCheckboxGroup with solo/unsolo behavior (click label to solo, click only-selected label to re-select all); collapsed by default with expand/collapse toggle; accessible aria-expanded, aria-label attributes
- frontend/src/components/DimensionPanel.vue: Added filter mode NSelect per dimension (Hide/Single/Multi options); filter mode selector disabled for X/Y/Slider dimensions (always Multi); emits update:filterMode event
- frontend/src/App.vue: Replaced ComboFilter with DimensionFilter; wired filterModes and filter mode change handling; switching to Single reduces selection to one value (first previously-selected or first); switching to Hide restores all values; switching to Multi from Hide starts with all selected; passes getFilterMode to each DimensionFilter
- 26 DimensionFilter component tests: hide mode renders nothing, collapse default/toggle/aria-expanded/aria-label, single mode NSelect rendering/value/change/accessibility/no checkboxes, multi mode checkboxes/toggle/solo/unsolo/all/none/disabled states/accessible labels/no NSelect
- Updated DimensionPanel tests (15): filter mode selector rendering with 3 options, current mode display, multi override for assigned dimensions, disabled state for X/Y/Slider, update:filterMode emission, accessible labels
- Updated useDimensionMapping tests (41): filter mode initialization to hide, reset on setScanResult, setFilterMode for unassigned dimensions, ignore for X/Y/Slider, getFilterMode defaults, role assignment sets multi/reverts hide, addImage initializes filter modes for new dimensions, removeImage cleans up filter modes

### S-022: Left-side slide-out controls panel
- frontend/src/components/AppDrawer.vue: New component wrapping NDrawer with left placement, overlay mode, 360px width, closable drawer content with "Controls" title; accepts show prop with v-model:show for open/close state
- frontend/src/App.vue: Moved TrainingRunSelector, PresetSelector, and DimensionPanel from header/main into AppDrawer slot; added hamburger toggle button (☰) in header-left with aria-label; responsive default state via matchMedia — drawer opens by default on wide screens (≥1024px), closed on narrow screens; listens for media query changes to auto-toggle; drawer does not affect grid state when opened/closed; combo filters, master slider, and grid remain in main content area
- 6 AppDrawer component tests: NDrawer left placement, show prop passthrough, NDrawerContent title and closable, slot content rendering, update:show emission, closed state
- Updated App.test.ts with 7 tests: header rendering, placeholder content, TrainingRunSelector in drawer, hamburger toggle button rendering, drawer toggle on click, closed default on narrow screens, open default on wide screens

### S-021: Dark/Light theme toggle
- frontend/src/composables/useTheme.ts: New composable managing theme state (light/dark mode); defaults to browser prefers-color-scheme media query; persists user choice in localStorage; returns Naive UI GlobalTheme for NConfigProvider; applies body class for non-Naive-UI CSS; listens for system preference changes when user hasn't explicitly chosen
- frontend/src/components/ThemeToggle.vue: 2-way toggle button (Light/Dark) using NButton with accessible aria-label describing the action
- frontend/src/App.vue: Integrated useTheme composable and ThemeToggle in header; NConfigProvider now receives theme prop; added CSS custom properties (--border-color, --bg-color, --text-color, --text-secondary, --bg-surface, --error-color, --warning-color, --accent-color, --accent-bg) with light and dark mode values; .dark-mode class toggles dark palette
- Replaced hardcoded CSS colors across 10 components (ImageCell, XYGrid, CheckpointMetadataPanel, ComboFilter, DimensionPanel, MasterSlider, SliderBar, PresetSelector, TrainingRunSelector, App) with CSS custom property references for theme-awareness
- 14 useTheme composable tests: light/dark system default detection, localStorage persistence and restoration, toggle behavior, setMode, body class application, system preference change following (ignored when user chose explicitly), darkTheme object validation, invalid localStorage handling
- 5 ThemeToggle component tests: text rendering in both modes, toggle event emission, accessible aria-labels for both states
- Updated App.test.ts with matchMedia mock for compatibility with useTheme

### R-002: Migrate to Naive UI component library
- frontend/package.json: Added naive-ui as a dependency
- frontend/src/App.vue: Wrapped app in NConfigProvider; replaced native button with NButton for metadata toggle; replaced WebSocket status span with NTag
- frontend/src/components/TrainingRunSelector.vue: Replaced native select with NSelect; replaced native checkbox with NCheckbox for has-samples filter
- frontend/src/components/DimensionPanel.vue: Replaced native select elements with NSelect for dimension role assignment
- frontend/src/components/PresetSelector.vue: Replaced native select with NSelect; replaced native buttons with NButton for save/delete
- frontend/src/components/ComboFilter.vue: Replaced native buttons with NButton for All/None; replaced native checkboxes with NCheckbox
- frontend/src/components/SliderBar.vue: Replaced native range input with NSlider
- frontend/src/components/MasterSlider.vue: Replaced native range input with NSlider; replaced buttons with NButton for play/pause; replaced checkbox with NCheckbox for loop; replaced select with NSelect for speed
- frontend/src/components/CheckpointMetadataPanel.vue: Replaced custom fixed-position panel with NDrawer + NDrawerContent; replaced HTML table with NDataTable for metadata display
- frontend/src/components/ImageLightbox.vue: Replaced native button with NButton for metadata toggle
- Removed custom CSS for elements now styled by Naive UI (metadata button, WebSocket indicator, select/checkbox/button/slider styles)
- Updated 7 test files (TrainingRunSelector, DimensionPanel, PresetSelector, ComboFilter, SliderBar, MasterSlider, CheckpointMetadataPanel) to use Naive UI component finders (findComponent/findAllComponents) and event patterns (vm.$emit('update:value', ...))
- All 265 tests pass across 17 test files

### S-020: Generation metadata in image lightbox
- backend/internal/service/image_metadata.go: ImageMetadataService parses PNG tEXt chunks to extract embedded ComfyUI metadata (prompt, workflow); validates image paths within sample_dir for path traversal safety; reads PNG signature, iterates chunks, extracts tEXt key-value pairs; returns empty map (not error) when no tEXt chunks present
- backend/internal/api/image_metadata.go: ImageMetadataHandler serves GET /api/images/{filepath}/metadata; extracts filepath from URL, strips /metadata suffix, delegates to ImageMetadataService; returns JSON response with metadata map; maps errors to 400 (invalid path) and 404 (not found)
- backend/internal/api/images.go: ImageHandler updated to delegate requests ending in /metadata to the ImageMetadataHandler via SetMetadataHandler; regular image serving unaffected
- backend/cmd/server/main.go: Wired ImageMetadataService and ImageMetadataHandler into server startup
- frontend/src/api/types.ts: Added ImageMetadata interface for image metadata API response
- frontend/src/api/client.ts: Added getImageMetadata(filepath) method
- frontend/src/components/ImageLightbox.vue: Added metadata panel with toggle button; fetches metadata on-the-fly when lightbox opens; displays tEXt chunk key-value pairs with JSON formatting for prompt/workflow; sorted keys; "No metadata available" for empty metadata; loading and error states; metadata panel positioned at bottom-right, does not interfere with zoom/pan; click.stop prevents panel clicks from closing lightbox
- 12 service unit tests: tEXt chunk extraction (prompt+workflow, empty PNG, all chunk types, single chunk), path validation (empty, absolute, dot-dot, single dot, embedded traversal), error handling (missing file, non-PNG, truncated PNG)
- 5 API handler tests: metadata response, empty metadata, not found, path traversal, regular image serving preserved
- 13 new ImageLightbox component tests: metadata fetch on mount, toggle button, show/hide content, sorted keys, JSON formatting, empty metadata message, loading state, error state, re-fetch on URL change, zoom with panel open, accessible toggle, panel click isolation, non-JSON display
- 2 API client tests: getImageMetadata success and failure

### S-019: Checkpoint metadata slideout panel
- backend/internal/service/checkpoint_metadata.go: CheckpointMetadataService parses safetensors file headers to extract ss_* training metadata fields; resolves checkpoint filenames against configured checkpoint_dirs via recursive filesystem walk; validates filenames for path traversal safety (rejects slashes, dots); reads 8-byte little-endian header length prefix, parses header JSON, extracts __metadata__.ss_* fields; returns empty map (not error) when no metadata present
- backend/internal/store/filesystem.go: Added OpenFile method implementing CheckpointMetadataReader interface for reading safetensors files from disk
- backend/internal/api/design/checkpoints.go: Goa DSL defining checkpoints service with metadata method at GET /api/checkpoints/{filename}/metadata; CheckpointMetadataResponse type with metadata map; not_found and invalid_filename error responses
- backend/internal/api/checkpoints.go: CheckpointsService implementing generated interface; maps service errors to appropriate Goa error types (invalid_filename → 400, not_found → 404)
- backend/internal/api/http.go: Added CheckpointsEndpoints to HTTPHandlerConfig; wired checkpoints server into NewHTTPHandler
- backend/cmd/server/main.go: Wired CheckpointMetadataService and CheckpointsService into server startup
- frontend/src/api/types.ts: Added CheckpointMetadata interface for metadata API response
- frontend/src/api/client.ts: Added getCheckpointMetadata(filename) method with URL encoding
- frontend/src/components/CheckpointMetadataPanel.vue: Slideout panel component with checkpoint list sorted by step number descending; highest step count checkpoint selected by default; fetches metadata on-the-fly when selecting a checkpoint; displays metadata in sorted key-value table; shows "No metadata available" when no ss_* fields; loading and error states; accessible roles (complementary, listbox, option) and aria-labels; close button
- frontend/src/App.vue: Integrated CheckpointMetadataPanel with toggle button in header; panel opens/closes without affecting grid state
- 15 service unit tests: ss_* field extraction, non-ss field exclusion, missing __metadata__ section, no ss_* fields, subdirectory file resolution, multiple checkpoint dirs, many metadata fields, path validation (empty, forward slash, backslash, dot-dot, single dot), file not found, truncated file, invalid JSON
- 7 API unit tests: valid metadata response, empty metadata when no ss_* fields, empty metadata when no __metadata__ section, invalid_filename error for path traversal, not_found for nonexistent file, subdirectory file resolution via walk, multi-directory search
- 13 CheckpointMetadataPanel component unit tests: panel rendering, descending sort, default highest selection, metadata display with sorted keys, no-metadata message, loading state, error display, checkpoint click fetch, close event, accessible close button, accessible listbox, step numbers display, empty checkpoints handling
- 2 API client unit tests: getCheckpointMetadata success and failure

### S-017: Slider playback mode
- frontend/src/components/MasterSlider.vue: Added Play/Pause button that auto-advances through slider values at a configurable interval; speed selector with 0.5s/1s/2s/3s options (default 1s); Loop checkbox to wrap around from last value to first; playback stops automatically at the last value when loop is off; speed changes during playback restart the interval; playback stops when the values prop changes (e.g. dimension switch); accessible aria-labels on all playback controls
- 16 new MasterSlider playback tests: play button rendering, play/pause toggle, interval advance, multi-step advance, stop at last value without loop, wrap with loop enabled, no playback with <=1 values, stop on pause, speed selector default, speed adjustment, speed change during playback restarts interval, loop checkbox default state, accessible labels, play button aria-label changes, stop on values prop change

### S-016: Keyboard navigation for sliders
- frontend/src/components/SliderBar.vue: Added keyboard navigation — ArrowLeft/ArrowDown step to previous value, ArrowRight/ArrowUp step to next value; container div has tabindex="0" for focus; keydown events from the range input bubble to the container handler; preventDefault stops native range input behavior to avoid double-step
- frontend/src/components/MasterSlider.vue: Same keyboard navigation as SliderBar; container div has tabindex="0" for focus when clicking near the slider area
- 9 SliderBar keyboard tests: ArrowRight/ArrowLeft/ArrowUp/ArrowDown stepping, boundary clamping (no emit at first/last value), non-arrow key ignore, keyboard on range input via bubbling, tabindex presence
- 9 MasterSlider keyboard tests: same coverage as SliderBar keyboard tests

### S-015: WebSocket live updates (frontend)
- frontend/src/api/wsClient.ts: WSClient class managing WebSocket connection to /api/ws with auto-reconnect using exponential backoff (configurable initial delay, max delay, multiplier); resets backoff on successful connection; validates incoming FSEvent messages before dispatching; supports event listeners and connection state listeners
- frontend/src/api/types.ts: Added FSEventType union type and FSEventMessage interface for typed WebSocket events
- frontend/src/composables/parseImagePath.ts: Parses WebSocket event paths (checkpoint_dir/query_encoded_filename.png) into ScanImage objects; strips batch suffix; extracts query-encoded dimensions; resolves checkpoint step numbers from training run metadata
- frontend/src/composables/useWebSocket.ts: Composable wiring WSClient to app state; handles image_added (parse + addImage + update combo selections), image_removed (removeImage), and directory_added (trigger full rescan); connects/disconnects based on selected training run
- frontend/src/composables/useDimensionMapping.ts: Added addImage() for incremental image additions with dimension value updates (preserves role assignments, creates new dimensions as needed, sorts values); added removeImage() for image removal with dimension value recalculation (removes orphaned dimensions and their assignments); added helper functions for dimension value sorting, type inference, and rebuilding
- frontend/src/App.vue: Integrated useWebSocket composable; added rescanCurrentTrainingRun for directory_added events; added WebSocket connection status indicator ("Live"/"Disconnected") in header
- 20 WSClient unit tests: connection lifecycle, event dispatching (all 3 event types), invalid message handling (non-JSON, invalid types, missing fields, non-string data), listener management (add/remove), auto-reconnect with exponential backoff, backoff cap at maxDelay, backoff reset on successful connection, reconnect after error
- 13 parseImagePath unit tests: standard query-encoded path, batch suffix stripping, no batch suffix, missing directory separator, non-PNG files, case-insensitive extension, empty filename, unparseable dimensions, checkpoint lookup with step numbers, unmatched checkpoint, no checkpoints provided
- 11 useWebSocket unit tests: connect on training run selection, no connect on null, reconnect on change, disconnect on null, connected state tracking, image_added event handling with checkpoint dimension and combo selection updates, image_removed forwarding, directory_added rescan trigger, unparseable path handling, new dimension combo creation
- 12 useDimensionMapping unit tests: addImage (new image, new dimension values with numeric sort, new dimension creation with assignment, assignment preservation, duplicate path replacement, no-op without scan result), removeImage (by path, orphaned value removal, assignment preservation, dimension disappearance cleanup, non-existent path no-op, no-op without scan result)

### S-014: WebSocket live updates (backend)
- backend/internal/model/event.go: FSEvent domain type with EventType enum (image_added, image_removed, directory_added) and relative Path field
- backend/internal/service/hub.go: WebSocket Hub managing connected HubClient instances; Register/Unregister clients, Broadcast FSEvents to all clients, auto-remove unresponsive clients
- backend/internal/service/watcher.go: Filesystem Watcher using fsnotify; WatchTrainingRun watches sample directories for active training run checkpoints plus sample_dir root; converts fsnotify events (Create/Remove/Rename) into model.FSEvent broadcasts; auto-watches newly created directories; case-insensitive PNG detection; WatcherNotifier interface for testability
- backend/internal/api/design/ws.go: Goa DSL defining ws service with StreamingResult subscribe method at GET /api/ws; FSEventResponse type with event type and path fields
- backend/internal/api/ws.go: WSService implementing generated ws.Service interface; Subscribe method registers a streamClient with the Hub and blocks until client disconnects; streamClient adapts Goa SubscribeServerStream to HubClient with buffered event channel and write pump goroutine
- backend/internal/api/http.go: Added WSEndpoints to HTTPHandlerConfig; WebSocket upgrader with permissive origin check; mounts generated ws server with gorilla/websocket upgrader
- backend/internal/api/training_runs.go: Scan method now starts filesystem watching for the scanned training run (watcher is optional/nil-safe)
- backend/cmd/server/main.go: Wired Hub, FSNotifier, Watcher, WSService, and ws endpoints into server startup; graceful shutdown closes notifier and stops watcher
- go.mod: Added fsnotify v1.9.0 and gorilla/websocket v1.5.3 as direct dependencies
- 10 Hub unit tests: register/unregister lifecycle, client count tracking, broadcast to all clients, removal of unresponsive clients, multiple events in sequence, no-op on empty hub
- 13 Watcher unit tests: watch directory setup for checkpoints with samples, sample_dir root always watched, previous watch cleanup, image_added/image_removed/directory_added events, auto-watch new directories, non-PNG file ignoring, Write event ignoring, case-insensitive PNG, stop idempotency

### S-013: Image lightbox with zoom and pan
- frontend/src/components/ImageLightbox.vue: Modal overlay component with full-size image display, mouse wheel zoom (toward cursor position), click-drag pan, Escape key and backdrop click to close, grab/grabbing cursor states, transform reset on image change
- frontend/src/components/ImageCell.vue: Added click emit that fires with image URL when an image is present; cursor: pointer style on images
- frontend/src/components/XYGrid.vue: Added image:click emit forwarding ImageCell click events to parent for all grid layouts (x+y, x-only, y-only, flat)
- frontend/src/App.vue: Integrated ImageLightbox with lightbox state management; XYGrid image clicks open the lightbox, Escape/backdrop closes it
- 13 ImageLightbox unit tests: dialog rendering, backdrop close, content area non-close, Escape close, non-Escape ignore, zoom in/out via wheel, mouse drag pan, grab cursor states, transform reset on prop change, non-draggable image, event listener cleanup on unmount, right-click drag ignore

### R-001: Refactor Goa HTTP wireup into NewHTTPHandler
- backend/internal/api/http.go: New file with NewHTTPHandler() that encapsulates all Goa HTTP transport setup (mux creation, decoder/encoder, server instantiation, mounting, middleware application, custom handlers)
- backend/internal/api/http.go: HTTPHandlerConfig struct takes pre-built Goa endpoints, ImageHandler, SwaggerUIDir, Logger, and Debug flag
- backend/internal/api/http.go: errorHandler helper logs encoding errors with request ID for correlation
- backend/internal/api/http.go: HTTP-level middleware (RequestID, CORS) applied inside NewHTTPHandler
- backend/internal/api/http.go: Custom image handler and /docs redirect mounted inside NewHTTPHandler
- backend/internal/api/http.go: Debug mode enables error handler and mount logging
- backend/cmd/server/main.go: Simplified to only own dependency injection (config, stores, services, API impls, endpoint creation); calls NewHTTPHandler and wires result into http.Server
- All existing tests pass unchanged (126 specs across 4 suites)

### B-003: Dimension UI selection
- frontend/src/api/types.ts: Changed DimensionRole from 'combo' to 'none' — unassigned dimensions now have 'none' role instead of 'combo' since combo filters are always visible
- frontend/src/components/DimensionPanel.vue: Renamed role label from "Combo Filter" to "None"; default role changed to 'none'
- frontend/src/composables/useDimensionMapping.ts: Default dimension role is now 'none'; displaced dimensions move to 'none'; removed comboDimensions computed (no longer needed since all dimensions show combo filters)
- frontend/src/App.vue: ComboFilter components now render for ALL dimensions regardless of role (not just combo-role ones); preset loading maps combos to 'none' role
- frontend/src/components/PresetSelector.vue: assignmentsToMapping maps 'none' role to combos list for backward-compatible preset serialization
- No backend changes needed — preset mapping combos field naturally stores unassigned ('none' role) dimensions

### B-002: No config.yaml content
- Created `.env` with local host paths for checkpoint and sample directories (gitignored)
- Updated README.md Configuration section with step-by-step setup instructions for `.env` and `config.yaml`

### B-001: WAL mode fails with read-only dev volume
- docker-compose.dev.yml: Use separate `backend_dev_data` named volume for `/build/data` instead of sharing `backend_data` with production mode; the production Dockerfile creates `/app/data` as root with 755 permissions, so when the shared volume was initialized by production first and reused in dev mode (which runs as non-root), SQLite WAL PRAGMA failed with "attempt to write a readonly database"

### S-018: Auto-discover training runs from checkpoint files
- backend/internal/config/config.go: Switched from TOML to YAML configuration (config.yaml); new yamlConfig struct with checkpoint_dirs (list of strings), sample_dir (string), port, ip_address, db_path; validates checkpoint_dirs and sample_dir exist as directories
- config.yaml.example: Example YAML config file with documentation; config.yaml gitignored for local use
- backend/internal/model/config.go: Replaced TrainingRunConfig/DimensionConfig with simplified Config struct (CheckpointDirs, SampleDir); removed pattern/dimensions/root fields
- backend/internal/model/training_run.go: New TrainingRun and Checkpoint domain types for auto-discovered training runs (name, checkpoints, has_samples, step_number, filename, checkpoint_dir_index)
- backend/internal/store/filesystem.go: Replaced ListDirectories with ListSafetensorsFiles (recursive .safetensors scanning) and DirectoryExists; kept ListPNGFiles
- backend/internal/service/discovery.go: New DiscoveryService that recursively scans checkpoint_dirs for .safetensors files, strips suffixes (-step<NNNNN>, -<NNNNNN> epoch), groups into training runs by base name, correlates checkpoints with sample directories under sample_dir, extracts step/epoch numbers, assigns final checkpoint step values
- backend/internal/service/scanner.go: Rewritten to use ScannerFileSystem (ListPNGFiles only); ScanTrainingRun takes model.TrainingRun, scans sample directories per checkpoint, auto-adds "checkpoint" dimension from step numbers, relative paths as checkpoint_filename/image_filename
- backend/internal/api/design/training_runs.go: List method accepts has_samples boolean filter; TrainingRunResponse now includes checkpoint_count, has_samples, checkpoints array; new CheckpointResponse type; removed DimensionConfigResponse and pattern field; added discovery_failed error
- backend/internal/api/training_runs.go: Uses DiscoveryService and Scanner; List calls Discover() with has_samples filter; Scan discovers then scans training run
- backend/cmd/server/main.go: Wired DiscoveryService, updated Scanner and ImageHandler to use sampleDir
- docker-compose.yml, docker-compose.dev.yml: Updated from config.toml to config.yaml; replaced DATASET_ROOT with CHECKPOINT_DIR and SAMPLE_DIR separate volume mounts
- .env.example: Updated from DATASET_ROOT to CHECKPOINT_DIR and SAMPLE_DIR
- frontend/src/api/types.ts: Replaced DimensionConfig with CheckpointInfo; TrainingRun now has checkpoint_count, has_samples, checkpoints instead of pattern/dimensions
- frontend/src/api/client.ts: getTrainingRuns accepts optional hasSamples filter parameter
- frontend/src/components/TrainingRunSelector.vue: Added default-checked "Has samples" filter checkbox; re-fetches training runs when filter changes; resets selection on filter toggle
- 22 discovery service unit tests: suffix stripping (step/epoch), grouping, step extraction, sample correlation, multiple checkpoint dirs, empty dirs, ordering, path preservation, filename-only sample matching
- 16 scanner unit tests: query-encoded filename parsing with checkpoint dimension, checkpoint dimension discovery, skipping checkpoints without samples, batch deduplication, dimension type inference, sorting, error handling, edge cases
- 14 API unit tests: List with has_samples filter, checkpoint details in response, Scan with discovery-based lookup, model-to-API type mapping, error handling
- 5 has-samples filter frontend unit tests: checkbox default state, initial API call with has_samples=true, re-fetch on toggle, selection reset on filter change

### S-012: Preset save and select
- backend/internal/model/preset.go: Preset and PresetMapping domain types (ID, Name, Mapping with X/Y/Slider/Combos, timestamps)
- backend/internal/store/preset.go: PresetStore CRUD operations (ListPresets, GetPreset, CreatePreset, UpdatePreset, DeletePreset) with JSON mapping serialization, RFC3339 timestamps, and sql.ErrNoRows for not-found cases
- backend/internal/service/preset.go: PresetService business logic with UUID generation, name validation, and store delegation
- backend/internal/api/design/presets.go: Goa DSL defining presets service with list, create, update, delete methods; PresetResponse, PresetMappingResponse, CreatePresetPayload, UpdatePresetPayload types
- backend/internal/api/presets.go: PresetsService API implementation mapping between Goa generated types and domain model, wired to service layer
- backend/cmd/server/main.go: Wired presets service, endpoints, and HTTP server into application startup
- frontend/src/api/types.ts: Added Preset and PresetMapping types
- frontend/src/api/client.ts: Added getPresets, createPreset, updatePreset, deletePreset methods
- frontend/src/components/PresetSelector.vue: Component with preset dropdown, save button (prompts for name), delete button, load with unmatched dimension warnings, accessible labels
- frontend/src/App.vue: Integrated PresetSelector with dimension assignment loading, preset warning display, save/delete handlers
- 10 store unit tests: CRUD operations, empty list, ordered by name, duplicate ID rejection, not-found handling, optional mapping fields
- 10 service unit tests: list empty/populated, create with UUID/validation, update with not-found/validation, delete with not-found
- 8 API unit tests: list empty/populated with response mapping, create with payload mapping, update with not-found, delete
- 11 PresetSelector component unit tests: rendering, loading state, error display, load/save/delete events, unmatched dimension warnings, accessible labels, prompt cancellation, disabled save button
- 6 API client unit tests: getPresets, createPreset, updatePreset, deletePreset success and failure

### S-011: Slider navigation
- frontend/src/components/SliderBar.vue: Per-cell range slider component cycling through ordered slider-dimension values, with accessible aria-label and aria-valuetext, current value display
- frontend/src/components/MasterSlider.vue: Top-level master slider that moves all individual cell sliders in sync, with dimension name label and accessible role="group" container
- frontend/src/components/XYGrid.vue: Integrated SliderBar below each ImageCell when a slider dimension is assigned; emits update:sliderValue events for per-cell slider changes; accepts defaultSliderValue prop for master slider synchronization
- frontend/src/composables/useImagePreloader.ts: Composable that preloads images via Image() objects to populate browser HTTP cache; priority 1: all slider positions for visible grid cells, priority 2: remaining filtered images, priority 3: all scan images; cancels in-flight preloads on reset; deduplicates URLs
- frontend/src/App.vue: Integrated MasterSlider above the grid, wired master/individual slider value synchronization (master clears per-cell overrides), added useImagePreloader for background pre-caching, added watch to reset slider state on dimension change
- 10 SliderBar unit tests: range input rendering, min/max bounds, current value index, unknown value fallback, value text display, change emission at various indices, accessible aria-label and aria-valuetext
- 11 MasterSlider unit tests: range input rendering, dimension name label, min/max bounds, current value index, unknown value fallback, value text display, change emission, accessible aria-label, aria-valuetext, role="group" container
- 8 useImagePreloader unit tests: preload all images without slider, prioritize slider positions for visible cells, Image() constructor usage, combo filter integration, restart on image change, empty list handling, URL deduplication, x/y dimension visible cell preloading
- 3 new XYGrid slider integration tests: SliderBar per cell rendering, update:sliderValue emission, no slider when dimension unassigned

### S-010: Combo filters
- frontend/src/components/ComboFilter.vue: Multi-select filter component for combo-assigned dimensions with checkboxes for each value, click-label single-selection shortcut, select-all/select-none controls, and accessible labels
- frontend/src/App.vue: Integrated ComboFilter components for each combo-assigned dimension, wired combo selection updates to reactive state that drives XYGrid filtering
- 16 ComboFilter unit tests: dimension name rendering, checkbox per value, checked state from selection, toggle via checkbox change, add via checkbox, single-select via label click, select-all button, select-none button, All button disabled when all selected, None button disabled when none selected, button enabled states, accessible labels on controls and values, empty values list

### S-009: X/Y grid with dimension mapping
- frontend/src/api/types.ts: Added ScanImage, ScanDimension, ScanResult, DimensionRole, and DimensionAssignment types for scan API responses and dimension mapping state
- frontend/src/api/client.ts: Added scanTrainingRun(id) method to ApiClient for GET /api/training-runs/{id}/scan
- frontend/src/composables/useDimensionMapping.ts: Composable managing dimension-to-role assignments (x, y, slider, combo) with role uniqueness enforcement, computed role accessors, and image lookup
- frontend/src/components/DimensionPanel.vue: Panel listing all discovered dimensions with role selection dropdowns (X Axis, Y Axis, Slider, Combo Filter) and accessible labels
- frontend/src/components/ImageCell.vue: Grid cell component displaying an image via /api/images/ endpoint or a placeholder for missing combinations, with lazy loading
- frontend/src/components/XYGrid.vue: Grid component rendering rows (Y values) and columns (X values) with image lookup, combo filter integration, slider dimension support, horizontal/vertical scrolling, and flat image display when no axes are assigned
- frontend/src/App.vue: Integrated DimensionPanel and XYGrid; training run selection triggers scan API call, populates dimensions and images, initializes combo selections
- 16 composable unit tests: setScanResult initialization, role assignment with displacement, computed dimensions by role, dimensionAssignments array, findImage with exact/partial/missing matches
- 8 DimensionPanel unit tests: row rendering, dimension names, value counts, role options, current assignment display, assign event emission, empty state, accessibility
- 5 ImageCell unit tests: image rendering with URL, placeholder for null, empty class toggling, lazy loading attribute
- 17 XYGrid unit tests: grid structure (headers, rows, cells), image rendering, missing combination placeholders, X-only and Y-only layouts, no-axes empty/flat states, combo filter integration, slider dimension filtering, scrollable container
- 2 API client unit tests: scanTrainingRun success and failure

### S-008: Filesystem scanning and image serving (backend)
- backend/internal/model/scan.go: Domain types for Image (relative path + dimensions map), Dimension (name, type, sorted values), and ScanResult
- backend/internal/service/scanner.go: Scanner service implementing filesystem scanning, query-encoded filename parsing, batch counter deduplication (highest batch number wins), directory dimension regex extraction, dimension type inference (numeric values → int sort), and deterministic output ordering
- backend/internal/store/filesystem.go: FileSystem store providing ListDirectories (recursive walk with regex pattern matching) and ListPNGFiles (directory listing filtered to .png)
- backend/internal/api/design/training_runs.go: Extended Goa DSL with scan method (GET /api/training-runs/{id}/scan), ScanResultResponse, ImageResponse, and DimensionResponse types; not_found and scan_failed error responses
- backend/internal/api/training_runs.go: Updated TrainingRunsService with Scan method that delegates to Scanner, maps model types to API response types, validates training run ID bounds
- backend/internal/api/images.go: ImageHandler serving images from dataset root via GET /api/images/{filepath} with path traversal protection (component validation + resolved path prefix check), Cache-Control: max-age=31536000, immutable headers, and Content-Type: image/png
- backend/cmd/server/main.go: Wired FileSystem store, Scanner service, and ImageHandler into server startup
- 16 service unit tests: filename parsing, batch deduplication, directory dimension extraction, dimension type inference, numeric/string sorting, deterministic ordering, error handling, edge cases
- 6 API unit tests: Scan method (not_found, scan_failed, success with model-to-API mapping), List method compatibility
- 7 integration tests: GET /api/training-runs/{id}/scan (200 with results, 404 for invalid ID), GET /api/images/* (serving, cache headers, 404, path traversal rejection, empty path, directory rejection)

### S-007: Training run listing and selection
- backend/internal/api/design/training_runs.go: Goa DSL for training_runs service with list method returning TrainingRunResponse and DimensionConfigResponse types
- backend/internal/api/gen/training_runs/: Generated Goa code for training_runs service
- backend/internal/api/training_runs.go: TrainingRunsService implementation mapping config training runs to API response types
- backend/cmd/server/main.go: Wired training_runs service into server startup
- frontend/src/api/types.ts: Added TrainingRun and DimensionConfig types
- frontend/src/api/client.ts: Added getTrainingRuns() method
- frontend/src/components/TrainingRunSelector.vue: Dropdown component that fetches and displays training runs, emits selection events, shows loading/error states
- frontend/src/App.vue: Integrated TrainingRunSelector into header, stores selected training run in app state
- 6 backend unit tests: TrainingRunsService list (empty, with runs, with dimensions, empty dimensions) and HTTP integration (GET /api/training-runs response, CORS headers)
- 8 frontend unit tests: TrainingRunSelector (rendering, loading state, dropdown population, selection emit, error display, disabled state) and API client getTrainingRuns method

### S-006: Docker Compose and Makefile wiring
- config.toml: production config with ip_address=0.0.0.0 for LAN access, dataset root at /data/dataset (Docker mount point), db_path at ./data/checkpoint-sampler.db
- docker-compose.yml: dataset root mounted as read-only volume via DATASET_ROOT env var, SQLite data as named Docker volume, config.toml mounted read-only, CONFIG_PATH set
- docker-compose.dev.yml: dataset root and config.toml mounted into dev backend, named volume for data directory, CONFIG_PATH set for dev working directory
- backend/Dockerfile.dev: added /build/data directory with world-writable permissions for named volume compatibility with non-root user
- frontend/nginx.conf: reverse proxy for /api/, /health, and /docs to backend service using Docker embedded DNS resolver for dynamic upstream resolution
- frontend/vite.config.ts: dev proxy for /api, /health, and /docs to backend service for HMR dev mode
- .env.example: documents DATASET_ROOT environment variable
- .gitignore: added .dataset-placeholder/ entry
- Both make up (production) and make up-dev (hot-reload) build and start successfully; frontend proxies API requests to backend in both modes

### S-005: Frontend scaffold and API client
- frontend/src/main.ts: Vue 3 app entry point mounting App component to #app
- frontend/src/App.vue: App shell with header ("Checkpoint Sampler") and placeholder main content
- frontend/src/env.d.ts: TypeScript shims for .vue single-file components and Vite client types
- frontend/src/api/types.ts: Shared API types (ApiErrorResponse, ApiError, HealthStatus)
- frontend/src/api/client.ts: ApiClient class with typed fetch wrapper, error normalization (backend ErrorWithCode → ApiError), NETWORK_ERROR/UNKNOWN_ERROR fallbacks, and getHealth() method; exports singleton apiClient instance
- frontend/index.html: updated title to "Checkpoint Sampler"
- 12 unit tests: ApiClient request method (URL construction, RequestInit passthrough, default base URL, error code parsing, non-JSON error fallback, malformed error body, network errors), getHealth method, and App component rendering

### S-004: Goa API scaffold and codegen pipeline
- backend/internal/api/design/api.go: Goa v3 API definition (title, version, server)
- backend/internal/api/design/health.go: Health check service DSL with GET /health endpoint returning status
- backend/internal/api/design/docs.go: Docs service DSL with GET /docs/openapi3.json and Swagger UI file serving at /docs/
- backend/internal/api/generate.go: go:generate directive for Goa codegen
- backend/internal/api/gen/: Generated Goa code (HTTP transport, encoders, OpenAPI 3.0 spec)
- backend/internal/api/health.go: HealthService implementation returning {"status":"ok"}
- backend/internal/api/docs.go: DocsService implementation serving OpenAPI spec bytes
- backend/internal/api/cors.go: CORS middleware supporting configurable allowed origin
- backend/internal/api/design/public/swagger-ui/: Swagger UI static assets (v5.18.2)
- backend/cmd/server/main.go: Server entrypoint wiring config, database, Goa services, CORS middleware, and graceful shutdown
- 10 unit tests covering health service, docs service, CORS middleware, and HTTP integration (health endpoint, OpenAPI spec, CORS preflight)

### S-003: SQLite database setup and migrations
- backend/internal/store/db.go: OpenDB() configures SQLite with WAL mode, 5s busy timeout, foreign keys ON; creates parent directory if needed
- backend/internal/store/db.go: Migrate() forward-only migration runner with schema_migrations tracking table; applies pending migrations in order within transactions
- backend/internal/store/migrations.go: AllMigrations() returns ordered migration list; migration 1 creates presets table (id, name, mapping JSON, created_at, updated_at)
- backend/internal/store/store.go: Store type with New() constructor that runs migrations on init, Close(), and DB() accessor
- docker-compose.dev.yml: added GOMODCACHE volume for writable Go module cache in dev containers
- 16 unit tests covering DB pragma verification, migration execution, idempotency, error handling, presets table schema validation, and store initialization

### S-002: TOML configuration loading
- backend/internal/model/config.go: domain types for Config, TrainingRunConfig, DimensionConfig, DimensionType
- backend/internal/config/config.go: TOML config loading with Load(), LoadFromPath(), LoadFromString(); validation for root (must exist as directory), port (1-65535, default 8080), ip_address (valid IP, default 127.0.0.1), db_path (default ./data/), training run patterns and dimensions
- Validation rejects missing root, nonexistent root, non-directory root, invalid port, invalid IP, invalid regex patterns, missing required fields, invalid dimension types
- 23 unit tests covering valid config, defaults, missing fields, invalid regex, file loading, and env var override

### S-001: Architecture and schema documentation
- docs/architecture.md: system overview, backend layered structure, filesystem scanning, image serving, WebSocket, frontend architecture, Docker runtime, data flow
- docs/database.md: SQLite setup, migration strategy, presets table schema with mapping JSON format, indexes, conventions
- docs/api.md: Goa design-first workflow, service groupings, endpoint documentation (training runs, images, presets, WebSocket), error handling, CORS
- CLAUDE.md section 5: references SQLite + TOML config + filesystem dataset root
