# Enhancements

Improvements to existing features that need user prioritization. Only items requiring user approval belong here — routine improvements should be implemented directly by agents.

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

### Deterministic pending-job pickup order
* status: needs_approval
* priority: low
* source: developer
The `ListSampleJobs()` store query should ORDER BY `created_at ASC` to ensure FIFO processing of pending jobs. Currently the SQLite query may return jobs in arbitrary order when multiple jobs are pending.

### Guard explicit Start() API against concurrent running jobs
* status: needs_approval
* priority: medium
* source: developer
The `SampleJobService.Start()` method doesn't verify that no other job is already running. While the executor now won't preempt, the DB can end up with two `running` jobs, which is confusing. `Start()` should check for existing running jobs and return an error if one exists.

### ComfyUI WS reconnect on disconnect — recover stuck jobs
* status: needs_approval
* priority: medium
* source: developer
If the WebSocket connection drops mid-job (e.g. ComfyUI restarts), the executor never receives the completion event and the job stays stuck in running. A recovery mechanism that polls the ComfyUI history API after reconnect to detect already-completed prompts would make the system resilient to mid-job connection losses.

### Atomic stop-and-transition in executor
* status: needs_approval
* priority: low
* source: developer
Currently `RequestStop` clears executor state but the DB update to `stopped` happens in the service layer separately. The executor could own the DB status update after stop (like `completeJob` does), reducing the window where the DB and executor state diverge.

### Update agent ideas files to use "stopped" instead of "paused" terminology
* status: needs_approval
* priority: very-low
* source: qa
Two agent idea files (`agent/ideas/enhancements.md` and `agent/ideas/testing.md`) still reference the old "paused" terminology. These should be updated to say "stopped" for consistency with the codebase after the S-049 rename.

### Lightbox grid position indicator
* status: needs_approval
* priority: low
* source: developer
Show a "3 of 12" or thumbnail strip indicator in the lightbox so the user knows their position in the grid while navigating with Shift+Arrow keys.

### Update gridImages on slider change in lightbox
* status: needs_approval
* priority: low
* source: developer
When the user changes the slider value in the lightbox, the gridImages snapshot could be refreshed so that navigating to adjacent cells shows the correct slider-matched image rather than the state captured at open time.

### Per-model-type workflow restore on training run change
* status: needs_approval
* priority: low
* source: developer
Currently, `restoreModelInputs` is called when the training run changes (after metadata fetch). If the user opens the dialog and the training run is already known (from restore), the per-model-type workflow won't be applied until after the metadata loads. A future improvement could speculatively apply the per-model-type workflow earlier if the model type is already cached from a previous session.

### Deprecate `has_samples` query parameter from Goa DSL
* status: needs_approval
* priority: very-low
* source: developer
The `has_samples` query parameter on `GET /api/training-runs` is now ignored by the backend after S-081 switched the viewer to directory-driven discovery. A future story could remove it from the Goa DSL to keep the API spec clean, though this requires a codegen cycle and frontend client update.

### Expose more sidecar fields as numeric in metadata API
* status: needs_approval
* priority: very-low
* source: developer
Currently only seed, steps, and cfg are routed to NumericFields in the sidecar metadata parser. Fields like width, height, and index are also numeric in practice but are returned as strings. A future story could expand the numericSidecarFields set based on observed sidecar field conventions.

### Drawer swipe-to-close gesture on mobile
* status: needs_approval
* priority: low
* source: developer
On narrow/mobile screens, add a swipe-left gesture on the drawer to close it, improving touch UX. This requires detecting touch events on the drawer element and emitting update:show=false.

### Filters drawer width configurable or auto-sized
* status: needs_approval
* priority: very-low
* source: developer
The FiltersDrawer has a fixed 320px width. For users with many dimensions or long dimension values, an auto-sizing or resizable drawer (like the metadata panel) would be more ergonomic.

### Rename preset inline
* status: needs_approval
* priority: very-low
* source: developer
The Update button updates the mapping but reuses the existing name. A small "Rename" affordance (inline edit on the name field) would let users change names without the Save-As prompt.

### Database UNIQUE constraint on study names
* status: needs_approval
* priority: low
* source: developer
Add a migration to add a `UNIQUE` constraint on `studies.name` to enforce uniqueness at the database level, complementing the service-layer check and preventing race conditions in concurrent-user scenarios.

### Tooltip for long checkpoint names in "Current checkpoint" progress line
* status: needs_approval
* priority: very-low
* source: developer
The "Current checkpoint:" progress line in JobProgressPanel also shows raw checkpoint filenames that could be long. Unlike the completeness section (fixed in B-052), this line has no ellipsis/tooltip treatment. Could add the same `:title` binding for consistency.

### Tooltip on study bead showing checkpoint counts
* status: needs_approval
* priority: low
* source: developer
When hovering over a study's bead in the dropdown, show a tooltip like "3/5 checkpoints have samples" for partial status to give the user more information without cluttering the dropdown label.

### Shared validation constants between backend and frontend
* status: needs_approval
* priority: very-low
* source: developer
The disallowed character set for study name validation is defined independently in the Go service (`disallowedNameChars` constant) and the Vue component (`disallowedChars` variable). A future improvement could surface the disallowed characters in the API error response and have the frontend reflect them, eliminating the duplicated constant. For a simple character set, the current duplication is acceptable.

### Integrate ConfirmDeleteDialog into StudyEditor delete flow
* status: needs_approval
* priority: medium
* source: developer
StudyEditor currently uses `window.confirm()` for delete confirmation, which is browser-native and not styled. Replace with the new ConfirmDeleteDialog (with optional "Also delete sample data" checkbox) for a consistent UX.

### Integrate ConfirmDeleteDialog into preset delete flow
* status: needs_approval
* priority: low
* source: developer
PresetSelector also uses `window.confirm()` for delete confirmation. Replace with ConfirmDeleteDialog for a consistent deletion UX across the app.

### Remove orphaned ThemeToggle.vue component
* status: needs_approval
* priority: very-low
* source: developer
`ThemeToggle.vue` and `ThemeToggle.test.ts` are now dead code since S-091 moved the toggle into the Settings dialog. A cleanup story could delete them.
