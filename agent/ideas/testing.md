# Testing Infrastructure

Major test infrastructure changes requiring design or user buy-in — not routine test additions. Only items requiring user approval belong here — routine improvements should be implemented directly by agents.

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

### Add "queued" status (yellow bead) test case to JobLaunchDialog status bead tests
* status: needs_approval
* priority: low
* source: qa
The `_status`/`_color` metadata test covers empty/complete/running but does not exercise the queued path (pending or paused job). Adding a `pendingJob` fixture for a training run with status `pending` and asserting `_status: 'queued'` and `_color: '#f0a020'` would complete the 4-of-4 coverage for the `beadColor()` function.

### Add Vite ws proxy ECONNREFUSED to QA_ALLOWED_ERRORS.md
* status: needs_approval
* priority: very-low
* source: qa
During startup, the frontend Vite dev server briefly logs `Error: connect ECONNREFUSED` for its WebSocket proxy before the backend is ready. This is a benign startup timing race and could be added to the allowlist to prevent future QA agents from investigating it.

### Automated panic detection in E2E log scan
* status: needs_approval
* priority: medium
* source: developer
The QA agent currently searches E2E backend logs for panics manually. A lightweight shell script or Makefile target that exits non-zero when `panic:` appears in E2E logs would make panic-free criteria machine-verifiable and prevent regressions silently passing review.

### Widen accessibility test coverage to include grid state
* status: needs_approval
* priority: low
* source: developer
Currently the accessibility audit runs only on the initial empty-state page. Adding a second scan after loading a training run and assigning axes (with real images rendered) would catch contrast violations inside grid cells, image captions, and axis labels.

### E2E test for keyboard auto-repeat slider navigation
* status: needs_approval
* priority: low
* source: developer
Keyboard-driven slider behaviors (arrow navigation with auto-repeat) are difficult to test in JSDOM because the stale-prop race condition only manifests at real browser auto-repeat rates. A Playwright E2E test using `page.keyboard.down('ArrowRight')` with repeated presses and asserting correct slider progression would give higher confidence for this interaction pattern.

### App.test.ts window.innerWidth cleanup between tests
* status: needs_approval
* priority: low
* source: developer
The "Eager auto-select" tests in App.test.ts set `Object.defineProperty(window, 'innerWidth', ...)` which persists across tests since `vi.unstubAllGlobals()` only removes `vi.stubGlobal` stubs. Tests running after this section inherit the modified `innerWidth`. A shared `afterEach` that resets `innerWidth` to a known default would prevent ordering-dependent test failures.

### Shared E2E helper functions across spec files
* status: needs_approval
* priority: low
* source: developer
Many E2E spec files duplicate `selectTrainingRun`, `selectNaiveOption`, and `closeDrawer` helper functions. Extracting these to `frontend/e2e/helpers.ts` (alongside the existing `resetDatabase` helper) would reduce duplication and make future selector changes a single-file edit.
