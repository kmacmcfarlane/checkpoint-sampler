# Dev Ops

Build pipeline, CI, Docker, linting, and infrastructure improvements. Only items requiring user approval belong here — routine improvements should be implemented directly by agents.

## Required fields for new entries

Every idea appended by agents must include:
- `status: needs_approval` — default for all new ideas. The user changes this to `approved`, `rejected`, etc.
- `priority: <low|medium|high|very-low>` — the agent's suggested priority based on impact and effort.
- `source: <developer|reviewer|qa|orchestrator>` — which agent originated the idea.

Example:
```
### <Title>
* status: needs_approval
* priority: medium
* source: developer
<Description — 1-3 sentences>
```

## Ideas

### CSS variable linting
* status: approved
* priority: medium
* source: unknown

A stylelint rule (e.g., a custom plugin or stylelint-no-undefined-variables) that warns when a color property does not use a --text-color or --bg-* variable could prevent low-contrast issues from being introduced in the first place.

### nginx config validation in CI
* status: needs_approval
* priority: low
* source: unknown

Adding an `nginx -t` config syntax check step to the build pipeline (e.g., in the frontend Dockerfile build stage or a Makefile target) would catch nginx config errors before they reach a running container.

### Automated nginx WebSocket validation
* status: needs_approval
* priority: low
* source: unknown

A test or CI step could verify the presence of required WebSocket headers in nginx.conf at build time (e.g., a simple grep/lint step in the Makefile), preventing accidental removal of the headers in future changes.

### E2E log capture before teardown
* status: approved
* priority: high
* source: unknown

Consider adding a `make test-e2e-logs` target or `--always-save-logs` option that captures docker compose logs to a file before teardown, enabling the QA runtime error sweep even for self-contained E2E runs.

### Playwright browser pre-warming
* status: approved
* priority: low
* source: unknown

The `npm ci` on every E2E test invocation adds 5-10 seconds. Consider building a custom image `FROM mcr.microsoft.com/playwright:...` with `npm ci` baked in as a project-maintained Docker image to speed up CI.

### Update .air.toml to use build.entrypoint
* status: approved
* priority: low
* source: unknown

The air hot-reload configuration uses the deprecated `build.bin` setting, producing a startup warning on every dev container launch. Migrating to `build.entrypoint` would silence this warning and keep the config current with the air toolchain.

### make test-backend with run --rm instead of exec
* status: approved
* priority: low
* source: unknown

The Makefile's `test-backend` target uses `exec` which requires the dev stack to be running, making it unusable as a one-shot command when the stack is down. Changing it to `run --rm` would align documentation with implementation and make it usable without a running stack.

### Suppress Docker Compose orphan container warning
* status: approved
* priority: low
* source: unknown

Running `make test-e2e` after `make up-dev` produces a Docker Compose orphan container warning. Adding `--remove-orphans` to the `COMPOSE_E2E` run command, or documenting it as expected behavior in TEST_PRACTICES.md, would remove the noise.

### make gen root-level target
* status: approved
* priority: low
* source: unknown

There is no root-level `make gen` target — codegen requires either a full `docker compose ... run --rm backend sh -c "cd /build && make gen"` invocation or being inside the backend dev container. A root-level `make gen` target would simplify the codegen step for agents and developers alike.

### Unused import detection in Vue SFCs
* status: approved
* priority: low
* source: unknown

The TypeScript compiler doesn't always catch unused imports in `<script setup>` blocks. An ESLint rule for Vue SFCs could catch this automatically during lint.

### Accessibility audit tool
* status: approved
* priority: high
* source: unknown

A Lighthouse or axe-core integration in the CI pipeline would catch low-contrast issues like B-023 automatically before they reach UAT, reducing the number of purely visual bug stories entering the backlog.
