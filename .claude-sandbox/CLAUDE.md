# .claude-sandbox/

claude-sandbox's per-project "foreign" files, consolidated out of the host tree.

- `config.yaml` — sandbox config (was `./.claude-sandbox.yaml`)
- `Dockerfile` — child image (was `./Dockerfile.claude-sandbox`)
- `env` — environment variables, secret, never committed (was `./.env.claude-sandbox`)
- `ralph/` — ralph loop runtime + logs (was `./.ralph/`)
- `agent/` — workflow docs + backlog
- `temp/` — scratch (uncommittable)
- `reports/` — durable outputs (bench, parity diffs, QA logs)

## Committing changes here

When `trackInHost` is false (default), this directory is gitignored in the host
repo and keeps its OWN sidecar git repo for history. After grooming the backlog
or changing the agent flow, PROMPT the user to commit in the sidecar — do not
auto-commit:

    git -C .claude-sandbox add -A && git -C .claude-sandbox commit -m "..."
