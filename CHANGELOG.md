# Changelog

All notable changes to this project will be documented in this file.
Older entries are condensed to titles only — see git history for full details.

## Unreleased

### S-175: Keyboard accessibility — XYGrid header filtering and ImageCell lightbox activation
- XY grid column and row headers are now keyboard-operable: `tabindex="0"` plus an `onHeaderKeydown` handler that activates the same solo/unsolo filtering on Enter/Space that a mouse click triggers. The existing `role="columnheader"`/`role="rowheader"` were deliberately kept rather than switched to `role="button"` — ARIA does not allow combining them, and the header roles are what assistive tech uses to announce position within the surrounding `role="grid"` structure
- `ImageCell` is now focusable whenever it has an image (`relativePath` set), not only when slider dimensions exist, and gains `role="button"`. Enter/Space opens the lightbox via the same path as a click. Previously a cell with no slider dims was unreachable by keyboard, so the lightbox was mouse-only
- The Enter/Space branch in `onKeydown` runs before the slider guard but is safe for empty cells (`onClick` already null-guards on the image URL) and does not interfere with the pre-existing arrow-key slider stepping — covered by a dedicated non-interference test
- Added `:focus-visible` outline styling (2px accent-color, -2px offset) for both header classes so focus stays visible against the dark grid background
- Tests: component coverage for focusability, `role`, Enter/Space activation, empty-cell no-op, and unrelated-key no-op in both `ImageCell` and `XYGrid`, plus a new `keyboard-accessibility` E2E spec asserting real outcomes (grid narrows on header solo; lightbox becomes visible) rather than just event emission

### B-173: Investigate 404s on deprecated unversioned `/api/*` paths seen in dev backend logs
- **Investigation only — no code change.** Confirmed no current code path issues requests to unversioned `/api/*` paths. `ApiClient` (`frontend/src/api/client.ts`) defaults to `/api/v1` and is only overridden in its own tests; `buildDefaultWSUrl()` hardcodes `/api/v1/ws`; no `VITE_*`/`API_BASE` env var or build-time substitution can redirect the base URL
- Both the `vite.config.ts` dev proxy and the `nginx.conf` `location /api/` block use non-rewriting `proxy_pass` (no URI segment after the upstream), so neither can strip `/v1` from an outbound `/api/v1/*` request. No `docker-compose`/Makefile healthcheck targets an unversioned path
- Commit `674a882` (S-171) moved every route to `/api/v1` as a clean break with no aliases. Route text at `674a882^` matches the reported `/api/ws`, `/api/comfyui/status`, and `/api/demo` exactly — consistent with a browser tab holding a pre-S-171 JS bundle in memory on the LAN client (192.168.1.95)
- Noted: the fourth reported path `/api/settings` never existed in this repo's history (`git log --all -S` finds zero hits); the pre-S-171 equivalent was `/api/config`. Likely a human-readable label in the sweep report rather than a literal captured path
- The `/api/test/*` paths in `frontend/e2e/*` are a distinct, `ENABLE_TEST_ENDPOINTS`-gated surface mounted only in the test compose stacks — unrelated to the reported 404s

### S-174: User-facing usage guide and troubleshooting doc
- Added `docs/usage.md` — the first user-facing (as opposed to developer-facing) documentation. Walks a new user through restoring the demo dataset from Settings, the Study → Sample Job → XY grid workflow, and enabling ComfyUI generation via `comfyui.url` / `workflow_dir` / `reconnect_interval`. Existing `docs/ui.md` covers component architecture and never explained how to actually operate the viewer or why inference features might appear disabled
- Troubleshooting/FAQ section covers the `ComfyUI (offline)` pill (jobs queue and resume automatically once reconnected), an empty training-run list, models not visible to ComfyUI (filename matching / `extra_model_paths.yaml`), and proxy `allowed_origins` mismatches (hostname-only matching, scheme and port ignored), plus stuck jobs and where output lands
- `README.md` links the guide from Quick start and from the Architecture doc cross-links
- Docs-only; every command, config key, API path, and UI label was verified against source and against a running dev stack rather than inferred

### S-173: Fail fast on unreadable configured directories; helpful empty state when no training runs found
- Startup config validation now attempts `os.ReadDir` (not just `os.Stat`) on every configured `checkpoint_dirs`, `lora_dirs`, `base_model_dir`, and `sample_dir` entry, failing with `config: directory not readable: <label> <dir>: <err>`. Previously a root-owned Docker-created host mount passed the `os.Stat` check, `FSState.Populate` then failed Warn-only, and the app looked healthy but was permanently empty. Optional dirs are still only validated when actually configured, so omitting `lora_dirs`/`base_model_dir` does not break startup
- `GET /api/v1/config` now returns `checkpoint_dirs` (added to the Goa `ConfigResult` type) so the frontend can name the configured directories; `NewHealthService` gains a checkpoint-dirs parameter
- `TrainingRunSelector` renders a standalone `NEmpty` block naming the configured checkpoint directories and pointing at `config.yaml` / `docs/filesystem.md`, replacing the generic "No Data". The block is standalone rather than the `NSelect` `empty` slot because that slot only renders when the dropdown is opened — which a disabled/empty selector never is, hiding the message exactly when it is most needed. Falls back to a generic message if the config fetch fails
- Tests: backend chmod-0000 cases for `checkpoint_dirs` and `sample_dir` (skipped when running as root), frontend unit coverage for the named-dirs / fallback / hidden-when-runs-exist paths, plus a new `training-run-empty-state` E2E spec

### S-177: Grid view header — show training-run name and study label (stacked, ellipsis, tooltip)
- The grid-view header now shows a two-line label to the right of the Filters button identifying the selected run: run name on top, study label below (modest type). Each line truncates with a CSS ellipsis (max-width 220px) and an `NTooltip` on hover reveals the full run name + study label
- The label uses the same visibility guard as the Filters button (`selectedTrainingRun && !scanning && !scanError && dimensions.length > 0`), and renders only the name line when `study_label` is empty (legacy/checkpoint-source runs)
- Displays `training_run_dir || name` — for study-grouped runs `name` is a composite backend id (`model/study/model`), so the clean directory name is preferred, matching the existing validation-dialog title pattern. Frontend-only

### S-179: Generate Samples — default base model from checkpoint ss_ metadata for fresh LoRA runs
- The Generate Samples base-model selector now defaults, for a *fresh* LoRA run with nothing remembered, to the base model named in the checkpoint's `ss_` training metadata — preferring `ss_sd_model_name`, then `ss_pretrained_model_name_or_path`, then `ss_base_model_version` — matched by basename (case-insensitive, extension-stripped) against `base_model_dir` options. No match or missing metadata leaves it unselected (best-effort, no wrong guess, no error). Frontend-only; reuses the existing checkpoint-metadata fetch (no new API call)
- Precedence preserved: the remembered-from-samples value and any explicit user choice always win over the metadata default, gated by an `availabilityFetched` flag and a `hasRememberedForAnyStudy` guard; extraction is LoRA-gated so checkpoint (non-LoRA) runs never trigger it

### S-172: Contributor onramp — CONTRIBUTING.md, SECURITY.md, untrack sandbox config
- Added `CONTRIBUTING.md` (dev setup, test commands, PR expectations, optional claude-sandbox/ralph agent-workflow section) and `SECURITY.md` (private vulnerability reporting policy scoped to the no-auth local/LAN threat model)
- `.claude-sandbox/config.yaml` is no longer tracked (it carried personal mount paths and host-access flags); a sanitized `.claude-sandbox/config.yaml.example` is checked in and the real file is now gitignored — copy the example per the config-cascade convention
- README's agent-workflow marketing moved out of the product intro into a Contributing section that points to CONTRIBUTING.md/SECURITY.md; `frontend/package.json` declares `license: GPL-3.0-only`

### S-170: Paginate GET /api/v1/sample-jobs with invisible lazy loading; strip tracebacks from list view
- Backend `GET /api/v1/sample-jobs` now accepts `limit` (default 50, max 200) / `offset` query params with stable ordering (`ORDER BY created_at DESC, id DESC` — `created_at` is immutable so paging stays consistent even as running jobs update). The total count travels in an `X-Total-Count` response header; the response body stays a bare jobs array for backward compatibility. Store gains `ListSampleJobsPage`/`CountSampleJobs`; service `List` returns `(jobs, total, err)`
- List entries now omit the per-item `traceback` blob (retained on the `show` endpoint via `SampleJobResponse`) so the list payload no longer grows unboundedly as failed jobs accumulate; `failed_item_details` + `error_message` are still present on list entries for at-a-glance failure info
- Frontend `JobProgressPanel` lazy-loads pages ahead of the scroll position via an `IntersectionObserver` (600px rootMargin) prefetch — no manual "Load more" button, so loading is invisible. New WS jobs prepend into the accumulated list (dedupe-by-id) rather than resetting to page 1, preserving loaded older pages. `listSampleJobs()` loops all pages so `JobLaunchDialog`'s per-run bead status and failed-bead navigation still see the full job history
- Ordering note: actively-updating jobs no longer bubble to the top of the list (supersedes B-133's `updated_at DESC` ordering) — an intentional trade-off for stable pagination

### S-169: Toast layer for API errors — job controls and launch-dialog fetches surface failures
- Added an app-level Naive UI toast layer: `NMessageProvider` wraps a render-nothing `ToastRegistrar` that bridges `useMessage()` (only callable inside the provider subtree) to a module-level singleton, so App.vue's own setup logic and any component can fire toasts via a no-op-safe `useToast()` composable. The four job-control handlers (stop/resume/retry/delete) now show an error toast on failure instead of only `console.warn`
- JobLaunchDialog's initial fetches (training-runs/jobs/workflows, base models, studies) now render an inline error banner with a Retry affordance instead of silently showing empty selectors — a transient backend error is no longer indistinguishable from "no data exists". Frontend-only

### S-178: Generate Samples — enable checkpoint multi-select for fresh runs (no samples yet)
- The Generate Samples dialog now renders the per-checkpoint checkbox multi-select for fresh runs (no samples yet), not just for regenerate flows — the user can generate for all or a subset of checkpoints. Select All / Deselect All are available; "Select Missing" is hidden for fresh runs (every checkpoint is missing, so it would equal Select All), and the regenerate-only controls (clear existing / missing only) stay unavailable
- All checkpoints are selected by default for a fresh run; the total-images count and the `max_study_items` limit check now reflect the current subset. Frontend-only — the created job's `checkpoint_filenames` carries exactly the selected checkpoints, and is omitted when all are selected (empty/omitted = all, preserving the prior generate-all behavior). Submit is blocked with a clear message when zero checkpoints are selected

### S-171: Move the API under /api/v1 (clean break, no legacy aliases)
- All HTTP API routes moved from `/api/*` to `/api/v1/*` as a clean compatibility break — no legacy aliases or redirects. Establishes a versioning posture before any external consumers exist (pre-release, bundled frontend is the only consumer). `/health`, `/docs` (Swagger), and the ENABLE_TEST_ENDPOINTS-gated `/api/test/*` endpoints intentionally stay unversioned
- Spans the full stack: Goa design + regenerated OpenAPI/Swagger, frontend API client base path, WebSocket path (`/api/v1/ws`) and image URLs (`/api/v1/images/*`), the dedicated nginx WS `location` block, E2E specs/fixtures, and docs (`docs/api.md`, PRD API table)

### S-165: Document the security trust model; default exposure to localhost
- Documented the trust model in a new README "Security model" section: the app has **no authentication**, so anyone who can reach the port has full read/write/delete access, and a firewall or authenticating reverse proxy is required before exposing beyond localhost
- Compose published host ports now bind `127.0.0.1` by default via `${HOST_BIND:-127.0.0.1}` in `docker-compose.yml` and `docker-compose.worktree.yml`, making LAN exposure an explicit opt-in (`HOST_BIND=0.0.0.0`) rather than the shipped default; the in-container backend bind stays `0.0.0.0` so port mapping still works. Test/e2e stacks are untouched (container-to-container, no host ports)
- `.env.example` documents the new `HOST_BIND` variable; `config.yaml.example` `ip_address` comment now explains the container-vs-host binding distinction (bind `0.0.0.0` inside Docker; host/LAN exposure is controlled at the compose layer)

### S-164: Scrub personal domains and paths from docs and test fixtures
- Replaced personal-infrastructure identifiers with documentation-reserved equivalents ahead of public release (no behavior change): `/home/rt/ai/...` example paths in `docs/filesystem.md` and `docs/spike-lora-support.md` → `/path/to/...` placeholders; `checkpoint-sampler.mcfacehead.com` → `example.com` and private `192.168.x` IPs → RFC 5737 doc ranges (`192.0.2.x`, `198.51.100.x`) across the CORS, origin-policy, config, and ComfyUI-WS test fixtures

### S-167: Vulnerability audit tooling — make audit + pre-push hook + AGENT_FLOW step; catch up current findings
- Added `make audit` (via `scripts/audit.sh`): runs govulncheck on the backend reachable set plus `npm audit --omit=dev --audit-level=high` on frontend production deps, failing on high-severity findings. Offline runs degrade to a LOUD warning and soft-skip (never a silent green pass) — network errors are distinguished from real findings by `classify_result`, with the `Vulnerability #` marker checked before the network-error patterns so a real govulncheck finding can never be misclassified as offline. govulncheck is pinned via `GOVULNCHECK_VERSION` (v1.6.0); unit tests for the classifier live in `scripts/test-audit.sh`
- Added `make install-hooks` (sets `core.hooksPath` → `scripts/git-hooks`) and a versioned `scripts/git-hooks/pre-push` that runs `make audit` before every push; both documented in the README's new "Dependency audit and git hooks" section
- AGENT_FLOW.md adds a proactive dependency-audit step to the developer verification gate — agents run `make audit` before setting `review` (mandatory when a change bumps/adds a dependency, a cheap sanity check otherwise)
- Caught up current advisories: Go toolchain bumped 1.25.6 → 1.25.12 (`.claude-sandbox/Dockerfile`, `backend/go.mod`, `go.work`); frontend lodash/lodash-es → 4.18.1, postcss → 8.5.19, nanoid → 3.3.16 with `package.json` overrides pinning lodash/lodash-es ≥4.18.1 and postcss ≥8.5.10. `npm audit --omit=dev` clean; govulncheck reachable set clear

### S-166: Frontend coverage tooling + imageCube store unit tests
- Added `@vitest/coverage-v8` devDependency and a `test:coverage` script (`vitest run --coverage`) so frontend coverage is now measurable (previously unmeasurable due to the missing dependency)
- Added a dedicated unit-test suite for the `imageCube` Pinia store (the XY-grid data backbone): dimension/axis role mapping and exclusivity, cumulative combo filtering, image-cube indexing (master/per-cell slider slice selection, grid nav, lightbox focus), and edge cases (no scan result, empty cube, single-value dimensions, flat mode). Baseline `imageCube.ts` coverage: 96.11% lines

### S-163: ComfyUI connection documentation and container networking (extra_hosts)
- Added a "Connecting to ComfyUI" section to the README: ComfyUI is a separate service the user runs, how to enable the `comfyui:` config block, the Docker-networking trap where `localhost:8188` resolves to the backend container itself (use `host.docker.internal` for a same-machine ComfyUI or a LAN IP for a remote one), the need for ComfyUI to see the same checkpoint files via its `extra_model_paths.yaml`, and offline behavior (the "ComfyUI (offline)" pill; jobs queue while disconnected and resume automatically on reconnect per S-161)
- `docker-compose.yml` backend service now sets `extra_hosts: host.docker.internal:host-gateway` so `config.yaml`'s `comfyui.url` can reach a host ComfyUI instance (Docker Desktop and Docker Engine 20.10+ on Linux); the dev overlay inherits it, and the test/e2e stacks are untouched since they use an in-stack `comfyui-mock`
- `config.yaml.example` `comfyui:` guidance expanded and its example URL changed from `http://localhost:8188` to `http://host.docker.internal:8188` so an uncomment-and-run gives a working default under Docker Compose

### S-162: README overhaul for public release — real intro, prerequisites, quick-start order, config/ports tables, E2E section
- Rewrote the README intro to describe the actual product (browse checkpoints/LoRAs, launch parameterized ComfyUI sample jobs, compare outputs in an XY grid) with a feature list and a placeholder for a real XY-grid screenshot (image tag commented out until captured; follow-up idea filed)
- Added a Prerequisites section (Docker + Compose v2, make, git; Go 1.25/Node 22 only for non-Docker dev commands) and reordered Quick start so the two `cp` config/env steps precede `make up` (aligned with the B-169 `check-config` guard)
- Reworked the Configuration section: split `.env` host-path vars (added MODEL_DIR/LORA_DIR, removed the bogus PORT row) from a new Ports table (UI 3001→3000, API/Swagger 8081→8080) with a note that `config.yaml`'s `port` is container-internal; documented `lora_dirs`, `base_model_dir`, and the `comfyui:` block, and linked docs/filesystem.md
- Corrected the E2E section — `make test-e2e` (parallel, `SHARDS=N`) and `make test-e2e-serial` (`SPEC=`); removed the nonexistent `test-e2e-parallel` target; watch targets note they require `make up-dev`. Fixed the malformed project-structure tree and removed all mcfacehead.com / private-LAN references
- Corrected CLAUDE.md's stale `make test-e2e` default from 12 shards to 4

### B-172: failItem re-read cleared activeJobID — item failures could silently drop and retry forever
- `failItem`/`failItemWithDetails` now take an explicit `jobID` captured at the event-handling site (under the lock, before unlock) instead of re-reading `e.activeJobID`. A concurrent `RequestStop`/disconnect could clear `activeJobID` in the window before the failure's blocking I/O ran, so `ListSampleJobItems("")` returned nothing, the failure was silently dropped, and the item stayed `running` — retried forever by orphan-reset for a deterministic error. All call sites now pass jobID explicitly, mirroring the completion path

### B-171: Frontend/backend contract drift — WS completeness type + 'lora' ComfyUIModelType
- `GET /api/comfyui/models` Goa enum now includes `lora`, matching the already-supported service layer (`ComfyUIModelTypeLoRA` → `LoraLoader`/`lora_name`) and the frontend `ComfyUIModelType` union — `?type=lora` no longer 400s before reaching working backend code
- WS `job_progress` payload gets its own truthful FE type `WSCheckpointCompletenessInfo` (4 fields: checkpoint/expected/verified/missing), distinct from the richer HTTP `CheckpointCompletenessInfo` (which keeps `extra`/`invalid_params`). Ad-hoc private 4-field shapes in `JobProgressPanel.vue` and `useJobProgress.ts` removed in favor of the shared type

### B-166: Transient ComfyUI connection error at submit permanently failed items instead of re-queueing
- The job executor's `SubmitPrompt` error path now mirrors the S-161 path-resolution branch: a connection error (`isConnectionError`) leaves the item pending, marks the connection dead, and clears active state so the reconnect ticker/orphan-recovery re-selects it — instead of calling `failItem`. A ComfyUI restart between the connectivity check and submit no longer turns a transient outage into a `completed_with_errors` job requiring manual retry. Genuine (non-connection) submit rejections still fail only the affected item

### B-170: goa CLI not installed or pinned — `make gen` failed on a fresh machine; Dockerfiles used @latest
- `internal/api/generate.go`'s `go:generate` directive now invokes goa via `go run goa.design/goa/v3/cmd/goa@v3.25.3` (mirroring the mockery pin), so codegen works on a clean clone with only Go installed — no pre-installed `goa` binary needed. This directive is the single source of truth for the goa CLI version (must match `goa.design/goa/v3` in go.mod)
- `backend/Dockerfile` and `Dockerfile.dev` no longer `go install goa@latest`; they run `go generate`, which resolves the pinned version, preventing silent codegen drift from upstream goa releases

### B-165: `POST /sample-jobs/{id}/start` marked a job running but the executor never adopted it
- `Start` now calls `executor.RequestResume(id)` immediately after the status write (mirroring `Resume`), so a started job is adopted synchronously instead of relying on the 1s poll tick — which only auto-starts `pending` jobs and would otherwise leave a `running` job stuck until a server restart if the API write won the race

### B-167: Default db_path `./data/` was a directory — SQLite crashed with cryptic "unable to open database file (14)"
- The `db_path` default (used when a user omits the documented-as-optional key) now resolves to the file path `./data/checkpoint-sampler.db` instead of the directory `./data/`, so a fresh start no longer fatal-crashes at pragma verification. The parent directory is auto-created (pre-existing `store.OpenDB` behavior)
- Config validation now rejects a `db_path` that ends with a trailing slash or names an existing directory, failing fast at startup with the clear message `config: db_path must be a file path`

### B-164: Delete job with data removed no files — `RemoveJobSampleDir` used stale path layout
- `Delete(deleteData=true)` reported success while removing nothing: `RemoveJobSampleDir` targeted `{sampleDir}/{study}/{checkpoint}`, a layout that stopped existing after the run-name/base-model restructuring. It now resolves the deletion root through the same `fileformat.StudyOutputDir` helper the executor writes with, so delete-with-data removes the actual output files for both checkpoint (`{run}/{study}/{checkpoint}`) and LoRA (`{run}/{study}/{baseModel}/{checkpoint}`) layouts (same root-cause family as B-163)
- The remover interface was widened to take the training run name and base model, and a separator-bounded path-containment guard rejects any target that resolves outside `sample_dir` (e.g. a `..` study name)
- Testing: backend unit coverage for both layouts, slash-bearing run-name sanitization, and traversal rejection; a new `job-delete.spec.ts` E2E asserts delete-with-data actually drops sample availability to `none` on disk (previously only the 204 status was checked)

### B-169: Fresh-clone `make up` created config.yaml as a directory and crash-looped — added guard and fixed Quick start order
- `make up` and `make up-dev` now depend on a `check-config` preflight guard that fails fast (before `docker compose up`) when `config.yaml` or `.env` is missing — or when `config.yaml` is a stray directory Docker left behind from bind-mounting a nonexistent source. The error names the exact `cp config.yaml.example config.yaml` / `cp .env.example .env` command to run
- README Quick start now lists the two `cp` steps before `make up`, so a fresh clone never triggers the directory-creation crash loop

### B-168: SAMPLE_DIR mounted read-only in prod compose — sample generation, thumbnails, and demo install all fail
- The flagship `make up` path mounted `${SAMPLE_DIR}:/data/samples:ro`, but the sample executor, thumbnailer, and first-run demo installer all write there — so under `make up` a new user got a blank app (demo install failed as a Warn-level log only). The prod `docker-compose.yml` sample mount is now `:rw`, matching the dev stack; checkpoint/model/lora mounts remain read-only security boundaries
- Corrected stale "mounted read-only" claims for `sample_dir` in README.md, CLAUDE.md, and .env.example — the app writes generated samples, thumbnails, and demo data there

### B-163: Missing-only sample jobs regenerated everything — creation check used stale output path layout
- The missing-only creation filter probed `{sampleDir}/{study}/{checkpoint}/{file}`, but the executor writes to `{sampleDir}/{sanitizedRun}/{study}[/{baseModel}]/{checkpoint}/{file}` (via `fileformat.StudyOutputDir`). The probe never matched on-disk files, so `missing_only` jobs silently regenerated every sample. Creation now resolves expected paths through the same `fileformat.StudyOutputDir` helper the executor uses, so existing samples are detected (including sanitized run names and the LoRA base-model directory level)
- LoRA strength encoding (`strength_model`/`strength_clip`) in output filenames is now keyed on a new `FilenameDimensions.LoRA` flag (derived from `job.BaseModel` / the job's LoRA kind) instead of the per-item `LoraModelPath`, which S-161 leaves empty at creation time. Creation-time and executor-written filenames now agree, so missing-only LoRA jobs correctly skip existing samples
- Testing: added backend unit coverage for missing-only detection of both checkpoint (sanitized run dir) and LoRA (base-model dir, strength-keyed filenames) jobs laid out in the executor's exact on-disk structure

### B-162: Job progress Completeness reported 0/N missing for LoRA jobs
- The executor computed the study output directory in three places and only the image-write site appended the `base_model` level. `fileformat.StudyOutputDir(trainingRunName, studyName, baseModel)` is now the single source of truth; the image write, manifest write, and completeness check all route through it, so the completeness check reads `{sampleDir}/{run}/{study}/{base_model}/{checkpoint}/` and `manifest.json` lands beside the checkpoint image directories rather than one level above
- Non-LoRA jobs (`base_model` empty) resolve to the same `{run}/{study}` path as before. Manifests written before this fix stay at the old location and continue to fall back to count-based validation via `ErrManifestNotFound` — no read-side fallback was added, deliberately, so that only one manifest location is ever valid
- Testing: `comfyui-mock` now serves `object_info/LoraLoader` (seeded from `LORA_FILENAMES`), without which no LoRA job could reach completion under E2E; new `lora-job-completeness.spec.ts` drives a LoRA job to completion and asserts N/N verified with no missing lines

### S-161: Queue sample jobs when ComfyUI is offline — resolve checkpoint paths lazily at execution
- `SampleJobService.Create` no longer path-matches checkpoints against ComfyUI's live model list at creation time, so launching a job while ComfyUI is unreachable now succeeds and persists a pending job with all items pending (removing the misleading "all N items failed checkpoint path matching — no checkpoints could be resolved" whole-job rejection). Path resolution moves to execution time: the job executor's `processItem` resolves `ComfyUIModelPath`/`LoraModelPath` lazily for items with empty paths (wired via `SetPathMatchers`)
- Connection errors are now distinguished from genuine misses via a typed `ErrCheckpointNotResolved` sentinel classified with `errors.Is`/`isConnectionError`: an unreachable-ComfyUI error at resolution leaves the item pending and marks the connection dead so the existing reconnect ticker retries it when ComfyUI returns; a genuine "checkpoint absent" miss (ComfyUI up) fails only that item and the job finishes `completed_with_errors`. The frontend launch dialog no longer surfaces a path-match error when ComfyUI is offline — the job appears queued
- Testing: added backend unit coverage for offline-create success, connection-error-leaves-pending → reconnect → drain, and genuine-miss-fails-item (checkpoint and LoRA). QA added an E2E spec (`job-queue-comfyui-offline.spec.ts`) plus an always-on control plane on the ComfyUI mock to simulate a true TCP-level outage for the offline→reconnect→drain journey

### S-160: XY grid prompt-dimension headers show the full prompt text on hover
- When the prompt dimension (`prompt_name`) is on the X or Y axis, the XY grid headers rendered only the short prompt name (e.g. `forest`) with the full prompt text invisible anywhere in the grid. Column and row headers are now wrapped in a Naive UI `NTooltip` that reveals the full prompt text on hover, gated on dimension identity so non-prompt dimensions (steps, cfg, sampler, …) show no tooltip
- The name→text lookup is sourced from the active training run's study: `App.vue` fetches saved studies on mount and derives an `activeStudyPromptTextMap` by matching `study_label` to `Study.name`, threaded into `XYGrid` via a `promptTextMap` prop. A value with no matching prompt (renamed/removed) shows no tooltip and never errors; the existing header:click selection is preserved through the tooltip trigger slot. Frontend-only

### S-159: Display total runtime per job in the job list (live-ticking while running, fixed when terminal)
- The job list (`JobProgressPanel`) now shows each job's total runtime derived from the existing `created_at`/`updated_at` timestamps — no schema change. Running jobs tick a live elapsed timer (`now - created_at`) via a shared 1-second ticker (`useJobRuntimes` composable) that only runs while a job is active and tears down on unmount; terminal jobs (`completed`, `completed_with_errors`, `failed`, `stopped`) show a fixed `updated_at - created_at` total
- Duration is formatted human-readably by a pure `formatElapsedDuration` helper: `mm:ss` under one hour, `h:mm:ss` at/beyond one hour (negative/non-finite clamped to 0). Frontend-only; the runtime cell carries a `data-testid="job-{id}-runtime"` for testability. Runtime is approximate (includes queue-wait; `updated_at` ≈ completion time) — an accepted tradeoff to avoid a migration

### B-161: Checkpoint slider omits the final epoch (100) — assignFinalCheckpointStep now recognizes 'epochs-N' run-name tokens
- The final unsuffixed checkpoint in a training run whose name encodes epochs (e.g. `...-epochs-100-...`) was assigned the max numbered-checkpoint step (90) instead of 100, colliding with the real epoch-90 checkpoint and hiding the final epoch on the checkpoint slider. Root cause: `assignFinalCheckpointStep` (backend `internal/service/discovery.go`) only scanned the run name for a `steps?-(\d+)` token; `epochs-100` never matched
- Fix: the resolver now also matches `epochs?-(\d+)` in the run name, taking the max across the steps token, epochs token, and numbered-checkpoint max. The final checkpoint resolves to StepNumber 100 and sorts after epoch 90. Existing `steps-N` detection and the no-token maxStep fallback are unchanged. Backend-only fix — the slider renders directly from discovered checkpoints; QA added `frontend/e2e/checkpoint-final-epoch.spec.ts` plus fixture checkpoints to cover the discovery→slider journey

### B-160: Generate Samples dialog validation shows 0/720 — study-scoped validation now uses the shared output-dir resolver
- Fixed the Generate Samples (JobLaunchDialog) validation totals reporting `0 / N` for a completed run whose samples were all present on disk, while the left-panel "Validate" slideout and availability beads correctly reported `N / N`. Root cause: the `study_id` (dialog) validation path in `TrainingRunsService.Validate` reconstructed the sample output dir as `{sanitize(run)}/{study}`, omitting the `{base_model}` level that LoRA runs write into (`{sanitize(run)}/{study}/{base_model}`); the manifest was therefore not found at the guessed path and validation fell back to study-config counting against a non-existent directory
- Both validation entry points now converge on one shared core: `resolveStudyOutputDir` resolves the canonical on-disk sample dir via viewer discovery (the same source the slideout draws its `StudyOutputDir` from — exact `{run}/{study}` match, else `{run}/{study}/{base_model}` prefix match, else the naive path for pre-generation), and `validateSampleSet` is the single manifest-first "actual vs expected" validator shared by the dialog and slideout paths so they can no longer diverge. Backend-only fix; the frontend already passed `studyId` correctly
- Fixed a UAT defect where the same-host WebSocket `CheckOrigin` policy rejected the `/api/ws` upgrade in the `make up-dev` stack, silently breaking all live job-progress streaming (status, percent complete, images/total, per-image inference progress, and ETA) while REST-persisted aggregate progress still rendered on refresh. Root cause: the Vite dev proxy's `/api` block set `changeOrigin: true`, rewriting the forwarded `Host` to `backend:8080` so the browser `Origin` hostname could never match. Removed `changeOrigin` from the `/api` proxy (kept on non-WS `/health`/`/docs`) so the real Host is forwarded and `Origin==Host`; added an explanatory comment to prevent reintroduction. Added `originAllowed` regression entries covering the dev LAN-IP same-host allow (including proxy-to-backend-port) and cross-host reject cases. Deployments behind a Host-rewriting proxy must use the documented `allowed_origins` override

### S-158: Label LoRA strength-pair inputs (Model vs CLIP) in StudyEditor
- `StudyEditor.vue` now renders a persistent "Model" / "CLIP" column header above the LoRA Strength Pairs inputs, replacing reliance on `NInputNumber` placeholders that vanished once the default 1.0 values were set. Labels use `var(--text-secondary)` and stay visible regardless of input state. Added unit tests (persistent visibility at default values and after adding rows) and an E2E assertion in `lora-strength-pairs.spec.ts`

### S-157: Promote Resolution, VAE, Text Encoder, and Shift to multi-value study dimensions
- Studies now sweep across four new list dimensions in addition to Steps/CFGs/Seeds/LoRA pairs: `Resolutions []ResolutionPair` (paired width/height), `VAEs []string`, `TextEncoders []string`, and `Shifts []float64`. The domain model's `ImagesPerCheckpoint`/`ImagesPerCheckpointLoRA` multiply by each non-empty dimension via a shared `DimMultiplier` helper (empty list = factor 1), and the service-layer sample-job expansion produces the full cross-product across all non-empty dimensions
- Persistence: migration v28 adds JSON list columns and backfills existing rows — `width`/`height` wrap into a single-element `resolutions` list; `vae`/`text_encoder`/`shift` backfill to single-element lists or empty (`[]`) when the prior scalar was NULL/empty. Existing single-value studies load and behave identically. The Goa study create/update payload and response carry the four fields as lists (scalars replaced; codegen regenerated), and the S-153 50k work-item cap validation counts the new dimensions
- The job executor substitutes the per-item resolution/VAE/text-encoder/shift into the workflow (role-gated: a workflow lacking a role never substitutes stored values) and records each value in the per-image sidecar/manifest; the scanner surfaces them as `ScanDimensions` assignable to X/Y/slider grid roles only when a study actually sweeps more than one value
- Frontend: `StudyEditor.vue` renders a paired `{width,height}` dynamic resolution list, multi-value VAE/TextEncoder selectors, and a numeric multi-value Shift list — each gated by the selected workflow's declared roles (`vae_loader`/`clip_loader`/`shift`). MRU localStorage and study import validation accept the new list shapes and wrap legacy scalar imports into single-element lists; `DimensionPanel` and dimension filters expose the four new axes for assignment and filtering

### R-020: Frontend cleanups — single grid-cell image resolution; deterministic test fixture IDs
- `XYGrid.vue` now precomputes a `cellImageMap` (cellKey → image) that calls the store's `getImage()` exactly once per cell per render; the template's local `getImage()` helper reads from that map as an O(1) `Map.get()` instead of re-hitting the store for both the relative-path and thumbnail-path bindings. Behavior-preserving refactor — grid rendering output is unchanged (full E2E grid specs green)
- Removed `Math.random()` from frontend test fixture IDs (`dualBeadStatus.test.ts`, `useSampleAvailability.test.ts`) in favor of a per-test counter reset in `beforeEach`, satisfying TEST_PRACTICES §4.1 determinism

### B-159: job_executor no longer logs "sql: no rows in result set" at error for orphaned items
- When a sample-job item's ComfyUI completion event lands after its parent job row has been deleted (e.g. the E2E `/api/test/reset` race), `handleItemCompletionAsync` now treats the `GetSampleJob` `sql.ErrNoRows` result as a benign orphaned-item case: it logs at debug, clears active item/prompt state, and returns without force-failing the item. Genuine (non-not-found) fetch errors still log at error and fail the item. Eliminates the spurious `failed to fetch job for output path` / `marking item as failed` error-level noise during E2E runs without broadening the W-006 schema-missing allowlist

### S-155: Stable training-run identifiers (survive rescans)
- Training-run resource IDs are now opaque, stable strings derived from each run's relative-path name (URL-safe base64 via `base64.RawURLEncoding`) instead of a zero-based positional index. A held ID resolves to the same run across rescans even when discovery order changes — the backend recomputes and matches IDs (`service.FindTrainingRunByID`) rather than indexing by position, eliminating the bug where a refresh could reorder discovery and silently retarget a different run
- API contract: `GET /api/training-runs` emits the opaque ID; scan, validate, and study-availability endpoints resolve by it and return `not_found` for unknown IDs. The frontend treats IDs as opaque strings throughout and discards legacy numeric IDs persisted in localStorage. Documented in `docs/api.md`

### R-019: Extract sample-availability and job-progress logic into tested composables
- The Generate Samples dialog's sample-availability/bead derivations move out of `JobLaunchDialog.vue` into a new `frontend/src/composables/useSampleAvailability.ts`, and App.vue's three manually-synced job-progress maps (`jobProgress`, `inferenceProgress`, `prevCheckpointProgress`) plus their WebSocket handlers move into `frontend/src/composables/useJobProgress.ts`. The synchronization invariants that previously lived only in inline comments referencing past regressions (B-067 placeholder-init, S-098 ETA-preservation, B-105 terminal-status, flip-flop guard) are now encoded as unit tests
- `JobLaunchDialog.vue` collapses its separate `selectedTrainingRunId` watchers into a single consolidated watcher delegating to an extracted init helper; execution order and the deliberate keep-stale-on-refresh behavior are preserved. Behavior-preserving refactor — render functions, templates, CSS, and bead `data-testid`s are untouched, so PRD 5.5.1 bead rendering is pixel-identical (bead/progress E2E specs unchanged and green). Adds 69 composable unit tests covering the PRD 5.5.1 precedence tables and the ETA/transition rules

### W-029: Adopt mockery for service-layer mocks (migration, part 2 of 2)
- Completes the mockery migration started in W-028 by moving the service-layer test doubles for the two genuinely call-based collaborators (`ObjectInfoGetter`, `SampleDirRemover`) onto deterministic mockery-generated mocks in a new committed `backend/internal/service/servicemocks` package, wired through a per-package `backend/.mockery.yaml` config. The `comfyui_models_test.go` `nodeType` assertions and the `job_executor_test.go` `cp1→cp2` removal ordering are preserved via `RunAndReturn` closures and `.Once()`/`.NotBefore()` expectations — behavior-preserving, no weakened assertions
- The remaining hand-rolled service doubles are stateful data stores, active event drivers, fixture holders, or implement unexported / Goa-generated-package interfaces that mockery's call-recorder API cannot express; they are renamed `fake*` (so no `type mock` struct remains in backend test files) with the exception justified in-code. Test-tooling only — no production behavior changed

### R-018: Split job_executor.go into cohesive units
- `backend/internal/service/job_executor.go` (2,459 lines) split within the same `service` package into four responsibility-scoped files: `job_executor_lifecycle.go` (start/stop/pause/resume/run loop), `job_executor_conn.go` (ComfyUI WS connect/reconnect, stuck-item recovery, event handling), `job_executor_workflow.go` (workflow substitution, output paths, image download/save), and `job_executor_progress.go` (item failure, progress, completion, broadcast). Primary file now 273 lines (interfaces, struct, constructors, package-level helpers)
- Pure code movement, no behavior change: 54/54 top-level declarations byte-identical to the original (AST+SHA256 verified); public package API unchanged; all backend suites and the full E2E suite pass with no assertion modifications

### M-003: Docs refresh part 3 — filesystem.md, ui.md, workflows.md + PRD config sync
- `docs/filesystem.md` per-training-run layout is corrected to match the job executor's output-path construction: the study directory level uses the study's display name (`study.Name`), not a UUID; LoRA jobs insert an extra `base_model_name` level (`{run}/{study}/{base_model_name}/{lora_checkpoint.safetensors}/`) only when a base model is set, while the manifest stays at the study level above it. Per-image `.json` sidecars and the `thumbnails/` JPEG subdirectory are now documented, with separate checkpoint-job and LoRA-job tree examples
- `docs/ui.md` gains a verified 1:1 component inventory (all 23 `frontend/src/components/*.vue` files with accurate purposes); the status-bead system is documented as rendered inline only by `JobLaunchDialog.vue` via `composables/dualBeadStatus.ts` (not a standalone component, and not `TrainingRunSelector.vue`, which renders a kind badge). `docs/workflows.md` cs_role table is reconciled with `KnownCSRoles()`/`substituteNode` — adds the `lora_loader` role, `batch_size` (forced to 1) on `latent_image`, and corrects the stale `negative_prompt` claim (the text IS injected when non-empty)
- PRD section 4 config example adds `max_request_size_mb` (200), `max_study_items` (50000), and `allowed_origins` (empty) with accurate defaults from `internal/config`. Docs-only change — no production code modified

### M-002: Docs refresh part 2 — api.md regenerated from the Goa design
- `docs/api.md` is rewritten from the Goa DSL (`backend/internal/api/design/*.go`) as source of truth, eliminating documented drift. The prior doc listed only 4 of the 13 service groups; the refresh now documents all 13 (health, docs, training_runs, studies, sample_jobs, presets, images, checkpoints, base_models, comfyui, workflows, demo, ws) with a per-service endpoint reference enumerating every method's HTTP verb, path, result, and declared errors — cross-checkable 1:1 against the design package
- The error-code section now matches the R-016 canonical vocabulary exactly (`internal_error`/500, `not_found`/404, `invalid_payload`/400, `invalid_state`/400, `too_many_items`/422, `service_unavailable`/503) and corrects the wire envelope to the Goa default `name` field. The false `Format()` validation claim is removed — the doc now lists only the directives the DSL actually uses (Required/Enum/MinLength/Minimum/Default)
- Content-type handling is corrected from the stale PNG-only claim to runtime sniffing via `http.DetectContentType` (with a thumbnails subsection), CORS is documented as middleware rather than DSL, and the WebSocket section is expanded with the `inference_progress` event. Docs-only change — no production code modified

### W-028: Adopt mockery for api-layer mocks (tooling + migration, part 1 of 2)
- Mocks for Go interfaces are now generated by mockery (v3, pinned to `v3.7.1` in `backend/Makefile`) instead of hand-rolled, eliminating the drift risk where a stale mock keeps passing while its interface changes. A new `backend/.mockery.yaml` config and a `make mocks` target (`go run github.com/vektra/mockery/v3@<version>`, no container rebuild needed) regenerate the four api-layer interface mocks (`ComfyUIHealthChecker`, `ComfyUIModelLister`, `WorkflowLoader`, `PingableConn`) deterministically into the committed `backend/internal/api/apimocks` package
- The api-layer test files (`comfyui_test.go`, `workflows_test.go`, `ws_test.go`) drop their hand-rolled mock types in favor of thin helper constructors wrapping the generated testify mocks; behavior is preserved (`.Maybe()` keeps the prior lenient, no-call-count-assertion semantics). Mockery is deliberately not pointed at the generated `internal/api/gen` package — the one mock of a Goa-generated stream interface stays hand-rolled. The store layer had no hand-rolled mocks to migrate; the service layer is deferred to W-029
- TEST_PRACTICES.md section 2.1.1 documents the generation workflow (config, pinned version, command, mock location, determinism, codegen ordering). Test-tooling only — no production behavior changed

### S-156: Schema hardening — status CHECK constraints; move business default out of DDL
- Migration 27 rebuilds `sample_jobs` and `sample_job_items` to add `CHECK (status IN (...))` constraints, so an invalid status (previously possible from a code bug since enums were wire-enforced only) now fails at the DB layer. The constraint value lists match the model status constants exactly (`sample_jobs`: pending/running/stopped/completed/completed_with_errors/failed; `sample_job_items`: pending/running/completed/failed/skipped). SQLite cannot `ALTER TABLE ADD CONSTRAINT`, so the migration follows the existing table-rebuild pattern; it drops the child table before the parent and points the staging child FK at the staging parent to prevent `ON DELETE CASCADE` from wiping rows during the rebuild, preserves all rows/columns, and recreates the B-149 indexes
- The LoRA strength business default now lives in the service layer: `expandJobItems` (and `study.go`) seed `{StrengthModel: 1.0, StrengthClip: 1.0}` for new items, and the DDL `DEFAULT 1.0` on migrations 24/25 is annotated as legacy. No behavior change for existing rows
- Store tests cover migrating a populated DB (rows intact, invalid-status inserts rejected post-migration) plus `DescribeTable` coverage of every valid status value for both tables

### M-001: Docs refresh part 1 — architecture.md + database.md regenerated from implementation
- `docs/architecture.md` and `docs/database.md` are rewritten from the code as source of truth, eliminating documented drift. Both docs previously described TOML config (the backend uses YAML via `internal/config/config.go`); all TOML references are gone and the config section now matches the `yamlConfig` struct field-by-field (top-level, `comfyui`, and `thumbnails` keys with defaults and validation), including `max_request_size_mb`, `allowed_origins`, `max_study_items`, `ws_ping_interval`, and the thumbnail keys
- `docs/database.md` now documents the full final SQLite schema (presets, studies, sample_jobs, sample_job_items — every column, default, FK, and index) derived from `internal/store/migrations.go` through v26, plus a migration-history summary and the forward-only/recreate migration strategy. The stale claims (DB persists only presets; a `studies.version` column) are corrected — `studies.version` existed transiently (v12 add, v13 drop) and is noted as not in the final schema
- The architecture layer diagram now covers every `internal/` package (api, service, store, fileformat, model, config, buildinfo, testutil); image serving is documented as content-type-detected at serve time (512-byte `http.DetectContentType`) with JPEG thumbnails, and graceful-shutdown ordering is described. Docs-only change — no production code modified

### W-027: Replace sleep-based negative assertions in watcher/ws tests with deterministic synchronization
- The four fixed-`time.Sleep` negative assertions in `service/watcher_test.go` and `api/ws_test.go` are replaced with deterministic synchronization. The three watcher tests use a sentinel-event pattern: the suppressed event is followed by a PNG-create sentinel that *should* broadcast, and `waitForEvents(1, …)` confirms only the sentinel arrived (single-goroutine, in-order channel processing guarantees the suppressed event was already handled). The zero-ping-interval test invokes the configurer's no-op path directly instead of sleeping. Eliminates flake-under-load and silent false-passes (TEST_PRACTICES 1.2/4.3); test-only change, no production behavior modified

### S-152: Cap concurrent WebSocket clients in the hub
- The WebSocket hub now enforces a fixed cap of `MaxHubClients = 100` concurrent clients (no config key at this scale). `Hub.Register` returns `false` when at capacity (atomic with the map write under the same lock — no TOCTOU); `ws.go Subscribe` rejects the connection by closing the write pump + stream and returning a capacity error. Disconnects free capacity (cap is on concurrent clients, not lifetime), preventing any LAN device from exhausting goroutines/memory by opening connections in a loop

### R-017: Move image-serving filesystem logic out of the API layer behind a store interface
- The path-traversal security boundary for image serving now lives in the store layer: `FileSystem.OpenImageFile(sampleRoot, relPath)` ports the prior `isPathSafe` validation (per-component `..`/`.` rejection, absolute-path rejection, and the S-154 separator-bounded prefix check) verbatim, does the `os.Stat`/`os.Open`, and returns an `ImageFile` (`io.ReadSeekCloser` + size) or the `ErrInvalidImagePath`/`ErrImageNotFound` sentinels. This restores the architecture.md layer boundary (filesystem access belongs to the store) and gives the security check a unit-test seam it previously lacked
- `api/images_service.go` is now a thin streaming adapter behind the consumer-defined `ImageFileResolver` interface — no `os.*`/`filepath.*` calls remain. Behavior is byte-identical: same status mapping, `Cache-Control: max-age=31536000, immutable`, 512-byte `http.DetectContentType` sniff (seek-back-to-start), Content-Length, and `io.Copy` streaming. Error messages still omit absolute paths (R-015 preserved)
- New store-layer `DescribeTable` tests cover `..` traversal, absolute paths (including absolute-inside-root), sibling-prefix dirs (`samples-evil` vs `samples`), clean valid paths, not-found, dir-as-file, the partial-read+seek sniff path, and no-path-leak

### S-154: Path-handling hardening — separator-bounded write check and study-name dot rejection
- `getOutputPath` write-path containment is now separator-bounded (`sampleDir+separator`), closing a latent sibling-prefix bypass (e.g. `/data/samples-evil` no longer passes a check scoped to `/data/samples`); mirrors the existing READ-path pattern
- Study-name validation now rejects pure-traversal components (`.`, `..`) and leading/trailing-dot names; inner dots (e.g. `v1.2`, `a..b`) remain valid

### R-016: Unify Goa error vocabulary across services in the design DSL
- Defined one canonical error code per failure class across every service (documented in `internal/api/design/errors.go` and `docs/api.md` §5.3): `internal_error` (500), `not_found` (404), `invalid_payload` (400), `invalid_state` (400), `too_many_items` (422), `service_unavailable` (503). Collapsed the per-service synonyms (`scan_failed`/`discovery_failed`/`validation_failed` → `internal_error`; `bad_request`/`invalid_filename` → `invalid_payload`) so the frontend can rely on stable codes without per-service special-casing
- `comfyui.models` previously swallowed all failures into an empty list (ComfyUI outages surfaced as unmapped 500s); it now declares and returns `service_unavailable` (503) for connection failures (`net.Error`/`net.OpError`/context deadline) and `internal_error` (500) otherwise. `sample_jobs.create` gained `internal_error` for discovery/DB failures. Every frontend caller already tolerates a thrown error with a static fallback list, so UX is unchanged — only the HTTP status is now correct
- Frontend `ApiErrorCode` union type (`frontend/src/api/types.ts`) documents the canonical codes plus the client-side `NETWORK_ERROR`/`UNKNOWN_ERROR`

### W-030: Unit tests for destructive filesystem helpers and uncovered store queries
- Added store-layer unit tests locking down the six previously-0%-coverage destructive/listing helpers in `store/filesystem.go` (`RemoveSampleDir`, `RemoveStudyDir`, `RemoveJobSampleDir`, `RemoveCheckpointOutputDir`, `CleanStudyDirs`, `ListSubdirectories`) plus `GetStudyByName`/`HasRunningJob`; store coverage 66.2% → 72.3%, deletion helpers now 75–93%. Test-only — no production code changed
- Tests empirically confirmed (and pin via `DOCUMENTS traversal gap` cases) a real path-traversal gap: the Join-based helpers (`RemoveSampleDir`/`RemoveStudyDir`/`RemoveJobSampleDir`) do not reject `..`/empty name components, so they can delete outside the sample root. Filed for a dedicated hardening story (see `agent/ideas/enhancements.md` "Centralized Path Sanitization"); `RemoveCheckpointOutputDir` is the safe `filepath.Base` pattern

### R-015: Replace string-matched error handling with typed errors; stop leaking absolute paths in API errors
- The service layer now defines sentinel errors (`internal/service/errors.go`: `ErrNotFound`, `ErrInvalidFilename`, `ErrInvalidPath`, `ErrManifestNotFound`, `ErrServiceUnavailable`) that service methods wrap with `%w`. API handlers classify failures to HTTP statuses via `errors.Is`/`errors.As` instead of `strings.Contains(err.Error(), ...)`, so rewording an error message can no longer silently change a status code. Goa error result types and status codes are unchanged
- `job_executor.go` `isConnectionError` no longer substring-matches lowercased error text (`"timeout"`/`"network"`/`"eof"`); it uses typed checks (`net.Error.Timeout()`, `context.DeadlineExceeded`, `*net.OpError`, `syscall.Errno` ECONNREFUSED/ECONNRESET/EPIPE/etc., `io.EOF`). A ComfyUI node error whose text merely mentions "network" no longer triggers a bogus reconnect cycle
- API error responses for not-found/invalid-path/manifest-not-found no longer embed absolute server filesystem paths; the detailed path is logged server-side only

### R-014: Fix service-to-store layering breach: ObjectInfo belongs in model
- `ObjectInfo`/`ObjectInfoInput` now live in `internal/model` (no serialization tags) as the domain representation. The store keeps a json-tagged DTO (`objectInfoEntity`) for decoding ComfyUI's `/object_info` HTTP response and maps it to the model type via `toModelObjectInfo`. The service's consumer-defined `ObjectInfoGetter` interface is now typed over the model type. Removes the last `internal/service` → `internal/store` import, restoring the architecture.md 2.1 / DEVELOPMENT_PRACTICES 2.3 layer separation. No behavior or wire-format change

### S-151: Restrict WebSocket origin and CORS to same-host with allowed_origins config override
- The WebSocket upgrader `CheckOrigin` and the CORS middleware now share one `originAllowed` policy: requests with no `Origin` header are allowed (curl/non-browser/same-origin), and an `Origin` is accepted only when its hostname equals the request `Host` hostname (scheme and port ignored, case-insensitive, exact match — no substring/suffix bypass). Cross-host origins are refused (WS upgrade rejected; CORS headers omitted). CORS now echoes the allowed `Origin` with `Vary: Origin` instead of `*`, and cross-host preflights return 403. Closes the prior always-true `CheckOrigin` / `CORSMiddleware("*")` hole that let any LAN webpage stream prompts/paths or make cross-origin mutations (DNS-rebinding exposure)
- New optional config key `allowed_origins` (list of full origins or bare hostnames, default empty) extends the allowlist for reverse-proxy/dev-proxy setups that rewrite the `Host` header (e.g. Vite's `changeOrigin`); documented in `config.yaml.example`. Default same-host behavior is unchanged, so Caddy deployments that preserve `Host` and same-host LAN/IP access keep working with no config

### S-153: Cap study total work items at 50k (config-overridable) with backend and frontend validation
- New config key `max_study_items` (default 50000; `<=0` rejected at config load) caps the Cartesian product of work items; job creation rejects oversized jobs with a stable `too_many_items` error (HTTP 422) carrying the computed total and the limit, and study save catches oversized per-checkpoint products early
- New `GET /api/config` endpoint exposes UI-relevant limits (`{ max_study_items }`); the launch dialog fetches it and disables launch with a total-vs-limit message when exceeded

### S-150: Limit HTTP request body size (200MB default) with config override
- New `RequestBodyLimitMiddleware` (applied outermost) rejects oversized requests: a `Content-Length` over the limit short-circuits to a `413` with the normalized Goa error envelope; bodies without `Content-Length` are capped via `http.MaxBytesReader` (a chunked overrun surfaces as Goa's decode error). No response buffering — image downloads and WebSocket upgrades pass through untouched
- New config key `max_request_size_mb` (default 200 when unset; `0`/negative rejected at config validation); `MaxHeaderBytes` set to 1MB on the HTTP server

### B-158: API client surfaces raw error-response bodies in user-facing messages
- `normalizeError` (`frontend/src/api/client.ts`) no longer appends the raw non-JSON response body to the `UNKNOWN_ERROR` message in production — the body snippet is now gated behind `import.meta.env.DEV` and truncated to 200 chars (with an ellipsis), so backend internals (paths, stack fragments) can no longer leak into the UI. The error shape (`{ code, message }`) and the stable `UNKNOWN_ERROR` code are unchanged for consumers
- Added unit tests covering prod mode (no body in message), dev mode (truncated body present), and the 200-char truncation boundary

### B-157: Shutdown race: HTTP server Shutdown runs concurrently with deferred close of store/watcher/executor
- Graceful shutdown is now deterministically ordered and blocking: `run()` waits on a `shutdownDone` channel before returning, so DB/notifier closes can no longer fire while in-flight requests are still draining. A new `performShutdown` (`cmd/server/shutdown.go`) stops background workers (job executor → watcher → fsState) first, then drains HTTP via `srv.Shutdown`, replacing the previous fire-and-forget goroutine + incidental LIFO `defer` ordering. Eliminates "database is closed" errors on SIGTERM during in-flight requests

### B-156: Metadata parsers allocate up to 100MB from corrupt-file-declared lengths; guard branches untested
- Lowered the safetensors header and PNG metadata-chunk caps from 100MB to 16MB (real headers/chunks are KBs to low MBs), and the safetensors parser now validates the declared header length against the actual file size (via a `Stat()` type-assertion satisfied by `*os.File`) before `make([]byte, headerLen)` — a corrupt/malicious tiny file declaring a near-cap length no longer triggers an eager large allocation; it is rejected with a clear error first
- Added rejection-branch unit tests (over-cap header length, header length exceeding file size, over-cap PNG chunk)

### B-155: Image preloader never reacts to combo-filter changes and restarts full preload on every retrigger
- The preload `watch` now keys on a serialized signature of `comboSelections` (sorted dim→values) instead of the reactive object reference, so combo-filter changes — which mutate keys in place on a stable-identity computed — actually retrigger prioritization of newly-visible cells. The old shallow watch never fired on in-place mutation, silently degrading the instant-slider guarantee
- Retriggers no longer call `preloaded.clear()`: the existing `has(url)` guard skips already-cached URLs so only newly-visible URLs are fetched, and the in-flight `Image` is now wired to the cycle's `AbortSignal` so a superseded cycle yields promptly instead of waiting on a stale load

### B-152: recoverStuckItems races the executor ticker — duplicate ComfyUI submissions after reconnect
- Reconnect recovery (`recoverStuckItems`) now compare-and-acts under `e.mu`: it snapshots each stuck item's prompt ID before its `GetHistory` I/O, then re-reads the item's current state under the lock (`findItemLocked`) and only resets-to-pending (`resetItemToPendingIfUnchanged`) or claims the active slot (`claimRecoveredItem`) when the stored prompt ID still matches the snapshot. Previously recovery mutated from a stale snapshot, so an item the executor ticker had re-submitted with a fresh prompt ID during the disconnect window could be reset/claimed against the old prompt ID — orphaning the in-flight prompt and causing a duplicate ComfyUI submission
- Removed the dead `stopRequested` field, its unreachable `processNextItem` guard, and both `= false` assignments (it was only ever set false — a cooperative-stop guard that never engaged)

### B-154: Frontend WebSocket composable leaks connection and listeners on unmount/HMR
- `useWebSocket` now registers an `onScopeDispose` (guarded by `getCurrentScope()`) that deregisters its own `onConnectionChange`/`onEvent` listeners and calls `wsClient.disconnect()` on scope teardown. Previously the composable had no cleanup, so on unmount/HMR the socket stayed open and the exponential-backoff reconnect timer fired `doConnect()` forever, accumulating zombie connections. `WSClient.disconnect()` already cancels the pending reconnect timer (no change needed there)

### B-151: Single 10s HTTP timeout on all ComfyUI calls — image downloads fail and completed generations are lost
- Removed the client-wide `http.Client{Timeout: 10s}` on the ComfyUI HTTP client (it bounded the entire request including body read, so a large PNG or a GPU still streaming the image failed `DownloadImage`'s `io.ReadAll` and lost an already-generated image). Each call now wraps a per-operation `context.WithTimeout` derived from the caller's context: control-plane calls (health, queue, submit, object_info, cancel) get 10s; `DownloadImage` and `GetHistory` get 120s. Caller context cancellation still aborts in-flight requests
- Timeout budgets are named constants documented in code; budgets are injectable for deterministic unit tests (no real-time sleeps in the suite)

### B-149: Job list endpoint loads every item row of every job (N+1) and sample_job_items has no indexes
- The job list endpoint now computes per-job progress with a fixed set of aggregate queries instead of an N+1 of `GetProgress` calls that loaded every item row of every job on each poll. New `Store.ListJobsProgress()` runs one `SELECT job_id, status, COUNT(*) ... GROUP BY job_id, status` aggregate plus a single targeted query of only failed/skipped rows to rebuild per-checkpoint failure details — completed/pending rows are never materialized. Progress numbers stay identical to the show/detail view (parity preserved per B-148)
- Migration 26 adds indexes on `sample_job_items(job_id)`, `(job_id, status)` (backs the list aggregate), and `(job_id, created_at)` (backs the executor's ordered item listing) — previously `sample_job_items` had no indexes, so every item query was a full table scan

### B-153: fsnotify watches leak on every training-run switch — live updates eventually stop
- The training-run `Watcher` now tracks its active watch set (`watched` map) and removes every previously-registered inotify watch in `stopLocked()` when switching runs — both static checkpoint-directory watches and dynamically-added per-image-directory watches route through a single `addWatch` helper, so none are leaked. Previously each run switch accumulated inotify descriptors on the shared `fsnotify.Watcher` until `max_user_watches` was hit, after which `Add` silently failed and live updates stopped
- Stale events from a prior run's directories no longer reach the event loop after a switch (their watches are gone), eliminating cross-run event delivery

### B-148: completed_items counter races (lost updates) and diverges between job list and detail views
- New `Store.RecalculateCompletedItems(jobID)` derives the stored `completed_items` counter atomically in a single `UPDATE sample_jobs SET completed_items = (SELECT COUNT(*) FROM sample_job_items WHERE job_id = ? AND status = 'completed')` statement — replacing the get-modify-write in `updateJobProgress` that lost updates when two item completions raced. Combined with B-146's single-writer pool, the persisted counter can never drift from the actual completed-item count
- The list and show endpoints now both report the item-derived completed count (`counts.Completed`, the same source as failed/pending) instead of list surfacing the stored counter — the two views can no longer disagree on a job's progress

### B-150: ComfyUI WebSocket read loop has no read deadline — half-open connection hangs jobs forever
- The ComfyUI WebSocket client now runs a client-side ping/pong keepalive: `Connect` installs a read deadline (refreshed on every pong and every successful read) and a `pingLoop` goroutine sends periodic pings, so a half-open peer (Wi-Fi drop, host poweroff without RST) trips the deadline within a bounded interval instead of blocking `ReadMessage` forever — the existing `disconnectHandler` then fires and the executor's reconnect + `recoverStuckItems` path takes over
- Healthy-but-idle connections (long GPU-bound generations with no execution events) stay up because pongs keep refreshing the deadline; the ping goroutine stops cleanly on read-loop exit and on `Close()` (no leak). Keepalive timings are injectable for deterministic unit tests (silent peer → disconnect; pong-driven peer → stays alive)

### B-147: Sample job + items creation is not atomic — orphaned jobs with partial items on mid-loop failure
- New `Store.CreateSampleJobWithItems(job, items)` inserts the job row and all item rows in a single SQLite transaction (commit once, rollback on any failure) — a mid-loop item insert failure now leaves no job and no items behind, eliminating orphaned jobs whose `total_items` disagreed with their actual item count (which made the executor wait forever)
- Service `Create` now assembles all items in memory (expansion, missing-only filter, path matching, B-141 all-skipped guard) before a single atomic persist; the three best-effort `DeleteSampleJob` compensation paths are removed. All transaction work runs on `*sql.Tx`, safe under B-146's single-connection pool

### B-146: SQLite pool allows concurrent writers — missing SetMaxOpenConns(1) causes SQLITE_BUSY write failures
- `OpenDB` now pins the `database/sql` pool to a single connection (`SetMaxOpenConns(1)`), the canonical remedy for SQLite's single-writer semantics — prevents writer-vs-writer collisions (job executor goroutine vs API handlers) from surfacing as hard "database is locked" errors that the busy_timeout cannot reliably absorb
- Store tests no longer override the pool size away from the production setting, so unit runs exercise the real single-connection behavior; added a multi-goroutine concurrent-write regression test

### B-145: Base model not remembered when selecting a training-run/study with existing samples
- The studies availability API now reports `base_models` — the base-model directory names derived from the on-disk LoRA sample layout `{run}/{study}/{base_model}/{checkpoint}/` — so the base model that produced existing samples can be resolved even when no `SampleJob` DB record remains
- The Generate Samples dialog pre-selects the remembered base model (matched by basename without extension) when a LoRA run/study with existing samples is chosen, falling back to an empty dropdown when none resolves and never overriding a value already restored from a loaded job

### B-144: Existing LoRA samples not detected — no green bead, validation shows no samples
- `DiscoveryService.Discover()` now computes `has_samples` by walking all four sample-output layouts (legacy flat, legacy study, checkpoint-run, and the deeper LoRA `{run}/{study}/{base_model}/{checkpoint}/` layout) instead of only the flat legacy path, so detection agrees with the grid-listing path that already handled nesting
- New `ListSubdirectories` method on the `CheckpointFileSystem` interface backs the multi-layout scan; legacy flat-path check retained as a fallback so detection never under-reports

### B-142: Generate Samples refresh button serves stale FSState cache on NFS mounts
- `GET /api/training-runs` accepts a `refresh=true` query param that forces a fresh `FSState.Populate()` (full filesystem rescan) before returning results, bypassing the in-memory cache that fsnotify cannot keep current on NFS mounts
- The Generate Samples dialog's manual refresh button now passes the force-refresh flag, so newly added `.safetensors` files on NFS-mounted checkpoint/LoRA directories appear without restarting the container; background fetches (mount, WebSocket, dialog open) stay on the cached path

### B-141: LoRA job creation and retry silently proceed with unresolvable model paths
- CreateSampleJob now fails with an error when all checkpoint path matches fail (zero viable items), and logs a warning for partial failures — previously it silently created an all-skipped job
- RetryFailed re-runs path matching for items with empty model paths, enabling recovery after ComfyUI config changes without needing to recreate the job
- substituteWorkflow validates non-empty lora_name before submitting to ComfyUI, preventing opaque downstream errors

### B-143: Base model dropdown depends on ComfyUI instead of base_model_dir
- New `GET /api/base-models` endpoint scans `base_model_dir` (or `checkpoint_dirs[0]` fallback) for `.safetensors` files directly from the filesystem, removing the ComfyUI dependency for base model selection
- Frontend job launch dialog now calls the dedicated endpoint instead of the ComfyUI UNET proxy, so LoRA jobs can be launched even when ComfyUI is offline
- Workflow substitution translates the curated `base_model_dir` path to ComfyUI's authoritative `unet_name` before submission (trailing-path match, basename fallback), fixing the LoRA-job `value_not_in_list` rejection; unresolvable or ambiguous matches fail the job item with an actionable error naming the conflicting candidates

### B-140: Job launch dialog allows LoRA runs with non-LoRA workflows
- Workflow API responses now include a derived `lora_capable` boolean (true when `lora_loader` cs_role is present)
- Job launch dialog badges incompatible studies with "Not LoRA" warning when a LoRA training run is selected, disables the launch button, and shows an explanatory alert
- Compatibility is derived client-side by joining study workflow templates with workflow roles — no new backend endpoint or storage

### B-138: E2E suite regression — demo install FSState race fix
- DemoAPIService now triggers synchronous FSState refresh after install/uninstall, eliminating race condition where training run list was stale due to fsnotify debounce window

### S-149: Frontend: LoRA strength pairs editor in study/preset UI
- Study editor gains a LoRA Strength Pairs section with add/remove UX matching sampler/scheduler pairs; default pair is {1.0, 1.0}
- Total images per checkpoint calculation now multiplies by the strength pair count for LoRA runs
- Import/export, clone, and duplicate validation all support the new field

### B-139: LoRA checkpoint metadata resolution only searches checkpoint_dirs
- `CheckpointMetadataService` now searches both `checkpoint_dirs` and `lora_dirs` when resolving checkpoint filenames for metadata parsing, with checkpoint_dirs taking precedence

### S-148: Frontend: LoRA training run badge and job launch UX
- Training run selectors display a "LoRA" badge for LoRA training runs; checkpoint runs show no badge (default kind)
- Job launch dialog conditionally shows a base model dropdown (populated from ComfyUI UNET models) when a LoRA training run is selected
- Workflow filtering: LoRA runs show only workflows with `lora_loader` cs_role; checkpoint runs exclude LoRA-capable workflows
- Job creation payload includes `base_model` field for LoRA jobs; submit validation requires base model selection
- Fix: study selector now shows all studies regardless of training run kind (studies are reusable across LoRA and checkpoint runs)

### S-147: Output path: base model directory level for LoRA samples
- ViewerDiscoveryService now detects 4-level LoRA directory layout: `{training_run}/{study}/{base_model_name}/{checkpoint.safetensors}/`
- Non-LoRA 3-level discovery paths unchanged (regression-safe); `StudyNameForRun` transparently handles both depths via `path.Dir`

### S-146: Job execution: LoRA workflow substitution
- `substituteNode` handles `CSRoleLoraLoader`: sets `lora_name`, `strength_model`, `strength_clip` from item fields
- `substituteNode` for `unet_loader`: uses `job.BaseModel` for LoRA jobs instead of `item.ComfyUIModelPath`
- `handleItemCompletionAsync` inserts base model name directory level for LoRA output paths: `{run}/{study}/{base_model_name}/{lora_checkpoint}/`
- `generateFilenamePrefixForJob` embeds base model name in save_image prefix for LoRA jobs

### S-145: Job creation: LoRA path matching, base model, strength expansion
- LoraPathMatcher queries ComfyUI's LoRA model list (via `object_info/LoraLoader`) for filename-to-path matching, separate from the UNET path matcher used for checkpoint runs
- `expandJobItems` includes `lora_strength_pairs` in the Cartesian product for LoRA training runs; non-LoRA jobs skip strength expansion
- Job creation validates LoRA runs require both a base model and a lora-capable workflow (containing `lora_loader` cs_role)
- DB migrations v22-v25 add `base_model` to sample_jobs and `lora_model_path`, `strength_model`, `strength_clip` to sample_job_items

### S-144: API: expose TrainingRunKind, base_model, and LoRA strength pairs
- Goa DSL: `TrainingRunResponse.kind` (enum: checkpoint/lora), `StudyPayload/Response.lora_strength_pairs`, `CreateSampleJobPayload.base_model` (optional)
- API implementation maps `kind` from model with "checkpoint" default; study create/update/fork now accept and return LoRA strength pairs

### S-143: Study model: add LoRA strength pairs
- Added `LoraStrengthPair` struct and `LoraStrengthPairs` field to the Study model; stored as JSON in SQLite with DB migration v21
- Service validates non-negative strength values and rejects duplicates; defaults to `[{1.0, 1.0}]` when empty

### S-142: Workflow template: add lora_loader cs_role
- Added `CSRoleLoraLoader` constant to model and `KnownCSRoles()` registry; WorkflowLoader now recognizes `lora_loader` nodes in workflow templates as an optional role
- Reduced default E2E shard count from 12 to 4 to resolve resource contention flakiness

### S-141: Discovery: scan lora_dirs and assign TrainingRunKind
- DiscoveryService now scans both `checkpoint_dirs` and `lora_dirs`, assigning `TrainingRunKindCheckpoint` or `TrainingRunKindLoRA` based on directory source
- Same suffix-stripping logic (step/epoch) applies to LoRA files; FSState watch dirs include lora_dirs

### S-140: Config + model foundations for LoRA support
- Added `lora_dirs` (list, optional) and `base_model_dir` (single path, optional) to config schema with directory existence validation; backward-compatible when omitted
- Added `TrainingRunKind` type with `checkpoint` and `lora` constants; `TrainingRun.Kind` field distinguishes how a run was discovered
- Docker compose and sandbox mounts updated for `/data/models` volume

### R-013: Implement State Snapshot for filesystem selectors
- Training run and study selector API endpoints now serve from an in-memory FSState snapshot instead of rescanning the filesystem on every request, significantly reducing response times
- Snapshot is populated at startup and refreshed reactively via fsnotify with 500ms debounce; watcher recursively monitors all subdirectories and dynamically adds new ones on creation
- E2E tests updated to poll for eventual consistency after demo dataset installation (FSState refresh is asynchronous)

### B-137: Scheduler and sampler dropdowns empty in Study Editor
- Added static fallback lists for samplers and schedulers when ComfyUI is unavailable or returns empty data, ensuring dropdowns are never empty

### S-138: WebSocket heartbeat/ping-pong mechanism
- Backend sends periodic WebSocket ping frames (configurable via `ws_ping_interval`, default 30s) to keep idle connections alive beyond proxy read timeouts; connection is cleaned up on ping write failure
- Frontend auto-reconnects when the backend closes a dead connection, with unit test traceability for the ping-timeout reconnection path

### R-012: XYGrid: read grid derivations from store instead of recomputing from props
- Removed 7 props and 5 duplicated computed properties from XYGrid, reading all grid derivations (filteredImages, imageIndex, xValues, yValues, etc.) from useImageCubeStore instead
- Eliminates divergence risk between XYGrid's local computation and the store's canonical values (Phase 4 of R-009 Pinia refactor)

### W-026: Fix pre-existing TS errors and enforce zero-error TypeScript gate in agent pipeline
- Fixed all pre-existing vue-tsc errors across frontend test files (missing `checkpoint_filenames`, `thumbnail_path`, `total_extra`/`total_invalid_params` fields, unused variables, loosely-typed function parameters)
- Added `vue-tsc --noEmit` zero-error gate to DEVELOPMENT_PRACTICES.md, code-reviewer.md, and qa-expert.md so TS errors are caught at every pipeline stage

### W-025: Workflow: enforce no pre-existing E2E failures — block or file bugs
- Removed all "fix or skip" and "known failures" tolerance from workflow docs (AGENT_FLOW.md, TEST_PRACTICES.md, qa-expert.md)
- QA must now file B-tickets for unrelated E2E failures and fix them — no skipping or disabling permitted
- Added QA iteration limit: after 2 rejected QA cycles, story is BLOCKED instead of bouncing indefinitely

### R-011: Serialize /api/test/reset endpoint for parallel E2E safety
- Rewrote `ResetDB()` to use a pinned `*sql.Conn` with `BEGIN EXCLUSIVE` transaction, serializing concurrent reset calls at the SQLite level and eliminating UNIQUE constraint failures on `schema_migrations` under 12-shard parallel E2E load

### S-136: Generate Samples minor UI tweaks (whitespace + validation message)
- Added left-margin whitespace between checkpoint name and sample count in the Generate Samples dialog
- Changed validation message to "Select at least one checkpoint to generate" with red styling via `--error-color`

### S-137: Validation dialog: add refresh button
- Added a Refresh button to the validation dialog that re-runs the validation API call and updates displayed results without closing and reopening the dialog
- Button shows loading/disabled state during the API call; works in both the job progress panel and slideout validation contexts

### S-134: Validation dialog: display detailed per-checkpoint report
- Replaced flat checkpoint rows with collapsible sections containing per-file-type breakdown tables (PNG samples, JSON metadata) with Expected/Valid/Missing/Invalid columns
- Added summary breakdown table with totals row aggregating counts across all checkpoints
- Extra/unexpected files are flagged at both summary and per-checkpoint levels

### S-135: Failed checkpoint indicator click navigates to failed job in Job List
- Clicking a red (failed) bead on a training run or study in the Generate Samples dialog now closes the dialog, opens the Job List, and scrolls to the most recent failed job with its error details expanded
- Clicking the "failed" badge on individual checkpoint rows in the Generate Samples dialog also navigates to the failed job (rework: badge click was previously a no-op that toggled the checkbox)
- Fixed cross-study scoping: failed checkpoint badges now only appear for jobs matching the currently selected study

### B-136: Colored beads not displayed when Training Run / Study selectors are closed
- Fixed `renderTag` functions for Training Run and Study NSelect components to render dual-bead status indicators (activity/problem) in the closed/collapsed trigger state, matching the existing open-dropdown behavior
- Fixed bead layout to display inline with label text (flexWrap nowrap + flex/minWidth on label span) instead of wrapping to a separate row

### B-135: Training run with no checkpoint sample dirs causes grid error
- Backend now returns empty images/dimensions (instead of propagating errors) when a training run has no checkpoint sample directories; logs a warning for operator visibility
- Frontend displays a "No sample images found" empty state instead of a misleading grid placeholder
- Fixed alreadyLoaded deduplication guard to treat empty-but-valid scans as completed state, preventing redundant re-scans

### B-134: Parallel E2E shard startup DNS failures causing cascading test failures
- Added Phase 2.5 DNS/HTTP connectivity pre-flight in parallel E2E runner: each shard verifies Playwright container can reach `frontend:3000` before tests start, preventing ENOTFOUND cascades
- Reduced shard batch size (4→3) and increased inter-batch stagger (2s→5s) to reduce Docker DNS pressure
- Capped `withRetry` exponential backoff at 10s and increased `resetDatabase` retry window to ~54s total

### B-132: Validation passes with extra samples; no per-sample param verification
- Reworked `ValidateTrainingRunWithManifest` to generate expected filenames from manifest parameter combinations (Cartesian product) instead of counting directory listings — foreign/copied samples no longer inflate the verified count
- Extra (foreign) files on disk are now tracked separately and cause validation to report issues rather than silently passing
- Added `FileExists` to `ValidationFileSystem` interface for per-file existence checks during expected-filename iteration

### B-098: Training run selector truncates long names (needs multi-line wrap)
- Fixed study selector in Gen Samples dialog: added `filterable` prop so selected study name displays when collapsed and trigger height no longer grows with number of studies
- Increased vertical padding on dropdown options (6px → 10px) in both TrainingRunSelector and JobLaunchDialog for better readability

### B-115: Regenerate confirmation dialog missing on study update (UAT feedback round 2)
- Fixed "Regenerate" button to close the Generate Samples dialog and switch to the job list after queuing jobs
- Fixed backend path construction bug: `filepath.Base()` now strips directory components from checkpoint filenames when building output paths, preventing `mkdir` failures when checkpoints live in subdirectories

### B-115: Regenerate confirmation dialog missing on study update
- Clarified immutability dialog wording: buttons renamed to "Yes, regenerate" / "No, keep existing samples", scope explicitly limited to "this study only", and clearing timing noted as "when each job starts"

### B-133: Job updated_at not touched on status transitions; list sorts by created not updated
- Fixed job list sort order to use `updated_at DESC` instead of `created_at DESC` so recently active jobs appear at the top
- Frontend now displays both "Created" and "Updated" timestamps in the job progress panel
- Added auto-scroll: when a job reorders to the top of the list (due to updated_at sort), the panel scrolls to show the new top item

### B-132: Validation passes with extra samples; no per-sample param verification
- Fixed `ValidateTrainingRunWithStudy` and `ValidateTrainingRunWithManifest` to track extra samples (verified > expected) in new `Extra` / `TotalExtra` fields instead of silently clamping to zero — extra files now surface as a validation warning
- Added per-sample param verification in `ValidateTrainingRunWithManifest`: reads each PNG's companion sidecar JSON and checks seed, CFG, steps, sampler/scheduler pair, and prompt name against the manifest's allowed values; mismatches surface via new `InvalidParams` / `TotalInvalidParams` fields
- Extended Goa API design and regenerated code to expose `extra`, `invalid_params`, `total_extra`, `total_invalid_params` in validation responses
- Updated `ValidationResultsDialog` to display extra/param-mismatch warnings in the summary tag and per-checkpoint rows
- Added unit tests: count-strict validation (extra samples detected), param-level verification (DescribeTable covering all six mismatching fields), missing sidecar skip, corrupt sidecar handling

### B-131: Clear-existing deletes ALL samples in study, not just selected checkpoints
- Fixed clear-existing to only delete samples for the selected checkpoints instead of the entire study directory, preserving samples for unselected checkpoints

### B-098: Training run selector truncates long names (needs multi-line wrap)
- Fixed Generate Samples dialog training run and study selectors to wrap long names instead of truncating, using `renderTag` with inline `whiteSpace: normal` and `:deep()` CSS overrides on Naive UI NSelect internals
- Fixed zebra-stripe backgrounds in the dialog to use literal `rgba()` values instead of CSS variables that don't resolve in Teleport-rendered VNodes

### B-115: Regenerate confirmation dialog missing on study update
- Fixed `StudyHasSamples()` to scan `{sampleDir}/{runDir}/{studyName}/` across all training run subdirectories instead of the nonexistent top-level `{sampleDir}/{studyName}/` path, which always returned false and prevented the immutability dialog from appearing on study update

### S-133: Alternating row striping on training run selectors
- Added zebra-stripe alternating row backgrounds to training run and study selector dropdowns in the Generate Samples dialog using Naive UI's `renderOption` with `cloneVNode` and the `--bg-surface` CSS variable

### B-126: Study Manager: VAE/TE not autopopulated on workflow auto-select + Shift not restored from preset
- Extracted `applyMruForWorkflow()` so MRU defaults (VAE, text encoder, shift, sampler/scheduler) apply on both manual workflow select and auto-select via New Study
- Extended MRU localStorage schema to include shift value alongside VAE/TE per workflow template, with backward compatibility for old entries

### B-129: drawer-auto-collapse.spec.ts column header click times out on narrow screen test
- Replaced CSS class selector with `data-testid="xy-grid-col-header"` and added DOM-attachment assertion before clicking, fixing intermittent timeout on narrow viewport E2E tests

### B-128: filters-slideout-layout.spec.ts flaky — checkpoint filter and zoom control intermittently not visible
- Added `dismissOverlays` calls in `setupWithAxes`, `setupWithSlider`, and inline test bodies after `closeDrawer` to wait for the sidebar NDrawer mask animation to fully complete before clicking header buttons — under parallel shard CPU contention the 0.2s CSS leave transition could outlast the fixed 300ms delay in `closeDrawer`
- Updated `openFiltersDrawer` helper to call `dismissOverlays` before clicking the filters button for the same reason
- Scoped the `[aria-label="Toggle checkpoint 1000"]` selector to `[data-testid="filters-drawer-content"]` in all usages to eliminate ambiguous page-wide matching

### B-130: Manage Studies dialog does not close after saving
- Fixed race condition where the study editor dialog close was delayed by the async `fetchStudies()` call, causing E2E test flakiness under parallel-shard load

### B-127: Red problem bead shows 'incomplete' instead of 'failed' for failed jobs (S-116 regression)
- Fixed `completed_with_errors` job status to show red "failed" bead instead of yellow "incomplete" in the Generate Samples dialog's training run and study dropdowns

### B-125: Generate Samples button label always says 'Regenerate' even with no samples
- Button label is now study-scoped: shows "Generate Samples" when the selected study has no samples, "Regenerate Samples" when it does — previously used a run-level check that always showed "Regenerate" if any study had samples

### B-114: Clear-existing samples should be a job param applied at job start, not queue time
- Changed `SampleDirRemover` interface from per-checkpoint removal to study-scoped directory removal (`RemoveStudyOutputDir`), fixing the bug where clear-existing targeted a non-existent legacy path and never actually deleted anything
- The new `StudyOutputDirRemover` uses `os.RemoveAll` on `{sampleDir}/{sanitizedRunName}/{studyName}/` to recursively delete all samples, thumbnails, and extraneous files before the job runs

### B-098: Training run selector — zebra stripe dropdown options
- Added alternating row striping to training run and study selector dropdown options using Naive UI's `renderOption` prop with `cloneVNode` (inline style required due to Teleport rendering outside scoped CSS)

### B-115: Regenerate confirmation dialog missing on study update
- Reworked immutability dialog from two-step flow (Fork/Regen/Cancel → separate confirmation) to a single three-option dialog: Clone (with editable name input), Regenerate Existing (saves and queues jobs with clear-existing), and Ignore (saves without touching samples)
- Affected training runs are pre-loaded and displayed inline in the dialog

### B-124: Stale preset localStorage entry not cleaned on training run selection
- Fixed `onPresetDelete` in App.vue to clear the stored combo preset entry when `PresetSelector.attemptAutoLoad` emits `delete` for a nonexistent preset ID, regardless of whether `selectedPresetId` matches (it's `null` for stale presets)

### B-123: E2E: /data/samples directory path missing for scan requests during E2E tests
- Added `DirectoryExists` guard in `ScanTrainingRun` to handle TOCTOU race where concurrent E2E resets remove sample directories between discovery and scan, preventing `no such file or directory` errors in the sweep

### B-122: E2E: /api/test/reset fails with UNIQUE constraint on schema_migrations during parallel shard runs
- Added `sync.Mutex` to serialize concurrent reset endpoint requests, preventing race conditions when 12 E2E shards call `/api/test/reset` simultaneously
- Changed `INSERT INTO` to `INSERT OR IGNORE INTO` for `schema_migrations` as defense-in-depth against duplicate version inserts

### W-024: Worktree isolation — Docker compose scoping, merge conflict handling, orchestrator update
- Story-scoped Docker compose project names (`checkpoint-sampler-dev-<story-id>`) via `scripts/compose-project-name.sh` for full container/volume/network isolation between concurrent worktrees
- `docker-compose.worktree.yml` overlay with `!override` ports for ephemeral port assignment, preventing port collisions
- `scripts/worktree/merge_helper.py` auto-resolves trivial merge conflicts (CHANGELOG.md via union merge with dedup, backlog.yaml via theirs-acceptance); non-trivial conflicts route back to the developer through the normal review cycle
- AGENT_FLOW.md sections 4.1.2 (Docker compose isolation) and 4.1.3 (merge conflict handling) document the workflow

### W-023: Worktree-based agent workflow — backlog locking, story claims, worktree lifecycle
- `backlog.py` gains file locking (`fcntl.flock`) for all mutating operations, `--repo-root` / `BACKLOG_REPO_ROOT` for worktree-aware path resolution, and `--claim <worker-id>` for atomic story claiming
- New `scripts/worktree/worktree.py` with create, remove, list, detect-stale, and recover subcommands for managing per-story git worktrees under `.worktrees/`
- AGENT_FLOW.md section 4.1.1 documents the parallel agent worktree workflow

### B-116: E2E: job-delete.spec.ts AC3 flaky — delete confirmation races with API check
- Added `Promise.all` + `page.waitForResponse` to synchronize on the DELETE 204 response before asserting the job is gone, eliminating the race between the in-flight DELETE and the immediate GET check

### B-120: E2E: Multiple specs fail with Naive UI select popup timeout
- Centralized select dropdown popup interaction into a retry-capable `clickSelectAndWaitForPopup` helper, fixing flakiness in regen-confirmation, checkpoint-default-selection, and study-name-validation specs under parallel shard load

### B-121: E2E: lightbox Y-axis keyboard navigation tests fail intermittently
- Added Playwright auto-wait assertions before reading `getAttribute('src')` in lightbox keyboard navigation tests to eliminate async race conditions under CPU contention

### R-009: Pinia state management refactor — reactive lightbox via useImageCubeStore
- Introduced `useImageCubeStore` Pinia store as the single source of truth for the multi-dimensional image cube: dataset, dimension assignments, grid position (slider values, combo selections), and lightbox cursor
- Lightbox image is now a computed derivation (`focusedImage`) that reactively updates when any slider changes — eliminates the stale-snapshot sync pattern (`lightboxContext`, `syncLightboxAfterSliderChange`, etc.)
- `useDimensionMapping` rewritten as thin backward-compatible wrapper delegating to the store
- App.vue reduced by ~70 lines: local slider/lightbox refs replaced with store state and actions

### B-118: E2E: job-delete spec fails to find delete button by data-testid
- Replaced real job creation with seed endpoint in job-delete E2E tests to eliminate the pending→running→completed race condition that made the Delete button intermittently unfindable

### B-115: Regenerate confirmation dialog missing on study update
- New `GET /api/studies/{id}/affected-runs` endpoint returns training runs with samples for a study
- Study update now shows a confirmation dialog listing affected training runs before queuing regeneration jobs with `clear_existing: true`

### B-114: Clear-existing samples should be a job param applied at job start, not queue time
- `clear_existing` is now stored as a persistent job parameter and executed once when the job first transitions to `running`, not at queue time
- Resuming a stopped/failed job no longer re-clears existing sample directories

### S-132: X/Y axis sliders rework — bottom/right positioning, dimension mappings, lightbox sync
- Replaced header MasterSlider with playback-only AnimationControls (play/pause, loop, speed — no slider track)
- 4 independent dimension mappings: X Axis (grid columns), Y Axis (grid rows), X Slider (bottom edge), Y Slider (right edge) — grid axes and sliders are independently assignable
- X/Y sliders in lightbox sync to main view sliders; both hidden when no dimension is mapped to the respective slider role
- Y slider now uses NSlider's native `vertical` prop for proper tall vertical rendering (UAT rework)

### R-008: Treat orphaned running items as resumable in processNextItem
- `processNextItem` now recovers orphaned running items (stuck after stop/resume or server restart) by resetting them to pending and reprocessing, instead of marking the job `completed_with_errors`

### B-113: e2e_sweep.sh integer comparison error and summary.txt not reliably written
- Fixed `grep -c` producing non-integer output in `e2e_sweep.sh` by switching to `mapfile` + array length for shard counting
- Added EXIT trap in `e2e_parallel.sh` to guarantee `summary.txt` is written even when Phase 5 report merge fails; wrapped Phase 5 in `set +e`/`set -e`

### B-112: accessibility.spec.ts dark mode populated grid test timeouts clicking settings-button
- Extracted `dismissOverlays` helper to shared `helpers.ts` and applied it in accessibility.spec.ts before settings-button clicks, replacing the insufficient fixed 300ms wait

### B-111: debug-mode.spec.ts tests timeout clicking settings-button in parallel shard execution
- Fixed `.app-header` z-index to stack above the fixed Y slider bar (`z-index: 90`), which was intercepting pointer events on header buttons
- Added `dismissOverlays` helper in E2E tests to wait for NDrawer masks to fully disappear before clicking header elements

### S-131: Add Y slider on right side of viewport
- Vertical Y slider pinned to the right viewport edge using `position: fixed`, hidden when no dimension is assigned to the Y axis
- MasterSlider reused with `writing-mode: vertical-lr` CSS overrides for vertical orientation; selecting a value solos that Y row in the grid

### S-130: Move X slider to bottom of viewport
- X axis slider pinned to the bottom edge of the viewport using `position: fixed`, hidden when no dimension is assigned to the X axis
- MasterSlider reused for the bottom bar; selecting a value solos that X column in the grid

### S-129: Complete checkpoints not auto-checked in Generate Samples validation selector
- Validation selector now unchecks complete checkpoints by default; only incomplete or unstarted checkpoints are pre-selected for generation
- Added `prefillProtected` flag to prevent validation watcher from overriding explicit prefill selections

### B-110: E2E beads test spuriously finds activity bead on empty training run
- Added API pre-flight guard (`GET /api/sample-jobs` → assert empty) before UI assertions to close the race window between `resetDatabase()` and bead visibility checks

### B-109: generate-samples-beads.spec.ts 'AC no beads' flaky — activity bead visible after resetDatabase
- Awaited fire-and-forget `fetchAllRunsAvailability` in JobLaunchDialog to eliminate race between availability fetch and Playwright's `networkidle` detection

### B-105: Side panel TR selector doesn't show new sample set after generation
- Training run selector now auto-refreshes when a sample job reaches terminal status via WebSocket, so newly generated sample sets appear without manual refresh

### B-102: Dimension mapping preset not auto-selected from localStorage on TR change
- Preset persistence redesigned from single-entry to per-(TR+study) map in localStorage, so switching training runs preserves each combo's last-used preset
- Backward-compatible migration from the old single-entry format

### B-101: App load/refresh doesn't restore TR, study, or preset from localStorage
- Eager preset restoration in `App.vue` runs after training run auto-select, independent of drawer mount lifecycle — fixes narrow-screen state loss
- Guard in `onTrainingRunSelect()` extended to skip duplicate scans when one is already in flight, preventing race condition that reset preset dimension mappings to defaults on refresh

### B-108: E2E parallel suite fails with ENOTFOUND/ECONNREFUSED in resetDatabase across all shards
- Added `withRetry` exponential backoff to `resetDatabase` E2E helper for transient DNS/connection errors during parallel shard startup
- Staggered shard startup in batches of 4 with 2s pause to reduce Docker DNS resolver pressure

### B-107: Manage Study: Checkpoint Status disappears after regenerate attempt
- Guard study persistence watcher against null so `resetForm()` doesn't erase persisted study; restore persisted selections on dialog reopen
- UAT rework: added unit tests for cancelled confirmation, failed doSubmit, and validation content preservation

### B-106: Manage Study: Regenerate (update in place) doesn't launch a job
- `StudyEditor` now emits `study-regenerate` after a successful in-place update; `JobLaunchDialog` handles it by creating a sample job with `clear_existing: true`
- Job progress panel auto-opens after any job creation so the user sees activity immediately

### B-104: Generate Samples validation shows 'workflow not found: .json' for all checkpoints
- Reject empty workflow names early in `WorkflowLoader.Get()` and validate study has a workflow template in `SampleJobService.Create()`, preventing the misleading ".json" error

### B-103: Stop job shows no activity and stop+restart fails (invalid_state)
- Backend `Stop()` now falls back to direct DB update when executor rejects, preventing jobs from getting stuck in "running" state
- Stop button shows loading spinner during the async operation

### B-100: Lightbox displays JPEGs instead of full-quality PNGs
- Fixed `getImagesBySliderValue` in XYGrid to always use full-resolution PNG paths for the lightbox slider, instead of preferring JPEG thumbnails

### B-099: Duplicate validate button in main controls slideout
- Removed inline validate button and results display from TrainingRunSelector; only the dialog-opening validate button in the slideout remains

### B-098: Training run selector truncates long names (needs multi-line wrap)
- Collapse filter `<input>` to `width: 0` when selector is closed so the render-label overlay gets full flex space for natural word wrapping (UAT rework v2)
- Added vertical padding to dropdown option items for readability with multi-line names

### B-097: 21 E2E tests fail expecting 'Sample Set' label and two-dropdown training run selector
- Aligned E2E test assertions with current UI: "Training Run" label (not "Sample Set"), dialog-scoped `study-select` locators, JSON localStorage format
- Fixed backend fixture seeders and partial sample seeder to use `studyName` for filesystem paths, matching the real job executor layout

### R-007: Remove orphaned ThemeToggle.vue component
- Deleted dead `ThemeToggle.vue` and its test file; theme toggle lives in the Settings dialog since S-091

### R-006: Shared validation constants between backend and frontend
- Frontend now extracts disallowed study name characters from backend API error response instead of maintaining a duplicate constant; bootstrap default ensures inline validation works before first API call

### R-005: Deprecate has_samples query parameter from Goa DSL
- Removed unused `has_samples` query parameter from `GET /api/training-runs` Goa DSL and regenerated API code; response field retained

### W-020: Explicit log-capture helper Makefile target
- `make logs-snapshot` atomically starts the dev stack, captures 500 log lines per service to `.claude-sandbox/ralph/temp/logs-snapshot/`, and tears down with guaranteed cleanup

### W-019: Add test-frontend and test-backend to Makefile .PHONY
- Declared `test-frontend` and `test-backend` as `.PHONY` targets in the root Makefile for correctness

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
- UAT rework: dark semi-opaque pill background (`rgba(0,0,0,0.65)`) replaces near-invisible white; z-index raised to ensure indicator renders above all other lightbox elements

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

### S-116: Training run and study status beads in Generate Samples (UAT rework 3)
- Study bead now shows yellow (partial) instead of green when validation detects missing sample files, even though all checkpoint directories exist
- Warning icon (⚠) displayed next to sample count text when missing samples are detected

### S-117: Validation results dialog with regenerate flow (job list + slideout)
- "Validate" button on each job card in the Sample Jobs panel and in the controls slideout triggers on-demand validation and displays results in a dialog
- Regenerate button in the validation dialog opens the Generate Samples dialog with pre-filled training run, study, and "generate missing samples only" checked

### S-109: Keyboard navigation help overlay in lightbox (UAT rework)
- Added `?` keyboard shortcut to toggle the help panel, addressing UAT feedback that the overlay had no discoverable trigger
- Improved `?` button visibility: upgraded from `quaternary`/`small` to `secondary`/`medium` with explicit background color

### S-108: Configurable confirmation button text in ConfirmDeleteDialog
- `ConfirmDeleteDialog` accepts an optional `confirmLabel` prop to customize the confirm button text, enabling reuse for non-delete confirmations (e.g., regeneration dialogs)

### S-105: Tooltip on study bead showing checkpoint counts (UAT rework)
- All four bead colors (blue, green, yellow, red) now show checkpoint counts in their tooltip; blue/red use format "running — 3/5 checkpoints have samples"

### S-110: Resume completed_with_errors jobs (retry failed items)
- New `POST /api/sample-jobs/{id}/retry-failed` endpoint resets failed/skipped items to pending and resumes execution; guards against concurrent running jobs and non-`completed_with_errors` state
- "Retry failed" button on JobProgressPanel for `completed_with_errors` jobs, replacing the need to create a new job to retry failures
- Fixed `RequestResume()` to adopt the job when no active job exists, so retried jobs are actually picked up by the executor loop

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
- Frontend image preloader now downloads JPEG thumbnails instead of full-res PNGs for grid display; full-res images served only in lightbox
- Added +/-3 horizontal neighbor preloading for smoother grid scrolling
- Slider position maps (`getImagesBySliderValue`) prefer thumbnail URLs when available

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
