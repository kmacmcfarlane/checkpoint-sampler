# Aspect 4: Security

- **[medium]** [auth/exposure] `backend/cmd/server/main.go:293` + `config.yaml.example:26` — No auth anywhere; example binds 0.0.0.0; README advertises LAN access. Full unauthenticated control (delete studies/jobs, trigger jobs, browse all images) for anyone who can route to the port. No doc warns. Fix: document trust model, default example to 127.0.0.1, recommend authenticating reverse proxy or token middleware.
- **[medium]** [dependencies] `frontend/package.json` — npm audit prod: lodash-es (2 high: _.template code injection, proto pollution) + postcss <8.5.10 (moderate XSS). Fix: bump + rebuild.
- **[low/medium]** [Go stdlib vulns] — vulncheck flags ~24 stdlib advisories on go1.25.6 (HTTP/2 CONTINUATION GO-2026-4918, TLS deadlock GO-2026-4870, textproto GO-2026-5039). Fix: bump Go toolchain patch, re-run vulncheck.
- **[low]** [path traversal/symlinks] `backend/internal/store/filesystem.go:399` / `service/image_metadata.go:45` — path validation solid (rejects abs/dotdot, prefix re-check) but no EvalSymlinks; symlink inside sample root escapes. Low exploitability (no write path via API, ro mounts). Fix: EvalSymlinks + re-assert root, or document.
- **[low]** [resource] `backend/internal/api/error_logging.go:20-60` — middleware buffers full 4xx/5xx response bodies for logging. Fix: cap at ~2KB.

Positives verified: SQL fully parameterized; test endpoints env-gated; body/study-size/WS/PNG-chunk bounds; ComfyUI type Enum-constrained, no SSRF (base URL is operator config); CORS/WS same-host origin echo (never *), CSRF via preflight; study names validated; delete filenames filtered against discovered files.

**Verdict:** Path-traversal boundary implemented carefully; SQL/input handling sound. Material risks are operational: unauthenticated API on 0.0.0.0 with no documented trust boundary + stale deps.
