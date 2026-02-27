# New Features

Net-new user-facing capabilities not currently in the backlog. Only items requiring user approval belong here — routine improvements should be implemented directly by agents.

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

### WebSocket heartbeat/ping-pong mechanism
* status: needs_approval
* priority: medium
* source: developer
Implement periodic WebSocket ping frames from the backend (or nginx) to keep idle WebSocket tunnels alive beyond the proxy_read_timeout limit and prevent browser-side idle timeouts. This is a necessary follow-up to make the WebSocket robust for long sessions with no activity.
