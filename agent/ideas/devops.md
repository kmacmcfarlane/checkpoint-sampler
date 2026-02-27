# Dev Ops

Build pipeline, CI, Docker, linting, and infrastructure improvements. Only items requiring user approval belong here — routine improvements should be implemented directly by agents.

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

### Scoped-CSS-in-render-functions lint rule or doc note
* status: needs_approval
* priority: low
* source: developer
A custom ESLint rule or DEVELOPMENT_PRACTICES doc note could warn developers when CSS class names from `<style scoped>` are used inside `h()` render functions or `renderLabel`/`renderOption` callbacks — scoped CSS is not applied to VNodes created outside Vue's template compilation context. This footgun caused a two-iteration UAT cycle on S-049.

### Update frontend npm dependencies to resolve high-severity audit findings
* status: needs_approval
* priority: medium
* source: qa
`rollup` can be updated non-breakingly via `npm audit fix`; the `minimatch`/`@vue/test-utils` chain requires evaluation of the breaking-change downgrade to `@vue/test-utils@2.4.0`. See B-034 in backlog.yaml.
