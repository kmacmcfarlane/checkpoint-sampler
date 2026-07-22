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

For a walkthrough of the demo dataset, the Study → Sample Job → XY grid workflow, and
troubleshooting common issues (ComfyUI offline, empty training-run list, models not
visible to ComfyUI, proxy/`allowed_origins` problems), see the
[Usage Guide](docs/usage.md).

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

### Dependency audit and git hooks

Run a vulnerability audit across both stacks (govulncheck for the backend
reachable set, `npm audit --omit=dev` for frontend production deps). It fails on
high-severity findings and degrades to a visible warning when offline (it never
silently passes):

```bash
make audit
```

Install the versioned git hooks once so the audit runs automatically before
every commit:

```bash
make install-hooks   # sets core.hooksPath -> scripts/git-hooks (pre-commit runs `make audit`)
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

For full details see [docs/architecture.md](docs/architecture.md), [docs/database.md](docs/database.md), and [docs/api.md](docs/api.md). For a task-oriented usage walkthrough, see [docs/usage.md](docs/usage.md).

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
| `PUID` | `1000` | UID the backend container runs as (non-root). Set to match your host user's UID (`id -u`) if `SAMPLE_DIR` is owned by a different user |
| `PGID` | `1000` | GID the backend container runs as (non-root). Set to match your host user's GID (`id -g`) if `SAMPLE_DIR` is owned by a different group |

### Ports

Docker Compose publishes two host ports, bound to `127.0.0.1` (localhost) by default:

| Service | Host URL | Container port |
|---|---|---|
| Web UI | [http://localhost:3001](http://localhost:3001) | 3000 |
| Backend API + Swagger UI | [http://localhost:8081](http://localhost:8081) ([/docs](http://localhost:8081/docs)) | 8080 |

The `port` key in `config.yaml` (default `8080`) is the **container-internal** port the backend binds to; it is mapped to host `8081` by `docker-compose.yml`. Changing `port` alone does not change the host port — update the compose port mapping too.

The host binding is controlled by the `HOST_BIND` variable in `.env` (default `127.0.0.1`, i.e. localhost-only). Set `HOST_BIND=0.0.0.0` to expose the app on your LAN — see the [Security model](#security-model) section below before doing so.

## Security model

Checkpoint Sampler has **no authentication**. Every API endpoint — including destructive operations like deleting checkpoints/samples and triggering sample jobs — is open to anyone who can reach the port. It is designed for local, single-user, trusted-network use.

- **Default**: the compose ports are bound to `127.0.0.1`, so the app is reachable only from the machine running Docker (see [Ports](#ports) above).
- **LAN exposure is an explicit, opt-in choice**: set `HOST_BIND=0.0.0.0` in `.env` to publish the ports on all interfaces. Do this only if you understand the risk — anyone on your network segment will have full read/write/delete access to your checkpoints, samples, and job queue.
- **Before exposing beyond localhost** (LAN, VPN, or the public internet), put a firewall rule or an authenticating reverse proxy (e.g. Caddy, nginx with `auth_request`, Tailscale, or a VPN) in front of the app. Checkpoint Sampler itself will not stop unauthenticated requests.
- This applies regardless of how the backend is run (Docker Compose or directly on the host) — see the `ip_address` comment in `config.yaml.example` for the container-vs-host binding distinction.
- **Both containers run as non-root** by default (backend UID/GID `1000:1000`, overridable via `PUID`/`PGID` in `.env`; frontend uses an unprivileged nginx image). Both also have `restart: unless-stopped` and container healthchecks, so a crash or host reboot brings the app back automatically. If the backend fails to write to `SAMPLE_DIR` or the database (`EACCES` in `docker compose logs backend`), set `PUID`/`PGID` in `.env` to match the owner of your `SAMPLE_DIR` (run `id -u` / `id -g` on the host) and `make down && make up`.

For the checkpoint and sample directory layout (naming conventions, suffix stripping, per-run/study hierarchy), see [docs/filesystem.md](docs/filesystem.md).

## Connecting to ComfyUI

Checkpoint Sampler does not generate images itself — it submits parameterized workflows to a **running ComfyUI instance you control** and does not bundle or manage ComfyUI. Without a reachable ComfyUI, the app still runs (browsing checkpoints, viewing prior results) but sample job launch is disabled.

To enable the inference pipeline, uncomment the `comfyui:` block in `config.yaml`:

```yaml
comfyui:
  url: http://host.docker.internal:8188
  workflow_dir: ./workflows
  # reconnect_interval: 10
```

**Getting the URL right (Docker networking):** the backend runs inside a container, so `url` is resolved from the container's network namespace, not your host machine.

- `http://localhost:8188` only resolves correctly if ComfyUI **and** the backend both run outside Docker on the same host. Uncommented as-is inside the shipped Docker Compose stack, it points at the backend container itself, not ComfyUI — you'll get a permanent "ComfyUI (offline)" status pill with no obvious cause.
- If ComfyUI runs on the same machine as Docker, use `http://host.docker.internal:8188`. `docker-compose.yml` adds the required `extra_hosts: host.docker.internal:host-gateway` entry so this resolves on both Docker Desktop and Docker Engine 20.10+ on Linux.
- If ComfyUI runs on a different machine on your LAN, use that machine's IP address, e.g. `http://192.168.1.50:8188`.

**Shared checkpoint files:** ComfyUI must see the *same* checkpoint (and LoRA) files that Checkpoint Sampler scans, at whatever paths ComfyUI's own configuration expects. If your ComfyUI installation stores models elsewhere, point it at the shared directories using ComfyUI's `extra_model_paths.yaml` (see the [ComfyUI documentation](https://github.com/comfyanonymous/ComfyUI) for its `extra_model_paths.yaml.example`) so both applications resolve checkpoint filenames to the same underlying files.

**Offline behavior:** the header shows a "ComfyUI (offline)" pill whenever the backend's WebSocket connection to ComfyUI is down. This is not fatal — you can still create and queue sample jobs while offline; they wait until the backend reconnects (retried every `reconnect_interval` seconds, default 10) and then resume automatically, including recovery of any items that finished on the ComfyUI side while disconnected.

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

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup,
the test commands, and pull-request expectations. Security issues should be
reported privately — see [SECURITY.md](SECURITY.md).

This repository also ships an optional Claude Code agent workflow
(claude-sandbox + ralph) as a contributor feature. It is entirely opt-in and not
required to build or contribute to the app — see the
[agent workflow section of CONTRIBUTING.md](CONTRIBUTING.md#optional-the-claude-sandbox--ralph-agent-workflow)
for details.

## Tooling

This project was scaffolded from [claude-templates](https://github.com/kmacmcfarlane/claude-templates) and is part of the [kmac-claude-kit](https://github.com/kmacmcfarlane/kmac-claude-kit) ecosystem.

## License

This project is licensed under the [GPL-3.0](LICENSE).
