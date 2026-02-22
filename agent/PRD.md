# Product Requirements Document

## 1) Overview

Checkpoint Sampler is a locally-running web-based image viewer for evaluating stable-diffusion training checkpoint outputs. It scans configured checkpoint directories for `.safetensors` files, groups them into training runs by stripping checkpoint suffixes, and correlates each checkpoint with its sample image directory. Dimensions are extracted from both directory names (checkpoint step/epoch) and query-encoded image filenames. The tool displays images in a configurable X/Y grid with sliders and multi-select combo filters for navigating the dimension space.

**Primary use cases:**
1. Compare sample images across checkpoints, prompts, seeds, CFG values, and other parameters to evaluate training progress and select the best checkpoint.
2. Generate sample images automatically by orchestrating ComfyUI inference across all checkpoints in a training run with configurable sampling parameters.

**Access model:** Local-first. No authentication. Accessible from any machine on the LAN.

## 2) Core concepts

### 2.1 Checkpoint directories and sample directory

The tool reads from two distinct directory trees configured in YAML:

- **`checkpoint_dirs`**: A list of directories to recursively scan for `.safetensors` checkpoint files. These are the source of truth for discovering training runs.
- **`sample_dir`**: A single directory where ComfyUI sample image output directories live. Each subdirectory is named after the checkpoint filename (exact match) and contains the generated sample images.

Both are exposed to the backend container via Docker volume mounts. The backend restricts all filesystem access to within these configured directories.

See [docs/filesystem.md](/docs/filesystem.md) for the full directory structure and naming conventions.

### 2.2 Training run

A group of checkpoint files sharing a common base name, auto-discovered from the filesystem. Training runs are selectable in the UI.

**Auto-discovery**: The tool recursively scans all `checkpoint_dirs` for `.safetensors` files. It groups checkpoint files into training runs by stripping suffixes from the filename:

1. Remove `.safetensors` extension
2. Remove step suffix: `-step<NNNNN>` (e.g., `-step00004500`)
3. Remove epoch suffix: `-<NNNNNN>` (e.g., `-000104`)

Files sharing the same base name after stripping form a training run. The full relative path (including parent directories within the checkpoint dir) is used for grouping to distinguish runs in different subdirectories.

**Sample correlation**: For each checkpoint file, the tool looks for a matching directory under `sample_dir` whose name equals the checkpoint filename (including `.safetensors` extension). Checkpoints without a matching sample directory are still listed but flagged as having no samples.

**Example:**
```
# checkpoint_dirs[0]: ~/ai/models-training/stable-diffusion/checkpoints
qwen/
  psai4rt-v0.3.0-no-reg.safetensors                    → base: qwen/psai4rt-v0.3.0-no-reg
  psai4rt-v0.3.0-no-reg-step00004500.safetensors        → same base
  psai4rt-v0.3.0-no-reg-step00004750.safetensors        → same base

# sample_dir: ~/ai/outputs/stable-diffusion/comfyui
psai4rt-v0.3.0-no-reg.safetensors/
  index=0&prompt_name=forest_portals&seed=420&cfg=1&_00001_.png
psai4rt-v0.3.0-no-reg-step00004500.safetensors/
  index=0&prompt_name=forest_portals&seed=420&cfg=1&_00001_.png
```

All three checkpoint files belong to training run `qwen/psai4rt-v0.3.0-no-reg`. Two of the three have matching sample directories.

### 2.3 Dimensions

Named parameters that vary across images. Two sources:

- **Filename dimensions**: Parsed from query-encoded filenames. Example: `index=5&prompt_name=portal_hub&seed=422&cfg=3&_00001_.png` yields dimensions `index`, `prompt_name`, `seed`, `cfg`.
- **Checkpoint dimension**: Auto-extracted from checkpoint filenames. Within a training run group, the step/epoch number from the filename suffix becomes the `checkpoint` dimension (sorted numerically). The final checkpoint (no suffix) is assigned the max step value from the training run name if detectable (e.g., `steps-9000` → checkpoint value `9000`), otherwise sorted last.

### 2.4 Batch counter

The `_NNNNN_` suffix in filenames (e.g., `_00001_`) is a ComfyUI batch counter. It is ignored by the tool — not treated as a dimension. When multiple batch files exist for the same parameter combination, the highest-numbered file is used.

### 2.5 Dimension mapping

An assignment of discovered dimensions to UI roles:

| Role | Behavior |
|------|----------|
| **X axis** | Grid columns. One column per unique value. |
| **Y axis** | Grid rows. One row per unique value. |
| **Slider** | Per-cell slider + master slider. Cycles through ordered values. |

Each dimension is assigned to exactly one role (X, Y, Slider) or left unassigned. Each dimension also has a filter mode (see section 2.6).

### 2.6 Dimension filters

Each dimension has an independent filter mode controlling how its values are filtered in the UI:

| Filter Mode | Behavior |
|-------------|----------|
| **Hide** | No filter UI shown. All values are included. |
| **Single** | One value selectable at a time. Defaults to first previously-selected value, or first value if none. |
| **Multi** | Checkbox multi-select. Click a value label to solo it. Click the only-selected label to re-select all values. |

Rules:
- Dimensions assigned to X, Y, or Slider always use Multi filter mode implicitly.
- Unassigned dimensions default to Hide filter mode.
- Filters in the main content area are collapsed by default with an expand/collapse toggle.
- Filtering is cumulative across all visible dimension filters.

### 2.7 Presets

Named dimension mapping configurations saved to the database. Users can save, load, and switch between presets via the UI. Presets persist across browser sessions and container restarts.

### 2.8 ComfyUI integration

Checkpoint Sampler uses ComfyUI as its inference backend. Rather than implementing model loading and sampling directly, the tool orchestrates ComfyUI by submitting parameterized workflows via its HTTP/WebSocket API. This leverages ComfyUI's existing support for all model architectures (qwen-image, Flux, Flux2, SD, etc.), VRAM management, and sampling algorithms.

**Connection:** Configured via `comfyui.host` and `comfyui.port` in `config.yaml`. Defaults to `localhost:8188`.

**Model discovery:** Available VAEs, text encoders (CLIPs), UNETs, samplers, and schedulers are queried from ComfyUI's `/object_info/{node_type}` API endpoint. This guarantees the UI shows exactly what ComfyUI can load — no separate directory scanning needed.

**Checkpoint path matching:** Training run checkpoints discovered by checkpoint-sampler must also be accessible to ComfyUI (via ComfyUI's `extra_model_paths.yaml`). When creating a sample job, checkpoint filenames are matched against ComfyUI's available model list to determine the correct ComfyUI-relative path for workflow substitution.

### 2.9 Workflow templates

ComfyUI API-format JSON files stored on disk in a configured `workflow_dir`. Each workflow represents a generation pipeline for a particular model type (e.g., qwen-image, Flux).

**cs_role tags:** Nodes that checkpoint-sampler needs to parameterize are identified by a `cs_role` field in the node's `_meta` object. This is more robust than class_type matching since workflows may have multiple nodes of the same type.

| cs_role | Substituted fields | Source |
|---------|-------------------|--------|
| `unet_loader` | `unet_name` or `ckpt_name` | Per checkpoint in training run (auto-matched) |
| `clip_loader` | `clip_name` | Job-level setting (user selects from ComfyUI's available CLIPs) |
| `vae_loader` | `vae_name` | Job-level setting (user selects from ComfyUI's available VAEs) |
| `sampler` | `seed`, `steps`, `cfg`, `sampler_name`, `scheduler` | Sample preset (iterated across all combinations) |
| `positive_prompt` | `text` | Sample preset (iterated across prompt list) |
| `negative_prompt` | `text` | Sample preset (single value, same for all images) |
| `shift` | `shift` | Job-level setting (e.g., AuraFlow shift parameter) |
| `latent_image` | `width`, `height` | Sample preset |
| `save_image` | `filename_prefix` | Controlled by checkpoint-sampler (not user-configurable) |

**Validation:** A workflow template must have at least a `save_image` role. All other roles are optional — if a role is absent, the corresponding job-level setting is hidden in the UI.

### 2.10 Sample setting presets

Named parameter sets for image generation, stored in the database. Distinct from dimension mapping presets (section 2.7). A sample preset defines:

- **Prompts**: Named list of positive prompts (e.g., `[{name: "forest_portals", text: "a mystical forest..."}]`)
- **Negative prompt**: Single negative prompt text (applied to all images)
- **Steps**: List of step counts to iterate (e.g., `[1, 4, 8]`)
- **CFG values**: List of CFG scales to iterate (e.g., `[1, 3, 7]`)
- **Samplers**: List of sampler names to iterate (e.g., `["euler", "res_multistep"]`)
- **Schedulers**: List of scheduler names to iterate (e.g., `["simple", "normal"]`)
- **Seeds**: List of seed values to iterate (e.g., `[420, 421, 422]`)
- **Width / Height**: Image dimensions (single values, not iterated)

**Images per checkpoint:** `len(prompts) × len(steps) × len(cfgs) × len(samplers) × len(schedulers) × len(seeds)`. Displayed in the UI when building a preset.

### 2.11 Sample jobs

A sample job generates images for every checkpoint in a training run using a sample preset and workflow template.

**Job creation:** The user selects a training run (typically one without existing samples), a workflow template, a sample preset, and job-level settings (VAE, CLIP, shift). The system expands the preset parameters into individual work items: one per checkpoint × parameter combination.

**Execution:** Work items are submitted to ComfyUI sequentially (one at a time to avoid queue congestion). For each completed image, checkpoint-sampler downloads the output via ComfyUI's `/view` API and saves it to `sample_dir/{checkpoint_filename}/{query_encoded_params}.png`. This integrates seamlessly with the existing filesystem scanner.

**Output filenames:** The query-encoded filename includes all iterated parameters as dimensions: `prompt_name={name}&steps={n}&cfg={n}&sampler_name={s}&scheduler={s}&seed={n}.png`. Single-value settings (negative prompt, width, height, shift, VAE, CLIP) are not included since they don't vary within a job.

**Progress:** Tracked at two levels:
1. **Checkpoint level:** How many checkpoints have all their images completed out of the total.
2. **Image level:** How many images in the current checkpoint are done out of the total for that checkpoint.
3. **ETA:** Estimated from average image generation time × remaining items.

**State machine:** `pending` → `running` → `completed` | `failed` | `paused`. Users can stop a running job (pauses at the current item) and resume it later (picks up from the first incomplete item).

## 3) User stories

### US-1: Select training run

**As a** user evaluating checkpoint outputs
**I want to** select a training run from the UI
**So that** I can switch between different training experiments

**Acceptance criteria:**
- The backend auto-discovers training runs by recursively scanning `checkpoint_dirs` for `.safetensors` files, grouping them by base name (after stripping checkpoint suffixes)
- Each checkpoint is correlated with its sample directory under `sample_dir` (exact filename match)
- The UI lists all auto-discovered training runs
- The UI provides a default-checked filter to show only training runs with at least one checkpoint that has samples
- Selecting a training run scans the sample directories for its checkpoints and loads image metadata
- The checkpoint step/epoch number is auto-extracted as a dimension from checkpoint filename suffixes
- All discovered dimensions and their values are refreshed on training run change

### US-2: View images in X/Y grid

**As a** user
**I want to** see images arranged in an X/Y grid based on two chosen dimensions
**So that** I can visually compare outputs across those dimensions

**Acceptance criteria:**
- Grid rows correspond to Y-dimension values, columns to X-dimension values
- Each cell displays the matching image at full resolution (source images are 1344x1344)
- Missing combinations show an empty placeholder cell
- Grid scrolls horizontally and vertically as needed

### US-3: Assign dimensions to UI roles

**As a** user
**I want to** assign any discovered dimension to X, Y, slider, or combo filter
**So that** I can explore the image space along the axes that matter most

**Acceptance criteria:**
- A dimension configuration panel lists all discovered dimensions
- Each dimension can be dragged/assigned to exactly one role: X, Y, slider, or combo
- Changing assignments immediately re-renders the grid

### US-4: Filter with multi-select combos

**As a** user
**I want to** filter images using multi-select combo dropdowns for non-axis dimensions
**So that** I can narrow the displayed images to specific parameter values

**Acceptance criteria:**
- Each combo-assigned dimension shows a dropdown populated with all its discovered values
- Multiple values can be selected simultaneously
- Clicking a value label selects only that value (single-selection shortcut)
- A select-all / select-none control is present on each combo
- Filtering is cumulative across all combo filters

### US-5: Navigate with sliders

**As a** user
**I want to** use sliders to cycle through values of the slider-assigned dimension
**So that** I can flip through e.g. checkpoints while keeping the grid layout fixed

**Acceptance criteria:**
- Each grid cell has an individual slider below it
- The slider cycles through the ordered values of the slider-assigned dimension
- Moving a slider swaps the displayed image in that cell
- A master slider at the top of the page moves all individual sliders in sync
- Images are cached client-side so slider movement feels instant
- Pre-caching priority: (1) all slider positions for visible grid cells, then (2) remaining images from the scan in the background

### US-6: Save and load presets

**As a** user
**I want to** save a named set of dimension-to-role assignments and switch between them
**So that** I don't have to reconfigure the grid layout every time

**Acceptance criteria:**
- A "Save preset" action stores the current dimension mapping with a user-chosen name
- Saved presets appear in a selectable list
- Selecting a preset applies its dimension mapping immediately
- If a preset references dimensions not present in the current scan, matching dimensions are applied and a warning lists the unmatched ones
- Presets persist across browser sessions and container restarts (stored in SQLite)

### US-7: View full-size image

**As a** user
**I want to** click an image to open it full-size with zoom and scroll
**So that** I can inspect fine details

**Acceptance criteria:**
- Clicking a grid cell opens a modal/lightbox overlay showing the image
- Mouse wheel zooms in and out
- Click-drag pans the zoomed image
- Escape or clicking outside the image closes the overlay

### US-9: View checkpoint metadata

**As a** user
**I want to** view training metadata for checkpoints in the selected training run
**So that** I can understand the training configuration and compare checkpoint details

**Acceptance criteria:**
- A slideout panel shows a list of all checkpoints in the current training run
- The highest step count checkpoint is selected by default
- Selecting a checkpoint displays metadata parsed from the `.safetensors` file header (`ss_*` fields): output name, total steps, epochs, optimizer, dataset info, base model name, etc.
- Metadata is fetched on-the-fly when a checkpoint is selected (not during scan)
- If the safetensors header contains no `ss_*` metadata, the panel shows a "no metadata available" message
- The slideout can be opened and closed without affecting the grid state

### US-10: View generation metadata in lightbox

**As a** user
**I want to** view the generation metadata embedded in a sample image
**So that** I can see the exact ComfyUI parameters (prompt, seed, CFG, etc.) used to generate it

**Acceptance criteria:**
- The image lightbox (US-7) includes a metadata section showing the raw ComfyUI workflow JSON
- Metadata is fetched on-the-fly from the backend when the lightbox opens (dedicated endpoint)
- The JSON is displayed in a scrollable, formatted view
- If no metadata is embedded in the PNG, a "no metadata available" message is shown
- Viewing metadata does not interfere with zoom/pan functionality

### US-18: Connect to ComfyUI and browse available models

**As a** user setting up a sample job
**I want to** see that ComfyUI is connected and browse its available models
**So that** I can select the right VAE, text encoder, and sampling settings

**Acceptance criteria:**
- Backend connects to ComfyUI at the configured host:port
- A connection status indicator shows whether ComfyUI is reachable
- Available VAEs, CLIPs, UNETs, samplers, and schedulers are queryable from ComfyUI's API
- Model lists are exposed through checkpoint-sampler's API for the frontend to consume

### US-19: Manage workflow templates

**As a** user
**I want to** select from available workflow templates when launching a sample job
**So that** I can use different generation pipelines for different model types

**Acceptance criteria:**
- Workflow JSON files in the configured `workflow_dir` are listed in the UI
- Each workflow is validated for required `cs_role` tags
- The UI shows which roles a workflow supports (helping the user understand what settings are configurable)
- Invalid workflows are listed with an error indicator (not silently ignored)

### US-20: Create and manage sample setting presets

**As a** user
**I want to** create named presets for sampling parameters
**So that** I can reuse parameter sets across different training runs and sample jobs

**Acceptance criteria:**
- A preset editor allows configuring: prompts (named list), negative prompt, steps, CFG values, samplers, schedulers, seeds, width, height
- Sampler and scheduler dropdowns are populated from ComfyUI's available options
- The total images per checkpoint is displayed as parameters are configured
- Presets can be saved, loaded, edited, and deleted
- Presets persist in the database across sessions

### US-21: Launch a sample job

**As a** user
**I want to** launch a sample generation job for a training run
**So that** sample images are automatically generated for all checkpoints

**Acceptance criteria:**
- A "Generate Samples" action is available for training runs (especially those without existing samples)
- Launch dialog allows selecting: workflow template, sample preset, VAE, CLIP, shift value
- VAE/CLIP dropdowns populated from ComfyUI's available models
- Settings that don't apply to the selected workflow (e.g., shift for non-AuraFlow workflows) are hidden
- A confirmation summary shows: number of checkpoints, images per checkpoint, total images
- Launching creates a job and begins submitting work items to ComfyUI

### US-22: Monitor sample job progress

**As a** user
**I want to** see the progress of running sample jobs
**So that** I know how far along generation is and when it will finish

**Acceptance criteria:**
- A job progress panel shows all active and recent jobs
- Per job: status, checkpoints completed out of total, images completed for current checkpoint, estimated completion time
- Progress updates in real-time via WebSocket
- As images complete, they appear in the grid via the existing live update mechanism (filesystem watcher)

### US-23: Stop and resume sample jobs

**As a** user
**I want to** stop a running job and resume it later
**So that** I can free up GPU resources and continue generation at a convenient time

**Acceptance criteria:**
- A stop button pauses the job after the current image completes
- A resume button continues from the first incomplete work item
- Job state persists across application restarts (stored in database)
- Completed images are retained when a job is stopped

### US-8: Live updates via WebSocket

**As a** user
**I want to** see new images appear automatically as they are generated
**So that** I don't have to manually refresh while a ComfyUI run is in progress

**Acceptance criteria:**
- Backend watches the filesystem for new/changed image files in the active training run directories
- New images are pushed to connected clients via WebSocket
- The UI updates available dimension values and grid cells without a full page reload
- WebSocket reconnects automatically on disconnect

### US-11: Consistent UI with Naive UI and theming

**As a** user
**I want** the UI to use a polished component library with dark and light theme support
**So that** the interface feels professional and comfortable in different lighting conditions

**Acceptance criteria:**
- All UI elements use Naive UI components (buttons, selects, checkboxes, sliders, drawers, modals, tables)
- A theme toggle switches between Light and Dark mode (2-way toggle)
- Theme defaults to the system preference (prefers-color-scheme)
- Selected theme persists in localStorage across sessions
- All components render correctly in both themes

### US-12: Controls in left-side drawer

**As a** user
**I want** training run selection, preset management, and dimension assignments in a collapsible left-side panel
**So that** the main content area has maximum space for the image grid

**Acceptance criteria:**
- A left-side slide-out drawer contains: Training Run Picker, Preset Picker, Dimension Assignments (top to bottom)
- A toggle button in the header opens/closes the drawer
- The drawer overlays the main content (does not push it)
- On wide screens (≥1024px), the drawer opens by default; on narrow screens, it starts closed
- Dimension filters remain in the main content area (not in the drawer)

### US-13: Flexible dimension filtering

**As a** user
**I want** to choose how each dimension is filtered: hidden, single-select, or multi-select
**So that** I can simplify the UI for dimensions I don't need to filter

**Acceptance criteria:**
- Each dimension has a filter mode: Hide, Single, or Multi
- Hide: no filter UI shown, all values included
- Single: exactly one value selectable at a time; defaults to the first previously-selected value (or first value if none)
- Multi: checkbox multi-select with solo/unsolo behavior (click label to solo; click only-selected label to re-select all)
- Dimensions assigned to X, Y, or Slider always use Multi filter mode
- Unassigned dimensions default to Hide
- Dimension filters in the main content area are collapsed by default; a toggle opens each filter
- Filters are cumulative across all visible dimensions

### US-14: Grid cell resizing and header filtering

**As a** user
**I want** to resize grid cells by dragging dividers and click column/row headers to filter
**So that** I can customize the view and quickly isolate specific dimension values

**Acceptance criteria:**
- Grid cell boundaries can be resized by dragging dividers between cells
- Vertical (column) boundaries all change together; horizontal (row) boundaries all change together
- Clicking an X column header solos that value in the X dimension's filter
- Clicking a soloed X header re-selects all values for that dimension
- Same solo/unsolo behavior for Y row headers
- The image grid does not overflow independently of the rest of the page (whole page scrolls together)
- The grid uses the full viewport, with a small spacer for the sticky master slider at the top

### US-15: Main slider and playback improvements

**As a** user
**I want** a streamlined slider with inline controls and more speed options
**So that** playback is easier to use without taking up extra vertical space

**Acceptance criteria:**
- Master slider is 100% width, inline with the Play button (stacks on small mobile)
- Master slider is always visible: sticky-positioned at the top of the viewport so it remains accessible even when the grid overflows
- Pressing Play reveals loop controls (loop checkbox + speed selector); stopping hides them
- Loop is enabled by default
- Speed options: 0.25s, 0.33s, 0.5s, 1s (default), 2s, 3s

### US-16: Lightbox close improvements

**As a** user
**I want** clear ways to close the image lightbox
**So that** I can easily return to the grid view

**Acceptance criteria:**
- Clicking the background (outside the image) closes the lightbox (bug fix)
- An X button in the top-left corner closes the lightbox
- Escape key continues to close the lightbox

### US-17: Checkpoint metadata panel improvements

**As a** user
**I want** a resizable metadata panel with better key-value layout
**So that** I can read metadata comfortably and adjust the panel to my needs

**Acceptance criteria:**
- The slideout panel is resizable by dragging its left edge
- Min width: 300px; max width: 80vw; full width at the smallest responsive breakpoint
- Each metadata field displays the key as a header above the value (stacked layout, not side-by-side table)

## 4) Configuration

Server-side YAML file (`config.yaml` at the project root, or path specified via `CONFIG_PATH` environment variable).

```yaml
# Directories to recursively scan for .safetensors checkpoint files.
# Multiple directories can be specified.
checkpoint_dirs:
  - /data/checkpoints

# Directory where sample image output directories live.
# Each subdirectory is named after the checkpoint filename (exact match).
# Generated images from sample jobs are also saved here.
sample_dir: /data/samples

# Backend server port
port: 8080

# Bind address (use 0.0.0.0 for LAN access)
ip_address: "0.0.0.0"

# SQLite database path (relative to working directory)
db_path: ./data/checkpoint-sampler.db

# ComfyUI connection settings for inference pipeline (optional)
comfyui:
  host: localhost        # ComfyUI server hostname
  port: 8188             # ComfyUI server port (default: 8188)

# Directory containing workflow template JSON files
workflow_dir: ./workflows
```

### Configuration notes

- `checkpoint_dirs` and `sample_dir` use container-internal paths (`/data/...`) mapped to host directories via Docker Compose volume mounts (see `docker-compose.yml`). The actual host paths are configured via environment variables (`CHECKPOINT_DIR`, `SAMPLE_DIR`).
- `checkpoint_dirs` and `sample_dir` act as security boundaries. The backend rejects any path traversal outside these directories.
- Training runs are auto-discovered by scanning `checkpoint_dirs` for `.safetensors` files and grouping by base name (see section 2.2). No per-run configuration is needed.
- Filename dimensions are auto-discovered from query-encoded filenames. The checkpoint dimension is auto-extracted from checkpoint filename suffixes. No dimension configuration is needed.
- Dimension types are inferred: values that parse as integers are sorted numerically, otherwise lexicographically.
- `comfyui` settings are optional. If omitted, inference pipeline features are disabled in the UI.
- `workflow_dir` must contain ComfyUI API-format JSON files with `cs_role` tags (see section 2.9). The directory is created at startup if it does not exist.
- Checkpoint files must be accessible to both checkpoint-sampler (via `checkpoint_dirs`) and ComfyUI (via ComfyUI's `extra_model_paths.yaml`) for inference to work. Path matching is done by filename.

### Development environment (claude-sandbox)

The [claude-sandbox](https://github.com/kmacmcfarlane/claude-sandbox) container can mount external filesystems for read-only development access. Mount configuration is defined in `.claude-sandbox.yaml` (see `.claude-sandbox.example.yaml` for the template format). This file is processed by the claude-sandbox launcher to add extra volume mounts to the sandbox container. `.claude-sandbox.yaml` is gitignored; only the `.example` template is tracked.

For the author's setup, the AI PC filesystem is available via CIFS at `/mnt/lucy/` on the host, and the sandbox mounts provide:
- Checkpoints: `/mnt/lucy/models-training/stable-diffusion` → `/data/checkpoints/models-training` (read-only)
- Sample output: `/mnt/lucy/outputs/stable-diffusion/checkpoint-sampler` → `/data/samples` (read-only)
- ComfyUI repo (on the AI PC): `/mnt/lucy/repos/ComfyUI` (contains `extra_model_paths.yaml` defining ComfyUI's model search paths)

## 5) Architecture

Follows the layered backend architecture defined in `/docs/architecture.md`.

### 5.1 Backend layers

| Layer | Responsibilities |
|-------|-----------------|
| **model** | Image, Dimension, DimensionValue, DimensionMapping, Preset, TrainingRun, SamplePreset, SampleJob, SampleJobItem, Workflow |
| **service** | Filesystem scanning, filename parsing, dimension extraction, image lookup, preset CRUD, WebSocket hub, file watching, ComfyUI client, workflow template management, sample preset CRUD, job orchestration and execution |
| **store** | SQLite for presets, sample presets, and jobs; filesystem for images, directory scanning, and workflow templates |
| **api** | Goa v3 REST endpoints, image serving endpoint, WebSocket upgrade endpoint, ComfyUI proxy endpoints, Swagger UI |

### 5.2 Image serving

The backend serves images from the `sample_dir` filesystem through a dedicated API endpoint. The image path (relative to `sample_dir`) is validated to prevent path traversal outside the configured directory. Images are served with long-lived cache headers (`Cache-Control: max-age=31536000, immutable`) since checkpoint outputs are write-once.

### 5.3 Client-side caching

The frontend relies on browser HTTP cache (driven by backend cache headers) and proactively preloads images at adjacent slider positions to ensure instant display when the slider moves.

### 5.4 WebSocket

A single WebSocket endpoint pushes image-change events to connected clients. The backend uses filesystem notification (fsnotify) to watch directories in the active training run. Events include new image files and new directories matching the training run pattern.

### 5.5 Frontend components

The frontend uses [Naive UI](https://www.naiveui.com/) as its component library with dark/light theme support. See [docs/ui.md](/docs/ui.md) for detailed UI architecture.

| Component | Purpose |
|-----------|---------|
| `AppDrawer` | Left-side slide-out panel containing controls (Training Run, Presets, Dimensions) |
| `TrainingRunSelector` | Dropdown to pick the active training run |
| `DimensionPanel` | Assign dimensions to X, Y, slider roles and set filter modes |
| `PresetSelector` | Save/load/switch dimension mapping presets |
| `DimensionFilter` | Per-dimension filter (Hide/Single/Multi mode) in main content area |
| `XYGrid` | Renders the image grid with resizable cell dividers and header click filtering |
| `ImageCell` | Single grid cell: image + individual slider |
| `MasterSlider` | Full-width slider with inline Play button and collapsible loop controls |
| `ImageLightbox` | Modal overlay with zoom, pan, close button, and generation metadata viewing |
| `CheckpointMetadataPanel` | Resizable slideout panel with stacked key-value metadata display |
| `ThemeToggle` | Light/Dark theme switch |
| `SamplePresetEditor` | Create/edit sample setting presets with parameter lists and ComfyUI-populated dropdowns |
| `JobLaunchDialog` | Launch a sample job: select workflow, preset, VAE, CLIP, shift; shows confirmation summary |
| `JobProgressPanel` | Display active/recent jobs with per-checkpoint and per-image progress, ETA, stop/resume controls |
| `ComfyUIStatus` | Connection status indicator for ComfyUI |

### 5.6 ComfyUI integration

The backend maintains an HTTP + WebSocket client connection to a ComfyUI instance. Communication flow:

1. **Model discovery:** Query `/object_info/{node_type}` to enumerate available VAEs, CLIPs, UNETs, samplers, schedulers. Cached with a short TTL.
2. **Prompt submission:** POST to `/prompt` with the parameterized workflow JSON. Returns a `prompt_id`.
3. **Progress monitoring:** WebSocket connection to ComfyUI receives per-node execution progress events keyed by `prompt_id`.
4. **Output retrieval:** After prompt completion, query `/history/{prompt_id}` to get output metadata, then download images via `/view?filename={name}&subfolder={subfolder}&type=output`.
5. **Queue management:** Query `/queue` to check pending/running prompts. Use `/queue` DELETE to cancel queued prompts on job stop.

### 5.7 Job execution

The job executor runs as a background goroutine. It processes one work item at a time:

1. Pick the next incomplete item from the job (ordered by checkpoint, then parameter combination).
2. Clone the workflow template and substitute tagged node values.
3. Submit to ComfyUI and wait for completion (via WebSocket progress events).
4. Download the output image and save to `sample_dir/{checkpoint_filename}/{query_encoded_params}.png`.
5. Update job progress and push WebSocket event to connected frontend clients.
6. Repeat until all items complete, or job is stopped.

**Checkpoint path matching:** For each checkpoint in the training run, the executor queries ComfyUI's available models and matches by filename to find the ComfyUI-relative path. Checkpoints not accessible to ComfyUI are skipped with an error logged on the job item.

## 6) API surface (preliminary)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/training-runs` | List auto-discovered training runs (supports `?has_samples=true` filter) |
| GET | `/api/training-runs/{id}/scan` | Scan directories and return image metadata + discovered dimensions |
| GET | `/api/images/*filepath` | Serve an image file (path relative to sample_dir, validated) |
| GET | `/api/images/*filepath/metadata` | Parse and return PNG embedded metadata (ComfyUI workflow JSON) |
| GET | `/api/checkpoints/{filename}/metadata` | Parse and return safetensors header metadata (ss_* fields) |
| GET | `/api/presets` | List saved dimension mapping presets |
| POST | `/api/presets` | Create a new preset |
| PUT | `/api/presets/{id}` | Update a preset |
| DELETE | `/api/presets/{id}` | Delete a preset |
| GET | `/api/ws` | WebSocket endpoint for live image update and job progress events |
| GET | `/api/comfyui/status` | Check ComfyUI connection status |
| GET | `/api/comfyui/models` | List available models by type (`?type=vae\|clip\|unet\|sampler\|scheduler`) |
| GET | `/api/workflows` | List available workflow templates |
| GET | `/api/workflows/{name}` | Get workflow template details and cs_role info |
| GET | `/api/sample-presets` | List sample setting presets |
| POST | `/api/sample-presets` | Create a sample setting preset |
| PUT | `/api/sample-presets/{id}` | Update a sample setting preset |
| DELETE | `/api/sample-presets/{id}` | Delete a sample setting preset |
| POST | `/api/sample-jobs` | Create and start a sample job |
| GET | `/api/sample-jobs` | List sample jobs (active and recent) |
| GET | `/api/sample-jobs/{id}` | Get sample job status and progress |
| POST | `/api/sample-jobs/{id}/stop` | Stop a running job |
| POST | `/api/sample-jobs/{id}/resume` | Resume a paused job |
| DELETE | `/api/sample-jobs/{id}` | Delete a job and its items |

The API is defined design-first using Goa v3 DSL. Swagger UI is served at `/docs`.

## 7) Data model (preliminary)

### SQLite tables

**presets**
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| name | TEXT | User-chosen preset name |
| mapping | TEXT (JSON) | Serialized dimension-to-role assignments |
| created_at | TEXT (RFC3339) | Creation timestamp |
| updated_at | TEXT (RFC3339) | Last update timestamp |

**sample_presets**
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| name | TEXT | User-chosen preset name |
| prompts | TEXT (JSON) | Array of `{name, text}` objects |
| negative_prompt | TEXT | Negative prompt text |
| steps | TEXT (JSON) | Array of step count integers |
| cfgs | TEXT (JSON) | Array of CFG scale numbers |
| samplers | TEXT (JSON) | Array of sampler name strings |
| schedulers | TEXT (JSON) | Array of scheduler name strings |
| seeds | TEXT (JSON) | Array of seed integers |
| width | INTEGER | Image width in pixels |
| height | INTEGER | Image height in pixels |
| created_at | TEXT (RFC3339) | Creation timestamp |
| updated_at | TEXT (RFC3339) | Last update timestamp |

**sample_jobs**
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| training_run_name | TEXT | Training run identifier |
| sample_preset_id | TEXT | FK to sample_presets |
| workflow_name | TEXT | Workflow template filename |
| vae | TEXT | Selected VAE (ComfyUI path) |
| clip | TEXT | Selected CLIP/text encoder (ComfyUI path) |
| shift | REAL | AuraFlow shift value (nullable if workflow has no shift role) |
| status | TEXT | pending, running, paused, completed, failed |
| total_items | INTEGER | Total work items (checkpoints × images_per_checkpoint) |
| completed_items | INTEGER | Number of completed work items |
| error_message | TEXT | Error details if failed |
| created_at | TEXT (RFC3339) | Creation timestamp |
| updated_at | TEXT (RFC3339) | Last update timestamp |

**sample_job_items**
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| job_id | TEXT | FK to sample_jobs |
| checkpoint_filename | TEXT | Checkpoint file being sampled |
| comfyui_model_path | TEXT | ComfyUI-relative model path |
| prompt_name | TEXT | Prompt name from preset |
| prompt_text | TEXT | Prompt text |
| steps | INTEGER | Step count |
| cfg | REAL | CFG scale |
| sampler_name | TEXT | Sampler name |
| scheduler | TEXT | Scheduler name |
| seed | INTEGER | Seed value |
| status | TEXT | pending, running, completed, failed, skipped |
| comfyui_prompt_id | TEXT | ComfyUI prompt ID (set when submitted) |
| output_path | TEXT | Relative path of saved image (set when completed) |
| error_message | TEXT | Error details if failed |
| created_at | TEXT (RFC3339) | Creation timestamp |
| updated_at | TEXT (RFC3339) | Last update timestamp |

### In-memory (per scan)

- **TrainingRun**: name (base name after stripping suffixes), list of Checkpoint entries
- **Checkpoint**: filename, step/epoch number, has_samples flag, sample directory path (if exists)
- **Image**: relative path (within sample_dir), parsed dimensions (map of dimension name to value)
- **Dimension**: name, type, set of discovered values, assigned UI role

## 8) Non-functional requirements

- **Performance**: With up to ~200 images per dataset, scanning must complete in under 2 seconds. Client-side caching ensures slider navigation feels instant. After the initially displayed images load, pre-cache all slider positions for visible grid cells, then remaining scan images in the background.
- **Security**: Backend restricts all filesystem access to within the configured `checkpoint_dirs` and `sample_dir`. Path traversal is rejected. No authentication (local/LAN use only).
- **Resilience**: WebSocket auto-reconnects on disconnect. Missing images show a placeholder. Malformed filenames are logged and skipped. Sample jobs survive application restarts (state persisted in database). ComfyUI connection failures are retried with backoff.
- **Portability**: Runs on Linux via Docker Compose. No host dependencies beyond Docker.
- **Image format**: Source images are 1344x1344 PNG. Served at full resolution. Generated images saved as PNG.
- **Inference**: ComfyUI integration is optional — the tool remains fully functional for viewing without a ComfyUI connection. Job execution is sequential (one prompt at a time) to avoid VRAM contention.

## 9) Future considerations (not in scope)

- **Image annotations**: Add notes or ratings to individual images or checkpoints.
- **Side-by-side comparison mode**: Pin images from different parameter sets for direct comparison.
- **Parallel ComfyUI submission**: Submit multiple prompts concurrently for faster throughput (requires careful VRAM management).
- **Remote ComfyUI instances**: Support connecting to multiple ComfyUI instances for distributed generation.
- **Workflow editor**: Visual workflow editing within checkpoint-sampler (currently workflows are edited in ComfyUI and exported).
