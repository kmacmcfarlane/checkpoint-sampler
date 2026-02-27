---
name: comfyui-api
description: >-
  Reference for the ComfyUI server API (REST and WebSocket). Use when writing code that
  interacts with a ComfyUI instance — queuing prompts, polling execution status, retrieving
  generated images, uploading inputs, or listening for real-time progress over WebSocket.
  Trigger phrases: "ComfyUI API", "queue prompt", "comfy websocket", "comfy workflow",
  "ComfyUI endpoint", "execution history". Do NOT use for ComfyUI node/plugin authoring
  or the ComfyUI web frontend itself.
disable-model-invocation: false
allowed-tools: Read, Glob, Grep, Edit, Write, Bash
---

# ComfyUI Server API Reference

## Important

- The default ComfyUI server address is `127.0.0.1:8188`.
- All REST endpoints use `http://`, WebSocket uses `ws://`.
- Workflow prompts use a node-graph JSON format (see Workflow Format below).
- Always generate a unique `client_id` (UUID4) per session for WebSocket tracking.
- Consult `references/api-reference.md` for full endpoint details, request/response schemas, and code examples.

## Core Workflow: Queue and Track Execution

### Step 1: Connect WebSocket (optional, for real-time tracking)

```
ws://<host>:<port>/ws?clientId=<uuid>
```

Receives JSON messages (`executing`, `progress`, `execution_cached`, `status`) and binary preview frames.

### Step 2: Submit a Prompt

```
POST /prompt
Body: { "prompt": { ...workflow graph... }, "client_id": "<uuid>" }
Returns: { "prompt_id": "<uuid>", "number": <queue_position>, "node_errors": {} }
```

### Step 3: Monitor Execution

**Via WebSocket:** Listen for `executing` messages. Execution is complete when `data.node` is `null` and `data.prompt_id` matches yours.

**Via polling:** `GET /prompt` returns `queue_pending` and `queue_running` arrays.

### Step 4: Retrieve Results

```
GET /history/<prompt_id>
```

Walk `outputs[node_id].images[]` for each output node. Each image has `filename`, `subfolder`, `type`.

### Step 5: Download Images

```
GET /view?filename=<name>&subfolder=<sub>&type=<folder_type>
```

Returns raw image bytes.

## Workflow Prompt Format

The prompt is a JSON object where keys are string node IDs and values are node definitions:

```json
{
  "<node_id>": {
    "class_type": "NodeClassName",
    "inputs": {
      "param": "value",
      "link_param": ["<source_node_id>", <output_index>]
    }
  }
}
```

- **Links** between nodes: `["source_node_id", output_index]` where `output_index` is a zero-based integer.
- Common node types: `CheckpointLoaderSimple`, `KSampler`, `CLIPTextEncode`, `EmptyLatentImage`, `VAEDecode`, `SaveImage`.

## Key REST Endpoints (quick reference)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/prompt` | Queue a workflow for execution |
| GET | `/prompt` | Get queue status (pending/running) |
| GET | `/queue` | Get execution queue state |
| GET | `/history` | Get all execution history |
| GET | `/history/{prompt_id}` | Get history for a specific prompt |
| GET | `/view` | Download an output image |
| POST | `/upload/image` | Upload an image for use in workflows |
| POST | `/upload/mask` | Upload a mask image |
| GET | `/object_info` | Get all available node type definitions |
| GET | `/object_info/{node_class}` | Get definition for a specific node type |
| GET | `/embeddings` | List available embeddings |
| GET | `/system_stats` | System info (GPU, VRAM, Python version) |
| GET | `/extensions` | List installed extensions |
| POST | `/interrupt` | Interrupt current execution |
| POST | `/free` | Free GPU/system memory |
| POST | `/queue` (body: `{"delete": [...]}`) | Delete items from queue |
| POST | `/queue` (body: `{"clear": true}`) | Clear the entire queue |
| POST | `/history` (body: `{"delete": [...]}`) | Delete history entries |
| POST | `/history` (body: `{"clear": true}`) | Clear all history |

## WebSocket Message Types

| Type | Description | Key Fields |
|------|-------------|------------|
| `status` | Queue status update | `data.status.exec_info.queue_remaining` |
| `execution_start` | Prompt begins executing | `data.prompt_id` |
| `execution_cached` | Nodes skipped (cached) | `data.nodes`, `data.prompt_id` |
| `executing` | Node started or finished | `data.node` (null = prompt complete), `data.prompt_id` |
| `progress` | Step progress within a node | `data.value`, `data.max`, `data.prompt_id`, `data.node` |
| `executed` | Node finished with output | `data.node`, `data.output`, `data.prompt_id` |
| `execution_error` | Node execution failed | `data.node_id`, `data.exception_message`, `data.prompt_id` |

Binary WebSocket messages are preview images. The first 8 bytes are a header; image data starts at byte offset 8.

## Examples

### Example 1: Minimal txt2img workflow

User says: "Generate an image with ComfyUI API"

```python
import json, uuid, urllib.request

server = "127.0.0.1:8188"
prompt = {
    "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "model.safetensors"}},
    "5": {"class_type": "EmptyLatentImage", "inputs": {"batch_size": 1, "height": 512, "width": 512}},
    "6": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["4", 1], "text": "a photo of a cat"}},
    "7": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["4", 1], "text": "ugly, blurry"}},
    "3": {"class_type": "KSampler", "inputs": {
        "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0],
        "latent_image": ["5", 0], "seed": 42, "steps": 20, "cfg": 8,
        "sampler_name": "euler", "scheduler": "normal", "denoise": 1
    }},
    "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
    "9": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": "ComfyUI"}}
}
data = json.dumps({"prompt": prompt}).encode()
req = urllib.request.Request(f"http://{server}/prompt", data=data)
resp = json.loads(urllib.request.urlopen(req).read())
print(f"Queued: {resp['prompt_id']}")
```

### Example 2: WebSocket monitoring with image retrieval

See `references/api-reference.md` for a complete Python example that connects via WebSocket, queues a prompt, waits for completion, and downloads all output images.

## Troubleshooting

**Error: `node_errors` in POST /prompt response**
Cause: Invalid node inputs, missing checkpoint, or broken links.
Solution: Check `node_errors` object for per-node error messages. Verify checkpoint names with `GET /object_info/CheckpointLoaderSimple`.

**Error: WebSocket disconnects unexpectedly**
Cause: Server restart, OOM, or network issue.
Solution: Implement reconnect logic with exponential backoff. Re-check queue status via `GET /prompt` after reconnecting.

**Error: `GET /view` returns 404**
Cause: Image not yet written, or wrong `type` parameter.
Solution: Ensure execution is complete (via WebSocket or history check) before fetching. Use the exact `filename`, `subfolder`, and `type` from the history output.
