# Product Requirements Document

## 1) Overview

Checkpoint Sampler is a locally-running web-based image viewer for evaluating stable-diffusion training checkpoint outputs. It scans configured checkpoint directories for `.safetensors` files, groups them into training runs by stripping checkpoint suffixes, and correlates each checkpoint with its sample image directory. Dimensions are extracted from both directory names (checkpoint step/epoch) and query-encoded image filenames. The tool displays images in a configurable X/Y grid with sliders and multi-select combo filters for navigating the dimension space.

**Primary use case:** Compare sample images across checkpoints, prompts, seeds, CFG values, and other parameters to evaluate training progress and select the best checkpoint.

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
| **Combo filter** | Multi-select dropdown. Filters the visible image set. |

Each dimension is assigned to exactly one role. Unassigned dimensions default to combo filter.

### 2.6 Presets

Named dimension mapping configurations saved to the database. Users can save, load, and switch between presets via the UI. Presets persist across browser sessions and container restarts.

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

### US-8: Live updates via WebSocket

**As a** user
**I want to** see new images appear automatically as they are generated
**So that** I don't have to manually refresh while a ComfyUI run is in progress

**Acceptance criteria:**
- Backend watches the filesystem for new/changed image files in the active training run directories
- New images are pushed to connected clients via WebSocket
- The UI updates available dimension values and grid cells without a full page reload
- WebSocket reconnects automatically on disconnect

## 4) Configuration

Server-side YAML file (`config.yaml` at the project root, or path specified via `CONFIG_PATH` environment variable).

```yaml
# Directories to recursively scan for .safetensors checkpoint files.
# Multiple directories can be specified.
checkpoint_dirs:
  - /home/rt/ai/models-training/stable-diffusion/checkpoints

# Directory where ComfyUI sample image output directories live.
# Each subdirectory is named after the checkpoint filename (exact match).
sample_dir: /home/rt/ai/outputs/stable-diffusion/comfyui

# Backend server port
port: 8080

# SQLite database path (relative to working directory)
db_path: ./data/checkpoint-sampler.db
```

### Configuration notes

- `checkpoint_dirs` and `sample_dir` act as security boundaries. The backend rejects any path traversal outside these directories.
- Training runs are auto-discovered by scanning `checkpoint_dirs` for `.safetensors` files and grouping by base name (see section 2.2). No per-run configuration is needed.
- Filename dimensions are auto-discovered from query-encoded filenames. The checkpoint dimension is auto-extracted from checkpoint filename suffixes. No dimension configuration is needed.
- Dimension types are inferred: values that parse as integers are sorted numerically, otherwise lexicographically.

## 5) Architecture

Follows the layered backend architecture defined in `/docs/architecture.md`.

### 5.1 Backend layers

| Layer | Responsibilities |
|-------|-----------------|
| **model** | Image, Dimension, DimensionValue, DimensionMapping, Preset, TrainingRun |
| **service** | Filesystem scanning, filename parsing, dimension extraction, image lookup, preset CRUD, WebSocket hub, file watching |
| **store** | SQLite for presets; filesystem for images and directory scanning |
| **api** | Goa v3 REST endpoints, image serving endpoint, WebSocket upgrade endpoint, Swagger UI |

### 5.2 Image serving

The backend serves images from the `sample_dir` filesystem through a dedicated API endpoint. The image path (relative to `sample_dir`) is validated to prevent path traversal outside the configured directory. Images are served with long-lived cache headers (`Cache-Control: max-age=31536000, immutable`) since checkpoint outputs are write-once.

### 5.3 Client-side caching

The frontend relies on browser HTTP cache (driven by backend cache headers) and proactively preloads images at adjacent slider positions to ensure instant display when the slider moves.

### 5.4 WebSocket

A single WebSocket endpoint pushes image-change events to connected clients. The backend uses filesystem notification (fsnotify) to watch directories in the active training run. Events include new image files and new directories matching the training run pattern.

### 5.5 Frontend components

| Component | Purpose |
|-----------|---------|
| `TrainingRunSelector` | Dropdown to pick the active training run |
| `DimensionPanel` | Assign dimensions to X, Y, slider, combo roles |
| `PresetSelector` | Save/load/switch dimension mapping presets |
| `XYGrid` | Renders the image grid based on current mapping |
| `ImageCell` | Single grid cell: image + individual slider |
| `MasterSlider` | Top-level slider that drives all individual sliders |
| `ComboFilter` | Multi-select dropdown for a combo-assigned dimension |
| `ImageLightbox` | Modal overlay with zoom, pan, and generation metadata viewing |
| `CheckpointMetadataPanel` | Slideout panel showing checkpoint list and safetensors metadata |

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
| GET | `/api/ws` | WebSocket endpoint for live image update events |

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

### In-memory (per scan)

- **TrainingRun**: name (base name after stripping suffixes), list of Checkpoint entries
- **Checkpoint**: filename, step/epoch number, has_samples flag, sample directory path (if exists)
- **Image**: relative path (within sample_dir), parsed dimensions (map of dimension name to value)
- **Dimension**: name, type, set of discovered values, assigned UI role

## 8) Non-functional requirements

- **Performance**: With up to ~200 images per dataset, scanning must complete in under 2 seconds. Client-side caching ensures slider navigation feels instant. After the initially displayed images load, pre-cache all slider positions for visible grid cells, then remaining scan images in the background.
- **Security**: Backend restricts all filesystem access to within the configured `checkpoint_dirs` and `sample_dir`. Path traversal is rejected. No authentication (local/LAN use only).
- **Resilience**: WebSocket auto-reconnects on disconnect. Missing images show a placeholder. Malformed filenames are logged and skipped.
- **Portability**: Runs on Linux via Docker Compose. No host dependencies beyond Docker.
- **Image format**: Source images are 1344x1344 PNG. Served at full resolution.

## 9) Future considerations (not in scope)

- **Inference pipeline**: Generate sample images from selected checkpoints directly through the tool, replacing the manual ComfyUI workflow.
- **Image annotations**: Add notes or ratings to individual images or checkpoints.
- **Side-by-side comparison mode**: Pin images from different parameter sets for direct comparison.
