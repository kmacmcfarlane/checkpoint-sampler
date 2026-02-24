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
- **Reason**: ComfyUI is an external service that is not running in the test/dev environment. The backend reconnects on a loop, logging errors each attempt. This is non-fatal by design — the application continues to serve all other functionality.
- **Reference**: B-017 (backend crash-loops when ComfyUI is unreachable)
