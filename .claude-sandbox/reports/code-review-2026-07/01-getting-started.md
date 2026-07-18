# Aspect 1: Getting-started documentation

- **[critical]** [setup ordering / broken first run] `README.md:14-28` — "Quick start" tells the user to run `make up` before the "Configuration" section (README.md:140) ever mentions that `config.yaml` and `.env` must be created first. On a fresh clone neither file exists (both gitignored); docker compose bind-mounts ./config.yaml, so Docker silently creates a directory named config.yaml, backend crash-loops, later `cp config.yaml.example config.yaml` fails with "cannot overwrite directory". Fix: move cp commands into Quick start step 1; add Makefile guard in `up` erroring when config.yaml/.env missing.
- **[high]** [missing prerequisite] `README.md` (missing) — README never states a running ComfyUI instance is required, nor how to point at it. comfyui: block in config.yaml.example:81-87 commented out → inference features silently disabled. Fix: add "Connecting to ComfyUI" README section incl. extra_model_paths.yaml note.
- **[high]** [wrong example value] `config.yaml.example:85` — example ComfyUI URL http://localhost:8188 can't work from inside backend container. Fix: recommend host LAN IP or host.docker.internal (+ extra_hosts: host-gateway in compose).
- **[high]** [broken feature] `docker-compose.yml:14` — production compose mounts SAMPLE_DIR read-only (:ro) but generation writes to sample_dir. `make up` → generation fails on read-only fs; only dev stack mounts rw. Fix: mount rw in docker-compose.yml or document browse-only.
- **[medium]** [nonexistent make target] `README.md:200-202` — documents `make test-e2e-parallel` (doesn't exist); README:194 mislabels `make test-e2e` as serial. Fix: correct E2E section.
- **[medium]** [incomplete config table] `README.md:167-171` — env table omits MODEL_DIR and LORA_DIR (in .env.example, required for LoRA). Fix: add rows.
- **[medium]** [missing prerequisites] `README.md:16` — lists only Docker/Compose; make, git also required; no versions (Compose v2, Go 1.25, Node 22). Fix: list them.
- **[medium]** [undocumented data layout] `README.md` — never links docs/filesystem.md (only doc explaining checkpoint dir organization/suffix rules). Fix: link from Configuration.
- **[low]** [misleading] `README.md:163,171` — port customization guidance wrong under Docker (hardcoded 8081:8080, 3001:3000 mappings). Fix: state user-facing ports explicitly.
- **[low]** [watch targets] `README.md:38-43` — watch targets need `make up-dev` running first; not stated.
- **[low]** [private infra leak] `README.md:22` — references http://checkpoint-sampler.mcfacehead.com / "McFacehead LAN". Remove before publishing.
- **[low]** [boilerplate intro] `README.md:1-3` — intro doesn't say what the app does until line 121; README:96 malformed tree entry.

**Verdict:** Not ready for low-technical public audience. Documented happy path breaks on fresh clone (config files documented 120 lines after `make up`); ComfyUI requirement undocumented; sample dir read-only blocks generation.
