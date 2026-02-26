# New Features

Net-new user-facing capabilities not currently in the backlog. Only items requiring user approval belong here — routine improvements should be implemented directly by agents.

## Required fields for new entries

Every idea appended by agents must include:
- `status: needs_approval` — default for all new ideas. The user changes this to `approved`, `rejected`, etc.
- `priority: <low|medium|high|very-low>` — the agent's suggested priority based on impact and effort.
- `source: <developer|reviewer|qa|orchestrator>` — which agent originated the idea.

Example:
```
### <Title>
* status: needs_approval
* priority: medium
* source: developer
<Description — 1-3 sentences>
```

## Ideas

### Negative prompt injection
* status: approved
* priority: low
* instructions: negative prompt from the preset
* source: unknown

The `negative_prompt` cs_role currently does not inject the sample preset's negative prompt text into the workflow at execution time — only `positive_prompt` does. This is an inconsistency that users will find surprising. The code comment says "Keep default or set empty" which suggests this may be intentional for now, but should be a tracked enhancement.

### Lightbox keyboard navigation
* status: approved
* priority: medium
* instructions: use shift-right and shift-left to navigate images (since the regular arrows move the slider)
* source: unknown

The lightbox could support arrow-key navigation between images in the grid, which is a common UX pattern for lightboxes and would be a high-value enhancement.

### E2E test for sample generation batch
* status: needs_approval
* priority: medium
* source: unknown

Add a Playwright E2E test that exercises the full sample generation flow: select a training run, configure a preset, launch a job, and verify images appear in the grid. This depends on a running ComfyUI instance and will be slow compared to other E2E tests, so it should be behind a separate test tag or only run on demand. Needs design work around how to mock or connect to ComfyUI in CI and how to handle the long execution time.

### Combo filter "Solo" click in E2E tests
* status: approved
* priority: low
* source: unknown

The `DimensionFilter` component supports clicking a value text to "solo" it (select only that value). This workflow wasn't covered by E2E tests. A future story could add coverage for the solo interaction as it's a power-user feature.
