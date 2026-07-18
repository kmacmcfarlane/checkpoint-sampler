# Aspect 10: Build, packaging & distribution

- **[high]** [fresh-clone build] `backend/Makefile:9` / `backend/internal/api/generate.go:3` — `make gen` fails fresh: goa CLI not installed, nothing installs it. After `go install goa.design/goa/v3/cmd/goa@v3.25.3` build succeeds. Fix: `go run goa.design/goa/v3/cmd/goa@v3.25.3 gen ...` (match mockery pattern).
- **[high]** [end-user run] `README.md:16-19` vs `docker-compose.yml:11` — fresh clone `make up` → Docker creates config.yaml as directory, backend crash-loops. Fix: copy steps in Quick start + Makefile guard.
- **[high]** [version/release] missing — No .github/ (zero CI), no git tags, no semver, no published images, CHANGELOG has no version headers. Only buildinfo.CommitSHA via ldflags, not surfaced in UI or /version. Fix: GH Actions workflow, tag v0.1.0, Version var, optional GHCR images.
- **[medium]** [reproducibility] `backend/Dockerfile:3`, `Dockerfile.dev:7` — `go install goa@latest` unpinned while go.mod pins v3.25.3. Fix: pin.
- **[medium]** [prod compose] `docker-compose.yml` — no restart policies, containers run as root (no USER in backend Dockerfile; nginx master root), no healthchecks in prod file (test compose has them). Multi-stage builds otherwise good. Fix: restart: unless-stopped, healthchecks, non-root USER.
- **[medium]** [private-infra] README:22 mcfacehead.com, docs /home/rt/ai paths, README:3 advertises agent workflow as product feature. Fix: scrub; move agent blurb to CONTRIBUTING.
- **[medium]** [Makefile hygiene] `Makefile:17-69,123-124` — leads with claude/ralph/backlog targets requiring claude-sandbox; E2E_LOG_DIR/LOGS_SNAPSHOT_DIR point into .claude-sandbox/ralph/temp/. Fix: split Makefile.agent; default log dirs to .e2e/ or tmp/.
- **[low]** [toolchain pinning] — no engines field / .nvmrc / .tool-versions. go.mod tidy; lockfiles tracked. Fix: engines + .nvmrc.
- **[low]** [bundle] frontend 741.9 kB single chunk (209.9 kB gzip), Vite warning. Optional manualChunks.

Cross-platform: nginx container serves frontend, proxies /api; compose uses env-var host paths; macOS/Windows via Docker Desktop should work (README undersells). ComfyUI correctly optional.

**Verdict:** Packaging better than typical hobby projects (multi-stage builds, pinned lockfiles, compose-first, GPLv3). Blockers: broken Quick start, broken documented backend build (goa), zero CI/tags/releases, personal LAN details. ~1 day of work to credibly distributable.
