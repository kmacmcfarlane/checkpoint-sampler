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
* status: done
* priority: low
* source: developer
Implemented in S-070: helpers extracted to `frontend/e2e/helpers.ts`.

### Add Vite ws proxy EPIPE to QA_ALLOWED_ERRORS.md
* status: needs_approval
* priority: low
* source: qa
The `[vite] ws proxy socket error: Error: write EPIPE` pattern appears in every E2E run (~93 times) because Playwright closes WebSocket connections when pages are navigated or reset. Adding this to QA_ALLOWED_ERRORS.md would eliminate recurring noise in QA sweeps.

### Shared logrus log-level assertion helper for backend tests
* status: needs_approval
* priority: low
* source: developer
The pattern of capturing logrus output to a buffer to assert log levels (as used in B-066's test) works but is verbose. A small shared test helper (e.g. `captureLogrus(logger, fn) string`) in the service test suite would reduce boilerplate for similar log-level regression tests in the future.
