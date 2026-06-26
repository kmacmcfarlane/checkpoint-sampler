# API Design

## 1) Overview

The backend API is built with **Goa v3**, a design-first framework for Go. The API design DSL in
`/backend/internal/api/design/` is the source of truth for all endpoints, payloads, and responses. This document
enumerates every service group and endpoint and is cross-checkable 1:1 against `design/*.go`.

## 2) Design-first workflow

### 2.1 Source of truth

The Goa DSL files under `/backend/internal/api/design/` define:
- Service groupings and HTTP paths
- Method signatures (request/response types)
- Error types and HTTP status mappings
- Result/payload attribute validation directives

CORS is **not** defined in the DSL — it is implemented as transport middleware (`internal/api/cors.go`). See §8.

### 2.2 Code generation

```
backend/internal/api/design/   ← DSL definitions (hand-edited)
        │
        │  `make gen` (goa gen)
        ▼
backend/internal/api/gen/      ← Generated code (DO NOT EDIT)
```

- Generated code includes HTTP transport, encoding/decoding, and OpenAPI specs.
- Regenerate after any design change: `cd backend && make gen`.
- Mock generation (mockery) runs after Goa codegen when interfaces change.

### 2.3 Swagger / OpenAPI

- Swagger UI is hosted at `/docs` (served by the `docs` Goa service via static `Files`).
- The generated OpenAPI 3.0 spec is served at `/docs/openapi3.json`.
- The Swagger UI provides interactive API documentation and testing.

### 2.4 Validation

Validation is expressed with Goa attribute directives in the design DSL, applied to payload/result types. No design
file uses the `Format()` directive. The directives actually in use are:

- `Required(...)` — mandatory attributes (used pervasively across all payloads and results).
- `Enum(...)` — constrained string values (e.g. `comfyui.models` `type` ∈ {vae, clip, unet, sampler, scheduler};
  job `status` enum; `training_runs.list` `source` ∈ {samples, checkpoints}; dimension `type` ∈ {int, string};
  workflow `validation_state` ∈ {valid, invalid}; study `sample_status` ∈ {none, partial, complete}).
- `MinLength(...)` — non-empty strings and non-empty arrays (e.g. study `name`, `prompts`, `steps`, `cfgs`,
  `seeds`, `sampler_scheduler_pairs`; preset `name`; `NamedPrompt.name`/`.text`).
- `Minimum(...)` — numeric lower bounds (e.g. training-run/`id` and `training_run_id` ≥ 0; study `width`/`height` ≥ 1).
- `Default(...)` — default values for optional query params and flags (e.g. `source="samples"`, `refresh=false`,
  `delete_data=false`, `clear_existing=false`, `missing_only=false`, study string defaults `""`).

Path-traversal rejection for image and checkpoint paths is **not** a DSL directive — it is enforced in the store
layer and surfaced as the `invalid_payload` error (see §5 and the `images`/`checkpoints` services).

## 3) Service groups and endpoints

The API is organized into Goa services, each defined in a file under `design/`. The table below lists every
`Service(...)` in the design package. Each row maps 1:1 to a `*.go` file.

| Service         | File              | Base path(s)              | Purpose                                                       |
|-----------------|-------------------|---------------------------|--------------------------------------------------------------|
| `health`        | health.go         | `/health`, `/api/config`  | Health check and UI-relevant config limits                   |
| `docs`          | docs.go           | `/docs`                   | Swagger UI assets and OpenAPI 3.0 spec                        |
| `training_runs` | training_runs.go  | `/api/training-runs`      | Discover, scan, and validate training runs                   |
| `studies`       | studies.go        | `/api/studies`            | CRUD + fork for studies; sample availability/affected runs   |
| `sample_jobs`   | sample_jobs.go    | `/api/sample-jobs`        | Sample job orchestration (create/start/stop/resume/retry)    |
| `presets`       | presets.go        | `/api/presets`            | CRUD for dimension-mapping presets                           |
| `images`        | images.go         | `/api/images`             | Serve image bytes and image metadata                         |
| `checkpoints`   | checkpoints.go    | `/api/checkpoints`        | Read safetensors training metadata                           |
| `base_models`   | base_models.go    | `/api/base-models`        | List available base-model `.safetensors` files               |
| `comfyui`       | comfyui.go        | `/api/comfyui`            | ComfyUI connection status and model lists                    |
| `workflows`     | workflows.go      | `/api/workflows`          | List and inspect ComfyUI workflow templates                  |
| `demo`          | demo.go           | `/api/demo`               | Install/uninstall the demo dataset                           |
| `ws`            | ws.go             | `/api/ws`                 | WebSocket stream of filesystem + job-progress events         |

### 3.1 URL conventions

- Resource collections: plural nouns (e.g. `/api/presets`, `/api/studies`).
- Individual resources: collection + ID (e.g. `/api/presets/{id}`).
- Actions: sub-paths where RESTful verbs don't suffice (e.g. `/api/sample-jobs/{id}/start`,
  `/api/training-runs/{id}/scan`).
- Standard HTTP methods: GET (read), POST (create/action), PUT (update), DELETE (remove).

## 4) Endpoint reference

Errors below use the canonical codes from §5. Status codes are the DSL-declared HTTP responses.

### 4.1 health (`health.go`)

| Method   | HTTP                      | Result          | Errors |
|----------|---------------------------|-----------------|--------|
| `check`  | `GET /health`             | `HealthResult`  | —      |
| `config` | `GET /api/config`         | `ConfigResult`  | —      |

`config` exposes UI-relevant limits — currently `max_study_items` (the maximum total work items allowed per
study/job). Added in S-153.

### 4.2 docs (`docs.go`)

| Method    | HTTP                          | Result  | Errors |
|-----------|-------------------------------|---------|--------|
| `openapi` | `GET /docs/openapi3.json`     | `Bytes` (`application/json`) | — |
| (files)   | `GET /docs/{*path}`           | static Swagger UI assets | — |

### 4.3 training_runs (`training_runs.go`)

| Method     | HTTP                                  | Result                             | Errors                          |
|------------|---------------------------------------|------------------------------------|---------------------------------|
| `list`     | `GET /api/training-runs`              | `[]TrainingRunResponse`            | `internal_error`                |
| `validate` | `POST /api/training-runs/{id}/validate` | `ValidationResultResponse`       | `not_found`, `internal_error`   |
| `scan`     | `GET /api/training-runs/{id}/scan`   | `ScanResultResponse`               | `not_found`, `internal_error`   |

- `list` accepts `source` (`samples`|`checkpoints`, default `samples`) and `refresh` (default `false`, forces a
  fresh filesystem rescan, bypassing the FSState cache — B-142).
- `validate` accepts optional `study_id` and `study_output_dir` query params for study-aware validation.
- `scan` accepts optional `study_name` to scope the scan to a study subdirectory.

### 4.4 studies (`studies.go`)

| Method          | HTTP                                   | Result                          | Errors                                       |
|-----------------|----------------------------------------|---------------------------------|----------------------------------------------|
| `list`          | `GET /api/studies`                     | `[]StudyResponse`               | `internal_error`                             |
| `create`        | `POST /api/studies`                    | `StudyResponse` (201)           | `invalid_payload`, `internal_error`          |
| `update`        | `PUT /api/studies/{id}`                | `StudyResponse`                 | `not_found`, `invalid_payload`, `internal_error` |
| `fork`          | `POST /api/studies/{source_id}/fork`   | `StudyResponse` (201)           | `not_found`, `invalid_payload`, `internal_error` |
| `has_samples`   | `GET /api/studies/{id}/has-samples`    | `HasSamplesResponse`            | `not_found`, `internal_error`                |
| `delete`        | `DELETE /api/studies/{id}`             | (204)                           | `not_found`, `internal_error`                |
| `affected_runs` | `GET /api/studies/{id}/affected-runs`  | `[]AffectedRunResponse`         | `not_found`, `internal_error`                |
| `availability`  | `GET /api/studies/availability`        | `[]StudyAvailabilityResponse`   | `not_found`, `internal_error`                |

- `delete` accepts `delete_data` (default `false`) to also remove the study's sample output directory.
- `availability` requires the `training_run_id` query param.

### 4.5 sample_jobs (`sample_jobs.go`)

| Method         | HTTP                                       | Result                | Errors                                                       |
|----------------|--------------------------------------------|-----------------------|-------------------------------------------------------------|
| `list`         | `GET /api/sample-jobs`                     | `[]SampleJobResponse` | `internal_error`                                            |
| `show`         | `GET /api/sample-jobs/{id}`                | `SampleJobDetailResponse` | `not_found`, `internal_error`                           |
| `create`       | `POST /api/sample-jobs`                    | `SampleJobResponse` (201) | `not_found`, `invalid_payload`, `too_many_items`, `internal_error` |
| `start`        | `POST /api/sample-jobs/{id}/start`         | `SampleJobResponse`   | `not_found`, `invalid_state`, `service_unavailable`         |
| `stop`         | `POST /api/sample-jobs/{id}/stop`          | `SampleJobResponse`   | `not_found`, `invalid_state`                                |
| `resume`       | `POST /api/sample-jobs/{id}/resume`        | `SampleJobResponse`   | `not_found`, `invalid_state`, `service_unavailable`         |
| `retry_failed` | `POST /api/sample-jobs/{id}/retry-failed`  | `SampleJobResponse`   | `not_found`, `invalid_state`, `service_unavailable`         |
| `delete`       | `DELETE /api/sample-jobs/{id}`             | (204)                 | `not_found`, `internal_error`                               |

- `create` computes total work items; exceeding the configured maximum returns `too_many_items` (422).
- `delete` accepts `delete_data` (default `false`) to also remove generated sample files from disk.

### 4.6 presets (`presets.go`)

| Method   | HTTP                       | Result                 | Errors                                     |
|----------|----------------------------|------------------------|--------------------------------------------|
| `list`   | `GET /api/presets`         | `[]PresetResponse`     | `internal_error`                           |
| `create` | `POST /api/presets`        | `PresetResponse` (201) | `invalid_payload`, `internal_error`        |
| `update` | `PUT /api/presets/{id}`    | `PresetResponse`       | `not_found`, `invalid_payload`, `internal_error` |
| `delete` | `DELETE /api/presets/{id}` | (204)                  | `not_found`, `internal_error`              |

### 4.7 images (`images.go`)

| Method     | HTTP                                  | Result                  | Errors                          |
|------------|---------------------------------------|-------------------------|---------------------------------|
| `download` | `GET /api/images/{*filepath}`         | image bytes (streamed)  | `not_found`, `invalid_payload`  |
| `metadata` | `GET /api/_images_metadata/{*filepath}` | `ImageMetadataResponse` | `not_found`, `invalid_payload` |

- `download` uses `SkipResponseBodyEncodeDecode()` and streams the raw file. The response carries `Content-Type`,
  `Content-Length`, and `Cache-Control` headers (see §9 for content-type detection).
- `metadata` is registered under `/api/_images_metadata/{*filepath}` and re-routed to the logical
  `/api/images/{filepath}/metadata` path by a custom handler wrapper (`http.go`) due to chi router limitations.
  It returns string-valued and numeric-valued metadata maps parsed from a JSON sidecar or PNG `tEXt` chunks.
- `invalid_payload` is returned when the resolved path escapes the configured sample root (path-traversal
  rejection enforced in the store layer).

### 4.8 checkpoints (`checkpoints.go`)

| Method     | HTTP                                        | Result                        | Errors                          |
|------------|---------------------------------------------|-------------------------------|---------------------------------|
| `metadata` | `GET /api/checkpoints/{filename}/metadata`  | `CheckpointMetadataResponse`  | `not_found`, `invalid_payload`  |

Returns the `ss_*` training metadata fields read from a safetensors file header. `invalid_payload` covers a
rejected filename (path traversal).

### 4.9 base_models (`base_models.go`)

| Method | HTTP                     | Result               | Errors           |
|--------|--------------------------|----------------------|------------------|
| `list` | `GET /api/base-models`   | `BaseModelsResult`   | `internal_error` |

Lists `.safetensors` base-model filenames from `base_model_dir` (falling back to `checkpoint_dirs[0]`).

### 4.10 comfyui (`comfyui.go`)

| Method   | HTTP                          | Result                  | Errors                                  |
|----------|-------------------------------|-------------------------|-----------------------------------------|
| `status` | `GET /api/comfyui/status`     | `ComfyUIStatusResult`   | —                                       |
| `models` | `GET /api/comfyui/models`     | `ComfyUIModelsResult`   | `service_unavailable`, `internal_error` |

`models` requires the `type` query param (enum: vae, clip, unet, sampler, scheduler). A down/unreachable ComfyUI
connection returns `service_unavailable` (503) rather than an unmapped 500 (R-016).

### 4.11 workflows (`workflows.go`)

| Method | HTTP                        | Result                | Errors           |
|--------|-----------------------------|-----------------------|------------------|
| `list` | `GET /api/workflows`        | `[]WorkflowSummary`   | `internal_error` |
| `show` | `GET /api/workflows/{name}` | `WorkflowDetails`     | `not_found`      |

### 4.12 demo (`demo.go`)

| Method      | HTTP                         | Result                | Errors           |
|-------------|------------------------------|-----------------------|------------------|
| `status`    | `GET /api/demo/status`       | `DemoStatusResponse`  | `internal_error` |
| `install`   | `POST /api/demo/install`     | `DemoStatusResponse`  | `internal_error` |
| `uninstall` | `DELETE /api/demo`           | `DemoStatusResponse`  | `internal_error` |

### 4.13 ws (`ws.go`)

| Method      | HTTP                | Result                              | Errors |
|-------------|---------------------|-------------------------------------|--------|
| `subscribe` | `GET /api/ws`       | streaming `FSEventResponse` (WebSocket) | —  |

See §6 for the full WebSocket message protocol.

## 5) Error handling

### 5.1 Error response type

API errors use Goa's built-in `ErrorResult` type (the generated `goa.ServiceError`). Each design method declares
its errors with `Error("<code>", ErrorResult, "...")`, where `<code>` is one of the canonical codes in §5.3. On
the wire the default Goa error envelope carries the code in a `name` field plus a sanitized `message`:

```
{
  "name": "STABLE_ERROR_CODE",
  "message": "Human-readable description"
}
```

- The `name` is a stable string for programmatic consumption by the frontend. The frontend client
  (`frontend/src/api/client.ts`) maps `body.name` onto the `code` field of its `ApiError` type.
- The `message` is a sanitized, user-facing description.
- No secrets, stack traces, or internal details are exposed in error responses.

### 5.2 HTTP status mapping

Each design method maps its declared errors to HTTP status codes in the method's `HTTP(...)` block (e.g.
`Response("not_found", StatusNotFound)`).

### 5.3 Canonical error vocabulary (R-016)

Every design method that can fail declares its error set from the shared vocabulary below. One canonical code is
used per failure class across all services so the frontend can rely on stable codes without per-service
special-casing. The canonical set is documented in `backend/internal/api/design/errors.go` and surfaced to the
frontend as the `ApiErrorCode` type in `frontend/src/api/types.ts`.

| Code                  | HTTP status | Meaning                                                                                          |
|-----------------------|-------------|--------------------------------------------------------------------------------------------------|
| `internal_error`      | 500         | Unexpected server-side failure: DB error, filesystem error, or a failed scan/discovery/validation. |
| `not_found`           | 404         | The requested entity does not exist.                                                             |
| `invalid_payload`     | 400         | Malformed or invalid request data, including a rejected filename or file path (traversal).        |
| `invalid_state`       | 400         | The operation is not valid for the entity's current state (e.g. starting a running job).          |
| `too_many_items`      | 422         | Computed total work items exceeds the configured maximum.                                         |
| `service_unavailable` | 503         | A required dependency (the ComfyUI connection) is unavailable.                                     |

Domain-specific codes (`invalid_state`, `too_many_items`, `service_unavailable`) are retained only where the
frontend genuinely needs to distinguish them from a generic failure. All other 500-class failures collapse to
`internal_error`, all 404s to `not_found`, and all malformed-input 400s to `invalid_payload`. The frontend client
additionally emits `NETWORK_ERROR` (the request never reached the server) and `UNKNOWN_ERROR` (a non-ok response
with no Goa error envelope).

When adding a new failing method, reuse a code from this list. Introduce a new code only for a genuinely new
failure class the frontend must distinguish, and document it here and in `design/errors.go`.

## 6) WebSocket (`ws` service)

**Endpoint**: `GET /api/ws` — `subscribe` method, `StreamingResult(FSEventResponse)`.

Upgrades the HTTP connection to WebSocket. The backend pushes JSON messages to all connected clients when
filesystem changes are detected in monitored directories, when a sample job emits progress updates, or when
ComfyUI reports inference progress.

#### Connection lifecycle

1. Client sends a standard WebSocket upgrade request to `ws://<host>/api/ws` (or `wss://` over TLS).
2. The server immediately sends a `connected` event to trigger the HTTP 101 upgrade handshake before any
   filesystem events occur. This avoids write-timeout races on idle connections — particularly important for LAN
   clients behind nginx.
3. The client ignores unknown event types (including `connected`), so this handshake event is safe to dispatch.
4. The connection stays open until either the client closes it or the server shuts down.
5. On disconnect the frontend client reconnects automatically with exponential backoff (initial: 1 s, max: 30 s,
   multiplier: 2×). Backoff delay resets to the initial value on successful reconnect.

#### Message format

All messages are JSON objects with a `type` field (enum: `image_added`, `image_removed`, `directory_added`,
`job_progress`, `inference_progress`). Additional fields depend on the type. `type` and `path` are always present
(`path` is empty for non-filesystem events).

#### Filesystem events

| Type | Description |
|---|---|
| `image_added` | A new image file was detected in a checkpoint's sample directory. |
| `image_removed` | An existing image file was removed. |
| `directory_added` | A new directory was created; the frontend should trigger a full rescan. |

**Fields**: `type` (string) and `path` (string, file path relative to the configured sample directory root).

**Example**:
```json
{
  "type": "image_added",
  "path": "checkpoint.safetensors/index=0&prompt_name=forest&seed=420&cfg=1&_00001_.png"
}
```

#### Job progress events (`type=job_progress`)

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | string | yes | Always `job_progress`. |
| `path` | string | yes | Empty string (not applicable to job events). |
| `job_id` | string | no | Unique job identifier. |
| `status` | string | no | Job status: `pending`, `running`, `stopped`, `completed`, `completed_with_errors`, `failed`. |
| `total_items` | number | no | Total work items across all checkpoints. |
| `completed_items` | number | no | Items finished successfully. |
| `failed_items` | number | no | Items that failed. |
| `pending_items` | number | no | Items not yet started. |
| `checkpoints_completed` | number | no | Fully completed checkpoints. |
| `total_checkpoints` | number | no | Total checkpoints in the job. |
| `current_checkpoint` | string | no | Filename of the checkpoint currently being processed. |
| `current_checkpoint_progress` | number | no | Items completed within the current checkpoint. |
| `current_checkpoint_total` | number | no | Total items within the current checkpoint. |
| `checkpoint_completeness` | array | no | Per-checkpoint verification results. Each entry: `checkpoint`, `expected`, `verified`, `missing`. |
| `failed_item_details` | array | no | Failed-checkpoint error details: `checkpoint_filename`, `error_message`, `exception_type`, `node_type`, `traceback`. |
| `sample_eta_seconds` | number | no | Estimated seconds remaining for the current sample (0 if unavailable). |
| `job_eta_seconds` | number | no | Estimated seconds remaining for the entire job (0 if unavailable). |
| `current_sample_params` | object | no | Generation parameters for the currently generating sample (checkpoint_filename, prompt_name, cfg, steps, sampler_name, scheduler, seed, width, height). |

#### Inference progress events (`type=inference_progress`)

| Field | Type | Description |
|---|---|---|
| `prompt_id` | string | ComfyUI prompt ID. |
| `current_value` | number | Current inference step. |
| `max_value` | number | Total inference steps. |

#### Frontend client behavior

- The `WSClient` class (`frontend/src/api/wsClient.ts`) manages the connection lifecycle.
- `FSEventMessage` listeners receive `image_added`, `image_removed`, and `directory_added` events.
- `JobProgressMessage` listeners receive `job_progress` events.
- The `connected` handshake event and any other unknown types are silently discarded.
- The `useWebSocket` composable connects/disconnects automatically when the selected training run changes.

## 7) Authentication and authorization

None. Checkpoint Sampler is a local-first tool with no authentication. It is intended for use on a trusted LAN.

## 8) CORS

CORS is **not** configured in the Goa DSL. It is implemented as transport middleware (`internal/api/cors.go`)
using a same-host origin policy:

- An allowed `Origin` is echoed back verbatim (never `*`) so credentials and cross-port dev setups work.
- A cross-host origin not in the allow-list receives no `Access-Control-Allow-Origin` header (the browser blocks
  the read); cross-host preflights are refused with 403.
- Requests without an `Origin` header (curl, same-origin navigations) are always allowed.
- Supported methods: `GET, POST, PUT, DELETE, OPTIONS`. Allowed headers: `Content-Type, Authorization`.

## 9) Content types

- **JSON** is the primary content type for all API requests and responses.
- **Image bytes** are streamed by `images.download`. The `Content-Type` is **detected at serve time** via
  `http.DetectContentType` (Go's MIME sniffing over the first 512 bytes), not hardcoded — so PNG, JPEG, and other
  image formats are served with their correct MIME type. Responses include
  `Cache-Control: max-age=31536000, immutable`.
- The `docs.openapi` method serves `application/json`.

### 9.1 Thumbnails

The scan result (`training_runs.scan` → `ImageResponse`) includes a `thumbnail_path` attribute: the path of a
generated thumbnail relative to the sample directory (empty when thumbnails are disabled or not yet generated).
Thumbnails are served through the same `images.download` endpoint as full images — their content type is detected
the same way (a `.jpg` thumbnail is served as `image/jpeg`).

## 10) Request/response patterns

### 10.1 List endpoints

- Return arrays of resources.
- Support filtering via query parameters where applicable (e.g. `studies.availability`, `training_runs.list`).

### 10.2 Create/update endpoints

- Accept JSON request bodies.
- Return the created/updated resource (201 for create, 200 for update).
- Validation errors return 400 `invalid_payload`.

### 10.3 Scan endpoint

- Returns the full scan result in a single response (dataset is small).
- No pagination needed.

## 11) Implementation pattern

The Goa-generated transport layer calls into hand-written service implementations:

```
HTTP Request
    │
    ▼
Goa Generated Handler (decode, validate)
    │
    ▼
API Implementation (internal/api/)
    │
    ▼
Service Layer (internal/service/)
    │
    ▼
Store (internal/store/)
    │
    ▼
HTTP Response ◀── Goa Generated Encoder
```

The API implementation files in `internal/api/` adapt between Goa-generated types and the service layer's domain
model types.
