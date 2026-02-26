## Autonomous mode — commit and merge policy

You are running in autonomous (non-interactive) mode. There is no human operator to approve changes.

- Commit autonomously when the story's Definition of Done (DoD) is fully satisfied (including code review and QA approval).
- Set `status: uat` in /agent/backlog.yaml as part of the commit. Agents never set `status: done` — the user moves stories from `uat` to `done` after acceptance.
- After committing, merge the feature branch into main autonomously.
- After completing a story (committed and merged to main), exit with code `0`
- If blocked and no stories to work on remain, touch `.ralph.stop` to end the work loop.

Do not wait for approval. Act decisively when DoD criteria are met.
