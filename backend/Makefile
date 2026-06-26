.PHONY: gen clear-gen mocks build lint test run

COMMIT_SHA ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)$(shell git diff --quiet 2>/dev/null || echo -dirty)
LDFLAGS = -X github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/buildinfo.CommitSHA=$(COMMIT_SHA)

# Pinned mockery version. Bump deliberately; output is deterministic per version.
MOCKERY_VERSION = v3.7.1

gen:
	go generate ./internal/api/...

# Regenerate all mocks declared in .mockery.yaml. Deterministic: running twice
# produces no diff. Uses a pinned `go run` so no container rebuild is required.
mocks:
	go run github.com/vektra/mockery/v3@$(MOCKERY_VERSION)

clear-gen:
	rm -rf internal/api/gen
	find . -type d -name mocks -exec rm -rf {} + 2>/dev/null || true

build:
	go build -ldflags "$(LDFLAGS)" -o bin/server ./cmd/server

lint:
	go vet ./...

test:
	go test ./...

run: build
	./bin/server
