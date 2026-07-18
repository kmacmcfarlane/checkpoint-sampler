# Contributing to Checkpoint Sampler

Thanks for your interest in improving Checkpoint Sampler. This guide covers local
setup, the test commands, and what we expect in a pull request. For a high-level
overview of the app and its architecture, start with the [README](README.md) and
the docs under [`docs/`](docs/).

## Development setup

Checkpoint Sampler runs entirely via Docker Compose. You only need:

- **Docker** with the **Compose v2** plugin (`docker compose`)
- **make**
- **git**

Go 1.25 and Node.js 22 are optional — they are only needed if you want to run the
backend/frontend build, test, and lint commands directly on the host instead of
inside the containers.

Copy the two gitignored config files from their tracked examples before starting
the stack (`make up` runs a preflight guard that fails fast if they are missing):

```bash
cp config.yaml.example config.yaml
cp .env.example .env
# Edit .env to point at your checkpoint/sample/model/LoRA directories
```

Start the hot-reload development stack (backend via air, frontend via Vite HMR):

```bash
make up-dev
```

See the [README Configuration section](README.md#configuration) for the full list
of config keys and environment variables.

## Test commands

All tests run in Docker and must pass before you open a pull request:

```bash
make test-backend     # Go backend (Ginkgo/Gomega, one-shot)
make test-frontend    # Frontend unit tests + lint (Vitest, one-shot)
make test-e2e         # End-to-end regression (Playwright, sharded stacks)
```

For faster feedback during development you can use the watch variants
(`make test-backend-watch`, `make test-frontend-watch`) or run a single E2E spec
with `make test-e2e-serial SPEC=<file>.spec.ts`.

When touching frontend TypeScript, also run the linter and type checker:

```bash
cd frontend && npm run lint
cd frontend && npx vue-tsc --noEmit
```

## Pull request expectations

- **Keep diffs small and reviewable.** Prefer focused changes over large,
  multi-concern PRs. Avoid drive-by refactors or formatting churn unrelated to
  your change.
- **Include tests.** New behavior needs unit/integration coverage; user-facing
  behavior needs an E2E test. Bug fixes should include a regression test.
- **Respect the architecture boundaries** described in the README and
  [`.claude-sandbox/agent/DEVELOPMENT_PRACTICES.md`](.claude-sandbox/agent/DEVELOPMENT_PRACTICES.md):
  keep business logic in the service layer, persistence in the store layer, and
  domain types free of serialization tags. Never hand-edit generated Goa code
  under `backend/internal/api/gen/`.
- **Don't commit secrets or personal paths.** Local config
  (`config.yaml`, `.env`, `.claude-sandbox/config.yaml`) is gitignored — edit the
  tracked `*.example` files instead when you add or change config keys.
- **Commit message style.** This project uses `story(<id>): <summary>` for
  tracked stories; for ad-hoc contributions a concise, imperative summary line is
  fine (e.g. `Fix thumbnail cache invalidation`).
- **Report security issues privately** — see [SECURITY.md](SECURITY.md).

## Optional: the claude-sandbox / ralph agent workflow

This repository ships a complete, optional Claude Code agent workflow as a
contributor feature. It is part of the
[kmac-claude-kit](https://github.com/kmacmcfarlane/kmac-claude-kit) ecosystem and
is entirely opt-in — you never need it to build, test, or contribute to the app.

The workflow lets an agent pick up backlog stories, implement them, and run them
through a review/QA pipeline inside a sandboxed Docker container:

- [CLAUDE.md](CLAUDE.md) — always-loaded operating context for the agent
- [`.claude-sandbox/agent/AGENT_FLOW.md`](.claude-sandbox/agent/AGENT_FLOW.md) — the development loop and story lifecycle
- [`.claude-sandbox/agent/DEVELOPMENT_PRACTICES.md`](.claude-sandbox/agent/DEVELOPMENT_PRACTICES.md) — engineering standards
- [`.claude-sandbox/agent/TEST_PRACTICES.md`](.claude-sandbox/agent/TEST_PRACTICES.md) — testing standards
- [`.claude-sandbox/agent/PRD.md`](.claude-sandbox/agent/PRD.md) — product requirements
- [`.claude-sandbox/agent/backlog.yaml`](.claude-sandbox/agent/backlog.yaml) — story tracker

To try it, copy the sandbox config from its example and run one of the make
targets:

```bash
cp .claude-sandbox/config.yaml.example .claude-sandbox/config.yaml
# Edit the mount paths and hostAccess flags for your machine

make claude          # Interactive Claude Code session
make claude-resume   # Resume the previous session
make ralph           # Ralph loop (interactive)
make ralph-auto      # Ralph loop (autonomous)
```

The related tooling lives in separate repositories:
[claude-sandbox](https://github.com/kmacmcfarlane/claude-sandbox) (the container),
[claude-templates](https://github.com/kmacmcfarlane/claude-templates) (the project
scaffold), and [claude-skills](https://github.com/kmacmcfarlane/claude-skills)
(reusable slash-command skills).
