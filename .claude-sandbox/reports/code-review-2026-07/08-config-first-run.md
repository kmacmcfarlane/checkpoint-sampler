# Aspect 8: Configuration & first-run UX

- **[high]** [defaults] `backend/internal/config/config.go:90-91` + `store/db.go:22-28` — Default db_path is "./data/" (a directory); SQLite can't open it. Omitting db_path → fatal cryptic "unable to open database file (14)" at pragma verification. Fix: default to file path ./data/checkpoint-sampler.db or reject directory values with clear error.
- **[high]** [docker] `docker-compose.yml:14` — SAMPLE_DIR mounted :ro but app writes sample-job output (main.go:131-137), thumbnails, AND first-run demo dataset auto-install (main.go:186-192, demo.go). Demo install fails Warn-only; sample jobs fail mid-job. config.yaml.example:20 contradicts :ro mount. Fix: mount rw or split browse dirs from writable output dir.
- **[medium]** [docker] `config.yaml.example:81` + `config.go:257` — ComfyUI URL localhost:8188 default is container-relative; perpetual "ComfyUI (offline)" pill, no hint. Fix: host.docker.internal note.
- **[medium]** [validation] `config.go:114-121` + `main.go:150-152` — validation only os.Stat's dirs; unreadable dir (root-owned Docker-created) passes, FSState.Populate fails → Warn log only, UI shows empty dropdown forever. Fix: os.ReadDir at validation; fail or UI health warning.
- **[medium]** [empty-state] `frontend/src/components/TrainingRunSelector.vue:347` — zero training runs → generic "No Data"; no hint naming configured dirs. Fix: empty-state message.
- **[low]** [defaults] `config.go:87-88` — ip_address defaults 127.0.0.1; in container = unreachable published port. Mitigated by example setting 0.0.0.0. Fix: note or container-aware default.
- **[low]** [error-message] `config.go:67` + `main.go:36-38` — missing config file error has no next-step hint (cp config.yaml.example...). Fix: append hint.
- **[low]** [docs] `README.md:171` — PORT presented as env var; doesn't exist in code (only CONFIG_PATH, LOG_LEVEL). Fix: reword.

Done well: example file matches parsed struct field-for-field; config: prefixed validation errors; ComfyUI omission cleanly disables features; offline pill + S-161 queueing works.

**Verdict:** Config validation/docs far above average. Two real traps: directory-valued db_path default crashes cryptically; read-only sample-dir mount kills demo dataset + sample jobs in flagship Docker path.
