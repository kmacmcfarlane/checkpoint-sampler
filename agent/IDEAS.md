# IDEAS

Ideas are organized by category. Agents append here; the user curates and promotes ideas to backlog stories.

## Features

### Keyboard navigation for sliders
Arrow keys (left/right) could step through slider values when a cell is focused. This would complement mouse-based slider interaction for power users reviewing many checkpoints quickly.

### Slider animation / playback mode
A "play" button on the master slider that auto-advances through values at a configurable interval. Useful for quickly scanning through checkpoint progression without manual slider dragging.

### Parse safetensors checkpoint metadata
Read `ss_*` metadata embedded in .safetensors checkpoint files (via safetensors header) to extract training configuration: output name, total steps, epochs, optimizer, dataset info, base model name, etc. Could be used to enrich training run display in the UI or auto-configure grouping. Readable via `safetensors.safe_open(path).metadata()`.

### JSON sidecar metadata per image
Write a JSON sidecar file alongside each generated image containing flat key-value generation metadata (checkpoint, prompt, seed, CFG, steps, sampler, dimensions, etc.). This could be produced by a custom ComfyUI output node or by parsing the PNG `Prompt` metadata (which contains the full ComfyUI node graph as JSON) and flattening it. Sidecars would make metadata extraction trivial for the tool and decouple it from ComfyUI-specific PNG embedding. Aligns with future plans to handle more of the generation pipeline within this tool.

### View image/checkpoint metadata in the UI
Display sidecar metadata (and/or parsed PNG metadata) in the UI — e.g., a metadata panel that appears when hovering or clicking an image, showing generation parameters (prompt, seed, CFG, steps, sampler, checkpoint name). Could also show training run metadata from safetensors headers at the training run level.

## Dev Ops

### Playwright E2E smoke tests for QA
Add Playwright for end-to-end testing that verifies the full application stack (frontend rendering, API routing, service wiring) works beyond what unit tests can catch. This would replace the manual `curl`-based smoke tests in the QA phase with proper browser-driven verification.

#### Setup sketch
- Install: `npm install -D @playwright/test` in `/frontend`, then `npx playwright install --with-deps chromium` for headless Chromium
- Config: `playwright.config.ts` with `baseURL: 'http://localhost:3000'`, no `webServer` block (assume `make up-dev` is already running), optional `globalSetup` that polls `/api/health` until ready
- Tests live in `frontend/e2e/` (e.g. `smoke.spec.ts`)
- Makefile target: `make test-e2e` wraps `cd frontend && npx playwright test --reporter=list`

#### Minimal smoke test coverage
- Frontend loads and Vue app hydrates (verify a known element like the app title renders)
- `/api/health` returns 200 through the frontend proxy
- Key API endpoints return valid JSON (training runs, presets, etc.)
- Initial UI state renders correctly (e.g. "Select a training run" prompt visible)

#### Agent/QA workflow integration
The QA subagent would run E2E tests as part of its verification:
1. Orchestrator runs `make up-dev` before dispatching to QA
2. QA runs `npx playwright test --reporter=list` (plain-text output the agent can parse)
3. Orchestrator runs `make down` after QA completes

#### Sandbox considerations
- The claude-sandbox (Debian bookworm-slim + Node.js 22) can run Playwright headless — no display server needed
- `npx playwright install --with-deps chromium` requires root/sudo for apt-get of system libs (libglib, libnss, libatk, etc.) — either pre-bake into the sandbox Dockerfile or use `npx playwright install-deps chromium` separately
- Use `--only-shell` flag for smaller disk footprint (~150MB vs ~400MB for full Chromium)
- Chromium sandboxing may need `chromiumSandbox: false` in config if running as root inside Docker
- Browser version is pinned to the Playwright npm package version — always use the bundled browser, not system Chrome

## Workflow
