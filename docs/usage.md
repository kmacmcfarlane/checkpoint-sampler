# Usage Guide

This guide walks through using Checkpoint Sampler once the stack is running: exploring
the bundled demo dataset, the Study → Sample Job → XY grid workflow for your own
training runs, and enabling ComfyUI-backed sample generation. For install/config
reference material, see the [README](/README.md); for directory layout and naming
rules, see [docs/filesystem.md](filesystem.md); for UI component details, see
[docs/ui.md](ui.md).

## 1) Start the app

```bash
cp config.yaml.example config.yaml
cp .env.example .env
make up
```

Open [http://localhost:3001](http://localhost:3001). See the README's
[Quick start](/README.md#quick-start) section for prerequisites and the
[Configuration](/README.md#configuration) section for `.env`/`config.yaml` details.

## 2) Explore the demo dataset

If you don't have your own checkpoints and samples handy yet, the app ships a
built-in demo dataset so you can try the viewer immediately.

1. Click **Settings** in the header (gear/settings button, `aria-label="Open settings"`).
2. In the **Demo Dataset** section, the current status is shown (`Not installed` or
   `Installed`).
3. Click **Restore Demo** to install it. This generates a small training run with 3
   checkpoints and images that vary across the `prompt_name`, `seed`, and `cfg`
   dimensions.
4. Close Settings, open the left drawer (hamburger icon, `aria-label="Toggle controls
   drawer"`), and select the demo training run (named `demo-model`) from the **Training
   Run** picker.
5. The grid loads automatically. Use the **Dimensions** panel (bottom of the
   drawer) to assign `prompt_name`, `seed`, or `cfg` to the X axis, Y axis, or slider
   role, and watch the grid re-render.

To remove the demo data later, reopen Settings and click **Delete Demo**. The demo
dataset lives under `{sample_dir}/demo-model/demo-study/` — see
[docs/filesystem.md](filesystem.md#demo-dataset-layout) for the exact layout.

## 3) The Study → Sample Job → XY grid workflow

This is the core workflow for generating and reviewing your own sample images.

### Step 1: Point the app at your data

Configure `checkpoint_dirs` (and optionally `lora_dirs`, `base_model_dir`) in
`config.yaml`, and the corresponding host paths in `.env`
(`CHECKPOINT_DIR`, `LORA_DIR`, `MODEL_DIR`, `SAMPLE_DIR`). Restart the stack
(`make up`) after changing `.env`. See the README's
[Configuration](/README.md#configuration) section and
[docs/filesystem.md](filesystem.md) for naming/suffix rules that determine how
checkpoint files are grouped into training runs.

### Step 2: Create a Study

A **Study** defines the sampling parameters for a generation run: prompts, negative
prompt, steps, CFG values, sampler/scheduler pairs, seeds, resolutions, and (for LoRA
runs) LoRA strength pairs.

1. Click **Generate Samples** in the header.
2. In the dialog, click **Manage Studies**.
3. Click **New Study** (or select an existing one to edit), fill in **Study Name**,
   **Prompts** (name + text pairs), **Steps**, **CFG Values**, **Sampler / Scheduler
   Pairs**, **Seeds**, and **Resolutions**. Optionally set a **Workflow Template**,
   **VAEs**, **CLIP / Text Encoders**, and **Shift Values** — these dropdowns are
   populated from ComfyUI's available models, so they only show values when ComfyUI is
   connected (see section 4 below).
4. Save the Study, then close the "Manage Studies" panel to return to the Generate
   Samples dialog.

### Step 3: Launch a Sample Job

Back in the **Generate Samples** dialog:

1. Select a **Training Run** (the "Show all" checkbox reveals runs that already have
   samples; unchecked shows only runs missing samples).
2. Select the **Study** you just created. For LoRA training runs, a **Base Model**
   selector also appears (populated from ComfyUI's available UNET models).
3. The dialog validates completeness and shows a **Checkpoint Status** / **Checkpoint
   Validation Status** list with per-checkpoint checkboxes, so you can select specific
   checkpoints (e.g. only missing ones) instead of all of them.
4. Review the summary (checkpoints, images per checkpoint, total images), then click
   **Generate Samples** (or **Regenerate Samples** if targeting an already-sampled run).
5. Track progress via the **Job Progress** panel (`aria-label="Toggle sample jobs
   panel"` in the header). Images appear in the grid live via WebSocket as they
   complete — no page reload needed.

### Step 4: Review results in the XY grid

1. Open the left drawer and select the training run in the **Training Run** picker.
2. In **Dimensions**, assign discovered dimensions (e.g. `prompt_name`,
   `seed`, `cfg`, `checkpoint`) to the X axis, Y axis, or a slider role. Leave others
   as filters (Hide / Single / Multi).
3. The grid renders immediately. Use the **Master Slider** (sticky at the top) or each
   cell's individual slider to step through the slider dimension (e.g. flip through
   checkpoints while keeping prompt/seed fixed on the X/Y axes).
4. Click a cell to open the full-size lightbox (zoom with the scroll wheel, pan by
   dragging, close with the X button, Escape, or by clicking the backdrop). The
   lightbox also shows the embedded generation metadata (prompt, seed, CFG, etc.).
5. Save the current dimension assignment as a named preset via the **Preset** picker
   in the drawer so you don't have to reconfigure it next time. (This "dimension
   mapping preset" is a different concept from a Study — a Study defines sampling
   parameters for generation, a preset defines how dimensions map to X/Y/slider/filter
   roles for viewing.)

See [docs/ui.md](ui.md) for the full component/layout reference (drawer, filters,
grid resizing, keyboard shortcuts) and the README's
[Keyboard controls](/README.md#keyboard-controls) table.

## 4) Enabling ComfyUI generation

Checkpoint Sampler does not generate images itself — without a reachable ComfyUI
instance, you can still browse checkpoints and view existing samples, but **Generate
Samples** and Study editing dropdowns backed by ComfyUI (VAE, CLIP, samplers,
schedulers, base models) are unavailable.

To enable it, uncomment and configure the `comfyui:` block in `config.yaml`:

```yaml
comfyui:
  url: http://host.docker.internal:8188
  workflow_dir: ./workflows
  # reconnect_interval: 10
```

Then restart the stack (`make up`). See the README's
[Connecting to ComfyUI](/README.md#connecting-to-comfyui) section for the full
Docker-networking explanation of the `url` value, and
[docs/workflows.md](workflows.md) for how to annotate a ComfyUI workflow export with
`cs_role` tags so Checkpoint Sampler can parameterize it (a plain ComfyUI export will
not work without these annotations).

## 5) Troubleshooting / FAQ

### "ComfyUI (offline)" pill never goes away

The header shows a **ComfyUI (offline)** tag whenever the backend's WebSocket
connection to ComfyUI is down (a connected instance shows a plain **ComfyUI** tag).
Common causes:

- **Wrong `url` for Docker networking.** The backend runs inside a container, so
  `comfyui.url` is resolved from the *container's* network namespace, not your host.
  `http://localhost:8188` inside the shipped Compose stack points at the backend
  container itself, not ComfyUI, and produces a permanent offline pill with no other
  symptom. If ComfyUI runs on the same machine as Docker, use
  `http://host.docker.internal:8188` (the required `extra_hosts` entry is already in
  `docker-compose.yml`). If ComfyUI runs on another machine, use its LAN IP.
- **ComfyUI isn't running, or is listening on a different port.** Confirm you can
  reach ComfyUI's own UI at that address from the Docker host.
- **Not fatal**: while offline you can still create and queue sample jobs; work items
  wait until the backend reconnects (retried every `reconnect_interval` seconds,
  default 10) and then resume automatically, including recovering items that finished
  on the ComfyUI side while disconnected.

### Training run list is empty

The **Training Run** selector shows a message naming the configured checkpoint
directories when no training runs are discovered, e.g. *"No training runs found in
the configured checkpoint director(y/ies): ..."*. Check that:

- `checkpoint_dirs` in `config.yaml` points at a directory that actually contains
  `.safetensors` files (directly or in subdirectories).
- The corresponding `.env` variable (`CHECKPOINT_DIR`, and `LORA_DIR` for LoRA runs)
  points at the right host path, and the stack was restarted after editing `.env`.
- The directory and naming conventions match [docs/filesystem.md](filesystem.md) —
  in particular, checkpoint files must have a `.safetensors` extension for scanning to
  find them at all.
- If the configured directory exists but is unreadable (e.g. bad permissions or a
  disconnected network mount), the backend fails fast at startup rather than silently
  reporting zero training runs — check `make logs` for a startup error naming the
  directory.

### Models (checkpoints/LoRAs) not visible to ComfyUI

Checkpoint Sampler and ComfyUI must both be able to resolve the same underlying
`.safetensors` files, but they do so via independent configuration:

- Checkpoint Sampler discovers files via its own `checkpoint_dirs`/`lora_dirs`.
- ComfyUI discovers files via its own model paths (and, for shared/external
  directories, its `extra_model_paths.yaml`).

When launching a sample job or editing a Study, Checkpoint Sampler queries ComfyUI's
available model list and matches checkpoints/LoRAs to it **by filename** (not full
path). If a checkpoint can't be matched, the checkpoint is skipped with an error
logged on the job item (visible via a "failed" badge in the Generate Samples dialog's
checkpoint list). Fix by pointing ComfyUI's `extra_model_paths.yaml` at the same
shared directory Checkpoint Sampler scans — see the README's
[Connecting to ComfyUI](/README.md#connecting-to-comfyui) section and
[docs/workflows.md](workflows.md#unet_loader-and-checkpoint-path-matching) for
details.

### Proxy / `allowed_origins` issues (cross-origin or WebSocket failures)

By default, the backend only accepts cross-origin browser requests (including the
WebSocket upgrade) whose `Origin` header hostname matches the request `Host` header
hostname (scheme and port are ignored). This covers direct IP access, dev mode (Vite
on a different port than the backend), and Host-preserving reverse proxies. Requests
with no `Origin` header (curl, non-browser clients) are always allowed.

Symptoms of a mismatch: the browser console shows CORS errors, or the WebSocket
connection fails to establish (which can also present as a persistent "ComfyUI
(offline)"-*like* disconnected state for the app's own live-update connection, not to
be confused with the ComfyUI status pill above).

Fix: if you're running behind a reverse proxy that rewrites the `Host` header (so it
no longer matches the browser's `Origin`), add the externally-visible origin(s) to
`allowed_origins` in `config.yaml`:

```yaml
allowed_origins:
  - https://checkpoint-sampler.example.com
```

Entries may be a full origin (`scheme://host[:port]`) or a bare hostname; matching is
hostname-only. You do not need to set this for normal same-host Docker Compose usage
— it only extends the always-on same-host default. See the README's
[Security model](/README.md#security-model) section for the related discussion of
exposing the app beyond localhost.

### Sample job stuck at "pending" or won't start

Confirm ComfyUI is connected (see the offline-pill section above) — job items are
submitted to ComfyUI one at a time, so a disconnected ComfyUI pauses execution
(the job resumes automatically once reconnected). If ComfyUI is connected but a
specific checkpoint's item shows "failed", check the checkpoint-path-matching
section above.

### Where do generated images end up?

Under `sample_dir`, scoped by training run and Study name (and an extra base-model
level for LoRA jobs). See [docs/filesystem.md](filesystem.md#per-training-run-layout-current)
for the exact directory layout, sidecar metadata files, and thumbnail locations.
