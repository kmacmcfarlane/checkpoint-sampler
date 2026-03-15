.PHONY: claude claude-resume claude-dangerous ralph ralph-resume ralph-auto ralph-auto-resume capture-runtime-context up down logs up-dev down-dev logs-dev gen test-frontend test-frontend-watch test-backend test-backend-watch lint-nginx up-test down-test build-playwright test-e2e test-e2e-serial test-e2e-live test-e2e-live-run test-e2e-live-down test-e2e-logs down-e2e check-e2e-panics lint-e2e-helpers lint-disallowed-chars logs-snapshot check-tools

COMPOSE_DEV = docker compose -p checkpoint-sampler-dev -f docker-compose.yml -f docker-compose.dev.yml
COMPOSE_TEST = docker compose -p checkpoint-sampler-test -f docker-compose.test.yml
COMPOSE_E2E_LIVE = docker compose -p checkpoint-sampler-e2e-live -f docker-compose.test.yml -f docker-compose.e2e-live.yml

claude:
	claude-sandbox

claude-resume:
	claude-sandbox --resume

claude-dangerous:
	claude-sandbox --dangerously-skip-permissions

claude-resume-dangerous:
	claude-sandbox --resume --dangerously-skip-permissions

ralph:
	claude-sandbox --ralph --interactive ${ARGS}

ralph-dangerous:
	claude-sandbox --ralph --interactive --dangerously-skip-permissions ${ARGS}

ralph-resume:
	claude-sandbox --ralph --interactive --resume ${ARGS}

ralph-auto:
	claude-sandbox --ralph --dangerously-skip-permissions ${ARGS}

ralph-auto-once:
	claude-sandbox --ralph --dangerously-skip-permissions --limit 1 ${ARGS}

# make ralph-auto-resume ARGS="<resume id>"
ralph-auto-resume:
	claude-sandbox --ralph --dangerously-skip-permissions --resume ${ARGS}

# make ralph-auto-resume-once ARGS="<resume id>"
ralph-auto-resume-once:
	claude-sandbox --ralph --dangerously-skip-permissions --limit 1 --resume ${ARGS}

backlog-status:
	./scripts/backlog/backlog.py status

backlog-not-done:
	./scripts/backlog/backlog.py query --status todo,in_progress,review,testing,uat --fields id

backlog-uat:
	./scripts/backlog/backlog.py query --status uat --fields id

backlog-todo:
	./scripts/backlog/backlog.py query --status todo --fields id

backlog-in-flight:
	./scripts/backlog/backlog.py query --status in_progress,review,testing --fields id

# Capture runtime context snapshot (container logs, errors) to .ralph/temp/debug-context
capture-runtime-context:
	./scripts/capture-runtime-context.sh

# Run Goa codegen inside the backend dev container (does not require make up-dev)
gen:
	$(COMPOSE_DEV) run --rm -w /app/backend backend make gen

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f

up-dev:
	$(COMPOSE_DEV) up -d --build

down-dev:
	$(COMPOSE_DEV) down

logs-dev:
	$(COMPOSE_DEV) logs -f

test-frontend:
	$(COMPOSE_DEV) exec frontend npm run test

test-frontend-watch:
	$(COMPOSE_DEV) exec frontend npm run test:watch

test-backend:
	$(COMPOSE_DEV) run --rm -w /app/backend backend ginkgo -r --cover --race ./internal/... ./cmd/...

test-backend-watch:
	$(COMPOSE_DEV) exec -w /app/backend backend ginkgo watch -r --cover --race ./internal/... ./cmd/...

# Validate nginx config syntax and verify required WebSocket proxy headers are present.
# Uses a temporary nginx:alpine container so no running stack is needed.
lint-nginx:
	docker run --rm -v "$(CURDIR)/frontend/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine sh -c \
		"nginx -t && \
		grep -q 'proxy_http_version 1\\.1' /etc/nginx/conf.d/default.conf && \
		grep -q 'proxy_set_header Upgrade' /etc/nginx/conf.d/default.conf && \
		grep -qE 'proxy_set_header Connection \"upgrade\"' /etc/nginx/conf.d/default.conf && \
		echo 'nginx config validation passed'"

# Test environment: self-contained stack with test-fixtures/ data, healthchecks, and Playwright.
# Use make down-test to wipe without affecting up-dev.
up-test:
	$(COMPOSE_TEST) up -d --build

down-test:
	$(COMPOSE_TEST) down -v

E2E_LOG_DIR = .ralph/temp/e2e-logs
LOGS_SNAPSHOT_DIR = .ralph/temp/logs-snapshot

# Build the custom Playwright Docker image with npm dependencies pre-installed.
# Run this once (or after package.json changes) to avoid npm ci overhead on each test run.
build-playwright:
	$(COMPOSE_TEST) build playwright

# Run Playwright E2E tests in parallel across N sharded stacks (default: 4 shards).
# Each shard gets its own isolated docker-compose stack with a pre-built backend
# binary (no codegen or compilation at startup). Artifacts go to .e2e/.
# Override shard count: make test-e2e SHARDS=2
test-e2e:
	./scripts/e2e/e2e_parallel.sh $(or $(SHARDS),12)

# Run Playwright E2E tests serially in a single stack (pre-built binary).
# Supports SPEC= for targeted runs: make test-e2e-serial SPEC=smoke.spec.ts
test-e2e-serial:
	$(COMPOSE_TEST) down -v 2>/dev/null || true; \
	$(COMPOSE_TEST) up -d --build --wait --remove-orphans backend frontend && \
	$(COMPOSE_TEST) run --rm --remove-orphans playwright sh -c "npx playwright test $(SPEC)"; \
	STATUS=$$?; \
	mkdir -p $(E2E_LOG_DIR) && \
	$(COMPOSE_TEST) logs --no-color backend > $(E2E_LOG_DIR)/backend.log 2>&1; \
	$(COMPOSE_TEST) logs --no-color frontend > $(E2E_LOG_DIR)/frontend.log 2>&1; \
	$(COMPOSE_TEST) down -v; \
	./scripts/check-e2e-panics.sh $(E2E_LOG_DIR) || STATUS=1; \
	exit $$STATUS

# Start a hot-reload E2E stack for test development. Stays up until torn down.
# Use make test-e2e-live-run to execute specs against it.
test-e2e-live:
	$(COMPOSE_E2E_LIVE) up -d --build --wait --remove-orphans backend frontend

# Run spec(s) against the live hot-reload stack.
# Usage: make test-e2e-live-run SPEC=smoke.spec.ts
test-e2e-live-run:
	$(COMPOSE_E2E_LIVE) run --rm --remove-orphans playwright sh -c "npx playwright test $(SPEC)"

# Tear down the live hot-reload E2E stack.
test-e2e-live-down:
	$(COMPOSE_E2E_LIVE) down -v

# Scan E2E backend logs for Go panics. Exits non-zero when panic: is found.
# Log directory defaults to .ralph/temp/e2e-logs. Override with: make check-e2e-panics LOG_DIR=<path>
check-e2e-panics:
	./scripts/check-e2e-panics.sh $(if $(LOG_DIR),$(LOG_DIR),$(E2E_LOG_DIR))

# Capture logs from a running E2E stack without tearing it down.
# Useful for manual inspection when the stack is still up.
test-e2e-logs:
	mkdir -p $(E2E_LOG_DIR)
	$(COMPOSE_TEST) logs --no-color backend > $(E2E_LOG_DIR)/backend.log 2>&1
	$(COMPOSE_TEST) logs --no-color frontend > $(E2E_LOG_DIR)/frontend.log 2>&1
	@echo "E2E logs saved to $(E2E_LOG_DIR)/"

down-e2e:
	$(COMPOSE_TEST) down -v

# Capture a log snapshot from the dev stack atomically: start, capture 500 lines, tear down.
# Saves logs to .ralph/temp/logs-snapshot/backend.log and frontend.log.
# Teardown runs even if log capture fails.
logs-snapshot:
	$(COMPOSE_DEV) down 2>/dev/null || true; \
	$(COMPOSE_DEV) up -d --build --wait --remove-orphans backend frontend; \
	STATUS=$$?; \
	mkdir -p $(LOGS_SNAPSHOT_DIR) && \
	$(COMPOSE_DEV) logs --tail=500 --no-color backend > $(LOGS_SNAPSHOT_DIR)/backend.log 2>&1; \
	$(COMPOSE_DEV) logs --tail=500 --no-color frontend > $(LOGS_SNAPSHOT_DIR)/frontend.log 2>&1; \
	$(COMPOSE_DEV) down; \
	exit $$STATUS

# Audit E2E spec files for bare training-run-select click patterns that bypass
# the selectTrainingRun helper. Exits non-zero when violations are found.
lint-e2e-helpers:
	./scripts/check-e2e-select-helpers.sh

# Check availability of LSP tooling (informational, not a gate).
check-tools:
	@echo "=== Tool availability ==="
	@which gopls >/dev/null 2>&1 && echo "  gopls: $$(gopls version 2>&1 | head -1)" || echo "  gopls: not found"
	@which typescript-language-server >/dev/null 2>&1 && echo "  ts-lsp: $$(typescript-language-server --version 2>&1)" || echo "  ts-lsp: not found"
	@echo "=== Done ==="

# Scan source files for string literals that contain characters in the disallowed
# study-name set (defined in backend/internal/service/study.go).  Run this after
# adding a new character to disallowedNameChars to catch potential regressions
# (e.g. name-construction strings that include the newly-disallowed character).
# Exits non-zero when violations are found.
lint-disallowed-chars:
	./scripts/check-disallowed-chars.sh
