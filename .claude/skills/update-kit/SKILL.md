---
name: update-kit
description: Sync agent workflow files, subagent definitions, and skills from this project back to the upstream claude-templates, claude-skills, and claude-sandbox repos (part of kmac-claude-kit). Use when user says "sync upstream", "update templates", "update kit", "push changes to claude-templates", "propagate to claude-skills", or "sync skills". User-invoked only.
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
argument-hint: "[files|skills|all]"
---

# Update Kit

Syncs changes from a kmac-claude-kit child project back to upstream repos. Works with any project scaffolded from the `local-web-app` template.

The skill has built-in knowledge of all three upstream repo structures (see `references/repo-map.md`). Each project declares project-specific sync targets in `agent/claude-kit-repo-map.md`.

## Critical: Environment Check

Before doing anything, check if running inside Docker:

```bash
test -f /.dockerenv && echo "DOCKER" || echo "HOST"
```

**If inside Docker (`/.dockerenv` exists):**
Stop and tell the user:
> You are running inside a Docker container (claude-sandbox). The sibling repos are not accessible from here. Please either:
> 1. Run this skill outside the sandbox (directly on the host), or
> 2. Add volume mounts for the sibling repos to your docker-compose configuration.

Do not attempt to proceed if the sibling repos are not accessible.

## Step 1: Read Project Config

Read `agent/claude-kit-repo-map.md` in the project root. This file declares which skills originated in this project and should sync upstream, plus any extra files.

**If the file does not exist**, tell the user and offer to create it with a starter template:

```markdown
# Claude Kit Repo Map

Project-specific sync configuration for the `/update-kit` skill.

## Skills that sync upstream (project → claude-skills)

Skills that originated in this project and should be pushed to the
claude-skills repo. One skill name per line (matching the folder name
under `.claude/skills/`).

(none)

## Additional template files

Extra files (beyond the universal set) that should sync to
claude-templates. Most projects do not need this section.

(none)
```

## Step 2: Generate Full Diff Summary

Run this single command to diff ALL syncable files across all repos at once. Adapt the `UPSTREAM_SKILLS` variable to include the skill names from `agent/claude-kit-repo-map.md`.

```bash
#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(git rev-parse --show-toplevel)
PARENT=$(dirname "$PROJECT_ROOT")
TEMPLATES="$PARENT/claude-templates/local-web-app"
SKILLS="$PARENT/claude-skills"
SANDBOX="$PARENT/claude-sandbox"

# --- claude-templates: universal file mapping ---
echo "=== claude-templates ==="
TEMPLATE_FILES=(
  "agent/TEST_PRACTICES.md"
  "agent/DEVELOPMENT_PRACTICES.md"
  "agent/AGENT_FLOW.md"
  "agent/PROMPT.md"
  "agent/PROMPT_AUTO.md"
  "agent/PROMPT_INTERACTIVE.md"
  ".claude/agents/fullstack-developer.md"
  ".claude/agents/code-reviewer.md"
  ".claude/agents/qa-expert.md"
  ".claude/agents/debugger.md"
  ".claude/agents/security-auditor.md"
)

if [ -d "$TEMPLATES/agent" ]; then
  for f in "${TEMPLATE_FILES[@]}"; do
    src="$PROJECT_ROOT/$f"
    dst="$TEMPLATES/$f"
    if [ ! -f "$src" ]; then
      echo "  [D] $f (missing in project, exists upstream)"
    elif [ ! -f "$dst" ]; then
      echo "  [A] $f (new — not yet upstream)"
    elif diff -q "$src" "$dst" > /dev/null 2>&1; then
      echo "  [=] $f"
    else
      echo "  [M] $f"
    fi
  done
else
  echo "  (repo not found at $TEMPLATES)"
fi

# --- claude-skills: per-project skill list ---
echo ""
echo "=== claude-skills ==="

# SET THIS from agent/claude-kit-repo-map.md:
UPSTREAM_SKILLS=(playwright)

if [ -d "$SKILLS/skills" ]; then
  for skill in "${UPSTREAM_SKILLS[@]}"; do
    skill_dir="$PROJECT_ROOT/.claude/skills/$skill"
    upstream_dir="$SKILLS/skills/$skill"
    if [ ! -d "$skill_dir" ]; then
      echo "  [D] $skill (listed in repo map but missing in project)"
      continue
    fi
    if [ ! -d "$upstream_dir" ]; then
      echo "  [A] $skill/ (new — not yet in claude-skills)"
      continue
    fi
    changed=0
    while IFS= read -r -d '' file; do
      rel="${file#$skill_dir/}"
      if [ ! -f "$upstream_dir/$rel" ]; then
        echo "  [A] $skill/$rel (new file)"
        changed=1
      elif ! diff -q "$file" "$upstream_dir/$rel" > /dev/null 2>&1; then
        echo "  [M] $skill/$rel"
        changed=1
      fi
    done < <(find "$skill_dir" -type f -print0)
    if [ "$changed" -eq 0 ]; then
      echo "  [=] $skill/ (no changes)"
    fi
  done

  # Scan for unlisted project-only skills
  for skill_md in "$PROJECT_ROOT"/.claude/skills/*/SKILL.md; do
    skill_name=$(basename "$(dirname "$skill_md")")
    listed=0
    for s in "${UPSTREAM_SKILLS[@]}"; do
      [ "$s" = "$skill_name" ] && listed=1 && break
    done
    if [ "$listed" -eq 0 ] && [ ! -d "$SKILLS/skills/$skill_name" ]; then
      echo "  [?] $skill_name/ (project-only, not in repo map — add to upstream?)"
    fi
  done
else
  echo "  (repo not found at $SKILLS)"
fi

# --- claude-sandbox ---
echo ""
echo "=== claude-sandbox ==="
if [ -d "$SANDBOX/bin" ]; then
  echo "  (no universal file mapping — sandbox syncs are project-specific)"
else
  echo "  (repo not found at $SANDBOX)"
fi
```

**Before running**: replace the `UPSTREAM_SKILLS=(...)` line with the actual skill names parsed from `agent/claude-kit-repo-map.md`.

## Step 3: Present Summary and Ask

Show the complete output to the user. Then ask which repos they want to sync:

> Changes found across repos:
>
> **claude-templates** — 3 modified, 8 unchanged
> **claude-skills** — 1 modified, 0 unchanged
> **claude-sandbox** — no syncable files
>
> Which would you like to sync?

Options:
1. claude-templates only
2. claude-skills only
3. All changed repos
4. None (dry run only)

If no changes exist anywhere, report that and stop.

## Step 4: Apply Selected Changes

For each repo the user selects:
- **Template files**: Read project version, write to `claude-templates/local-web-app/<path>`
- **Skills (new)**: Copy entire skill directory tree to `claude-skills/skills/<name>/`
- **Skills (modified)**: Overwrite each changed file in the upstream skill directory

If the user confirms a `[?]` project-only skill for upstream, also update `agent/claude-kit-repo-map.md` to add it to the sync list.

**Never delete files from upstream repos** — only add or update. Flag `[D]` cases for the user to handle manually.

## Step 5: Report

After syncing, report per-repo and remind the user to commit:

```
Synced to claude-templates: 3 files updated
Synced to claude-skills: 1 skill updated (playwright)
claude-sandbox: no changes

Remember to commit and push in:
  - /path/to/claude-templates
  - /path/to/claude-skills
```

## What NOT to Sync

Project-specific content that must never go upstream:
- `agent/backlog.yaml`, `agent/PRD.md`, `agent/IDEAS.md`, `agent/QUESTIONS.md`
- `agent/claude-kit-repo-map.md` (this IS the project-specific config)
- `CHANGELOG.md`, `CLAUDE.md`
- `config.yaml`, `docker-compose*.yml`, `Makefile`
- Project application code (`backend/`, `frontend/`, `docs/`)

## Troubleshooting

### "Repo not found" error
The sibling repos must be checked out alongside this project:
```
parent-directory/
  your-project/        (this project)
  claude-templates/    (template repo)
  claude-skills/       (skills repo)
  claude-sandbox/      (sandbox repo)
```

### Merge conflicts
This skill does a one-way overwrite (project → upstream). If the upstream has changes not present in this project, those will be lost. Check `git diff` in the upstream repo before syncing if you suspect divergence.

### Missing claude-kit-repo-map.md
The skill will offer to create it. See Step 1 for the starter template.
