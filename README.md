# checkpoint-sampler

Checkpoint Sampler is a local-first web app for evaluating Stable Diffusion / Flux training runs. It browses your training checkpoints and LoRAs, lets you launch parameterized ComfyUI sample jobs (sweeping prompts, seeds, CFG, steps, samplers, and more), and compares the resulting images side by side in an interactive XY grid. It runs entirely on your own machine via Docker and talks to a ComfyUI instance you control.

### Features

- Browse training checkpoints and LoRAs discovered from your model directories
- Launch parameterized sample jobs against ComfyUI using annotated workflow templates
- Sweep across prompts, seeds, CFG, steps, samplers/schedulers, and checkpoints
- Compare outputs in an interactive XY grid with a zoomable lightbox
- Live job progress over WebSocket
- Thumbnail generation for fast grid loading

<!-- TODO(S-162): add a real screenshot of the XY grid view once one is captured (suggested path: docs/images/xy-grid.png), then restore the image tag below.
![Checkpoint Sampler XY grid](docs/images/xy-grid.png)
-->

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Go 1.25, Goa v3 |
| Frontend | Vue 3 (Composition API), Vite, TypeScript |
| Testing | Ginkgo/Gomega (backend), Vitest (frontend) |
| Infrastructure | Docker Compose, multi-stage builds |

## Prerequisites

- **Docker** with the **Compose v2** plugin (`docker compose`)
- **make**
- **git**

Go 1.25 and Node.js 22 are only needed if you want to run the non-Docker developer commands (backend/frontend builds, tests, and linters) directly on the host. They are not required to run the application via Docker.

## Quick start

Copy the two config files *before* starting the stack — `make up` runs a preflight guard (`check-config`) that fails fast if `config.yaml` or `.env` is missing:

```bash
cp config.yaml.example config.yaml
cp .env.example .env
# Edit .env to point at your checkpoint/sample/model/LoRA directories (see Configuration below)
make up
```

Then open the UI at [http://localhost:3001](http://localhost:3001).

To stop:

```bash
make down
```

## Development

Start the dev stack with hot reload (backend via air, frontend via Vite HMR):

```bash
make up-dev
```

Watch tests continuously (these `exec` into the running dev containers, so start `make up-dev` first):

```bash
make test-backend-watch    # Ginkgo watch in the dev backend container
make test-frontend-watch   # Vitest watch in the dev frontend container
```

Other targets:

```bash
make logs          # Tail operational logs
make logs-dev      # Tail dev logs
make down-dev      # Stop dev stack
```

### Backend commands (from repo root)

```bash
cd backend && make gen      # Goa codegen
cd backend && make build    # Build binary
cd backend && make lint     # Go vet
cd backend && make test     # Run tests
cd backend && make run      # Build and run
```

### Frontend commands (from repo root)

```bash
cd frontend && npm ci              # Install dependencies
cd frontend && npm run dev         # Vite dev server
cd frontend && npm run build       # Production build
cd frontend && npm run lint        # ESLint
cd frontend && npm run test:watch  # Vitest watch
```

## Project structure

```
checkpoint-sampler/
├── backend/
│   ├── cmd/server/           # Entrypoint (wiring only)
│   ├── internal/
│   │   ├── model/            # Domain structs
│   │   ├── service/          # Business logic
│   │   ├── store/            # Persistence + external resources
│   │   └── api/
│   │       ├── design/       # Goa DSL definitions
│   │       └── gen/          # Generated code (DO NOT EDIT)
│   ├── Dockerfile            # Production image
│   └── Dockerfile.dev        # Dev image with air hot reload
├── frontend/
│   ├── src/
│   │   ├── api/              # Backend API client modules
│   │   ├── components/       # UI components
│   │   └── views/            # Route-level pages
│   ├── Dockerfile            # nginx production image
│   └── Dockerfile.dev        # Vite dev server
├── docs/                     # Architecture, database, API, and filesystem docs
├── .claude-sandbox/agent/    # Agent workflow docs and backlog
├── scripts/                  # Tooling and E2E scripts
├── docker-compose.yml        # Production compose
├── docker-compose.dev.yml    # Dev overlay
├── docker-compose.test.yml   # E2E test stack
├── Makefile                  # Root orchestration targets
└── CHANGELOG.md
```

## Architecture

The backend enforces strict separation of concerns:

- **model** — Domain structs shared across layers (no serialization tags)
- **service** — Business logic depending on interfaces
- **store** — Persistence and external resource access
- **api** — Goa design-first transport glue and implementation

The frontend isolates all backend communication through `src/api/` modules. UI components never construct fetch requests directly.

Data flows: **Browser &rarr; Frontend (Vue) &rarr; Backend API (Goa) &rarr; Service &rarr; Store**

For full details see [docs/architecture.md](docs/architecture.md), [docs/database.md](docs/database.md), and [docs/api.md](docs/api.md).

## Workflow templates

Checkpoint Sampler generates images by submitting parameterized ComfyUI workflows. Workflow templates are ComfyUI API-format JSON files stored in the `workflow_dir` directory (default: `./workflows`). They require special `cs_role` annotations to identify which nodes should be parameterized — a plain ComfyUI export will not work without these annotations.

See [docs/workflows.md](docs/workflows.md) for the full reference: what annotations are required, what each role controls, and step-by-step instructions for creating a compatible workflow.

## Keyboard controls

| Context | Key | Action |
|---|---|---|
| Main view | `Ctrl+ArrowLeft` / `Ctrl+ArrowRight` | Step master slider backward / forward |
| Main view | `Ctrl+ArrowDown` / `Ctrl+ArrowUp` | Step master slider backward / forward |
| Lightbox | `ArrowLeft` / `ArrowRight` | Step lightbox slider backward / forward |
| Lightbox | `Shift+ArrowLeft` / `Shift+ArrowRight` | Navigate to previous / next grid image |
| Lightbox | `Escape` | Close lightbox |
| Lightbox | Scroll wheel | Zoom in / out |

## API documentation

The backend serves interactive Swagger UI at [http://localhost:8081/docs](http://localhost:8081/docs) with an OpenAPI 3.0 spec.

## Configuration

The application uses two gitignored config files, both copied from tracked examples during the quick start:

1. **`.env`** — Host paths for Docker volume mounts (from `.env.example`). Point these at your local model/output directories:

   ```env
   CHECKPOINT_DIR=/path/to/your/checkpoints
   SAMPLE_DIR=/path/to/your/samples
   MODEL_DIR=/path/to/your/models
   LORA_DIR=/path/to/your/loras
   ```

2. **`config.yaml`** — Backend application config (from `config.yaml.example`). The defaults work out of the box with Docker Compose. The `checkpoint_dirs`, `sample_dir`, `lora_dirs`, and `base_model_dir` values refer to container-internal mount paths (e.g. `/data/checkpoints`) and normally do not need to change. Notable keys:

   - `checkpoint_dirs` — directories scanned recursively for `.safetensors` checkpoints
   - `lora_dirs` — optional directories scanned for LoRA `.safetensors` files
   - `base_model_dir` — optional directory of base models for LoRA sample jobs
   - `sample_dir` — where generated sample images, thumbnails, and demo data are written
   - `comfyui:` — optional block (`url`, `workflow_dir`, `reconnect_interval`) enabling the inference pipeline; when omitted, inference features are disabled in the UI

### Environment variables (`.env`)

| Variable | Default | Description |
|---|---|---|
| `CHECKPOINT_DIR` | `./.dataset-placeholder` | Host path to the checkpoint directory (mounted read-only at `/data/checkpoints`) |
| `SAMPLE_DIR` | `./.dataset-placeholder` | Host path to the sample image directory (mounted read-write at `/data/samples`; the app writes generated samples, thumbnails, and demo data here) |
| `MODEL_DIR` | `./.dataset-placeholder` | Host path to the base model directory (mounted read-only at `/data/models`) |
| `LORA_DIR` | `./.dataset-placeholder` | Host path to the LoRA directory (mounted read-only at `/data/loras`) |

### Ports

Docker Compose publishes two host ports:

| Service | Host URL | Container port |
|---|---|---|
| Web UI | [http://localhost:3001](http://localhost:3001) | 3000 |
| Backend API + Swagger UI | [http://localhost:8081](http://localhost:8081) ([/docs](http://localhost:8081/docs)) | 8080 |

The `port` key in `config.yaml` (default `8080`) is the **container-internal** port the backend binds to; it is mapped to host `8081` by `docker-compose.yml`. Changing `port` alone does not change the host port — update the compose port mapping too.

For the checkpoint and sample directory layout (naming conventions, suffix stripping, per-run/study hierarchy), see [docs/filesystem.md](docs/filesystem.md).

## Testing

Backend tests use Ginkgo/Gomega and run inside the dev container (Go is not required on the host):

```bash
make test-backend-watch
```

Frontend tests use Vitest and can run directly if Node.js 22 is available:

```bash
cd frontend && npx vitest run
```

### E2E tests

End-to-end tests use Playwright against isolated docker-compose stacks with test fixture data.

**Parallel regression (default):**

```bash
make test-e2e              # 4 sharded stacks (default)
make test-e2e SHARDS=8     # override shard count
```

Each shard gets its own fully isolated compose stack (backend, frontend, comfyui-mock, SQLite DB). Playwright's `--shard` flag splits tests across stacks and images are built once and shared. Artifacts are written to `.e2e/`:

- `.e2e/logs/shard-{i}/` — backend and frontend logs per shard
- `.e2e/blobs/shard-{i}/` — Playwright blob reports per shard
- `.e2e/report/` — merged HTML report

**Serial (single stack, targeted runs):**

```bash
make test-e2e-serial                      # full suite in one stack
make test-e2e-serial SPEC=smoke.spec.ts   # a single spec
```

Stacks are torn down automatically when the run finishes.

## Agent workflow

This project includes a complete Claude Code agent workflow. See:

- [CLAUDE.md](CLAUDE.md) — Always-loaded operating context
- [.claude-sandbox/agent/AGENT_FLOW.md](.claude-sandbox/agent/AGENT_FLOW.md) — Deterministic development loop
- [.claude-sandbox/agent/DEVELOPMENT_PRACTICES.md](.claude-sandbox/agent/DEVELOPMENT_PRACTICES.md) — Engineering standards
- [.claude-sandbox/agent/TEST_PRACTICES.md](.claude-sandbox/agent/TEST_PRACTICES.md) — Testing standards
- [.claude-sandbox/agent/PRD.md](.claude-sandbox/agent/PRD.md) — Product requirements (write yours here)
- [.claude-sandbox/agent/backlog.yaml](.claude-sandbox/agent/backlog.yaml) — Story tracker

### Running with claude-sandbox

```bash
make claude              # Interactive Claude Code session
make claude-resume       # Resume previous session
make ralph               # Ralph loop (interactive)
make ralph-auto          # Ralph loop (autonomous)
```

## Tooling

This project was scaffolded from [claude-templates](https://github.com/kmacmcfarlane/claude-templates) and is part of the [kmac-claude-kit](https://github.com/kmacmcfarlane/kmac-claude-kit) ecosystem.

## License

This project is licensed under the [GPL-3.0](LICENSE).
