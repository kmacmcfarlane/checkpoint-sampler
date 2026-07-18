# Aspect 7: API design & contracts

- **[medium]** [contract drift] `frontend/src/api/types.ts:388-397` — CheckpointCompletenessInfo requires extra/invalid_params but WS job_progress never sends them (design/ws.go:21-28, api/ws.go:188-194); consumers declare private 4-field shapes (JobProgressPanel.vue:13, useJobProgress.ts:22). Fix: split interfaces or make fields optional.
- **[medium]** [contract drift] `types.ts:184` — ComfyUIModelType includes 'lora' but design enum (design/comfyui.go:24) doesn't → guaranteed 400; latent trap. Fix: align.
- **[medium]** [API design] `design/sample_jobs.go:10-19` — GET /api/sample-jobs unpaginated, embeds failed_item_details incl. full tracebacks (206,234); jobs accumulate forever. Scan endpoint returns up to 50,000 entries in one response. Fix: limit/offset + strip tracebacks from list view.
- **[medium]** [versioning] `design/api.go:7-18` — no /v1 prefix, Version("0.1.0") only OpenAPI metadata, no breaking-change posture. Fix: /api/v1/ before release or document unstable.
- **[low]** [naming] `design/training_runs.go:58 vs :38` — same value passed as `study_name` (scan) vs `study_output_dir` (validate); client.ts:94-96 papers over. Fix: rename scan param.
- **[low]** [OpenAPI accuracy] `design/images.go:44-48` — spec advertises /api/_images_metadata/{*filepath}; real route /api/images/{filepath}/metadata via rewrite middleware (http.go:329-343). Generated clients get wrong route. Fix: note in design / flag internal.
- **[low]** [contract drift] `types.ts:318-320` — SampleJob.vae/clip typed required; backend omits when empty. Fix: optional.
- **[low]** [WS contract] `design/ws.go:56-83` — FSEventResponse: path doc wrong for inference_progress (synthetic value, job_executor_conn.go:393); sample_eta_seconds comment says job_progress-only but sent on inference_progress too (ws.go:161-163). Fix: correct comments; consider discriminated union.
- **[low]** [HTTP semantics] `design/demo.go:33-41` — DELETE /api/demo returns 200+body vs 204 elsewhere; ETA duplicated as RFC3339 (HTTP) vs seconds float (WS). Fix: pick conventions.
- **[low]** [dead surface] `design/sample_jobs.go:58-77` — POST .../start designed+implemented but never called by frontend; GET /api/workflows/{name} unconsumed. Fix: wire UI or mark internal. (NOTE: backend review found Start is also BROKEN — never adopted by executor. Related.)

**Verdict:** Contract in good shape (snake_case consistent, 201/204 correct, error vocabulary mirrored). Real risks: lying shared WS type, unbounded list/scan responses with tracebacks, absent versioning posture.
