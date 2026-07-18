# Architecture

> Source of truth: this document is reconciled against the implementation.
> Configuration is described from `backend/internal/config/config.go`; the
> backend layering from the packages under `backend/internal/`; image serving
> from `backend/internal/api/images_service.go`.

## 1) System overview

Checkpoint Sampler is a local-first application that runs entirely on a single Linux workstation via Docker. It consists of two services plus host filesystem access, and integrates with an optional ComfyUI instance for sample generation.

```
┌─────────────┐       HTTP        ┌─────────────────┐       HTTP        ┌─────────────────┐
│   Browser   │ ◀──────────────▶  │   Frontend      │ ◀──────────────▶  │   Backend       │
│   (LAN)     │    WebSocket      │   (Vue/Vite)    │    WebSocket      │   (Go/Goa)      │
└─────────────┘                   └─────────────────┘                   └────┬───────┬────┘
                                                                             │       │
                                                              ┌──────────────┘       └──────────────┐
                                                              │                                      │
                                                       ┌──────▼──────┐                        ┌──────▼──────┐
                                                       │   SQLite    │                        │  ComfyUI    │
                                                       │  (db_path)  │                        │ (HTTP + WS, │
                                                       └──────┬──────┘                        │  optional)  │
                                                              │                               └─────────────┘
                                                       ┌──────▼──────────────┐
                                                       │  Filesystem         │
                                                       │  checkpoint_dirs    │
                                                       │  lora_dirs          │
                                                       │  base_model_dir     │
                                                       │  sample_dir         │
                                                       └─────────────────────┘
```

- **Frontend** serves the browser UI and communicates exclusively with the backend API over HTTP and WebSocket.
- **Backend** owns all business logic, configuration, data persistence, filesystem scanning, image/thumbnail serving, and ComfyUI orchestration.
- **SQLite** persists dimension-mapping presets, studies (saved sampling-parameter sets), and sample jobs / job items. Mounted as a Docker volume for persistence across container restarts.
- **Filesystem**: checkpoint, LoRA, base-model, and sample directories. Checkpoint/LoRA/base-model directories supply `.safetensors` files for scanning; the sample directory holds generated images and is written when jobs run.
- **ComfyUI** (optional): when configured, the backend submits prompts over HTTP and tracks execution progress over WebSocket to generate samples.

## 2) Backend architecture

### 2.1 Layered structure

The backend follows strict separation of concerns. The packages under `backend/internal/` are:

```
┌──────────────────────────────────────────────────────────────────────┐
│  cmd/server/                Entrypoint, dependency wiring, config       │
│                             loading, graceful shutdown ordering.        │
├──────────────────────────────────────────────────────────────────────┤
│  internal/api/              Goa transport adapters + middleware (CORS,  │
│                             origin checks, body-size limit, error       │
│                             logging), Swagger/docs hosting, WebSocket    │
│                             upgrade, image streaming. Calls service.     │
│  internal/api/design/       Goa DSL (source of truth for the API).      │
│  internal/api/gen/          Generated Goa code (DO NOT EDIT).           │
├──────────────────────────────────────────────────────────────────────┤
│  internal/service/          Business logic: scanning, dimension         │
│                             extraction, study/preset/sample-job logic,  │
│                             job executor, ComfyUI model discovery,      │
│                             thumbnail generation, WebSocket hub,        │
│                             filesystem watcher, in-memory FS state.     │
├──────────────────────────────────────────────────────────────────────┤
│  internal/store/            SQLite persistence + migrations, filesystem │
│                             access (read + image resolution), ComfyUI   │
│                             HTTP/WS clients, fixture seeding. Defines    │
│                             its own persistence entities.              │
├──────────────────────────────────────────────────────────────────────┤
│  internal/fileformat/       External on-disk file formats with JSON     │
│                             tags: manifest.json, image .json sidecars,  │
│                             path sanitization helpers.                 │
├──────────────────────────────────────────────────────────────────────┤
│  internal/model/            Domain structs shared across layers. No     │
│                             serialization tags, no business logic.      │
├──────────────────────────────────────────────────────────────────────┤
│  internal/config/           YAML config loading, defaulting, and        │
│                             validation. Produces an internal/model.     │
│                             Config.                                     │
├──────────────────────────────────────────────────────────────────────┤
│  internal/buildinfo/        Build metadata (CommitSHA set via ldflags). │
├──────────────────────────────────────────────────────────────────────┤
│  internal/testutil/         Shared test helpers (in-memory logrus       │
│                             capture). Test-support only.               │
└──────────────────────────────────────────────────────────────────────┘
```

**Rules:**
- `model` contains domain types shared across layers. No business logic and no serialization tags.
- `config` parses and validates the YAML config file and returns a `model.Config`. It is consumed by `cmd`.
- `service` contains business logic. It depends on `model` and on consumer-defined interfaces for store/provider access. It does not import `api`.
- `store` implements persistence interfaces (SQLite for presets, studies, and sample jobs) and filesystem interfaces (directory scanning, image reading and resolution). It defines persistence entities separate from domain model types, and hosts the ComfyUI HTTP/WS clients.
- `fileformat` defines the authoritative on-disk JSON formats (manifest and image sidecars) and is the only layer carrying JSON tags for those external files.
- `api` handles HTTP transport via Goa v3, middleware (CORS, origin validation, body-size limit, error logging), WebSocket upgrade, image streaming, and Swagger/docs hosting. It calls into the service layer.
- `api/gen` is generated by Goa codegen and must never be hand-edited.
- `cmd/server` loads YAML configuration, wires dependencies, starts the server, and coordinates graceful shutdown. No business logic here.

### 2.2 Dependency flow

```
cmd  ──▶  api  ──▶  service  ──▶  store (via interfaces)
 │                     │
 │                     ▼
 └──▶ config        model  ◀── fileformat
```

- Interfaces are defined in the consumer package (e.g. service defines the store/provider interfaces it needs; `api` defines `ImageFileResolver`, implemented by the store).
- Store packages implement those interfaces.
- This enables testing service and transport logic with mocks/stubs.

### 2.3 Configuration

The backend reads a **YAML** config file at startup. The path defaults to `config.yaml` and is overridable via the `CONFIG_PATH` environment variable (`backend/internal/config/config.go`). The file is parsed into `yamlConfig`, defaulted, validated, and converted into a `model.Config`.

Top-level keys (defaults and validation reflect `config.go`):

| Key | Type | Required | Default | Notes / validation |
|-----|------|----------|---------|--------------------|
| `checkpoint_dirs` | list of strings | yes | — | At least one entry; each must be an existing directory. |
| `lora_dirs` | list of strings | no | empty | Directories scanned for LoRA `.safetensors`; each, if present, must be an existing directory. |
| `base_model_dir` | string | no | empty (falls back to `checkpoint_dirs[0]` for base-model browsing) | If set, must be an existing directory. |
| `sample_dir` | string | yes | — | Must be an existing directory; holds generated images. |
| `port` | int | no | `8080` | Must be 1–65535. |
| `ip_address` | string | no | `127.0.0.1` | Must be a valid IP address. |
| `db_path` | string | no | `./data/checkpoint-sampler.db` | Must be a file path, not a directory (rejected if it ends in `/` or names an existing directory); parent directory is auto-created. Passed directly to the SQLite opener (see database.md §1.3). |
| `ws_ping_interval` | int (seconds) | no | `30` | Must be `>= 0`; `0` disables server-side WebSocket pings. |
| `max_request_size_mb` | int (MB) | no | `200` | Must be `> 0`; caps HTTP request body size. |
| `max_study_items` | int | no | `50000` | Must be `> 0`; caps total work items per study/job. |
| `allowed_origins` | list of strings | no | empty | Extends the default same-host origin policy for the WebSocket upgrader and CORS middleware. Entries may be full origins (`https://host:port`) or bare hostnames. The same-host default always applies regardless of this list. |

`comfyui` section (optional; absent disables ComfyUI features):

| Key | Type | Default | Notes / validation |
|-----|------|---------|--------------------|
| `url` | string | `http://localhost:8188` | Must be a well-formed `http`/`https` URL with a host. |
| `workflow_dir` | string | `./workflows` | Directory holding workflow templates. |
| `reconnect_interval` | int (seconds) | `10` | Must be `>= 1`; delay between ComfyUI WebSocket reconnect attempts. |

`thumbnails` section (optional; absent disables thumbnail generation):

| Key | Type | Default | Notes / validation |
|-----|------|---------|--------------------|
| `enabled` | bool | `false` | When false, no thumbnails are generated. |
| `max_resolution_x` | int | `512` | Must be `>= 1`. |
| `max_resolution_y` | int | `512` | Must be `>= 1`. |
| `jpeg_quality` | int | `85` | Must be 1–100. |

### 2.4 Filesystem scanning

The scanning subsystem lives in the service layer, using a store-layer filesystem interface:

1. Discover checkpoint / LoRA directories from the configured roots and scan generated samples under `sample_dir`.
2. Apply dimension extraction to directory and filename structure.
3. Scan each directory for `.png` image files.
4. Parse query-encoded filenames to extract dimension key-value pairs.
5. Ignore the `_NNNNN_` batch suffix; when duplicates exist, use the highest batch number.
6. All paths are validated to stay within the configured roots (path traversal rejected).

An in-memory FS-state snapshot (`service.FSState`) caches discovery results so selector endpoints serve from memory instead of rescanning on every request. A separate fsnotify watcher monitors `sample_dir`, `checkpoint_dirs`, and `lora_dirs` for structural changes and triggers debounced snapshot refreshes.

### 2.5 Image and thumbnail serving

Images are served from the sample directory through a dedicated API endpoint (`internal/api/images_service.go`). The store-layer `ImageFileResolver` (a consumer-defined interface) resolves the client-supplied relative path against `sample_dir`, performing path-traversal validation before opening the file. The handler stays a thin streaming adapter.

The `Content-Type` is **detected at serve time** by reading the first 512 bytes and calling `http.DetectContentType` — it is not assumed from the extension. Full-size source images are PNG; thumbnails are JPEG. Both stream through the same endpoint, so the served content type follows the actual file bytes. Responses include `Cache-Control: max-age=31536000, immutable` since checkpoint outputs are write-once.

Thumbnails are generated in the service layer (`internal/service/thumbnail.go`) when `thumbnails.enabled` is true and a sample job runs. Each thumbnail is a JPEG (quality from `thumbnails.jpeg_quality`, resized with bilinear interpolation to fit within `max_resolution_x` × `max_resolution_y`, aspect preserved) stored in a `thumbnails/` subdirectory alongside the source image with a `.jpg` extension.

### 2.6 WebSocket

A WebSocket endpoint pushes filesystem and job-progress events to connected clients via the service-layer hub. The backend uses fsnotify to watch the sample directory and emits events for new image files and new directories. When `ws_ping_interval > 0`, the server sends periodic ping frames; `0` disables pings. The hub caps the number of concurrent clients.

### 2.7 ComfyUI integration and the job executor

When the `comfyui` section is configured, the store layer creates HTTP and WebSocket clients for the configured `url`. The service layer's `JobExecutor` submits prompts, tracks execution and `execution_error` events over the ComfyUI WebSocket, writes generated images (and optional thumbnails) into `sample_dir`, and updates sample-job / job-item status in SQLite. Reconnects use `reconnect_interval`. When ComfyUI is not configured, sample-job and workflow services are wired in a disabled state.

### 2.8 Error handling

Backend errors carry:
- A stable error code (string) for programmatic consumption by the frontend.
- A user-facing message (sanitized, no server paths).
- An internal message for server logs (sanitized, no secrets).

The Goa API layer maps service errors to appropriate HTTP status codes. Service/store boundaries classify failures via sentinel errors (e.g. `store.ErrInvalidImagePath`, `store.ErrImageNotFound`, `service.ErrInvalidPath`) rather than substring matching.

### 2.9 Lifecycle and graceful shutdown

`cmd/server/main.go` wires all services and installs a signal handler for `SIGINT`/`SIGTERM`. On shutdown (`cmd/server/shutdown.go`), the order is:

1. Stop background workers — job executor (if present), filesystem watcher, and FS-state watcher — so they no longer touch the DB or submit ComfyUI requests.
2. Drain the HTTP server within a 10-second timeout so in-flight requests complete.
3. Only after draining do the deferred closes run: the SQLite store and the fsnotify notifiers close.

This ordering guarantees the database is never closed while requests or workers are still active.

## 3) Frontend architecture

### 3.1 Technology stack

- **Vue 3** with Composition API
- **Vite** for build and dev server (HMR)
- **TypeScript** with strict settings
- **Naive UI** component library
- **Pinia** for state management
- **Vitest** for unit tests; **Playwright** for E2E

### 3.2 Directory structure

```
frontend/
├── src/
│   ├── api/          # Backend API client + WebSocket client
│   ├── components/   # Reusable presentational components
│   ├── views/        # Route-level pages
│   ├── stores/       # Pinia state management
│   ├── lib/          # Shared utilities (filename parsing, sorting)
│   └── types/        # Shared TypeScript types
├── e2e/              # Playwright E2E specs
├── public/
└── tests/
```

### 3.3 Key principles

- **API isolation**: All backend communication goes through `src/api/`. Components never construct fetch requests directly.
- **Error normalization**: Backend error responses are normalized into a stable UI error shape in the API client layer.
- **Client-side caching**: Browser HTTP cache is leveraged via backend cache headers. Adjacent slider positions are proactively preloaded for instant display.

## 4) Docker runtime

### 4.1 Operational mode (`make up`)

- Runs built/production-like frontend and backend containers.
- Checkpoint, LoRA, base-model, and sample directories mounted into the backend container.
- SQLite data directory mounted read-write for persistence.
- Backend binds the configured `ip_address`/`port` (bind `0.0.0.0` for LAN access).
- Frontend reachable in browser; backend serves API and Swagger UI at `/docs`.

### 4.2 Dev mode (`make up-dev`)

- Frontend runs Vite dev server with HMR.
- Backend runs with hot reload on code changes.
- Source directories mounted into containers for live editing.
- Watch test targets available: `make test-frontend-watch`, `make test-backend-watch`.

## 5) Data flow summary

```
User ──▶ Browser ──▶ Frontend (Vue) ──▶ Backend API (Goa) ──▶ Filesystem (images)
                          ▲                     │   │                 │
                          │                     ▼   └──▶ ComfyUI ──────┘ (samples written)
                          │           SQLite (presets/studies/jobs)
                          │                     │
                          ◀──────── WebSocket (live updates) ◀───────┘
                                                    (fsnotify + job progress)
```

All data flows through the backend. The frontend is a pure UI layer.
