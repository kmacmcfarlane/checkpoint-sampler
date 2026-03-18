# Backend CLAUDE.md

## gopls MCP tools

The Go module lives here (`./backend/`). The gopls MCP server is configured
with `cwd: backend` in `.mcp.json` so it can find the module.

When working on backend code, **prefer gopls MCP tools over grep/read** for
symbol navigation and code understanding:

- `go_workspace` — call at session start to confirm the workspace is detected
- `go_search` — fuzzy symbol search (faster than grep for finding types/functions)
- `go_file_context` — call after reading any Go file to understand intra-package deps
- `go_symbol_references` — find all usages before modifying a symbol
- `go_diagnostics` — call after every edit to catch compile errors early
- `go_vulncheck` — call after modifying go.mod

See `/agent/LSP_TOOLS.md` for the full reference including the built-in LSP tool.
