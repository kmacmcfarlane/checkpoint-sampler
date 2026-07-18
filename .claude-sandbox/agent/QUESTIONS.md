# Questions

Questions from the agent that need user clarification. Update PRD.md or backlog.yaml after answering.

## S-171 follow-up: PRD API table is now stale (agent cannot edit PRD)

S-171 moved all HTTP routes from `/api/*` to `/api/v1/*`. PRD.md §6 "API surface (preliminary)" still lists the old unversioned paths (`/api/training-runs`, `/api/ws`, `/api/images/*`, etc.). The agent-ownership rule (AGENT_FLOW §0) reserves PRD.md for the user, so this was left unchanged. **Action for user:** update the §6 table to the `/api/v1/*` prefix (health/`/docs`/`/api/test/*` stay unversioned). `docs/api.md` and the served OpenAPI/Swagger were updated in-story and already reflect `/api/v1`.
