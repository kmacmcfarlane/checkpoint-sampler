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
- Architecture docs: /docs (architecture.md, database.md, api.md)
- Scripts: /scripts
- Changelog: /CHANGELOG.md
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
Persistence approach and external integrations are defined in /agent/PRD.md.

## 6) Runtime environment (claude-sandbox)
Claude Code runs inside a Docker container defined by the `claude-sandbox` tool (on PATH).
It may be running in a ralph loop (fresh-context iterations via `ralph`) or interactively.

Key facts about the container:
- **Base image**: Debian bookworm-slim
- **Installed**: Node.js 22, Docker CLI + compose plugin, git, make, jq, curl
- **NOT installed**: Go, ginkgo, or any Go toolchain
- **Docker access**: Host Docker socket is mounted — `docker compose` commands work and talk to the host daemon. ONLY use this to bring up and down the application (e.g. for testing), do not run other docker containers on the host system under any circumstances.
- **Project mount**: The repo is mounted at its real host path (not `/workspace`), so docker compose volume paths resolve correctly on the host
- **UID/GID**: Container user `claude` is remapped to match the host user's UID/GID. BE CAREFUL INSIDE VOLUME MOUNTS FOR THIS REASON.

Implications for development:
- **Go tests**: Run via `docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm backend sh -c "ginkgo ..."` (the backend dev container has Go + ginkgo)
- **Frontend tests**: `npx vitest run` works directly (Node.js is installed in the sandbox)
- **Go codegen**: Run via `docker compose ... run --rm backend sh -c "cd /build && make gen"`
- **Do not install system packages** or modify the container OS — it is ephemeral

## 7) Quick commands (keep accurate)
Root (preferred entrypoints):
- `make up` / `make down` / `make logs`
- `make up-dev`
- `make test-backend-watch`
- `make test-frontend-watch`

Backend (from repo root):
- `cd backend && make gen`   (Goa codegen; must run before mocks when required)
- `cd backend && make build`
- `cd backend && make lint`
- `cd backend && make test`
- `cd backend && make run`

Backend testing requirements (as a rule of thumb; actual commands live in Makefiles):
- ginkgo recursive with race where applicable, e.g.:
    - `ginkgo -r --race ./internal/... ./pkg/... ./cmd/...`
- watch mode uses `ginkgo watch`

Frontend (from repo root):
- `cd frontend && npm ci`
- `cd frontend && npm run dev`
- `cd frontend && npm run build`
- `cd frontend && npm run lint`
- `cd frontend && npm run test:watch`  (Vitest)

## 8) Change discipline
- One story at a time (from /agent/backlog.yaml) per /agent/AGENT_FLOW.md.
- Minimal diffs; no drive-by refactors or formatting churn.
- Do not edit generated code under /backend/internal/api/gen.
- Update /CHANGELOG.md per completed story.
- Commit policy is defined in /agent/AGENT_FLOW.md (follow it exactly).

## 9) When blocked
If acceptance criteria cannot be met:
- Do not mark the story done.
- Record a concrete blocker note in /agent/backlog.yaml (or the location specified by AGENT_FLOW).
- Stop work on that story until the backlog/PRD resolves the blocker.
