package buildinfo

// CommitSHA is set at build time via -ldflags.
// Falls back to "unknown" when built without ldflags (e.g. `go run`).
var CommitSHA = "unknown"
