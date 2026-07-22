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

### Include `e2e/` in typecheck and lint scope
* status: needs_approval
* priority: medium
* source: qa
`frontend/tsconfig.json` includes only `src/**`, and eslint reports e2e files as "ignored by a matching ignore pattern" — so the ~88 Playwright specs receive neither `vue-tsc` nor eslint. Type errors in E2E code surface only as runtime failures partway through a suite run, which is the most expensive place to find them. Add a `tsconfig.e2e.json` (or extend `include`) and drop e2e from the eslint ignore list. Found during R-021 QA while authoring a new spec.

### Generate TypeScript API types from Goa design for E2E tests
* status: needs_approval
* priority: low
* source: developer
E2E tests manually type API payload field names (e.g., `workflow_filename` vs `workflow_name`), which can silently diverge from the Goa API design. Generate a lightweight TypeScript types file from the Goa design so E2E tests can import typed payloads rather than guessing field names by hand.

### Validate mock server PNG checksum in CI
* status: needs_approval
* priority: low
* source: developer
Add a startup validation step to the ComfyUI mock that verifies its PNG data passes Go's CRC check before tests run, preventing silent thumbnail failures if the PNG is ever modified again.

### Fix playwright-report and test-results root ownership
* status: needs_approval
* priority: low
* source: developer
The `playwright` service in `docker-compose.test.yml` writes root-owned `frontend/playwright-report/` and `frontend/test-results/` to the host-mounted directory. These could be isolated to named volumes or the playwright service could use a `user:` directive to avoid the same class of root-ownership problem fixed by B-087.

### Accessibility audit as a separate CI step
* status: needs_approval
* priority: low
* source: developer
The axe E2E tests currently run as part of the full E2E suite. A dedicated accessibility audit step that runs accessibility.spec.ts before other E2E tests could catch regressions earlier in CI.

### Add lint-disallowed-chars to CI pipeline
* status: needs_approval
* priority: low
* source: developer
Once the disallowed character set is stable, add `make lint-disallowed-chars` as a pre-merge CI check so it runs automatically when `disallowedNameChars` is modified, rather than relying on developers to run it manually.

### E2E parallel shard DNS stability
* status: needs_approval
* priority: medium
* source: qa
The parallel E2E runner occasionally fails all shards due to Docker DNS not resolving the `frontend` hostname during simultaneous shard startup. Investigate adding a DNS readiness check or startup delay/retry in the shard orchestration before running tests.

### StudyHasSamples path alignment
* status: needs_approval
* priority: medium
* source: qa
The `StudyAvailabilityService.StudyHasSamples` method checks `{sampleDir}/{studyName}/` but samples are stored at `{sampleDir}/{runName}/{studyName}/`. This means the immutability dialog in StudyEditor is effectively unreachable through normal usage. Should align the path or document the intended behavior clearly.

### E2E log directory creation reliability in make test-e2e
* status: needs_approval
* priority: low
* source: qa
The `mkdir -p .ralph/temp/e2e-logs` step in the Makefile test-e2e recipe may execute after teardown or fail silently. Verify the log capture step runs before `docker compose down -v` so logs are always available for the runtime error sweep.

### Automatic E2E baseline tracking per-story
* status: needs_approval
* priority: low
* source: developer
When the orchestrator commits a story, automatically record the passing E2E count in the commit message in a structured format. This would allow automated detection of stories that introduced new failures vs. pre-existing ones, reducing false-positive bug reports like B-117.

### Backlog and worktree test runner Makefile targets
* status: needs_approval
* priority: low
* source: developer
There is no `make test-backlog` or `make test-worktree` target — Python script tests must be run manually via `python3 -m unittest`. Adding Makefile targets would improve discoverability and consistency with `make test-backend` / `make test-frontend`.

### Serialize /api/test/reset endpoint for parallel E2E safety
* status: needs_approval
* priority: medium
* source: qa
The DB reset endpoint races under 12-shard parallel load, causing UNIQUE constraint failures on schema_migrations. Adding a mutex or SQLite-level serialization would eliminate the most common source of E2E flakiness. Related: B-122.

### E2E shard DNS failure resilience
* status: needs_approval
* priority: low
* source: qa
Shard-3 suffered a complete DNS resolution failure (`ENOTFOUND frontend`) affecting all tests in that shard. Consider adding a startup health check that retries DNS resolution before the Playwright process starts, to surface infrastructure failures more clearly and potentially retry the shard.

### Reduce default E2E shard count or add per-host override
* status: needs_approval
* priority: medium
* source: qa
The Makefile hardcodes 12 shards, which can exhaust host resources (12 shards × ~6 containers = ~72 containers). Under load, CPU starvation causes Naive UI popup race conditions and timeout failures. A lower default (4-6 shards) or a `SHARDS_HOST` env var read from a local `.env` file would prevent recurrence.

### E2E parallel run Docker cleanup
* status: needs_approval
* priority: low
* source: qa
Orphaned `playwright-run` containers from aborted/conflicting E2E runs block subsequent runs by consuming Docker DNS entries. Consider adding a pre-flight cleanup step in `e2e_parallel.sh` to kill containers matching the project prefix pattern before starting a new run.

### SampleDirCleaner explicit preservation list for non-safetensors fixture roots
* status: needs_approval
* priority: low
* source: qa
`SampleDirCleaner.CleanStudyDirs()` deletes all non-`.safetensors` root directories, so any fixture using a nested (non-flat) sample layout requires a matching `FixtureSeeder` addition to recreate the deleted tree after each reset (as B-144 had to do for `test-lora/`). Consider extending `SampleDirCleaner` to accept an explicit list of protected directory names, making the preservation logic explicit rather than relying on the seeder to recreate deleted dirs.

### Document E2E network topology / allowed_origins requirement
* status: needs_approval
* priority: low
* source: qa
The `config-with-comfyui.yaml` E2E fixture needs `allowed_origins: [http://frontend:3000]` because Vite's `changeOrigin: true` rewrites `Host: backend:8080` while the browser sends `Origin: http://frontend:3000`, creating a cross-host scenario the same-host origin policy (S-151) correctly rejects. This is now documented inline in the fixture, but it could also be mentioned in `DEVELOPMENT_PRACTICES.md` under an "E2E network topology" note for future developers adding origin/CORS-related features.

### Enforce gofmt in backend lint
* status: needs_approval
* priority: low
* source: developer
`backend/make lint` runs only `go vet`; it does not catch gofmt drift. Several pre-existing files (e.g. `internal/service/validation_test.go`) are not gofmt-clean. Adding `gofmt -l` (fail on output) to the lint target would prevent formatting drift and remove ambiguity about "formatting churn" during reviews.

### `make gen` should bootstrap the pinned goa binary
* status: needs_approval
* priority: low
* source: developer
`cd backend && make gen` fails in a fresh sandbox because the `goa` binary is not on PATH. The target could `go install` the version pinned in `go.mod` (or document the prerequisite) so codegen works out of the box without a manual `go install goa.design/goa/v3/cmd/goa@<version>`.

### Frontend coverage thresholds
* status: needs_approval
* priority: low
* source: developer
Now that `@vitest/coverage-v8` tooling exists (S-166), consider adding per-file or global coverage thresholds in `frontend/vite.config.ts` to gate regressions in CI. Deferred from S-166 because it needs a baseline-setting decision across the whole frontend, not just imageCube.ts.

### Untrack stale gen/demo/ files
* status: needs_approval
* priority: low
* source: developer
12 files under `backend/internal/api/gen/demo/**` and `gen/http/demo/**` remain git-tracked even though the entire `gen/` directory is gitignored (they pre-date the ignore rule). They currently regenerate byte-identical so there's no correctness risk, but a future demo-design change could surface a confusing diff that looks like it must be committed. A small cleanup story could `git rm --cached` these paths. (Surfaced during B-170.)

### Cache govulncheck binary in CI/sandbox image
* status: needs_approval
* priority: low
* source: developer
`make audit` (added in S-167) runs `go run golang.org/x/vuln/cmd/govulncheck@<pinned>`, which recompiles the tool on first run per environment. Pre-installing/caching the govulncheck binary in the sandbox Dockerfile (or CI) would speed up the pre-push hook.

### Preflight guard for sandbox config
* status: needs_approval
* priority: low
* source: developer
`make up` guards against a missing `config.yaml`/`.env`, but there is no equivalent check that `.claude-sandbox/config.yaml` exists before `make claude`/`make ralph`. A small guard prompting contributors to copy the new `.claude-sandbox/config.yaml.example` would smooth first-run onboarding (relevant now that the real config is gitignored per S-172).

### `make test-e2e SPEC=...` silently ignores SPEC and runs the full suite
* status: needs_approval
* priority: high
* source: developer
The `test-e2e` target (`Makefile:154`) is `./scripts/e2e/e2e_parallel.sh $(or $(SHARDS),4)` — it accepts no `SPEC` variable, so any `SPEC=` passed on the command line is silently dropped and the full 4-shard regression runs instead. During S-173 this caused an accidental full-suite run (which then failed broadly with `getaddrinfo ENOTFOUND frontend`, likely resource contention from 4 concurrent shards in the sandbox). The correct targeted command is `make test-e2e-serial SPEC=<file>`. Two fixes worth considering: (a) correct the `fullstack-developer` agent definition (and any other subagent docs) to reference `test-e2e-serial` for targeted runs, and (b) make the `test-e2e` target fail loudly if an unexpected `SPEC=` is supplied, rather than ignoring it. (Surfaced during S-173.)

### Lint the `frontend/e2e/` directory
* status: needs_approval
* priority: low
* source: developer
`frontend/e2e/` is currently excluded by an ESLint ignore pattern, so E2E specs get no lint coverage at all — `npx eslint e2e/*.spec.ts` returns only "File ignored" warnings. Enabling it would catch unused imports and dead locals in test code (W-031 observed several). This is also a prerequisite for the "lint gate banning bare `page.waitForTimeout`" testing idea, which cannot fire while the directory is ignored.

### Type-check `frontend/e2e/` in CI
* status: needs_approval
* priority: low
* source: developer
The root `frontend/tsconfig.json` does not cover `e2e/`, so type errors in E2E specs only surface at Playwright runtime rather than at build time. A dedicated `tsconfig.e2e.json` wired into the build/CI would catch them earlier. Noted during W-031, where pre-existing TS errors in `sample-generation.spec.ts` (window type casts, unused vars) were invisible to `vue-tsc --noEmit`.

### Per-package coverage floors in `make test`
* status: needs_approval
* priority: low
* source: developer
After W-032, `backend/internal/model` sits at 100% and `backend/cmd/server` at 71.1%. A lightweight `go tool cover` threshold check on selected packages, wired into `make test`, would prevent silent coverage regressions on packages that were deliberately raised. Needs a decision on which packages get floors and at what values (a blanket repo-wide floor would be noisy), so it is cross-story coordination rather than something W-032 could land in scope.

### Investigate host-level inotify instance/watch exhaustion on the E2E host
* status: needs_approval
* priority: medium
* source: qa
During B-178 QA, all 4 E2E shards fully exhausted inotify watches (`total_watches=0`, `degraded=true`) from process start in BOTH full runs — meaning the host is at/near its effective inotify capacity even under normal 4-shard load, not just extreme stress. B-178's graceful degradation is now doing real work on every E2E run rather than only under rare stress. Investigate raising `fs.inotify.max_user_instances` / `fs.inotify.max_user_watches` on the CI/dev host (e.g. via `/etc/sysctl.d`) to restore true inotify-driven live updates under parallel load. (Surfaced during B-178 QA.)
