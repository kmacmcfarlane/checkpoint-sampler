# Aspect 3: Open-source readiness

- **[medium]** [personal-info] `.claude-sandbox/config.yaml` (tracked) — Personal infra paths (/mnt/lucy/..., /home/rt/...) + host-access flags in a tracked file; .gitignore un-ignores it (`!.claude-sandbox/config.yaml`); example exists alongside. Fix: untrack/sanitize; note it's in git history too.
- **[medium]** [branding] `README.md:1-3` — Intro is generic scaffold text; purpose not stated until ~line 121. Fix: rewrite intro + screenshot.
- **[medium]** [personal-info] `README.md:22` — "checkpoint-sampler.mcfacehead.com on the McFacehead LAN". Delete.
- **[low]** [licensing] `frontend/package.json` — no `license` field; repo LICENSE is GPL-3.0. Add "GPL-3.0-only". LICENSE file present — no blocker.
- **[low]** [community-files] missing — No CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, .github/ templates. Add short CONTRIBUTING esp. re: agent-driven workflow.
- **[low]** [personal-info] `docs/filesystem.md:201-203`, `docs/spike-lora-support.md:50` — /home/rt/ai/... example paths. Replace with placeholders.
- **[low]** [personal-info] `backend/internal/api/cors_test.go:103-110`, `origin_test.go:31`, `config_test.go:653-659`, `comfyui_ws_test.go` — personal domain + 192.168.x in test fixtures. Optional: example.com.
- **[low]** [hygiene] `.claude-sandbox/agent/backlog.yaml` + `backlog_done.yaml` (~8,400 lines), ideas/, QUESTIONS.md — full internal agent history ships publicly incl. env details. Optional prune/archive.

**Verified clean:** No secrets in tree or full git history (webhook URLs are placeholders); .env/config.yaml/data never committed; .gitignore solid; no large binaries (max 1.4MB vendored swagger-ui).

**Verdict:** Good shape — no secrets/license blockers. Remaining work cosmetic-to-moderate: strip personal domain/paths, rewrite README intro.
