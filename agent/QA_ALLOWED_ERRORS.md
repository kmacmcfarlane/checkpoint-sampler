# QA Allowed Errors

This file lists runtime error patterns that are **expected** in the test environment and must be filtered out during the QA runtime error sweep. These are not bugs — they are known consequences of the test environment not having all external services running.

The QA agent reads this file before performing the runtime error sweep (TEST_PRACTICES.md section 5.7). Any error matching a pattern below should be classified as "expected" and skipped.

## Format

Each entry has:
- **Pattern**: A regex or keyword match against docker compose log lines
- **Reason**: Why this error is expected
- **Reference**: The story or bug ticket that introduced or documented this behavior

## Allowed errors

### ComfyUI connection errors
- **Pattern**: Any log line matching `comfyui` or `ComfyUI` combined with `level=error`
- **Includes**: `failed to dial ComfyUI WebSocket`, `websocket: bad handshake`, `health check returned non-OK status` from `component=comfyui_ws` or `component=comfyui_http`
- **Reason**: ComfyUI is an external service that may not running in the test/dev environment. Manually check if it is running before assuming this is a bug. The backend reconnects on a loop, logging errors each attempt. This is non-fatal by design — the application continues to serve all other functionality.
- **Reference**: B-017 (backend crash-loops when ComfyUI is unreachable)

### Database reset race conditions
- **Pattern**: Any backend log line matching `no such table` or `no such column`
- **Includes**: SQLite errors such as `table sample_jobs has no column named ...`, `no such table: studies`, `no such table: sample_job_items` logged from any backend component (e.g. `component=job_executor`, `component=store`, or similar)
- **Reason**: The E2E test suite calls `DELETE /api/test/reset` between tests. `ResetDB()` drops all application tables and reruns migrations. Background goroutines (the job executor polling loop, the watcher, or any in-flight HTTP handler) may issue SQL queries during the brief window between the DROP TABLE statements and the migration re-run. SQLite returns "no such table" or "no such column" for any query that lands in this gap. The `BackgroundPauser` interface reduces but does not fully eliminate the window — a query already in-flight when Pause() is called can still hit a dropped table. These errors are logged at `level=error` but are immediately self-healing: the schema is recreated within milliseconds and subsequent queries succeed. The application does not crash or enter a broken state.
- **Reference**: W-006

### Safetensors metadata parse failures for test fixture checkpoint files
- **Pattern**: Any backend log line matching `failed to parse safetensors metadata` or `parsing safetensors header` combined with `component=checkpoint_metadata`
- **Includes**: `reading header length: EOF`, `reading header data: unexpected EOF`, `parsing header JSON: ...` logged from `component=checkpoint_metadata`
- **Reason**: Test fixture checkpoint files under `test-fixtures/checkpoints/` are minimal stubs (10 bytes: an 8-byte little-endian header length of 2 followed by the JSON bytes `{}`). They are not real safetensors files — they contain no tensor data and no `__metadata__` section. When an E2E test triggers a UI flow that requests checkpoint metadata for one of these stub files, the backend's `CheckpointMetadataService.GetMetadata()` attempts to parse the safetensors binary header. If a fixture file is missing, truncated, or zero-length (e.g. a newly added fixture stub before it is seeded with valid content), the parser will log an error at `level=error`. These failures are benign: the metadata endpoint returns a "not found" or "failed" response to the UI, which handles it gracefully, and no data is corrupted.
- **Reference**: W-006

### Vite WebSocket proxy EPIPE / ECONNREFUSED errors
- **Pattern**: Any frontend (Vite dev server) log line matching `EPIPE`, `ECONNREFUSED`, or `WebSocket proxy error` with a target of `http://backend:8080`
- **Includes**:
  - `[vite] ws proxy socket error: Error: write EPIPE` — Playwright closed a WebSocket connection (page navigation or test reset) before Vite finished writing; this is the primary source of these errors (~93 occurrences per E2E run)
  - `Error: write EPIPE` — the backend closed a WebSocket connection before Vite finished writing
  - `Error: connect ECONNREFUSED 172.x.x.x:8080` — Vite attempted to proxy a WebSocket connection but the backend was not yet ready (startup timing race) or had already shut down (teardown)
  - `WebSocket proxy error: ...` logged by Vite's built-in HTTP proxy middleware (`/api` route with `ws: true`)
- **Reason**: Vite proxies WebSocket connections (`ws: true`) from `localhost:3000/api` to `backend:8080`. The primary source of EPIPE errors during E2E runs is Playwright closing WebSocket connections when pages are navigated or reset between tests. Playwright tears down the page's network layer abruptly, which causes Vite's proxy to encounter a broken pipe when it next attempts to write to the closed socket. This produces approximately 93 `[vite] ws proxy socket error: Error: write EPIPE` entries per full E2E run and is not indicative of any application bug. Additionally, during E2E test startup the frontend container starts before the backend is fully accepting connections, causing brief ECONNREFUSED errors until the backend is ready; during teardown the backend container stops first, producing further EPIPE or ECONNREFUSED errors. All of these are expected artifacts of the test environment and do not affect application correctness.
- **Reference**: W-006, W-015
