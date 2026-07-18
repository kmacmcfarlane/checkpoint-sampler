package api

// Pinned goa CLI version. This is the single source of truth for the goa
// CLI pin; must match goa.design/goa/v3 in go.mod. Bump deliberately.
//go:generate go run goa.design/goa/v3/cmd/goa@v3.25.3 gen github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/design -o ../api
