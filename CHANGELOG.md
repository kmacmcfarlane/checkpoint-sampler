# Changelog

All notable changes to this project will be documented in this file.
Older entries are condensed to titles only — see git history for full details.

## Unreleased

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

### S-081: Viewer driven by sample output directories instead of checkpoints
- Viewer now discovers training runs from sample output directories instead of checkpoint files
- "Has Samples" filter removed from training run selector (all listed runs have samples by definition)
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

### B-031: Dimension preset selector missing New/Save/Delete workflow
- Added dirty tracking, New button, and restructured PresetSelector layout

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
