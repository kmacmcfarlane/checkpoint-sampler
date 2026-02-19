# Product Requirements Document

## 1) Overview

Checkpoint Sampler is a locally-running web-based image viewer for evaluating stable-diffusion training checkpoint outputs. It scans a configurable root directory for image files whose filenames encode dimension key-value pairs, and whose parent directory names carry additional dimension values extracted via regex. The tool displays images in a configurable X/Y grid with sliders and multi-select combo filters for navigating the dimension space.

**Primary use case:** Compare sample images across checkpoints, prompts, seeds, CFG values, and other parameters to evaluate training progress and select the best checkpoint.

**Access model:** Local-first. No authentication. Accessible from any machine on the LAN.

## 2) Core concepts

### 2.1 Dataset root

A single directory on the host filesystem configured in a TOML config file (e.g., `/home/rt/ai/outputs/stable-diffusion/comfyui`). The tool is restricted to reading files within this directory tree. Exposed to the backend container via a Docker volume mount.

### 2.2 Training run

A group of checkpoint output directories under the dataset root, identified by a regex pattern matching relative directory paths. Training runs are defined in the TOML config and selectable in the UI.

Example: the pattern `^psyart/qwen/psai4rt-v0\.3\.0-qwen-2512-1024-adafactor-constant-2\.5e-6.+` matches all checkpoint directories for a specific training configuration.

### 2.3 Dimensions

Named parameters that vary across images. Two sources:

- **Filename dimensions**: Parsed from query-encoded filenames. Example: `index=5&prompt_name=portal_hub&seed=422&cfg=3&_00001_.png` yields dimensions `index`, `prompt_name`, `seed`, `cfg`.
- **Directory dimensions**: Extracted from parent directory names via configured regex capture groups. Example: `-steps-(\d+)-` mapped to dimension `step` of type `int`.

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
- The UI lists all training runs defined in the config file
- Selecting a training run scans its matching directories and loads image metadata
- Directory dimension extraction regexes are applied to produce dimension values
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

Server-side TOML file (`config.toml` at the project root, or path specified via environment variable).

```toml
# Root directory the tool is allowed to read from.
# All file access is restricted to this tree.
root = "/home/rt/ai/outputs/stable-diffusion/comfyui"

# Backend server port
port = 8080

# SQLite database path (relative to working directory)
db_path = "./data/checkpoint-sampler.db"

# Training run definitions
[[training_runs]]
name = "psai4rt v0.3.0 qwen"
# Regex matching directory paths relative to root
pattern = '^psyart/qwen/psai4rt-v0\.3\.0-qwen-2512-1024-adafactor-constant-2\.5e-6.+'

  # Dimension extraction from matched directory names
  [[training_runs.dimensions]]
  name = "step"
  type = "int"
  pattern = '-steps-(\d+)-'

  [[training_runs.dimensions]]
  name = "checkpoint"
  type = "string"
  pattern = '([^/]+)$'
```

### Configuration notes

- `root` acts as a security boundary. The backend rejects any path traversal outside this directory.
- `pattern` is matched against directory paths relative to `root`. All matching directories are scanned for image files.
- Each `training_runs.dimensions` entry defines a named dimension extracted via a regex with one capture group. The `type` field controls sort order (`int` sorts numerically, `string` sorts lexicographically).
- Filename dimensions are always auto-discovered from query-encoded filenames. They do not need configuration.
- Filename dimension types are inferred: values that parse as integers are sorted numerically, otherwise lexicographically.

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

The backend serves images from the filesystem through a dedicated API endpoint. The image path (relative to root) is validated against the configured root to prevent path traversal. Images are served with long-lived cache headers (`Cache-Control: max-age=31536000, immutable`) since checkpoint outputs are write-once.

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
| `ImageLightbox` | Modal overlay with zoom and pan for full-size viewing |

## 6) API surface (preliminary)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/training-runs` | List configured training runs |
| GET | `/api/training-runs/{id}/scan` | Scan directories and return image metadata + discovered dimensions |
| GET | `/api/images/*filepath` | Serve an image file (path relative to root, validated) |
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

- **TrainingRun**: name, pattern, directory dimension configs (from TOML)
- **Image**: relative path, parsed dimensions (map of dimension name to value)
- **Dimension**: name, type, set of discovered values, assigned UI role

## 8) Non-functional requirements

- **Performance**: With up to ~200 images per dataset, scanning must complete in under 2 seconds. Client-side caching ensures slider navigation feels instant. After the initially displayed images load, pre-cache all slider positions for visible grid cells, then remaining scan images in the background.
- **Security**: Backend restricts all filesystem access to within the configured root. Path traversal is rejected. No authentication (local/LAN use only).
- **Resilience**: WebSocket auto-reconnects on disconnect. Missing images show a placeholder. Malformed filenames are logged and skipped.
- **Portability**: Runs on Linux via Docker Compose. No host dependencies beyond Docker.
- **Image format**: Source images are 1344x1344 PNG. Served at full resolution.

## 9) Future considerations (not in scope)

- **Inference pipeline**: Generate sample images from selected checkpoints directly through the tool, replacing the manual ComfyUI workflow.
- **Image annotations**: Add notes or ratings to individual images or checkpoints.
- **Side-by-side comparison mode**: Pin images from different parameter sets for direct comparison.
