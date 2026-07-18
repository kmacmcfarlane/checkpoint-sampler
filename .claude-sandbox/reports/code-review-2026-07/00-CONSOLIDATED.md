# Consolidated code review — public-release readiness (2026-07-17)

Ten Fable 5 sub-agents reviewed one aspect each. Full per-aspect findings in files 01–10 in this directory. Deduplicated, severity-ranked list below. "×N" = independently confirmed by N agents.

## P0 — Release blockers (break the first-run / core features)

1. **Fresh-clone `make up` breaks** (×3: aspects 1, 8, 10). README Quick start runs `make up` before config.yaml/.env exist → Docker creates a *directory* named config.yaml, backend crash-loops, later `cp` fails. Fix: copy steps first in Quick start + Makefile guard. `README.md:14-28`, `docker-compose.yml:11`.
2. **SAMPLE_DIR mounted `:ro` in prod compose** (×4: aspects 1, 2, 8, 10). Sample-job writes, thumbnails, AND first-run demo dataset install all fail (demo fails Warn-only → blank app). `docker-compose.yml:14`.
3. **Default `db_path: ./data/` is a directory** — omitting db_path crashes SQLite with cryptic errno 14. `backend/internal/config/config.go:90-91`.
4. **`make gen` fails on fresh machine** — goa CLI never installed/pinned; Dockerfiles use `@latest` vs go.mod v3.25.3. `backend/Makefile:9`, `backend/Dockerfile:3`.
5. **Missing-only sample jobs silently broken** — creation check uses stale path layout (omits run + base-model dirs) so it regenerates everything. `backend/internal/service/sample_job.go:384`. Plus LoRA filename mismatch (S-161 regression) at `sample_job.go:1218`.
6. **Delete-job-with-data removes nothing** — RemoveJobSampleDir uses stale layout; API returns success, files remain. `backend/internal/store/filesystem.go:317-318`.
7. **POST /start orchestration gap** — service sets running but never RequestResume; job can hang until restart. `sample_job.go:527-599`. (Frontend never calls it either — aspect 7.)

## P1 — High (fix before/at release)

8. ComfyUI requirement essentially undocumented; example URL `localhost:8188` can't work from container (×2: aspects 1, 8). README + `config.yaml.example:85` + compose extra_hosts.
9. README is scaffold boilerplate — doesn't say what app does until line 121; private LAN domain mcfacehead.com at README:22 (×4: aspects 1, 2, 3, 10). Rewrite intro + screenshot + scrub.
10. No auth + example binds 0.0.0.0 + no documented trust model (security). Default example to 127.0.0.1, document, recommend reverse proxy. `config.yaml.example:26`.
11. Zero CI / tags / releases / version surfacing (aspect 10). Add GH Actions, tag v0.1.0, Version var.
12. Frontend coverage unmeasurable — @vitest/coverage-v8 missing (aspect 9); imageCube.ts (584-line core store) has no unit test.
13. Transient ComfyUI outage at submit permanently fails items (inconsistent with S-161 offline queueing). `job_executor_lifecycle.go:543-554`.
14. Dependency vulns: lodash-es (2 high) + postcss (frontend); ~24 Go stdlib advisories → bump toolchain (security).
15. E2E docs inverted: `make test-e2e-parallel` doesn't exist; test-e2e mislabeled serial (×2). `README.md:189-203`; CLAUDE.md says 12 shards vs actual 4.

## P2 — Medium

16. Silent frontend API failures: job controls swallow errors (App.vue:753-787); launch-dialog fetches empty-catch (JobLaunchDialog.vue:1061); no toast layer exists.
17. Keyboard a11y: XYGrid headers + ImageCell lightbox not keyboard-operable. XYGrid.vue:284, ImageCell.vue:66.
18. Unreadable configured dirs pass validation → app "healthy" with forever-empty UI. config.go:114-121.
19. Empty-state UX: zero training runs → generic "No Data" with no hint. TrainingRunSelector.vue:347.
20. GET /api/sample-jobs unpaginated + inlines full tracebacks; scan returns up to 50k entries. design/sample_jobs.go:10.
21. No API versioning posture (/api/... unprefixed). design/api.go.
22. Contract drift: CheckpointCompletenessInfo lies about WS payload; ComfyUIModelType includes 'lora' → guaranteed 400. types.ts:388,184.
23. docs drift: database.md missing migration 27/28 (CHECK constraints, vae/text_encoder/shift cols); filesystem.md manifest location stale post-B-162.
24. Missing user-facing usage guide / troubleshooting doc.
25. Prod compose: no restart policies, root containers, no healthchecks. docker-compose.yml.
26. Executor lock discipline: store I/O under e.mu stalls WS event delivery. job_executor_lifecycle.go:294-351.
27. Tracked `.claude-sandbox/config.yaml` has personal infra paths (also in history). Untrack/sanitize.
28. README config table omits MODEL_DIR/LORA_DIR, lora_dirs, base_model_dir, comfyui section (×2).
29. Makefile leads with claude/ralph targets; E2E log dirs point into .claude-sandbox/ralph/temp/. Split Makefile.agent.
30. E2E waitForTimeout in shared helpers (~40 sites) contrary to TEST_PRACTICES 6.10; 30ms sleeps in comfyui_client_test.go.
31. cmd/server 6.4% coverage; model 57.7%.
32. Four frontend components 1200–2029 lines.

## P3 — Low (polish / opportunistic)

33. Personal paths/domain in docs + test fixtures (docs/filesystem.md:201, cors_test.go etc.).
34. No CONTRIBUTING/CODE_OF_CONDUCT/SECURITY/.github templates; frontend package.json missing license field.
35. failItem jobID race → silent drop / infinite retry of deterministic failures. job_executor_progress.go:29.
36. Double-Stop panic; ComfyUI WS Connect-after-Close can't reconnect (footguns). job_executor_lifecycle.go:52, comfyui_ws.go:150.
37. GetItemCounts errors swallowed (api/sample_jobs.go:173+); progress aggregation triplicated (already drifted once).
38. URL encoding: client.ts:140 filepath unencoded; image URLs break on #?%.
39. jobProgress map never pruned; preloader no dispose-abort/cap. useJobProgress.ts:96, useImagePreloader.ts:209.
40. Dead code: ComboFilter.vue; dead API surface GET /workflows/{name}.
41. Misc: ip_address 127.0.0.1 default in container; config-not-found error lacks hint; PORT table row bogus; DELETE /api/demo returns 200; scan param named study_name; OpenAPI advertises internal _images_metadata route; ErrorLoggingMiddleware unbounded body buffering; symlink escape (low exploitability); CHANGELOG single 1090-line Unreleased; hub_test no-op assertion; presetWarnings.ts untested; store suite 21s; 741kB bundle chunk; no engines/.nvmrc; README:96 malformed tree; watch targets need up-dev note; filesystem.md legacy-mapping inconsistency.

## Verified clean
No secrets in tree or git history; SQL fully parameterized; path traversal boundary solid; CORS/origin handling correct; docs/api.md accurate vs design; frontend zero any/@ts-ignore, vue-tsc clean; backend vet/lint clean; test network-isolation rules followed.
