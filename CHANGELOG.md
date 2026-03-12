# Changelog

All notable changes to this project will be documented in this file.
Older entries are condensed to titles only — see git history for full details.

## Unreleased

### S-127: MRU for sampler/scheduler pairs per workflow
- Sampler/scheduler pairs are now remembered per workflow template in localStorage and auto-filled when re-selecting a workflow; existing study values are preserved when loading from the study selector

### S-126: ETA countdown timer (client-side interpolation)
- Job progress ETA now interpolates a smooth countdown between WebSocket events using `setInterval`, giving a "ticking down" UX instead of jumping between server pushes

### S-120: Filters drawer width configurable or auto-sized
- FiltersDrawer is now drag-to-resize via a left-edge handle (min 200px, max 80vw); defaults to full viewport width on screens narrower than 600px

### S-104: Rename preset inline
- "Rename" button appears when a preset is selected, opens a dialog pre-filled with the current name; confirms via PUT (no Save-As needed)

### S-103: Expose more sidecar fields as numeric in metadata API
- `numericSidecarFields` expanded from 3 to 6 entries: `width`, `height`, and `index` now route to `NumericFields` instead of `StringFields` in sidecar metadata parsing

### W-022: Fixture seeder idempotency guard
- `SeedFixtures()` now checks for existing fixture data before seeding, preventing silent state duplication if the DB cleaner fails mid-reset

### W-018: Slow-motion mock mode for E2E timing tests
- ComfyUI mock supports configurable delay via `COMFYUI_MOCK_DELAY_MS` env var and runtime `POST /mock/config` endpoint, enabling E2E tests to reliably observe in-flight job state
- 3 new E2E tests verify mock config round-trip, running-phase UI observation (status tag, stop button, sample params), and stop-button functionality during slow-motion execution

### W-017: Incomplete-set E2E test infra (partial sample seeding)
- New test-only `POST /api/test/seed-partial-samples` endpoint creates partial sample directory structures, enabling E2E coverage of the incomplete-set (`sample_status=partial`) code path without running a generation job
- 5 new E2E tests verify partial/complete/none sample status and yellow problem bead UI behavior

### W-016: Shared logrus log-level assertion helper for backend tests
- New `testutil.LogCapture` helper in `backend/internal/testutil/` replaces three ad-hoc patterns (inline for-loops, local `filterByLevel`, `bytes.Buffer` string matching) with a single reusable struct
- Existing log-level tests in `filesystem_test.go`, `preset_test.go`, and `job_executor_test.go` refactored to use the helper

### W-015: Add Vite ws proxy EPIPE to QA_ALLOWED_ERRORS.md
- Updated QA_ALLOWED_ERRORS.md to document `[vite] ws proxy socket error: Error: write EPIPE` as the primary EPIPE source during E2E runs, caused by Playwright closing WebSocket connections on page navigation

### W-014: App.test.ts window.innerWidth cleanup between tests
- Top-level `afterEach` in App.test.ts now resets `window.innerWidth` to 1024, preventing narrow-screen test state from leaking across tests via `Object.defineProperty`

### W-013: E2E test for keyboard auto-repeat slider navigation
- New Playwright spec (`slider-keyboard-autorepeat.spec.ts`) with 4 tests exercising `page.keyboard.down()` auto-repeat on the master slider, catching stale-prop race conditions that JSDOM cannot reproduce

### W-012: Shift field E2E testing with AuraFlow workflow fixture
- Added `test-workflow-auraflow.json` fixture with `cs_role: "shift"` node, enabling E2E tests for shift field visibility behavior
- Three new E2E tests verify shift input appears/disappears based on workflow selection in the study editor

### W-011: Cross-story regression guard for character-set changes
- New `make lint-disallowed-chars` target scans string literals in `.go`/`.ts`/`.vue` files for characters in the `disallowedNameChars` set, catching regressions when new characters are added to the disallowed study-name set
- Fixed Goa design `Example("My Study (copy)")` → `Example("My Study - copy")` to comply with the current disallowed character set

### W-010: Automated audit for bare NSelect click patterns in E2E specs
- New `make lint-e2e-helpers` target runs a shell script that flags bare `training-run-select` clicks bypassing the `selectTrainingRun` helper, preventing recurrence of NSelect race conditions (B-053, B-054)

### W-008: Widen accessibility test coverage to include grid state
- Added populated-grid accessibility audit E2E tests (light + dark mode) that load a training run, assign axes, and scan the rendered grid
- Fixed ARIA structure violations in XYGrid (role="row" wrappers with display:contents) and ZoomControl (imperative aria-label on NSlider thumb)

### W-006: Expand QA_ALLOWED_ERRORS.md with all test environment artifacts
- Added allowlist entries for database reset race conditions, safetensors metadata parse failures on test fixture stubs, and Vite WebSocket proxy EPIPE/ECONNREFUSED during E2E startup/teardown

### W-005: Add queued status bead test case to JobLaunchDialog tests
- Added pending/queued path test case completing 4-of-4 dual bead state coverage (empty, complete, running, queued)

### S-125: Separate display ordering from processing ordering for ListSampleJobs
- UI-facing job list now returns newest-first (created_at DESC); executor FIFO pickup remains oldest-first (ASC)

### S-124: Configurable ComfyUI reconnect interval
- ComfyUI WebSocket reconnect interval is now configurable via `comfyui.reconnect_interval` in config.yaml (default remains 10 seconds)

### S-123: Display individual checkpoint filenames in job parameters panel
- Job params panel now shows individual checkpoint filenames instead of just a count; falls back to count for pre-migration jobs
- New `checkpoint_filenames` column (migration 19) stores the selected checkpoint list at job creation time

### S-122: Restrict Delete button to non-running jobs; require stop-then-delete flow
- Delete button hidden when job status is `running` to prevent data inconsistency from deleting mid-execution jobs

### S-119: Per-model-type workflow restore on training run change
- Speculatively applies per-model-type workflow preference from localStorage cache when switching training runs, avoiding wait for async metadata fetch
- Falls back to metadata fetch when cache is empty; cache is always refreshed in background to stay current

### S-118: Lightbox grid position indicator
- Added "X / Y" position indicator at top-center of lightbox, visible when grid has multiple images
- Indicator updates reactively on Shift+Arrow grid navigation; uses `pointer-events: none` to stay unobtrusive

### B-096: E2E: Filters slideout layout tests fail (2 tests)
- Replaced fragile Naive UI internal CSS class selector in `openFiltersDrawer` E2E helper with stable `data-testid="filters-drawer-content"` attribute, per TEST_PRACTICES.md section 6.7

### B-095: Close as not reproducible — dimension filtering combo filter E2E tests pass reliably
- Combo filter tests in dimension-filtering.spec.ts pass reliably across multiple consecutive runs; flakiness was likely resolved by B-089 and B-091 timing fixes

### B-089: Flaky E2E: preset dirty tracking test fails on manual preset selection
- `savePresetViaDialog` E2E helper now waits for the POST /api/presets API response before returning, fixing race where dirty-tracking state wasn't reset before assertion
- Removed duplicate local `savePresetViaDialog` from sidebar-preset-selector.spec.ts in favor of the shared helper

### B-091: Flaky preset dirty tracking: Save button not disabled after save on manually selected preset
- Updated E2E test to use NModal save dialog pattern (`savePresetViaDialog` helper) instead of deprecated `window.prompt` listener, eliminating the timing race that left the Save button enabled after save
- Added `down -v` pre-clean to `make test-e2e` to prevent stale SQLite schema from interrupted runs

### B-090: Race condition: 'failed to get job for progress broadcast' during job lifecycle
- `broadcastJobProgress` now handles `sql.ErrNoRows` gracefully (WARN instead of ERROR), eliminating spurious error logs when a job is deleted mid-broadcast during E2E teardown or normal operation

### S-128: WebSocket heartbeat/ping-pong mechanism
- Backend sends periodic WebSocket ping frames (default 30s interval) to keep idle connections alive through reverse proxies with short read timeouts
- Ping interval configurable via `ws_ping_interval` in config.yaml; set to 0 to disable

### S-121: Replace window.prompt for preset save with NModal input dialog
- Preset save now uses an NModal input dialog instead of `window.prompt`, consistent with the ConfirmDeleteDialog pattern (card preset, confirm/cancel buttons, Enter/Escape keyboard support)
- Empty and whitespace-only preset names are rejected (confirm button disabled)

### B-087: Fix root-owned dist/assets blocking host-side npm run build
- Added named volume overlays (`frontend_dist:/app/dist`) in dev and test compose files, matching the existing `node_modules` isolation pattern to prevent root-owned writes to the host filesystem

### B-088: Sanitize training run directory names (replace slashes with underscores)
- Fixture seeder now uses `SanitizeTrainingRunName` when constructing sample output paths, making the sanitization explicit and consistent with production code paths
- E2E test fixtures include a slash-containing training run (`test-run/my-model` → `test-run_my-model/`) with dedicated E2E coverage

### S-116: Training run and study status beads in Generate Samples (UAT rework)
- Training run green bead now falls back to completed job status when study availability data is absent, fixing beads not appearing for non-selected runs
- Study beads use only directory-level availability data (not validation results) for consistent rendering regardless of which study is selected
- Job refresh trigger fires on any status transition (not just terminal) so blue beads appear immediately when jobs start running
- Dual beads (activity + problem slots simultaneously) now work correctly; bead rules documented in PRD section 5.5.1

### S-117: Validation results dialog with regenerate flow (job list + slideout)
- "Validate" button on each job card in the Sample Jobs panel and in the controls slideout triggers on-demand validation and displays results in a dialog
- Regenerate button in the validation dialog opens the Generate Samples dialog with pre-filled training run, study, and "generate missing samples only" checked

### S-109: Keyboard navigation help overlay in lightbox (UAT rework)
- Added `?` keyboard shortcut to toggle the help panel, addressing UAT feedback that the overlay had no discoverable trigger
- Improved `?` button visibility: upgraded from `quaternary`/`small` to `secondary`/`medium` with explicit background color

### S-108: Configurable confirmation button text in ConfirmDeleteDialog
- `ConfirmDeleteDialog` accepts an optional `confirmLabel` prop to customize the confirm button text, enabling reuse for non-delete confirmations (e.g., regeneration dialogs)

### S-105: Tooltip on study bead showing checkpoint counts (UAT rework)
- Fixed study availability path: `GetAvailability()` now uses B-078 directory layout (`{sanitized_run_name}/{study_id}`) instead of the old `{study_name}` path, fixing checkpoint counts always showing 0/N

### S-110: Resume completed_with_errors jobs (retry failed items)
- New `POST /api/sample-jobs/{id}/retry-failed` endpoint resets failed/skipped items to pending and resumes execution; guards against concurrent running jobs and non-`completed_with_errors` state
- "Retry failed" button on JobProgressPanel for `completed_with_errors` jobs, replacing the need to create a new job to retry failures

### S-102: Show full sample params for currently generating sample in job list (UAT rework)
- Fixed first-sample params not displaying: `processItem` now broadcasts `job_progress` with `current_sample_params` immediately when a new item starts, not only after completion
- Same timing pattern as B-067 (inference progress bar missing on first sample)

### W-007: Automated panic detection in E2E log scan
- `make test-e2e` now automatically scans backend logs for Go panics after each run; a passing Playwright suite with backend panics exits non-zero
- Standalone `make check-e2e-panics` target for scanning saved E2E logs without re-running the suite

### B-086: E2E: S-116 activity bead not visible for running job in Generate Samples dialog
- Executor polling loop no longer discovers externally-seeded running jobs (which have no items) and immediately completes them; `resumeRunningJobs()` now properly adopts running jobs at startup by setting `activeJobID`

### S-115: Generate Samples dialog — smart checkbox defaults
- "Generate missing samples only" auto-checked when validation detects an incomplete sample set; "Clear existing samples" left unchecked for complete sets
- Smart defaults apply once per training run + study combination; subsequent manual checkbox changes are preserved

### S-113: MRU defaults for workflow/VAE/text encoder selections (local storage)
- VAE and text encoder selections now auto-fill from most-recently-used values per workflow template, stored in localStorage
- MRU only applies on user-driven workflow selection; loading an existing study preserves its own values

### S-116: Training run and study status beads in Generate Samples
- Dual-bead system replaces single-bead: each training run and study item shows up to two independent beads — activity (blue=running, green=complete) and problem (red=failed, yellow=incomplete)
- New `dualBeadStatus.ts` composable with pure functions for bead state computation; existing Jobs nav button bead (`beadStatus.ts`) unchanged

### S-114: Pre-generate JPEG thumbnails for sample images (UAT rework)
- Fixed corrupt IDAT CRC in ComfyUI mock PNG that silently prevented thumbnail generation; Go's `image.Decode` now succeeds on mock output
- Added unit tests for thumbnail generation in job executor and scanner thumbnail path population
- E2E tests verify end-to-end thumbnail generation and grid thumbnail URL usage

### S-111: Test seed endpoint for sample jobs (E2E testing infra)
- New `POST /api/test/seed-jobs` endpoint (gated on `ENABLE_TEST_ENDPOINTS=true`) creates sample jobs with specified statuses, enabling E2E testing of job-related UI without requiring ComfyUI
- Store-level `SeedSampleJobs` method auto-creates stub study rows to satisfy FK constraints

### B-085: Studies created without workflow_template cause 'workflow not found: .json' errors at job execution
- Added missing `workflow_template`, `vae`, and `text_encoder` fields to E2E test study payloads and backend fixture seeder that were not updated when S-112 moved these fields from job-level to study-level

### S-112: Move workflow template, VAE, text encoder, shift into study definition
- Workflow template, VAE, text encoder, and shift moved from job-level settings into the study definition; DB migration 18 adds columns to `studies` table
- `CreateSampleJobPayload` no longer accepts workflow/VAE/CLIP/shift — these are read from the study at job creation time
- StudyEditor gains workflow template, VAE, CLIP, and shift selectors with MRU workflow template via localStorage
- Study export/import includes the new fields for round-trip fidelity

### B-077: Tooltip for long checkpoint names in Current checkpoint progress line
- Current checkpoint name in JobProgressPanel progress line now shows ellipsis truncation with native tooltip on hover, consistent with B-052 completeness section treatment

### B-075: Clamp TotalMissing in backend validation to prevent negative values
- `TotalMissing` aggregate now clamped to `max(0, totalExpected - totalVerified)` in all three validation functions, preventing semantically incorrect negative values when checkpoints have more files than expected

### B-074: Atomic stop-and-transition in executor
- `RequestStop` now owns the DB status update to `stopped` (mirroring `completeJob`), eliminating the window where the executor cleared its state but the DB still showed `running`
- Service layer's `Stop()` delegates the DB write entirely to the executor, re-fetching post-stop state for the caller

### B-076: Database UNIQUE constraint on study names
- Migration 17 adds a UNIQUE index on `studies.name`, enforcing name uniqueness at the DB level and preventing race conditions that bypass the service-layer check

### B-071: Deterministic pending-job pickup order (ORDER BY created_at)
- `ListSampleJobs()` now orders by `created_at ASC` (oldest first) instead of `DESC`, ensuring FIFO processing when multiple pending jobs are queued

### B-069: Lightbox slider overlaps metadata button in bottom right
- Conditional CSS class offsets the metadata panel above the slider panel when a slider dimension is active, preventing overlap in the bottom-right corner

### B-072: Guard Start() API against concurrent running jobs
- `SampleJobService.Start()` now checks for existing running jobs via `HasRunningJob()` store query and returns an error if one is already running, preventing confusing dual-running-job state in the database

### B-073: ComfyUI WS reconnect on disconnect / recover stuck jobs
- Job executor now recovers stuck items after WebSocket reconnect by polling ComfyUI's history API for completed prompts and resetting unfinished items to pending for retry
- `everConnected` flag distinguishes initial connections from reconnects; recovery only triggers on reconnect to avoid unnecessary history polling at startup

### B-084: SQL error 'no such column: negative_prompt' during sample job execution
- Added `negative_prompt` column to initial `sample_job_items` CREATE TABLE in migration 4, ensuring fresh databases (including after ResetDB) always have the column from initial creation

### B-080: Job executor race condition: sql no rows during concurrent cancel/completion
- All job executor DB write paths now handle `sql.ErrNoRows` gracefully (WARN instead of ERROR), eliminating spurious error logs when a job is cancelled mid-processing

### B-068: Lightbox slider not synced with master slider on shift+arrow navigation
- Lightbox slider changes now propagate to master slider (via `onMasterSliderChange` instead of per-cell `onSliderValueUpdate`), keeping all grid cells in sync
- Shift+Arrow navigation uses the live master slider value instead of the stale snapshot from lightbox-open time

### B-079: Checkpoint validation status missing after generation (persists across refresh)
- Validate endpoint now uses checkpoint discovery (same source as frontend) when `study_id` is provided, fixing ID mismatch that caused not_found before generation and double-nested path after generation
- Legacy validation (no study context) continues to use viewer discovery for backward compatibility

### B-067: Inference progress bar missing on first sample generation
- Initialize `jobProgress` placeholder when `inference_progress` WebSocket events arrive before `job_progress`, fixing invisible progress bar on the first sample of a job

### B-082: E2E sample-count-preview.spec.ts 2 tests timing out in Generate Samples dialog
- Two dialog validation tests now use the pre-seeded fixture study instead of dynamically-created studies, fixing timeouts caused by B-078's scoped sample directory structure

### B-081: E2E regen-confirmation.spec.ts 4 tests timing out in Generate Samples dialog
- Added `FixtureSeeder` to test reset endpoint that seeds a deterministic study with matching sample directories after each DB reset, fixing B-078 regression where dynamically-created studies had no sample dirs at the per-study-scoped path
- regen-confirmation E2E tests now select the pre-seeded fixture study instead of creating studies via UI

### B-070: Main slider keyboard left/right arrows broken (regression)
- Removed incorrect `ctrlKey` guard from MasterSlider's keyboard handler (S-063 regression); plain arrow keys now navigate the slider as originally intended
- Added focus-based guard to skip document-level arrow handling when a non-MasterSlider slider (e.g. ZoomControl) has DOM focus

### B-078: Sample output directory restructure + per-training-run manifest + validation count scoping
- Sample output directories restructured from `{study_name}/{checkpoint}/` to `{sanitized_training_run_name}/{study_id}/{checkpoint}/`, scoping samples per training run and preventing cross-contamination when multiple training runs share the same study
- Training run names with directory separators (e.g. `qwen/Qwen2-VL`) sanitized to underscores for filesystem paths; DB/API retains original names
- Validation counts now scoped to the selected training run + study combination, fixing inflated 36/1 and 8/1 count bugs
- Demo dataset uses new `demo-model/demo-study/` layout; viewer discovery detects both 3-level (new) and 2-level (legacy) directory structures

### B-066: Job executor logs spurious error when database is reset mid-poll
- Downgraded `autoStartJob` error log from ERROR to WARN when `UpdateSampleJob` returns `sql.ErrNoRows`, eliminating spurious error noise during E2E test teardown race conditions

### S-101: Study editor validation field highlighting (UAT rework)
- Per-tag error highlighting for NDynamicTags (steps, CFGs, seeds) using `renderTag` prop with `NTag type="error"` — individual duplicate tags now show red styling instead of a wrapper border around the entire tag group
- NInput/NSelect `status="error"` for study name, prompt rows, and sampler/scheduler pairs; duplicate values highlight only occurrences after the first; highlights clear reactively when errors are resolved

### S-100: Debug mode params overlay in lightbox
- Lightbox now shows a debug overlay (bottom-left, non-interactive) displaying the same dimension parameters as the XY grid debug overlay when debug mode is enabled
- Debug info updates correctly when navigating between grid cells (Shift+Arrow) or changing the slider value inside the lightbox

### S-099: View job parameters on card title click
- Job card title in Sample Jobs dialog is now clickable; opens an inline parameter detail panel showing training run, workflow, study/preset, VAE, CLIP, shift, and checkpoint count
- Panel dismissible via close button or title toggle; accessible with `aria-expanded` attribute

### S-092: Visual polish: remove heading, play/pause icon, refresh icons
- Removed "Checkpoint Sampler" heading from the UI header to reclaim vertical space
- Play/Pause text button replaced with circular icon button: green triangle (play) and pause bars (pause) SVGs, themed via `--play-icon-color` CSS variable
- Refresh icon buttons added to Sample Set selector (sidebar) and Training Run selector (Generate Samples dialog) for manual list reload

### S-098: ETA per sample and per job (moving average) (UAT rework)
- Fixed per-sample ETA not displaying: backend now falls back to moving-average duration when elapsed exceeds average, ensuring `sample_eta_seconds` is always populated while a sample is running
- Frontend preserves existing per-sample ETA across `job_progress` events that omit the field, preventing inference-progress ETAs from being overwritten

### S-097: Delete jobs with option to keep or delete sample data
- Delete button on job cards opens a ConfirmDeleteDialog with "Also delete sample data" checkbox (default unchecked)
- `DELETE /api/sample-jobs/{id}?delete_data=true` removes per-checkpoint sample directories from disk before deleting the database record; filesystem errors prevent DB deletion to avoid orphaned state

### S-096: Delete dimension mapping preset (UAT rework)
- After deleting a preset, auto-selects the most recently used preset (or first available) instead of resetting to empty; MRU tracking is in-memory only (no cross-refresh persistence)

### B-063: Hot reload resets all dimension mappings to Single
- Converted `useDimensionMapping` composable to module-scoped singleton state with `import.meta.hot.data` preservation, preventing Vite HMR from resetting dimension role assignments and filter modes

### B-062: Generate Samples dialog: wrong bead colors, missing regeneration checkboxes
- Training run bead now uses job data as primary indicator: completed → green, completed_with_errors → yellow/partial (was red), replacing the root-level `has_samples` check that missed study-scoped sample directories
- Study bead overrides directory-level availability with validation results for image-level accuracy (e.g. 590/684 shows yellow, not green)
- Regeneration checkboxes now appear for runs with partial samples

### B-061: Job marked as completed despite 94 missing samples (590/684)
- `completeJob` now checks that ALL items are in `completed` status; any non-completed item (skipped, failed, stuck in running) triggers `completed_with_errors`
- Skipped items (from checkpoint path matching failures) counted as failed in `GetItemCounts`, `GetProgress`, and WebSocket progress broadcasts

### S-095: Delete study with option to keep or delete sample data
- Study deletion now shows a `ConfirmDeleteDialog` with an "Also delete sample data" checkbox (default off), replacing the browser `window.confirm()`
- Backend `DELETE /api/studies/{id}?delete_data=true` removes the study's sample output directory from disk before deleting the database record
- Filesystem removal errors prevent database deletion, avoiding orphaned state

### B-058: 45 pre-existing E2E test failures across 10 spec files
- Added `confirmRegenDialogIfVisible()` helper to handle S-093's regeneration confirmation dialog in E2E tests
- Fixed `regen-confirmation.spec.ts` unchecking "Clear existing samples" to prevent fixture directory deletion cascading across 9 spec files

### S-093: Confirmation dialog for regenerating a valid sample set (UAT rework)
- Fixed race condition where clicking Regenerate before validation API returned bypassed the confirmation dialog; now conservatively shows dialog while validation is in-flight
- Complete sample sets still show confirmation; incomplete sets skip the dialog and proceed directly

### S-091: Move Light/Dark and Debug mode to Settings dialog
- Theme toggle and debug mode switch moved from header into the Settings dialog's new "Appearance" section
- Reduces top-level UI clutter; controls take effect immediately without closing the dialog

### S-090: Lightbox shift+up/down for Y-axis grid navigation
- Shift+Up/Down arrow keys in lightbox navigate between grid rows (Y-axis), complementing existing Shift+Left/Right X-axis navigation
- Navigation wraps at grid boundaries; disabled when no X dimension is assigned

### S-094: Standard delete confirmation dialog component
- Reusable `ConfirmDeleteDialog.vue` with configurable title, description, optional checkbox, and red "Yes, Delete" confirm button
- Emits `confirm` (with checkbox state), `cancel`, and `update:show` events; integrates with Naive UI NModal

### B-047: Update button missing after changing selector type on preset load
- Extended preset dirty tracking to compare filter modes (Single/Multi/Hide) alongside axis role assignments, fixing invisible changes when switching filter modes after auto-load

### S-089: Unified dimension selector (X/Y/Slider, Single, Multi, Hide)
- Replaced two-dropdown pattern (role assignment + filter mode) with a single unified dropdown per dimension row in the mapping editor
- Mutual exclusion: axis options (X/Y/Slider) held by one dimension are hidden from other dimensions' dropdowns
- Unassigned dimensions default to Single filter mode; single-value dimensions default to Hide and are disabled

### S-088: Study dropdown status beads in Generate Samples dialog
- Study availability API returns three-way `sample_status` (none/partial/complete) alongside existing `has_samples` boolean
- Study dropdown renders green bead for complete, yellow for partial, no bead for none — replacing the previous binary green/transparent pattern

### B-052: Sample Jobs Dialog cosmetic fixes: progress flip-flop, verified label, checkpoint tooltip
- Monotonic guard on inference progress prevents out-of-order WebSocket events from flipping the progress bar backward
- Completeness status label (`verified`/`missing`) styled with `nowrap` to prevent wrapping in narrow containers
- Checkpoint names in completeness list show full name tooltip on hover via native `title` attribute

### B-051: Job bead color precedence (green/blue/yellow/red)
- Fixed bead color mapping: `completed_with_errors` now shows yellow (was red), added `failed` status mapped to red (was unhandled/gray)
- Extracted bead logic into `composables/beadStatus.ts` with correct precedence: red > yellow > blue > green

### B-055: Full E2E suite has systematic test isolation flakiness affecting ~29 tests
- Added `afterEach` cleanup hooks to 5 spec files: `cancelAllJobs()` for sample job specs, `uninstallDemo()` for demo dataset specs
- Enhanced `resetDatabase()` with post-reset `/health` check to guard against race conditions where subsequent API calls arrive before the backend has stabilized

### B-057: Full E2E suite resource contention causes 15s timeout on 25 UI tests
- Added `--disable-dev-shm-usage` and `--disable-gpu` Chromium launch args to prevent `/dev/shm` exhaustion over 130+ sequential tests in Docker
- Increased playwright service `shm_size` to 256 MB as safety margin for residual shared memory writes

### B-056: sample-generation.spec.ts tests 2-4 fail because training run select menu does not open after first test
- Added retry logic (up to 3 attempts) to `selectTrainingRun` E2E helper to handle NDrawer slide-in animation swallowing the NSelect trigger click
- Changed `page.goto` to use `networkidle` in sample-generation.spec.ts beforeEach to prevent race with training-runs API response

### B-050: Study name filename validation (no problematic directory characters)
- Backend `validate()` rejects filesystem-unsafe characters `()/\:*?<>|"` in study names with descriptive error message
- Frontend mirrors validation inline in study editor, blocking save when disallowed characters are present
- Fork suffix changed from `" (copy)"` to `" - copy"` to avoid triggering the new validation

### B-054: viewer-discovery E2E tests fail — 'my-model' training run not found in API response
- Replaced inline NSelect click sequence in `viewer-discovery.spec.ts` with shared `selectTrainingRun` helper, fixing race condition where the selector was clicked before async data loading completed (same pattern as B-053)

### B-046: ComfyUI execution errors not displayed in job viewer
- ComfyUI `execution_error` events now parsed for `exception_message`, `exception_type`, `node_type`, and `traceback`; forwarded through backend WebSocket to frontend
- Job viewer shows structured error summary per-checkpoint with expandable Python stack trace toggle

### B-053: E2E selectTrainingRun helper times out across multiple spec files
- Added loading-state wait to `selectTrainingRun` helper: waits for NSelect disabled class to disappear before clicking, preventing race condition with async training run data loading
- Consolidated 8 duplicate local helper definitions (`selectTrainingRun`, `selectNaiveOption`, `closeDrawer`) across spec files into shared `helpers.ts`

### B-049: Sample path scoping: Has Samples and validation must strictly scope to study dir
- Validation methods now bypass the legacy `HasSamples` flag when a study name is provided, always checking the study-scoped directory `sample_dir/<study_name>/<checkpoint>/` directly
- "Select Missing" button hidden when zero samples exist for the study+training run (only appears when some but not all exist)

### B-048: Audit and fix all E2E test failures + add E2E gate to UAT transition
- Fixed 29 cascading E2E test failures caused by premature "Clear existing samples" checkbox interaction before Vue rendered it, which deleted test fixture directories
- Added `SampleDirCleaner` to test reset endpoint as defense-in-depth, removing study-generated directories between E2E tests
- E2E gate: AGENT_FLOW.md and TEST_PRACTICES.md now require zero E2E failures before any story transitions to `uat`

### S-085: Study immutability and fork workflow (UAT rework)
- Replaced study versioning (version column, `v{N}/` directories) with immutability + fork approach
- Studies with existing samples cannot be edited directly; dialog offers "Create New Study" (fork) or "Re-generate Samples" (delete and regenerate)
- New `POST /api/studies/{source_id}/fork` endpoint creates a copy with modified settings
- New `GET /api/studies/{id}/has-samples` endpoint checks filesystem for existing samples
- Migration 13 drops `version` column from studies table (table recreation for SQLite)
- Flat `StudyAvailability` replaces versioned `StudyVersionInfo[]` in Generate Samples dialog
- Output directories simplified to `{sample_dir}/{study_name}/{checkpoint}/` (no version subdirectory)
- Removed `StudyVersion` from job manifest

### S-086: Study version selector UX and sample availability beads (UAT rework)
- Study selection required before checkpoint picker is shown in Generate Samples dialog
- Green bead indicators show per-study sample availability for the selected training run
- Aligned with S-085 immutability/fork model — no version selector (versioning removed)

### S-084: Sample count preview and missing-sample generation from Generate Samples dialog (UAT rework)
- Generate Samples dialog replaced separate checkpoint picker and validation preview with unified per-checkpoint validation status display (checkmark/warning icons, found/expected counts)
- Form field order changed to Training Run → Study → Validation Status → Workflow → VAE → CLIP → Shift
- "Select Missing" button replaces "Generate Missing Samples" for checkpoint selection
- Generate Samples dialog auto-fetches validation on training run selection, showing expected sample count and missing count preview
- "Generate missing samples only" checkbox creates a job that skips checkpoint×parameter combinations where the output file already exists
- Sidebar "Validate" results now show total counts; "Generate Missing" button opens the job dialog when missing samples are detected

### S-087: JSON sample job manifest per generation job
- Each completed generation job writes a `manifest.json` file to the study output directory capturing the full study configuration snapshot, job metadata, checkpoint list, and all dimension values
- New `fileformat.JobManifest` type with `NewJobManifest`, `MarshalManifest`, `UnmarshalManifest` functions
- Manifest write is non-fatal: failure logs a warning but does not block job completion
- `ValidationFileSystem` extended with `ReadFile` method; `ValidateTrainingRunWithManifest` and `ReadManifest` enable manifest-based validation and regeneration

### B-045: on-demand-validation E2E test fails due to empty POST body on updated validate endpoint
- Moved `study_id` from request body to URL query parameter via `Param("study_id")` in the Goa DSL, eliminating the generated decoder's requirement for a JSON body on POST `/api/training-runs/{id}/validate`

### B-043: Study editor allows duplicate dimension values
- Backend `validate()` rejects duplicate steps, CFGs, sampler/scheduler pairs, seeds, and prompt names via set-based detection
- `GetStudyByName` store method + service-layer uniqueness check on Create/Update with self-exclusion for updates
- Frontend `localValidationError` computed mirrors backend checks, disables save button and shows warning alert

### B-044: SQLite PRAGMA foreign_keys=ON not enforced across connection pool
- Pragmas (foreign_keys, WAL, busy_timeout) now set via DSN `_pragma` parameters instead of `db.Exec()`, ensuring enforcement on every pool connection
- E2E test verifies cascade deletion actually removes sample_jobs when a study is deleted

### B-030: Top nav elements unavailable on narrow screens until drawer opens (UAT rework)
- Generate Samples and Jobs buttons always visible in top nav regardless of training run selection
- Only the Metadata button remains gated on having a training run selected

### B-042: Watcher fails to watch demo training run checkpoint directories due to nested study path
- WatchTrainingRun now derives study name from run.Name and includes it when constructing checkpoint watch paths and parent directory watch target

### S-082: Make more room in UI — filters slideout, slider/zoom relocation
- Dimension filters moved from inline collapsible section to a right-side slideout drawer (always expanded, no individual collapse)
- Master slider relocated to the header center area; zoom control moved to the top nav bar alongside action buttons
- Responsive layout: header-center wraps to a second row on narrow screens (<768px)

### S-078: Demo sampleset and dimension preset (UAT rework)
- Fixed study-scoped relative path in `ScanTrainingRun`: image paths now include the study name prefix, resolving broken demo images in the viewer

### S-080: Disable and sort single-value dimensions to bottom
- Dimensions with only one unique value are sorted to the bottom of DimensionPanel and visually greyed out with disabled role assignment
- Filter mode remains settable on single-value dimensions; sorting updates reactively on training run change

### B-041: ComfyUI mock E2E tests fail intermittently due to WebSocket timing and job executor 'item not found' errors
- Job executor Pause() now clears active state (job/item/prompt IDs) to prevent stale DB references after test reset
- WebSocket event handler discards events while paused; item-not-found logged at warn level instead of error

### S-083: On-demand dataset validation from viewer controls
- "Training Run" selector renamed to "Sample Set" in the controls slide-out
- New `POST /api/training-runs/{id}/validate` endpoint reuses S-075 completeness-check logic to report per-checkpoint verified/expected/missing counts
- Validate button in the sidebar triggers on-demand validation with inline pass/warning results per checkpoint

### S-073: Per-sample inference progress bar
- Backend forwards ComfyUI per-node progress events (value/max) through the WebSocket as `inference_progress` messages
- JobProgressPanel shows a secondary NProgress bar for the currently-generating sample within checkpoint progress
- Progress bar resets between samples (on completed_items change, checkpoint progress change, or job completion)

### S-079: Sample preset (study) import/export to JSON
- Export button downloads the current study form as a JSON file (CreateStudyPayload shape, excludes id/timestamps)
- Import button uploads and validates a JSON file, populating the form for a new study with clear error messages on validation failure
- Validation enforces DEVELOPMENT_PRACTICES 4.11 numeric constraints: steps as positive integers, seeds as non-negative integers, cfgs as finite numbers

### B-040: Test fixture safetensors file triggers EOF parse errors in backend logs
- Replaced 4 empty (0-byte) test fixture `.safetensors` files with valid 10-byte minimal headers, eliminating EOF parse errors in backend logs during E2E tests

### B-039: Race condition during test reset causes 'no such column' SQL error
- Job executor Pause/Resume synchronization prevents SQL errors when test reset endpoint drops and recreates tables
- BackgroundPauser interface allows test reset to coordinate with any background polling process

### B-038: Frontend npm run build fails due to TypeScript type errors in test files
- Fixed ~50 TypeScript errors across 9 frontend files (test files and 2 source components) that caused `vue-tsc` to fail during `npm run build`
- Added `asVue()` helper in StudyEditor tests for type-safe `findComponent('[data-testid="..."]')` access

### S-071: nginx config validation and WebSocket header checks in build pipeline
- Dockerfile nginx stage validates config syntax (`nginx -t`) and required WebSocket proxy headers at build time
- Standalone `make lint-nginx` target runs the same checks without a running stack

### S-070: E2E test for full sample generation flow
- Lightweight ComfyUI mock server (Node.js + ws) in `comfyui-mock/` implements HTTP + WebSocket API surface for E2E testing without a real GPU
- Three Playwright tests exercise the full generation flow: create study, launch job, verify progression through pending → running → completed
- Shared E2E helpers extracted to `frontend/e2e/helpers.ts`; test fixtures expanded with checkpoint files, workflow template, and ComfyUI-enabled config

### R-004: Consolidate docker-compose.test.yml and docker-compose.e2e.yml
- Merged `docker-compose.e2e.yml` into `docker-compose.test.yml` as a single standalone test stack with test fixtures, healthchecks, and Playwright
- Removed `COMPOSE_E2E` Makefile variable; all test/E2E targets now use `COMPOSE_TEST`

### S-069: Drawer auto-collapse on image grid interaction
- Drawer auto-collapses on narrow/medium screens when user clicks an image, clicks a grid header, or uses Ctrl+Arrow keyboard navigation
- Wide screens (≥1024px) unaffected; manual drawer toggle continues to work after auto-collapse

### S-068: Backend quality — log-level tuning and sidecar typed metadata
- ListPNGFiles and ListSafetensorsFiles now log directory-not-found at debug level instead of error (expected miss pattern)
- Image metadata API splits fields into `string_metadata` and `numeric_metadata` maps; seed/steps/cfg returned as numbers for richer frontend display

### S-067: Persistence and display polish — Has Samples filter, CFG trailing-zero, workflow preference, slider wrap-around
- Has Samples filter checkbox persisted to localStorage; conditionally rendered only when runs without samples exist
- CFG tag display preserves trailing zero for whole numbers (7.0 not 7) per DEVELOPMENT_PRACTICES numeric format spec
- Workflow selection scoped per model type instead of global; three-tier fallback: auto-select single → per-model-type → global
- SliderBar optional `wrapAround` prop for boundary wrap-around consistent with ImageCell keyboard navigation

### S-066: Documentation — WebSocket path and capture-phase handler ordering
- Comprehensive WebSocket protocol documentation in docs/api.md: connection lifecycle, message types, field tables, reconnection behavior
- New DEVELOPMENT_PRACTICES.md section 4.10 documenting the capture-phase + stopImmediatePropagation pattern for keyboard event handling conflicts

### S-065: E2E test coverage additions — combo solo click and XYGrid emit test
- E2E test for DimensionFilter solo click (solo to filter, unsolo to restore all values)
- Unit test asserting XYGrid `image:click` emit payload shape (`ImageClickContext`)

### S-060: Playwright browser pre-warming via custom Docker image
- Custom Dockerfile bakes `npm ci` into the Playwright image, eliminating ~5-10s overhead per E2E test run
- New `make build-playwright` target; `make test-e2e` no longer runs `npm ci` at runtime

### S-059: Build tooling quality-of-life improvements
- `.air.toml`: deprecated `build.bin` → `build.entrypoint`; `make test-backend` uses `run --rm` (no running stack needed); E2E `--remove-orphans`; root-level `make gen` target

### S-081: Viewer driven by sample output directories instead of checkpoints (UAT rework)
- Viewer discovers training runs from sample output directories; Generate Samples dialog uses checkpoint-based discovery via `?source=checkpoints` query parameter
- "Has Samples" filter removed from viewer's training run selector (all listed runs have samples by definition)
- Supports both legacy root-level and study-scoped sample directory structures

### S-077: 'Show all' training runs checked by default in Generate Samples dialog
- "Show all" checkbox now defaults to checked, showing all training runs (not just empty ones)

### S-076: Auto-select single workflow template in Generate Samples dialog
- Auto-selects the workflow when exactly one valid workflow template exists; falls back to localStorage when multiple are available

### S-072: Regenerate button for completed sample jobs
- Regenerate button on completed and completed-with-errors job cards; pre-populates all job settings from original job
- For completed-with-errors jobs, pre-selects only failed checkpoints for retry

### S-075: Completeness check for generated sample datasets
- Per-checkpoint completeness verification after each batch (verified/missing counts via WebSocket events)
- Missing files logged as warnings, not failures; frontend displays completeness status per checkpoint

### S-074: Rename 'sample presets' to 'studies' with study-scoped output directories
- DB migration renames `sample_presets` → `studies`; API endpoints `/api/sample-presets` → `/api/studies`
- Output directories now study-scoped: `{sample_dir}/{study_name}/{checkpoint_filename}/`
- Study name denormalized on SampleJob for historical accuracy

### B-033: Lightbox closes on mouse-up after slider drag
- Track mousedown origin to prevent slider drag-release from closing lightbox

### B-031: Dimension preset selector missing New/Save/Delete workflow (UAT rework)
- Added "Update" button to save changes to an existing preset in place; "Save" now acts as "Save As" for creating new presets

### B-032: X/Y grid display glitches — add debug mode overlay
- Debug overlay showing per-cell dimension values, slider value, and combo selections

### S-055: Prompt prefix field in sample presets
- DB migration adds `prompt_prefix` column; prefix prepended to prompts at generation time with smart separator logic
- Full-stack: model, service, store, API, and frontend editor

### S-054: Playwright config hardening (HTML reporter, screenshot on failure, explicit timeout)
### S-053: Frontend lint enforcement and component type hygiene
### S-052: Apply data-testid selectors and test isolation to existing frontend tests

### S-064: E2E test data isolation per run
- `ResetDB()` method drops all tables and reruns migrations; `DELETE /api/test/reset` endpoint (gated by env var)

### S-063: MasterSlider keyboard conflict guard for multiple instances
- Global singleton managing keyboard focus stack; Ctrl+Arrow keys to avoid conflict with zoom controls

### S-062: Generate Samples dialog polish — bead indicator, preset auto-close, training run restore and refresh
- Colored bead indicator on Jobs button reflecting job status; auto-close preset editor on save; training run persistence
- DB migration adds ON DELETE CASCADE to `sample_jobs.study_id` FK, fixing 500 error on study deletion when jobs exist

### S-061: Lightbox UX improvements — keyboard navigation and slider dimension label
- Shift+Arrow grid navigation with wrap-around; slider label shows dimension name; local slider index for rapid key presses

## Earlier changes (title only — see git history for details)

### S-058: Frontend lint rules — CSS variable linting and unused import detection
### S-072: Replace independent sampler/scheduler lists with sampler-scheduler pairs in sample presets
### S-057: Accessibility audit integration (axe-core)
### B-037: Backend panics with nil pointer dereference on /api/sample-jobs when ComfyUI is not configured
### S-056: E2E log capture before teardown
### W-004: QA smoke test standardization — E2E tests as primary verification
### W-003: Story notes improvements — root cause documentation and numeric format spec
### W-002: E2E test result parsing — QA addresses failures and files bug tickets
### W-001: Update QA agent to write/modify E2E tests and file ideas for unrelated coverage
### B-032: Dark mode contrast issues in job cards and sample preset editor
### B-031: Generate Samples dialog doesn't sync preset selection to manage presets sub-dialog
### B-030: Top nav elements unavailable on narrow screens until drawer opens
### B-036: Job status does not report failed items — add error reporting, completed_with_errors status
### B-034: High-severity npm audit vulnerabilities in frontend dependencies
### B-035: Job executor never receives ComfyUI completion events — jobs stuck in running
### B-033: Negative prompt not injected into workflow substitution
### B-029: Sample jobs stuck in pending — backend should auto-start and execute jobs
### S-051: Workflows documentation (docs/workflows.md)
### S-050: Remember last workflow and model-type-specific inputs in Generate Samples dialog
### S-048: Sample preset steps/cfg/seeds as multi-value tag inputs with validation
### S-049: Generate Samples dialog — own training run selector with status beads and regeneration support
### B-025: Has Samples filter should default to checked
### B-023: Generate Samples dialog summary text unreadable (low contrast)
### B-027: Slider keyboard navigation only selects first or last value
### B-026: WebSocket fails on remote LAN hosts (nginx missing upgrade headers)
### B-024: Sample Preset Editor crashes when adding second prompt
### B-022: FileSystem.OpenFile logs at error level for expected sidecar miss
### S-039: JSON sidecar metadata per image
### S-038: Keyboard navigation for sliders
### S-046: E2E test: slider and playback controls
### S-045: E2E test: sample preset CRUD via job launch dialog
### S-037: Slider navigation in image lightbox
### S-044: E2E test: dimension filtering and combo filters
### S-043: E2E test: image lightbox interaction
### S-047: Integrate Playwright E2E tests into QA subagent workflow
### S-042: E2E test: training run selection and XY grid display
### S-041: Playwright E2E test infrastructure setup
### B-018: Training run selector dropdown too narrow to read long names
### Workflow improvements (2026-02-24)
### B-020: Sample preset editor not visible or accessible in the Generate Samples UI
### B-019: Workflow templates not loading — config nesting error and missing Docker volume mount
### B-021: ComfyUI config: replace host+port with url field to support HTTPS reverse proxies
### B-017: Backend crash-loops when ComfyUI is unreachable, preventing all API requests
### R-003: Refactor image serving and metadata endpoints to idiomatic Goa with SkipResponseBodyEncodeDecode
### B-016: Frontend swallows API error messages due to field name mismatch and missing Goa Debug middleware
### B-015: Backend service errors not logged to container stdout
### B-014: API returns bare 500 errors without JSON error body
### B-013: Migration 6 fails with duplicate column 'height' on existing databases
### S-035: Sample job launch and progress UI
### S-034: Sample job execution engine
### S-033: Sample job orchestration
### S-032: Sample setting presets
### S-031: Workflow template management
### B-012: Training run selector dropdown not populating
### S-036: Structured logging with logrus
### S-030: ComfyUI configuration, client, and model discovery
### S-029: Collapse all dimension filters into single expandable 'Filters' section
### S-028: XY grid corner-based cell resizing
### B-011: Auto-load previously used dimension preset from localStorage
### B-010: WebSocket live updates always displays 'disconnected'
### B-009: XY grid header solo click should hide non-selected values from grid
### B-008: Checkpoint selector in metadata slideout has unreadable background
### B-007: Checkpoint metadata panel dark mode text unreadable
### B-006: No zoom/scale control for grid cell size
### B-005: X/Y grid layout breaks with different configurations
### S-027: Responsive design polish
### S-026: Checkpoint metadata panel improvements
### B-004: Lightbox backdrop close broken and missing close button
### S-025: Main slider layout improvements
### S-024: X/Y grid improvements
### S-023: Dimension filter modes (Hide/Single/Multi)
### S-022: Left-side slide-out controls panel
### S-021: Dark/Light theme toggle
### R-002: Migrate to Naive UI component library
### S-020: Generation metadata in image lightbox
### S-019: Checkpoint metadata slideout panel
### S-017: Slider playback mode
### S-016: Keyboard navigation for sliders
### S-015: WebSocket live updates (frontend)
### S-014: WebSocket live updates (backend)
### S-013: Image lightbox with zoom and pan
### R-001: Refactor Goa HTTP wireup into NewHTTPHandler
### B-003: Dimension UI selection
### B-002: No config.yaml content
### B-001: WAL mode fails with read-only dev volume
### S-018: Auto-discover training runs from checkpoint files
### S-012: Preset save and select
### S-011: Slider navigation
### S-010: Combo filters
### S-009: X/Y grid with dimension mapping
### S-008: Filesystem scanning and image serving (backend)
### S-007: Training run listing and selection
### S-006: Docker Compose and Makefile wiring
### S-005: Frontend scaffold and API client
### S-004: Goa API scaffold and codegen pipeline
### S-003: SQLite database setup and migrations
### S-002: TOML configuration loading
### S-001: Architecture and schema documentation
