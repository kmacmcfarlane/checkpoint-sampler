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
