# Aspect 2: Documentation completeness & accuracy

- **[high]** [compose/docs contradiction] `docker-compose.yml:14` + `.env.example` + `README.md:170` — Prod compose mounts SAMPLE_DIR `:ro` but app writes images/thumbnails/manifest.json there. `make up` + sample job → read-only fs error. Fix: mount `:rw` + fix wording.
- **[high]** [README accuracy] `README.md:189-203` — E2E section inverted: `make test-e2e` is parallel (Makefile:135, default 4 shards); `test-e2e-parallel` doesn't exist.
- **[high]** [README completeness] `README.md:1-3` — boilerplate description; never says what tool does. Fix: real description + feature list + screenshot.
- **[medium]** [schema drift] `docs/database.md:214-249` §3.4 — sample_job_items schema omits migration-28 columns `vae`, `text_encoder`, `shift` (migrations.go:468-470). Fix: add.
- **[medium]** [schema drift] `docs/database.md:197,228` — missing CHECK(status IN...) constraints from migration 27 (migrations.go:391,419); header at database.md:6 says "through version 26" but history goes to 28.
- **[medium]** [filesystem drift] `docs/filesystem.md:80-84,125-135` — manifest.json location stale post-B-162: now written inside base-model dir for LoRA jobs (job_executor_workflow.go:456-458). Fix: update tree/text.
- **[medium]** [missing doc] — No user-facing usage guide or troubleshooting/FAQ (docs/ui.md is dev-facing). Fix: docs/usage.md covering comfyui config block, demo dataset, study→job→grid workflow, common failure modes.
- **[low]** [README config] `README.md:144-171` — omits MODEL_DIR/LORA_DIR, lora_dirs, base_model_dir, comfyui: section.
- **[low]** [private-infra] `README.md:22` — mcfacehead.com.
- **[low]** [doc drift] `CLAUDE.md` — says test-e2e defaults 12 shards; Makefile:136 says 4. Also repeats "sample dir read-only" claim.
- **[low]** [internal inconsistency] `docs/filesystem.md:170-177` — checkpoint-to-sample mapping describes legacy layout only, contradicts current {run}/{study} hierarchy above. Fix: label as legacy.
- **[low]** [CHANGELOG] `CHANGELOG.md:6` — single ~1090-line "Unreleased" section; cut a v0.x release header before publishing.

**Verified accurate:** docs/api.md matches Goa design 1:1; swagger at /docs real; architecture.md config table matches config.go; README ports/commands check out.

**Verdict:** Reference docs unusually accurate; drift concentrated in database.md/filesystem.md (v27/v28, B-162) and README. Read-only SAMPLE_DIR contradiction is the must-fix.
