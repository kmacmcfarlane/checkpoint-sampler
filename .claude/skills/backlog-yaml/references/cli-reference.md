# backlog.py CLI Reference

Location: `scripts/backlog/backlog.py`

## Global Options

```
python3 scripts/backlog/backlog.py [--backlog PATH] [--done PATH] [--format yaml|json] <command> [args...]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--backlog` | `<git-root>/agent/backlog.yaml` | Path to active backlog file |
| `--done` | `<git-root>/agent/backlog_done.yaml` | Path to done/archive file |
| `--format` | `yaml` | Output format for read operations |

---

## Read Commands

### `query` — Filter stories

```
backlog.py query [--status STATUS[,STATUS,...]]
                 [--priority-min N] [--priority-max N]
                 [--id-prefix PREFIX]
                 [--complexity COMPLEXITY[,COMPLEXITY,...]]
                 [--has-field FIELD]
                 [--source active|done|both]
                 [--fields FIELD[,FIELD,...]]
```

| Flag | Description |
|------|-------------|
| `--status` | Comma-separated status filter (todo, in_progress, review, testing, uat, done, blocked) |
| `--priority-min` | Minimum priority (inclusive) |
| `--priority-max` | Maximum priority (inclusive) |
| `--id-prefix` | Filter by ID prefix (S, B, R, W) |
| `--complexity` | Comma-separated complexity filter (low, medium, high) |
| `--has-field` | Only stories with this field non-empty |
| `--source` | Which file(s) to search. Default: `active` |
| `--fields` | Comma-separated fields to include in output |

**Examples:**

```bash
# All todo stories, compact view
backlog.py query --status todo --fields id,title,priority

# High-priority bugs
backlog.py query --id-prefix B --priority-min 50

# Stories with review feedback
backlog.py query --status in_progress --has-field review_feedback

# JSON output for piping to jq
backlog.py query --status todo --format json | jq '.[0].id'

# UAT stories with feedback (for orchestrator work selection)
backlog.py query --status uat --has-field uat_feedback --fields id,title,priority
```

### `get` — Get a single story

```
backlog.py get <id>
```

Searches active backlog first, then done archive. Prints full story.

**Examples:**

```bash
backlog.py get S-052
backlog.py get B-030 --format json
```

### `next-id` — Get next available ID

```
backlog.py next-id <prefix>
```

Scans both backlog files to find the highest numeric ID for the prefix and returns the next one. Prefix must be one of: `S`, `B`, `R`, `W`.

**Examples:**

```bash
backlog.py next-id S    # → S-083
backlog.py next-id B    # → B-038
```

### `list-ids` — List all IDs with status

```
backlog.py list-ids [--source active|done|both]
```

Outputs tab-separated: `<id>\t<status>\t<title>`, one line per story, sorted by ID.

**Examples:**

```bash
backlog.py list-ids --source active
backlog.py list-ids --source both | grep "^S-"
```

---

## Write Commands

### `add` — Add stories from stdin

```
backlog.py add [--before ID] [--after ID]
```

Reads YAML from stdin. Accepts a single story mapping or a list of mappings. Validates schema and checks for duplicate IDs before writing.

| Flag | Description |
|------|-------------|
| `--before` | Insert before this story ID |
| `--after` | Insert after this story ID |

**Required fields:** `id`, `title`, `priority`, `status`, `requires`, `acceptance`, `testing`

**Optional fields:** `complexity`, `notes`, `review_feedback`, `uat_feedback`, `blocked_reason`

**Examples:**

```bash
# Add a single story
cat <<'EOF' | backlog.py add
- id: S-083
  title: "Dark mode toggle"
  priority: 25
  status: todo
  complexity: low
  requires: []
  acceptance:
    - "FE: Dark mode toggle in nav bar"
  testing:
    - "command: cd frontend && npx vitest run"
EOF

# Add multiple stories at once
cat <<'EOF' | backlog.py add
- id: S-083
  title: "API endpoint for preferences"
  priority: 30
  status: todo
  complexity: medium
  requires: []
  acceptance:
    - "BE: GET /api/preferences endpoint"
  testing:
    - "command: make test-backend"
- id: S-084
  title: "Settings panel using preferences API"
  priority: 28
  status: todo
  complexity: medium
  requires: [S-083]
  acceptance:
    - "FE: Settings panel accessible from nav"
  testing:
    - "command: cd frontend && npx vitest run"
EOF
```

### `set` — Set a scalar field

```
backlog.py set <id> <field> <value>
```

Allowed fields: `status`, `priority`, `complexity`, `blocked_reason`, `title`

**Validation:**
- `status`: must be a valid status enum value
- `priority`: must be a positive integer
- `complexity`: must be `low`, `medium`, or `high`

**Examples:**

```bash
backlog.py set S-052 status in_progress
backlog.py set S-052 priority 50
backlog.py set S-052 complexity medium
```

### `set-text` — Set a text field from stdin

```
backlog.py set-text <id> <field>
```

Reads value from stdin. Allowed fields: `review_feedback`, `uat_feedback`, `notes`, `blocked_reason`

**Examples:**

```bash
# Single-line
echo "Missing null guard in handleClick" | backlog.py set-text S-052 review_feedback

# Multi-line via heredoc
backlog.py set-text S-052 review_feedback <<'EOF'
Changes requested:
1. Missing null guard in handleClick
2. Test coverage for edge case
EOF
```

### `clear` — Remove an optional field

```
backlog.py clear <id> <field>
```

Allowed fields: `review_feedback`, `uat_feedback`, `blocked_reason`, `complexity`, `notes`

Required fields (`id`, `title`, `priority`, `status`, `requires`, `acceptance`, `testing`) cannot be cleared.

**Examples:**

```bash
backlog.py clear S-052 review_feedback
backlog.py clear S-052 blocked_reason
```

### `archive` — Move story to done file

```
backlog.py archive <id>
```

Removes the story from `backlog.yaml` and appends it to `backlog_done.yaml`. Strips the `metrics` field if present. Writes done file first for safety (if backlog write fails, story exists in both rather than neither).

**Examples:**

```bash
backlog.py archive S-001
```

---

## Validation

### `validate` — Check schema validity

```
backlog.py validate [--source active|done|both] [--strict]
```

**Basic checks (always):**
- Required top-level keys present (`schema_version`, `project`, `defaults`, `stories`)
- `schema_version` equals 2
- Each story has all required fields
- ID format matches `PREFIX-NNN`
- Status is a valid enum value
- Complexity (if present) is valid
- Priority is a non-negative integer
- `requires` is a list, `acceptance` is a non-empty list
- No duplicate IDs within the file

**Strict checks (with `--strict`):**
- No duplicate IDs across both files
- Every ID in `requires` lists exists in either file
- Blocked stories must have `blocked_reason`
- Unknown fields produce warnings

**Examples:**

```bash
backlog.py validate                    # Basic validation of active backlog
backlog.py validate --strict           # Full cross-file validation
backlog.py validate --source both      # Validate both files
```

---

## Story Schema

```yaml
- id: S-083                    # Required. Format: PREFIX-NNN (S/B/R/W)
  title: "Short title"         # Required. Under 80 chars
  priority: 25                 # Required. Positive integer. Higher = more important
  status: todo                 # Required. Enum: todo, in_progress, review, testing, uat, done, blocked
  complexity: medium           # Optional (encouraged). Enum: low, medium, high
  requires: [S-082]            # Required. List of story IDs (may be empty)
  acceptance:                  # Required. Non-empty list of testable criteria
    - "FE: Criterion 1"       # Prefix: FE, BE, E2E, OPS, DOC, AGENT
    - "BE: Criterion 2"
  notes: |                     # Optional. Context, key files, root cause (for bugs)
    Description here.
    Key files: path/to/file.
  testing:                     # Required. Non-empty list of test commands
    - "command: make test-backend"
  review_feedback: "..."       # Optional. Set by orchestrator on rejection
  uat_feedback: "..."          # Optional. Set by user for rework
  blocked_reason: "..."        # Optional. Required when status is blocked
```

### ID Prefixes

| Prefix | Type | Example |
|--------|------|---------|
| `S-` | Story / feature / enhancement | S-083 |
| `B-` | Bug fix | B-038 |
| `R-` | Refactoring | R-005 |
| `W-` | Workflow / agent task | W-005 |

### Acceptance Criteria Prefixes

| Prefix | Scope | Testing command |
|--------|-------|-----------------|
| `FE:` | Frontend UI/behavior | `cd frontend && npx vitest run` |
| `BE:` | Backend logic/API/DB | `make test-backend` |
| `E2E:` | End-to-end tests | `make test-e2e` |
| `OPS:` | Build tooling/Docker/CI | varies |
| `DOC:` | Documentation | `(n/a) documentation only` |
| `AGENT:` | Agent workflow | `(n/a) agent workflow change` |

### Priority Ranges

| Range | Meaning |
|-------|---------|
| 70-90 | Urgent — blocks other work, user-facing breakage |
| 40-60 | Important — significant enhancement or bug |
| 20-39 | Nice-to-have improvement |
| 10-19 | Low priority, future consideration |

### Complexity Values

| Value | Description | Model selection |
|-------|-------------|-----------------|
| `low` | Single-layer, <5 files, pattern-following | sonnet |
| `medium` | Cross-stack, 5-15 files, non-trivial logic | opus |
| `high` | Architectural, security-sensitive, 15+ files | opus |

---

## Common Orchestrator Patterns

### Work selection (AGENT_FLOW.md section 3)

```bash
# 1. Review queue
backlog.py query --status review --fields id,title,priority

# 2. Testing queue
backlog.py query --status testing --fields id,title,priority

# 3. UAT feedback queue
backlog.py query --status uat --has-field uat_feedback --fields id,title,priority

# 4. In-progress with feedback
backlog.py query --status in_progress --has-field review_feedback --fields id,title,priority

# 5. New work candidates
backlog.py query --status todo --format json
```

### Status transitions

```bash
# Start work
backlog.py set S-083 status in_progress

# Developer done → review
backlog.py set S-083 status review
backlog.py clear S-083 review_feedback

# Reviewer approved → testing
backlog.py set S-083 status testing

# Reviewer rejected → back to in_progress
backlog.py set S-083 status in_progress
echo "Missing null guard" | backlog.py set-text S-083 review_feedback

# QA approved → uat
backlog.py set S-083 status uat

# Blocked
backlog.py set S-083 status blocked
echo "Needs design decision on layout" | backlog.py set-text S-083 blocked_reason
```

### UAT feedback handling

```bash
# Read the feedback
backlog.py get S-083 --format json | jq -r '.[0].uat_feedback'

# Copy to review_feedback
backlog.py get S-083 --format json | jq -r '.[0].uat_feedback' | backlog.py set-text S-083 review_feedback

# Clear uat_feedback
backlog.py clear S-083 uat_feedback

# Set back to in_progress
backlog.py set S-083 status in_progress
```

### Filing bug tickets from QA sweep

```bash
# Get next bug ID
NEXT_ID=$(backlog.py next-id B)

# Create the ticket
cat <<EOF | backlog.py add
- id: $NEXT_ID
  title: "Null pointer in handleResize"
  priority: 70
  status: todo
  complexity: low
  requires: []
  acceptance:
    - "BE: handleResize guards against null container ref"
  testing:
    - "command: make test-backend"
  notes: |
    Log evidence: TypeError: Cannot read property 'width' of null at handleResize
    Root cause: missing null check on container ref after unmount.
EOF
```
