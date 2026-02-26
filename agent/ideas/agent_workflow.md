# Agent Workflow

Changes to agent processes, orchestrator behavior, story writing, and handoff patterns. Only items requiring user approval belong here — routine improvements should be implemented directly by agents.

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

### E2E test result parsing in orchestrator
* status: approved
* priority: high
* instructions: failing E2E tests should be addressed by the QA agent. Any failing tests should result in bug tickets being added to the backlog
* source: unknown

The orchestrator currently has no structured mechanism to accumulate E2E pass/fail trends over time. Adding a simple log of E2E results per story to `.ralph-debug/` could enable spotting regressions before they become endemic.

### Documentation cross-reference test
* status: needs_approval
* priority: low
* source: unknown

Automated check comparing model constants against markdown tables to prevent documentation drift.

### Behavior accuracy for docs stories
* status: needs_approval
* priority: low
* source: unknown

Documentation stories benefit from a "key behaviors to document" list in story notes.

### QA smoke test consolidation
* status: needs_approval
* priority: low
* source: unknown

Unify the three ways to satisfy the smoke test requirement into a single decision tree.

### AC sandbox interpretation clarity
* status: needs_approval
* priority: low
* source: unknown

Story AC mentioning "works in the claude-sandbox" should clarify container vs Docker approach.

### Capture-phase handler ordering documentation
* status: approved
* priority: low
* source: unknown

The pattern in ImageLightbox.vue where capture-phase listeners with stopImmediatePropagation are used to prevent MasterSlider's bubble-phase handler from double-firing is well-commented but could be documented in a project-wide keyboard event handling guide to help future developers understand the intentional ordering.

### Story notes numeric format spec
* status: approved
* priority: low
* instructions: CFG should be floating point, where steps and seeds must be integers
* source: unknown

Story notes mentioning "add input validation to reject non-numeric characters" should specify how trailing zeros should be handled (e.g., should `7.0` round-trip as `7` or `7.0`). Explicit formatting requirements in acceptance criteria would avoid ambiguity.

### Root cause documentation in story notes
* status: approved
* priority: high
* source: unknown

Story notes should include richer root cause analysis (e.g., "NSlider's handleStepValue uses activeIndex === -1 guard") to help the developer focus immediately on the correct fix rather than investigating alternative approaches.
