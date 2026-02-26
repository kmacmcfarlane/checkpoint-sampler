# CLAUDE.md  agent quick reference

This is the always-loaded operating context for Claude Code. It must stay short, stable, and unambiguous.
Detailed requirements and process live under /agent.

## 0) Where the truth lives
Always read these at the start of each cycle:
- /agent/PRD.md
- /agent/backlog.yaml
- /agent/AGENT_FLOW.md
- /agent/TEST_PRACTICES.md
- /agent/DEVELOPMENT_PRACTICES.md
- /CHANGELOG.md

The loop prompt is /agent/PROMPT.md. The Ralph runner is `ralph` (via claude-sandbox on PATH).

## 1) Prime directive
Operate only on repository state (files + git). Treat each cycle as stateless.
Never claim completion unless acceptance criteria are met and tests pass.

## 2) Safety rules (non-negotiable)
- Do not run destructive shell commands that affect anything outside of the project directory. No changes to the OS or underlying system.
- Never exfiltrate secrets. Never print env vars. Never log tokens/keys/passwords.
- Tests must never call external networks or send real messages. External calls must be stubbed/mocked in tests.

## 3) Repository map
- Frontend (Vue + Vite + TS): /frontend
- Backend (Go + Goa v3): /backend
- Agent docs: /agent
- Architecture docs: /docs (architecture.md, database.md, api.md, filesystem.md)
- Scripts: /scripts
- Changelog: /CHANGELOG.md
- Subagent definitions: /.claude/agents/
- Claude Code policy: /.claude/settings.json

Compose modes via root Makefile:
- `make up`      : operational mode
- `make up-dev`  : hot reload + watch tests

## 4) Architecture boundaries (backend)
Separation of concerns is mandatory:
- /backend/internal/service : business logic (uses /backend/internal/model)
- /backend/internal/store   : DB + external resources (separate persistence entities from model)
- /backend/internal/model   : domain structs used across service/store interfaces
- /backend/internal/api     : Goa design/transport glue and API implementation
- /backend/internal/api/gen : generated Goa code (DO NOT EDIT)
- /backend/cmd              : entrypoints

Frontend never talks to providers. Frontend talks only to backend API.

## 5) Data persistence
- **SQLite** via `modernc.org/sqlite` (pure Go, no CGO). WAL mode, 5s busy timeout, foreign keys ON.
- **YAML configuration** at `config.yaml` (override via `CONFIG_PATH` env var). Defines checkpoint directories, sample directory, port, and db path.
- **Filesystem**: checkpoint directories (`.safetensors` files) and sample directory (images) mounted read-only. Images served through the backend API.
- Schema details in /docs/database.md. Full config schema in /agent/PRD.md section 4. Filesystem layout in /docs/filesystem.md.

## 6) Tooling ecosystem
This project is part of the [kmac-claude-kit](https://github.com/kmacmcfarlane/kmac-claude-kit) ecosystem:
- **claude-sandbox**: The Docker container this agent runs inside. See https://github.com/kmacmcfarlane/claude-sandbox
- **claude-templates**: The template this project was scaffolded from. See https://github.com/kmacmcfarlane/claude-templates
- **claude-skills**: Reusable skills (slash commands). See https://github.com/kmacmcfarlane/claude-skills

## 7) Runtime environment (claude-sandbox)

Claude Code may run inside a Docker container (the `claude-sandbox`) or directly on the host.
**Detect which at the start of each cycle** by checking for `/.dockerenv`:
- File exists → running inside the claude-sandbox container
- File does not exist → running directly on the host

### 7.1 Inside the sandbox (/.dockerenv exists)
The agent is already inside a Docker container with the project mounted. Key facts:
- **Base image**: Debian bookworm-slim
- **Installed**: Node.js 22, Docker CLI + compose plugin, git, make, jq, curl
- **NOT installed**: Go, ginkgo, or any Go toolchain
- **Docker access**: Host Docker socket is mounted — `docker compose` commands work and talk to the host daemon. ONLY use this to bring up and down the application (e.g. for testing), do not run other docker containers on the host system under any circumstances.
- **Project mount**: The repo is mounted at its real host path (not `/workspace`), so docker compose volume paths resolve correctly on the host
- **UID/GID**: Container user `claude` is remapped to match the host user's UID/GID. BE CAREFUL INSIDE VOLUME MOUNTS FOR THIS REASON.

Implications for development:
- **Go commands**: Run via `docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm backend sh -c "..."` (the backend dev container has Go + ginkgo). Do NOT use `docker run` with separate images — always use the project's compose services.
- **Frontend tests**: `npx vitest run` works directly (Node.js is installed in the sandbox)
- **Go codegen**: Run via `docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm backend sh -c "cd /build && make gen"`
- **Do not install system packages** or modify the container OS — it is ephemeral

### 7.2 On the host (/.dockerenv does not exist)
The agent is running directly on the host machine. Go and other tools may be available natively. Check before assuming — use `which go`, `which ginkgo`, etc.
- If Go is installed: run Go commands directly (no docker compose needed)
- If Go is NOT installed: fall back to the compose approach from 7.1
- Frontend commands (npm/npx) work directly if Node.js is installed

## 8) Quick commands (keep accurate)

Root Makefile targets (work in both sandbox and host — preferred for agent use):
- `make up` / `make down` / `make logs`
- `make up-dev`
- `make test-backend` / `make test-backend-watch`
- `make test-frontend` / `make test-frontend-watch`
- `make test-e2e` (Playwright E2E tests; self-contained — starts backend+frontend with test-fixtures/, runs tests, tears down)
- `make up-test` / `make down-test` (isolated test environment with separate volumes; independent from up-dev)

Backend via compose (sandbox — when Go is not installed locally):
- Codegen: `docker compose -p checkpoint-sampler-dev -f docker-compose.yml -f docker-compose.dev.yml run --rm backend sh -c "cd /build && make gen"`
- One-shot: use root `make test-backend`

Backend direct (host — requires Go installed):
- `cd backend && make gen`   (Goa codegen; must run before mocks when required)
- `cd backend && make build`
- `cd backend && make lint`
- `cd backend && make test`
- `cd backend && make run`

Backend testing (as a rule of thumb; actual commands live in Makefiles):
- ginkgo recursive with race where applicable, e.g.:
    - `ginkgo -r --race ./internal/... ./pkg/... ./cmd/...`
- watch mode uses `ginkgo watch`

Frontend (MUST run from /frontend, not the project root):
- `cd frontend && npm ci`
- `cd frontend && npm run dev`
- `cd frontend && npm run build`
- `cd frontend && npm run lint`
- `cd frontend && npm run test:watch`  (Vitest)

### Agent workflow (preferred sequence)
Agents should use one-shot commands, not watch mode. Watch mode is a long-running process designed for human developers — agents need discrete pass/fail results per invocation.

- **After Goa DSL edits**: run codegen (`make gen` via compose or direct), then `make test-backend` to verify
- **Backend verification**: `make test-backend` (one-shot, returns exit code)
- **Frontend verification**: `make test-frontend` or `cd frontend && npx vitest run`
- **Do not use** `make test-backend-watch` or `make test-frontend-watch` — these never exit

## 9) Change discipline
- One story at a time (from /agent/backlog.yaml) per /agent/AGENT_FLOW.md.
- Minimal diffs; no drive-by refactors or formatting churn.
- Do not edit generated code under /backend/internal/api/gen.
- Update /CHANGELOG.md per completed story.
- Commit policy is defined in /agent/AGENT_FLOW.md (follow it exactly).

## 10) Subagent workflow
Stories progress through a multi-agent pipeline: fullstack-developer → code-reviewer → qa-expert.
- Story status values: `todo`, `in_progress`, `review`, `testing`, `uat`, `done`, `blocked`
- The orchestrator (PROMPT.md) dispatches to the appropriate subagent based on story status
- After QA approval, stories enter `uat` (not `done`). Code is merged to main at this point.
- The user reviews functionality in `uat` and either moves to `done` or provides `uat_feedback` for rework.
- Agents never set `status: done` directly. `uat` stories without `uat_feedback` are not eligible work.
- Subagent definitions live in /.claude/agents/ and are checked into the repository
- See /agent/AGENT_FLOW.md for the full lifecycle and dispatch rules

## 11) When blocked
If acceptance criteria cannot be met:
- Do not mark the story done.
- Set `status: blocked` and record a concrete `blocked_reason` in /agent/backlog.yaml.
- Stop work on that story until the backlog/PRD resolves the blocker.
