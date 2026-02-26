# Workflow Templates

This document explains how to create ComfyUI workflow templates that are compatible with Checkpoint Sampler.

## Overview

Checkpoint Sampler uses ComfyUI as its inference backend. Rather than running inference itself, it submits parameterized workflows to ComfyUI's HTTP API. To do this, it needs to know which nodes in your workflow correspond to the checkpoint, sampler, prompts, and other configurable parameters.

**Regular ComfyUI exports will not work out of the box.** A compatible workflow requires `cs_role` annotations on specific nodes. These annotations tell Checkpoint Sampler which node inputs to substitute when generating images for each checkpoint and parameter combination.

Workflow template files are stored as ComfyUI API-format JSON files in the `workflow_dir` configured in `config.yaml` (default: `./workflows`).

## How it works

When Checkpoint Sampler generates images, it iterates over every checkpoint in a training run and every combination of parameters defined in the sample preset. For each combination, it:

1. Loads the workflow template JSON.
2. Substitutes values into the annotated nodes (checkpoint path, sampler settings, prompts, etc.).
3. Submits the modified workflow to ComfyUI's `/prompt` API.
4. Waits for completion, downloads the output image, and saves it to `sample_dir`.

The `cs_role` field in each node's `_meta` object identifies what that node does. Nodes without a `cs_role` are passed through to ComfyUI unchanged.

## cs_role reference

| cs_role | Required | Fields substituted | Source |
|---------|----------|--------------------|--------|
| `save_image` | Yes | `filename_prefix` | Controlled by Checkpoint Sampler (not user-configurable) |
| `unet_loader` | No | `unet_name` | Per-checkpoint path (auto-matched from training run) |
| `clip_loader` | No | `clip_name` | Job-level setting (user selects from ComfyUI's available CLIPs) |
| `vae_loader` | No | `vae_name` | Job-level setting (user selects from ComfyUI's available VAEs) |
| `sampler` | No | `seed`, `steps`, `cfg`, `sampler_name`, `scheduler` | Sample preset (iterated across all combinations) |
| `positive_prompt` | No | `text` | Sample preset (iterated across prompt list) |
| `negative_prompt` | No | `text` | Sample preset (single negative prompt, same for all images) |
| `shift` | No | `shift` | Job-level setting (e.g., AuraFlow shift parameter) |
| `latent_image` | No | `width`, `height` | Sample preset (width and height fields) |

### Required role: save_image

Every workflow template must have at least one node with `cs_role: "save_image"`. This is the only required annotation. Checkpoint Sampler sets the `filename_prefix` input on this node to control where ComfyUI saves the output file.

### Optional roles

All other roles are optional. When a role is absent from a workflow:

- The corresponding job-level setting is hidden in the UI when launching a sample job (e.g., no VAE selector if `vae_loader` is absent, no shift field if `shift` is absent).
- The corresponding inputs are left at whatever values are in the workflow JSON.

This means you can use a workflow template that hard-codes certain settings (for example, a fixed VAE or a static positive prompt) and Checkpoint Sampler will leave those nodes untouched.

### unet_loader and checkpoint path matching

The `unet_loader` role controls which checkpoint is loaded. When Checkpoint Sampler processes each checkpoint in a training run, it queries ComfyUI for its available model list and matches the checkpoint filename to find the ComfyUI-relative path (as configured in ComfyUI's `extra_model_paths.yaml`). This matched path is substituted into the `unet_name` input.

Checkpoints that cannot be matched in ComfyUI's model list are skipped with an error logged on the job item. The checkpoint files must be accessible to both Checkpoint Sampler (via `checkpoint_dirs`) and ComfyUI (via `extra_model_paths.yaml`).

Note: The role is named `unet_loader` but it supports any model loader node (including `CheckpointLoader` nodes that set `ckpt_name`). The substitution sets `unet_name` — if your workflow uses a `CheckpointLoader` that expects `ckpt_name`, rename the input field in your workflow or use a `UNETLoader` node instead.

### negative_prompt

The `negative_prompt` role marks the negative conditioning node. Checkpoint Sampler reads the negative prompt text from the sample preset but does not currently inject it into the workflow at execution time — the value in the workflow template JSON is used as-is. The negative prompt from the sample preset is stored in the sidecar metadata file alongside each generated image for reference.

If you want a specific negative prompt to apply, set the `text` input of the negative prompt node directly in the workflow template.

## Exporting a compatible workflow from ComfyUI

ComfyUI has two export formats:

- **Workflow (GUI format)**: The default export from the Save/Load menu. This is for use within ComfyUI's visual editor.
- **API format**: The format Checkpoint Sampler requires. This can be exported by enabling the "Dev mode options" in ComfyUI's settings and then clicking "Save (API Format)".

To enable API format export in ComfyUI:
1. Open ComfyUI settings (gear icon).
2. Enable "Dev mode options".
3. A "Save (API Format)" button will appear in the queue/export controls.

The API format JSON has nodes keyed by their node ID (a string like `"1"` or `"75:37"`). This is the format Checkpoint Sampler parses.

## Adding a workflow template

### Step 1: Build and test your workflow in ComfyUI

Set up your complete generation pipeline in ComfyUI and verify it produces images correctly with a single checkpoint. Use the nodes and settings you want to parameterize.

### Step 2: Export as API format

Once the workflow produces the expected output, export it using "Save (API Format)" as described above. Save the file as `<workflow-name>.json`.

### Step 3: Annotate nodes with cs_role

Open the exported JSON in a text editor and add `"cs_role"` entries to the `"_meta"` objects of the nodes you want Checkpoint Sampler to control. A `"_meta"` object already exists on every node in the API export (it holds the node title visible in ComfyUI's UI). Add `"cs_role"` as a new field inside it.

Nodes that do not need to be controlled by Checkpoint Sampler do not need any annotation — leave them exactly as exported.

### Step 4: Add the file to the workflow directory

Copy the annotated JSON file to your `workflow_dir` (default: `./workflows/`). The directory is created automatically on first startup if it does not exist.

Checkpoint Sampler scans the directory at startup and on each API call to the `/api/workflows` endpoint. Subdirectories are not scanned — only `.json` files at the top level of the directory are loaded.

### Step 5: Verify in the UI

Open the "Generate Samples" dialog in Checkpoint Sampler. The workflow should appear in the workflow selector. If it does not appear or shows an error indicator, check the backend logs for validation messages.

## Example: annotated workflow

The following is an abbreviated example showing how to annotate a workflow. This is based on the `qwen-image.json` template included in the repository.

```json
{
  "75:37": {
    "inputs": {
      "unet_name": "checkpoints/qwen/qwen_image_2512_bf16.safetensors",
      "weight_dtype": "default"
    },
    "class_type": "UNETLoader",
    "_meta": {
      "title": "Load Diffusion Model",
      "cs_role": "unet_loader"
    }
  },
  "75:38": {
    "inputs": {
      "clip_name": "qwen/qwen_2.5_vl_7b.safetensors",
      "type": "qwen_image",
      "device": "default"
    },
    "class_type": "CLIPLoader",
    "_meta": {
      "title": "Load CLIP",
      "cs_role": "clip_loader"
    }
  },
  "75:39": {
    "inputs": {
      "vae_name": "qwen/qwen_image_vae_comfy.safetensors"
    },
    "class_type": "VAELoader",
    "_meta": {
      "title": "Load VAE",
      "cs_role": "vae_loader"
    }
  },
  "75:6": {
    "inputs": {
      "text": "my prompt",
      "clip": ["75:38", 0]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP Text Encode (Positive Prompt)",
      "cs_role": "positive_prompt"
    }
  },
  "75:7": {
    "inputs": {
      "text": "",
      "clip": ["75:38", 0]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP Text Encode (Negative Prompt)",
      "cs_role": "negative_prompt"
    }
  },
  "75:58": {
    "inputs": {
      "width": 1344,
      "height": 1344,
      "batch_size": 1
    },
    "class_type": "EmptySD3LatentImage",
    "_meta": {
      "title": "EmptySD3LatentImage",
      "cs_role": "latent_image"
    }
  },
  "75:3": {
    "inputs": {
      "seed": 420,
      "steps": 1,
      "cfg": 3,
      "sampler_name": "res_multistep",
      "scheduler": "simple",
      "denoise": 1,
      "model": ["75:81", 0],
      "positive": ["75:6", 0],
      "negative": ["75:7", 0],
      "latent_image": ["75:58", 0]
    },
    "class_type": "KSampler",
    "_meta": {
      "title": "KSampler",
      "cs_role": "sampler"
    }
  },
  "75:81": {
    "inputs": {
      "shift": 3,
      "model": ["75:37", 0]
    },
    "class_type": "ModelSamplingAuraFlow",
    "_meta": {
      "title": "ModelSamplingAuraFlow",
      "cs_role": "shift"
    }
  },
  "75:8": {
    "inputs": {
      "samples": ["75:3", 0],
      "vae": ["75:39", 0]
    },
    "class_type": "VAEDecode",
    "_meta": {
      "title": "VAE Decode"
    }
  },
  "95": {
    "inputs": {
      "filename_prefix": "ComfyUI",
      "images": ["75:8", 0]
    },
    "class_type": "SaveImage",
    "_meta": {
      "title": "Save Image",
      "cs_role": "save_image"
    }
  }
}
```

Key points visible in this example:

- The `VAEDecode` node (`75:8`) has no `cs_role` — it passes through to ComfyUI unchanged.
- The `SaveImage` node (`95`) has `cs_role: "save_image"`. The `filename_prefix` value in the JSON (`"ComfyUI"`) is replaced at runtime.
- The values present in `inputs` for annotated nodes (e.g., `"seed": 420` in the sampler node) are placeholder defaults from when the workflow was exported. They are replaced by Checkpoint Sampler at execution time.
- Node IDs like `"75:37"` are ComfyUI API-format identifiers. Their exact format does not matter — Checkpoint Sampler treats them as opaque keys.

## Validation

When Checkpoint Sampler loads a workflow file, it performs the following checks:

- The file is valid JSON.
- The JSON is a top-level object (not an array or scalar).
- At least one node has `cs_role: "save_image"`.

If any of these checks fail, the workflow is marked as invalid. Invalid workflows still appear in the UI with an error indicator so you know they are present but unusable.

Additionally, any `cs_role` value that is not in the known list (see the table above) generates a warning in the backend logs, but the workflow is still considered valid. This allows custom or future roles to be added without breaking existing installations.

Non-JSON files and subdirectories in `workflow_dir` are ignored silently.

## Troubleshooting

**Workflow does not appear in the UI**

- Confirm the file is in the `workflow_dir` directory (not a subdirectory).
- Confirm the file has a `.json` extension.
- Check backend logs for JSON parse errors or load failures.

**Workflow appears with an error indicator**

- The workflow is missing the required `save_image` role.
- Add `"cs_role": "save_image"` to the `_meta` object of your `SaveImage` node.

**Generated images are saved but use wrong settings**

- Verify the `cs_role` annotations are on the correct nodes. In workflows with multiple nodes of the same `class_type`, confirm the role is on the node that should be controlled.
- Each `cs_role` value should appear on exactly one node (with the exception of unusual workflows that require the same role on multiple nodes — Checkpoint Sampler will substitute into all of them).

**Checkpoint is skipped with an error**

- The checkpoint file is not accessible to ComfyUI. Verify the checkpoint directory is in ComfyUI's `extra_model_paths.yaml`.
- The checkpoint filename must match between Checkpoint Sampler's scan and ComfyUI's model list. Path matching is by filename, not full path.
