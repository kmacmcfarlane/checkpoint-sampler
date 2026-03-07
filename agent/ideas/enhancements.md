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

### Replace window.prompt for preset save with NModal input dialog
* status: needs_approval
* priority: medium
* source: developer
The "Save preset" flow still uses `window.prompt`, which is inconsistent with the ConfirmDeleteDialog pattern established in S-094/S-095/S-096. A proper NModal input dialog would provide a more polished UX.

### Restrict Delete button to non-running jobs or add "Stop then Delete" flow
* status: needs_approval
* priority: low
* source: developer
Currently the Delete button shows on running jobs, which could lead to data inconsistency if the executor is mid-write when the DB record is removed. A dedicated "stop then delete" flow or hiding Delete when status is `running` would improve safety.

### Display individual checkpoint filenames in job parameters panel
* status: needs_approval
* priority: low
* source: developer
The SampleJob API response does not currently include the list of checkpoint filenames selected at job creation. Storing and returning this list would make the job parameter detail panel richer (show individual checkpoint names instead of just a count). Requires a backend schema change and API update.
