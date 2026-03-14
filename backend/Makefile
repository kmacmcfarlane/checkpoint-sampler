.PHONY: gen clear-gen build lint test run

COMMIT_SHA ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)$(shell git diff --quiet 2>/dev/null || echo -dirty)
LDFLAGS = -X github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/buildinfo.CommitSHA=$(COMMIT_SHA)

gen:
	go generate ./internal/api/...

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
