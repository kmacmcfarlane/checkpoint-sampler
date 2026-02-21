# Filesystem Structure

This document describes the directory layout and naming conventions that Checkpoint Sampler expects.

## Overview

The tool reads from two distinct directory trees:

1. **Checkpoint directories** (`checkpoint_dirs`): Where `.safetensors` checkpoint files live. Scanned recursively to discover training runs.
2. **Sample directory** (`sample_dir`): Where ComfyUI outputs sample images. Each subdirectory is named after a checkpoint filename and contains the generated images.

## Checkpoint directories

Each entry in `checkpoint_dirs` is recursively scanned for `.safetensors` files. The relative path within the checkpoint dir (including subdirectories) is preserved for grouping.

```
checkpoint_dirs[0]: ~/ai/models-training/stable-diffusion/checkpoints/
├── qwen/
│   ├── psai4rt-v0.3.0-no-reg.safetensors                     ← final checkpoint
│   ├── psai4rt-v0.3.0-no-reg-step00004500.safetensors         ← intermediate
│   ├── psai4rt-v0.3.0-no-reg-step00004750.safetensors         ← intermediate
│   ├── psai4rt-v0.3.0-no-reg-step00005000.safetensors         ← intermediate
│   └── other-experiment.safetensors
└── flux/
    ├── my-flux-lora.safetensors
    └── my-flux-lora-step00001000.safetensors
```

### Suffix stripping rules

Checkpoint files are grouped into training runs by stripping suffixes from the filename. The rules are applied in order:

1. **Remove `.safetensors` extension** — always present
2. **Remove step suffix**: `-step<NNNNN>` (e.g., `-step00004500`) — variable-length digits
3. **Remove epoch suffix**: `-<NNNNNN>` (e.g., `-000104`) — exactly 6 digits preceded by a hyphen

After stripping, the remaining base name (including the relative directory path) identifies the training run.

**Examples:**

| Filename | After stripping | Training run |
|----------|----------------|--------------|
| `qwen/psai4rt-v0.3.0-no-reg.safetensors` | `qwen/psai4rt-v0.3.0-no-reg` | `qwen/psai4rt-v0.3.0-no-reg` |
| `qwen/psai4rt-v0.3.0-no-reg-step00004500.safetensors` | `qwen/psai4rt-v0.3.0-no-reg` | `qwen/psai4rt-v0.3.0-no-reg` |
| `qwen/psai4rt-v0.3.0-no-reg-000104.safetensors` | `qwen/psai4rt-v0.3.0-no-reg` | `qwen/psai4rt-v0.3.0-no-reg` |
| `flux/my-flux-lora-step00001000.safetensors` | `flux/my-flux-lora` | `flux/my-flux-lora` |

### Checkpoint dimension extraction

The stripped suffix provides the `checkpoint` dimension value for each file:

- `-step00004500` → checkpoint value `4500` (numeric)
- `-000104` → checkpoint value `104` (numeric)
- No suffix (final checkpoint) → assigned `max_train_steps` from the training run name if detectable, otherwise sorted last

Checkpoint values are sorted numerically.

## Sample directory

The `sample_dir` contains subdirectories named after checkpoint filenames (exact match, including `.safetensors` extension). Each subdirectory contains the ComfyUI-generated sample images for that checkpoint.

```
sample_dir: ~/ai/outputs/stable-diffusion/comfyui/
├── psai4rt-v0.3.0-no-reg.safetensors/
│   ├── index=0&prompt_name=forest_portals&seed=420&cfg=1&_00001_.png
│   ├── index=0&prompt_name=forest_portals&seed=421&cfg=1&_00001_.png
│   └── index=1&prompt_name=portal_hub&seed=420&cfg=3&_00001_.png
├── psai4rt-v0.3.0-no-reg-step00004500.safetensors/
│   ├── index=0&prompt_name=forest_portals&seed=420&cfg=1&_00001_.png
│   └── ...
└── my-flux-lora.safetensors/
    └── ...
```

### Checkpoint-to-sample mapping

The mapping between checkpoint files and sample directories uses **exact filename matching**:

- Checkpoint file: `qwen/psai4rt-v0.3.0-no-reg-step00004500.safetensors`
- Expected sample directory: `<sample_dir>/psai4rt-v0.3.0-no-reg-step00004500.safetensors/`

Note: Only the checkpoint filename (not the relative path within checkpoint_dirs) is used for matching against sample_dir. The sample directory name includes the `.safetensors` extension.

### Image filename encoding

Image filenames use query-string encoding to embed dimension values:

```
index=0&prompt_name=forest_portals&seed=420&cfg=1&_00001_.png
```

Parsed dimensions from this filename:
- `index` = `0`
- `prompt_name` = `forest_portals`
- `seed` = `420`
- `cfg` = `1`

### Batch counter

The `_NNNNN_` suffix (e.g., `_00001_`) is a ComfyUI batch counter. It is **not** treated as a dimension. When multiple batch files exist for the same parameter combination, the highest-numbered file is used (latest batch wins).

## Configuration example

```yaml
checkpoint_dirs:
  - /home/rt/ai/models-training/stable-diffusion/checkpoints

sample_dir: /home/rt/ai/outputs/stable-diffusion/comfyui

port: 8080
db_path: ./data/checkpoint-sampler.db
```

## Security

- The backend only reads files within the configured `checkpoint_dirs` and `sample_dir`.
- Path traversal outside these directories is rejected.
- Checkpoint directories are scanned for `.safetensors` files only (no other file types are read from these directories).
- Image files are only served from within `sample_dir`.
