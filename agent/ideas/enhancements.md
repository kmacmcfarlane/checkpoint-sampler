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
