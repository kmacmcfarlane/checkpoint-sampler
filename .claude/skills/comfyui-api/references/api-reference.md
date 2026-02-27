# ComfyUI Server API — Full Reference

Default server: `http://127.0.0.1:8188`

---

## REST Endpoints

### POST /prompt — Queue a Workflow

Submit a workflow prompt to the execution queue.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | object | Yes | Workflow graph (node ID -> node definition) |
| `client_id` | string | No | UUID to associate with WebSocket session |
| `extra_data` | object | No | Arbitrary extra data attached to the prompt |
| `front` | boolean | No | If true, add to front of queue |
| `number` | number | No | Priority number (lower = higher priority) |

**Request Example:**

```json
{
  "prompt": {
    "4": {
      "class_type": "CheckpointLoaderSimple",
      "inputs": { "ckpt_name": "v1-5-pruned-emaonly.safetensors" }
    },
    "5": {
      "class_type": "EmptyLatentImage",
      "inputs": { "batch_size": 1, "height": 512, "width": 512 }
    },
    "6": {
      "class_type": "CLIPTextEncode",
      "inputs": { "clip": ["4", 1], "text": "masterpiece best quality girl" }
    },
    "7": {
      "class_type": "CLIPTextEncode",
      "inputs": { "clip": ["4", 1], "text": "bad hands" }
    },
    "3": {
      "class_type": "KSampler",
      "inputs": {
        "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0],
        "latent_image": ["5", 0], "seed": 8566257, "steps": 20, "cfg": 8,
        "sampler_name": "euler", "scheduler": "normal", "denoise": 1
      }
    },
    "8": {
      "class_type": "VAEDecode",
      "inputs": { "samples": ["3", 0], "vae": ["4", 2] }
    },
    "9": {
      "class_type": "SaveImage",
      "inputs": { "filename_prefix": "ComfyUI", "images": ["8", 0] }
    }
  },
  "client_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

**Success Response (200):**

```json
{
  "prompt_id": "abc123def456",
  "number": 1,
  "node_errors": {}
}
```

**Error Response (400):**

```json
{
  "error": "Validation failed",
  "node_errors": {
    "4": "Invalid checkpoint name"
  }
}
```

---

### GET /prompt — Queue Status

Returns current queue status.

**Response:**

```json
{
  "queue_pending": [
    [<number>, <prompt_id>, <prompt>, <extra_data>, <outputs_to_execute>]
  ],
  "queue_running": [
    [<number>, <prompt_id>, <prompt>, <extra_data>, <outputs_to_execute>]
  ]
}
```

---

### GET /queue — Execution Queue State

Returns pending and running items in the queue.

**Response:**

```json
{
  "queue_pending": [...],
  "queue_running": [...]
}
```

---

### POST /queue — Delete or Clear Queue Items

**Delete specific items:**

```json
{ "delete": ["prompt_id_1", "prompt_id_2"] }
```

**Clear entire queue:**

```json
{ "clear": true }
```

---

### GET /history — All Execution History

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `max_items` | integer | Maximum number of items to return |
| `offset` | integer | Number of items to skip |

**Response:** JSON object mapping `prompt_id` -> execution record.

Each record contains:
- `prompt` — original prompt definition
- `outputs` — per-node execution outputs
- `execution_time` — time taken (seconds)
- `status` — execution status

---

### GET /history/{prompt_id} — Specific Prompt History

Returns execution history for one prompt.

**Response structure:**

```json
{
  "<prompt_id>": {
    "prompt": [...],
    "outputs": {
      "<node_id>": {
        "images": [
          { "filename": "ComfyUI_00001_.png", "subfolder": "", "type": "output" }
        ]
      }
    },
    "status": { "status_str": "success", "completed": true }
  }
}
```

---

### POST /history — Delete or Clear History

**Delete specific entries:**

```json
{ "delete": ["prompt_id_1", "prompt_id_2"] }
```

**Clear all history:**

```json
{ "clear": true }
```

---

### GET /view — Download an Image

Retrieves a generated or uploaded image.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `filename` | string | Yes | Image filename |
| `subfolder` | string | No | Subfolder path (default: "") |
| `type` | string | No | Directory type: `output`, `input`, or `temp` (default: `output`) |

**Example:**

```
GET /view?filename=ComfyUI_00001_.png&subfolder=&type=output
```

**Response:** Raw image bytes with appropriate Content-Type header.

---

### POST /upload/image — Upload an Image

Upload an image for use in workflows.

**Form Data:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `image` | file | Yes | Image file to upload |
| `type` | string | No | Destination: `input`, `output`, `temp` (default: `input`) |
| `subfolder` | string | No | Subfolder within the type directory |
| `overwrite` | boolean | No | Overwrite existing file (default: false) |

**curl Example:**

```bash
curl -X POST http://127.0.0.1:8188/upload/image \
  -F "image=@/path/to/image.png" \
  -F "type=input" \
  -F "subfolder=uploads"
```

**Response:**

```json
{
  "name": "image.png",
  "subfolder": "uploads",
  "type": "input"
}
```

---

### POST /upload/mask — Upload a Mask

Same as `/upload/image` but for mask files used in inpainting workflows.

**Form Data:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `image` | file | Yes | Mask image file |
| `original_ref` | object | No | Reference to the original image being masked |
| `type` | string | No | Destination directory type |
| `subfolder` | string | No | Subfolder path |
| `overwrite` | boolean | No | Overwrite existing (default: false) |

---

### GET /object_info — All Node Type Definitions

Returns definitions of all available node types, including their inputs, outputs, and categories.

**Response structure (per node type):**

```json
{
  "CheckpointLoaderSimple": {
    "input": {
      "required": {
        "ckpt_name": [["model1.safetensors", "model2.safetensors"]]
      },
      "optional": {}
    },
    "output": ["MODEL", "CLIP", "VAE"],
    "output_name": ["MODEL", "CLIP", "VAE"],
    "name": "CheckpointLoaderSimple",
    "display_name": "Load Checkpoint",
    "category": "loaders",
    "output_node": false
  }
}
```

Use this to discover available models, samplers, schedulers, and valid input values.

---

### GET /object_info/{node_class} — Specific Node Type

Returns the definition for a single node type.

```
GET /object_info/KSampler
```

---

### GET /embeddings — List Embeddings

Returns an array of available embedding names.

```json
["embedding1", "embedding2", "embedding3"]
```

---

### GET /extensions — List Extensions

Returns an array of installed extension URLs/paths.

---

### GET /system_stats — System Information

Returns system stats including Python version, compute devices, and VRAM.

```json
{
  "system": {
    "os": "posix",
    "python_version": "3.10.12",
    "embedded_python": false
  },
  "devices": [
    {
      "name": "cuda:0 NVIDIA GeForce RTX 4090",
      "type": "cuda",
      "index": 0,
      "vram_total": 25769803776,
      "vram_free": 20000000000,
      "torch_vram_total": 25769803776,
      "torch_vram_free": 20000000000
    }
  ]
}
```

---

### POST /interrupt — Interrupt Current Execution

Stops the currently running workflow. No request body required.

---

### POST /free — Free Memory

Frees GPU memory and/or unloads models.

**Request Body:**

```json
{ "unload_models": true, "free_memory": true }
```

---

## WebSocket API

### Connection

```
ws://<host>:<port>/ws?clientId=<uuid>
```

- Generate a unique `client_id` (UUID4) per session.
- Use the same `client_id` when calling `POST /prompt` to associate WebSocket events with your prompts.

### Message Types (JSON)

All JSON messages have the structure: `{ "type": "<type>", "data": { ... } }`

#### `status`

Queue status update. Sent on connection and whenever queue changes.

```json
{
  "type": "status",
  "data": {
    "status": {
      "exec_info": { "queue_remaining": 0 }
    }
  }
}
```

#### `execution_start`

Prompt execution has begun.

```json
{
  "type": "execution_start",
  "data": { "prompt_id": "<uuid>" }
}
```

#### `execution_cached`

Some nodes were skipped because their outputs are cached.

```json
{
  "type": "execution_cached",
  "data": {
    "nodes": ["1", "2", "4"],
    "prompt_id": "<uuid>"
  }
}
```

#### `executing`

A node has started executing, or execution is complete.

```json
{
  "type": "executing",
  "data": {
    "node": "3",
    "prompt_id": "<uuid>"
  }
}
```

**Completion signal:** When `data.node` is `null`, the prompt has finished executing.

```json
{
  "type": "executing",
  "data": {
    "node": null,
    "prompt_id": "<uuid>"
  }
}
```

#### `progress`

Step-by-step progress within a node (e.g., sampling steps in KSampler).

```json
{
  "type": "progress",
  "data": {
    "value": 5,
    "max": 20,
    "prompt_id": "<uuid>",
    "node": "3"
  }
}
```

#### `executed`

A node has finished and produced output.

```json
{
  "type": "executed",
  "data": {
    "node": "9",
    "output": {
      "images": [
        { "filename": "ComfyUI_00001_.png", "subfolder": "", "type": "output" }
      ]
    },
    "prompt_id": "<uuid>"
  }
}
```

#### `execution_error`

A node failed during execution.

```json
{
  "type": "execution_error",
  "data": {
    "prompt_id": "<uuid>",
    "node_id": "3",
    "node_type": "KSampler",
    "exception_message": "Out of memory",
    "exception_type": "RuntimeError",
    "traceback": ["..."]
  }
}
```

### Binary Messages (Preview Images)

Binary WebSocket messages contain preview images generated during execution.

**Format:**
- Bytes 0-3: Event type identifier
- Bytes 4-7: Image format and metadata
- Bytes 8+: Raw image data (typically JPEG or PNG)

To display a preview, read from byte offset 8 onward:

```python
if isinstance(message, bytes):
    preview_image_data = message[8:]
    # preview_image_data is a valid JPEG/PNG
```

---

## Workflow Prompt Format

### Structure

```json
{
  "<node_id>": {
    "class_type": "NodeClassName",
    "inputs": {
      "<input_name>": <value_or_link>,
      ...
    },
    "_meta": {
      "title": "Optional display title"
    }
  }
}
```

### Node Links

To connect one node's output to another node's input, use a 2-element array:

```json
"model": ["4", 0]
```

This means: "use output index 0 from node '4'".

Output indices are determined by the node type's `output` array (see `GET /object_info`).

### Common Node Types

#### CheckpointLoaderSimple

Loads a Stable Diffusion checkpoint (model + CLIP + VAE).

```json
{
  "class_type": "CheckpointLoaderSimple",
  "inputs": { "ckpt_name": "v1-5-pruned-emaonly.safetensors" }
}
```

**Outputs:** `[MODEL, CLIP, VAE]` (indices 0, 1, 2)

#### CLIPTextEncode

Encodes text using CLIP for conditioning.

```json
{
  "class_type": "CLIPTextEncode",
  "inputs": {
    "text": "a beautiful landscape",
    "clip": ["4", 1]
  }
}
```

**Outputs:** `[CONDITIONING]` (index 0)

#### EmptyLatentImage

Creates a blank latent image at the specified resolution.

```json
{
  "class_type": "EmptyLatentImage",
  "inputs": { "width": 512, "height": 512, "batch_size": 1 }
}
```

**Outputs:** `[LATENT]` (index 0)

#### KSampler

The main sampling node.

```json
{
  "class_type": "KSampler",
  "inputs": {
    "model": ["4", 0],
    "positive": ["6", 0],
    "negative": ["7", 0],
    "latent_image": ["5", 0],
    "seed": 42,
    "steps": 20,
    "cfg": 8.0,
    "sampler_name": "euler",
    "scheduler": "normal",
    "denoise": 1.0
  }
}
```

**Outputs:** `[LATENT]` (index 0)

Common sampler names: `euler`, `euler_ancestral`, `heun`, `dpm_2`, `dpm_2_ancestral`, `lms`, `dpmpp_2s_ancestral`, `dpmpp_2m`, `dpmpp_sde`, `dpmpp_2m_sde`, `uni_pc`, `ddim`

Common schedulers: `normal`, `karras`, `exponential`, `sgm_uniform`, `simple`, `ddim_uniform`

#### VAEDecode

Decodes latent image to pixel space.

```json
{
  "class_type": "VAEDecode",
  "inputs": {
    "samples": ["3", 0],
    "vae": ["4", 2]
  }
}
```

**Outputs:** `[IMAGE]` (index 0)

#### SaveImage

Saves an image to the output directory.

```json
{
  "class_type": "SaveImage",
  "inputs": {
    "images": ["8", 0],
    "filename_prefix": "ComfyUI"
  }
}
```

**Outputs:** None (output node)

#### LoadImage

Loads an uploaded image from the input directory.

```json
{
  "class_type": "LoadImage",
  "inputs": { "image": "uploaded_image.png" }
}
```

**Outputs:** `[IMAGE, MASK]` (indices 0, 1)

---

## Complete Python Example: WebSocket Workflow

```python
import websocket
import uuid
import json
import urllib.request
import urllib.parse

server_address = "127.0.0.1:8188"
client_id = str(uuid.uuid4())


def queue_prompt(prompt, prompt_id):
    """Submit a workflow to the execution queue."""
    p = {"prompt": prompt, "client_id": client_id, "prompt_id": prompt_id}
    data = json.dumps(p).encode("utf-8")
    req = urllib.request.Request(f"http://{server_address}/prompt", data=data)
    return json.loads(urllib.request.urlopen(req).read())


def get_image(filename, subfolder, folder_type):
    """Download an image from the server."""
    data = {"filename": filename, "subfolder": subfolder, "type": folder_type}
    url_values = urllib.parse.urlencode(data)
    with urllib.request.urlopen(
        f"http://{server_address}/view?{url_values}"
    ) as response:
        return response.read()


def get_history(prompt_id):
    """Retrieve execution history for a prompt."""
    with urllib.request.urlopen(
        f"http://{server_address}/history/{prompt_id}"
    ) as response:
        return json.loads(response.read())


def get_images(ws, prompt):
    """Queue a prompt, wait for completion via WebSocket, return output images."""
    prompt_id = str(uuid.uuid4())
    queue_prompt(prompt, prompt_id)
    output_images = {}

    while True:
        out = ws.recv()
        if isinstance(out, str):
            message = json.loads(out)
            if message["type"] == "executing":
                data = message["data"]
                if data["node"] is None and data["prompt_id"] == prompt_id:
                    break  # Execution complete
        else:
            continue  # Binary data = preview image

    history = get_history(prompt_id)[prompt_id]
    for node_id in history["outputs"]:
        node_output = history["outputs"][node_id]
        if "images" in node_output:
            images_output = []
            for image in node_output["images"]:
                image_data = get_image(
                    image["filename"], image["subfolder"], image["type"]
                )
                images_output.append(image_data)
            output_images[node_id] = images_output

    return output_images


# --- Usage ---
prompt = {
    "4": {
        "class_type": "CheckpointLoaderSimple",
        "inputs": {"ckpt_name": "model.safetensors"},
    },
    "5": {
        "class_type": "EmptyLatentImage",
        "inputs": {"batch_size": 1, "height": 512, "width": 512},
    },
    "6": {
        "class_type": "CLIPTextEncode",
        "inputs": {"clip": ["4", 1], "text": "beautiful landscape"},
    },
    "7": {
        "class_type": "CLIPTextEncode",
        "inputs": {"clip": ["4", 1], "text": "ugly, blurry"},
    },
    "3": {
        "class_type": "KSampler",
        "inputs": {
            "model": ["4", 0],
            "positive": ["6", 0],
            "negative": ["7", 0],
            "latent_image": ["5", 0],
            "seed": 42,
            "steps": 20,
            "cfg": 8,
            "sampler_name": "euler",
            "scheduler": "normal",
            "denoise": 1,
        },
    },
    "8": {
        "class_type": "VAEDecode",
        "inputs": {"samples": ["3", 0], "vae": ["4", 2]},
    },
    "9": {
        "class_type": "SaveImage",
        "inputs": {"images": ["8", 0], "filename_prefix": "ComfyUI"},
    },
}

ws = websocket.WebSocket()
ws.connect(f"ws://{server_address}/ws?clientId={client_id}")
images = get_images(ws, prompt)
ws.close()

# images is dict: {node_id: [bytes, ...]}
for node_id, image_list in images.items():
    for i, img_data in enumerate(image_list):
        with open(f"output_{node_id}_{i}.png", "wb") as f:
            f.write(img_data)
```

---

## Go Example: Queue and Poll

```go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "net/url"
    "time"

    "github.com/google/uuid"
)

const serverAddr = "http://127.0.0.1:8188"

type PromptRequest struct {
    Prompt   map[string]interface{} `json:"prompt"`
    ClientID string                 `json:"client_id,omitempty"`
}

type PromptResponse struct {
    PromptID   string                 `json:"prompt_id"`
    Number     int                    `json:"number"`
    NodeErrors map[string]interface{} `json:"node_errors"`
}

func queuePrompt(prompt map[string]interface{}) (*PromptResponse, error) {
    req := PromptRequest{Prompt: prompt, ClientID: uuid.New().String()}
    body, _ := json.Marshal(req)

    resp, err := http.Post(serverAddr+"/prompt", "application/json", bytes.NewReader(body))
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    var result PromptResponse
    if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
        return nil, err
    }
    return &result, nil
}

func getHistory(promptID string) (map[string]interface{}, error) {
    resp, err := http.Get(serverAddr + "/history/" + promptID)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    var result map[string]interface{}
    json.NewDecoder(resp.Body).Decode(&result)
    return result, nil
}

func downloadImage(filename, subfolder, folderType string) ([]byte, error) {
    params := url.Values{}
    params.Set("filename", filename)
    params.Set("subfolder", subfolder)
    params.Set("type", folderType)

    resp, err := http.Get(serverAddr + "/view?" + params.Encode())
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()
    return io.ReadAll(resp.Body)
}
```
