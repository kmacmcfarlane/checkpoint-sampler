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

### Preset auto-close on save
* status: approved
* priority: low
* source: unknown

When the user saves a preset in the "Manage Presets" sub-modal, it could automatically close the sub-modal and return focus to the job launch dialog, reducing the required clicks to complete the launch flow.

### Preset preview in selector
* status: needs_approval
* priority: low
* source: unknown

The job launch dialog's preset dropdown could show a tooltip or inline summary (images per checkpoint, sampler count) when hovering over a preset option, helping users pick the right preset without opening the editor.

### Drawer auto-collapse on image grid interaction
* status: approved
* priority: low
* source: unknown

The NDrawer mask blocks pointer events on grid cells when the drawer is open. Consider auto-collapsing the drawer when the user starts interacting with the grid (e.g., after axis assignment), reducing friction for both real users and tests.

### Lightbox slider with dimension label
* status: approved
* priority: medium
* source: unknown

The slider in the lightbox currently shows a generic "Slider" label. It would be more informative to show the actual slider dimension name (e.g., "cfg", "checkpoint") — this would require passing the dimension name through as another prop.

### SliderBar wrap-around consistency
* status: approved
* priority: low
* source: unknown

SliderBar could optionally support wrap-around behavior (configurable via a prop) so keyboard navigation on the SliderBar is consistent with the ImageCell. Currently they differ at boundaries.

### Multiple MasterSlider keyboard conflict guard
* status: approved
* priority: medium
* source: unknown

If multiple MasterSlider components are ever mounted simultaneously, their document-level keydown listeners would conflict (both would handle the same arrow key). A future improvement would be to use a global singleton or priority system for which slider captures keyboard input.

### Preset state persistence after dialog close
* status: approved
* priority: low
* source: unknown

Currently, when the Manage Presets modal is closed, JobLaunchDialog re-fetches presets and auto-selects the last saved preset. A user flow improvement would be to also show the preset that was last edited/deleted as the currently selected option in the job dialog, rather than always auto-selecting saved presets.

### Persist Has Samples filter preference
* status: approved
* priority: low
* source: unknown

The `hasSamplesFilter` state in TrainingRunSelector is transient — it resets to the default on every page load. A user who prefers to see all runs (unchecked) will have to uncheck it every session. Consider persisting this preference the same way training run selection is persisted via localStorage.

### Bead count in sidebar
* status: approved
* priority: medium
* source: unknown

The "Generate Samples" button in the header could show a colored bead indicating whether the current sidebar-selected run has samples/jobs, giving a quick visual hint without opening the dialog.

### Training run list refresh in dialog
* status: approved
* priority: low
* source: unknown

When the dialog is already open and a job completes (via WebSocket), the dialog's training run options and beads should refresh automatically. Currently they are fetched once on mount.

### CFG trailing-zero display
* status: approved
* priority: low
* source: unknown

When a user enters `7.0` as a CFG value, it displays as `7` after the tag is committed due to `parseFloat` normalization. A custom `formatNumber` function that preserves one decimal place for CFG values would provide a better UX.

### Last training run restore in Generate Samples dialog
* status: approved
* priority: low
* source: unknown

The dialog currently restores the last workflow and model-type inputs but not the last selected training run. A future enhancement could remember and restore the last training run selection, providing a more complete "resume where I left off" experience.

### Per-model-type workflow preference
* status: approved
* priority: low
* source: unknown

Users who use different workflows for different model types (e.g., qwen-image.json for Qwen models) would benefit from the workflow selection also being scoped per model type rather than global.

### OpenFile log level for os.ErrNotExist
* status: approved
* priority: medium
* source: unknown

The `FileSystem.OpenFile()` method logs at error level for all open failures. For the sidecar-first metadata reading pattern, file-not-found is an expected condition for pre-existing images. Downgrading not-found errors to debug level while keeping error level for unexpected failures would reduce log noise significantly.

### Log-level tuning for other "expected miss" paths
* status: approved
* priority: low
* source: unknown

The `ListPNGFiles` and `ListSafetensorsFiles` functions also log at error unconditionally on directory-not-found. Those paths may have similar "expected miss" scenarios (e.g., a checkpoint directory configured but not yet mounted). A follow-up could apply the same debug-level pattern there.

### Sidecar reader for metadata display
* status: approved
* priority: low
* source: unknown

The current `parseSidecarJSON` returns all values as strings, which means numeric fields like `seed` come back as JSON numbers serialized to strings. A dedicated API response type could differentiate string vs numeric fields for richer frontend display.

### WebSocket path documentation
* status: approved
* priority: medium
* source: unknown

The project has no documented contract for which URL paths carry WebSocket traffic. A short note in /docs/api.md listing /api/ws would make it easier to audit nginx configs in the future.

### XYGrid image:click emit test
* status: approved
* priority: low
* source: unknown

The `image:click` event in `XYGrid.vue` now emits a full `ImageClickContext` (cellKey, sliderValues, currentSliderValue, imagesBySliderValue), but XYGrid.test.ts has no test asserting the shape of this payload. Adding one test for `image:click` emit context would catch regressions if the payload structure changes.
