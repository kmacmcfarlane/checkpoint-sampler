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
* status: resolved
* priority: medium
* source: qa
`rollup` can be updated non-breakingly via `npm audit fix`; the `minimatch`/`@vue/test-utils` chain requires evaluation of the breaking-change downgrade to `@vue/test-utils@2.4.0`. See B-034 in backlog.yaml.
Resolved by B-034: rollup upgraded to 4.59.0 via npm audit fix; minimatch pinned to >=9.0.7 via overrides.

### Fix pre-existing vue-tsc build failure from TypeScript errors in test files
* status: needs_approval
* priority: medium
* source: developer
The `npm run build` command runs `vue-tsc -b` which type-checks test files and fails with ~50 TypeScript errors (e.g., `WrapperLike` missing `.vm`/`.props`, unused variables, implicit `any` types). This blocks the canonical build command. Fix options: exclude test files from the tsconfig used by vue-tsc, or create a separate `tsconfig.build.json` that excludes `**/__tests__/**`. Both the developer (B-034) and QA independently flagged this issue.

### Explicit log-capture helper Makefile target
* status: needs_approval
* priority: very-low
* source: developer
A `make logs-snapshot` target that performs `make up-dev && docker compose logs --tail=500 --no-color 2>&1 && make down` as a single atomic operation would reduce the chance of a QA agent forgetting teardown during the runtime error sweep and would be referenceable by a single command in both TEST_PRACTICES.md and qa-expert.md.
