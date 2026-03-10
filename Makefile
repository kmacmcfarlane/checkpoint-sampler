.PHONY: claude claude-resume claude-dangerous ralph ralph-resume ralph-auto ralph-auto-resume capture-runtime-context up down logs up-dev down-dev logs-dev gen test-frontend-watch test-backend-watch lint-nginx up-test down-test build-playwright test-e2e test-e2e-logs down-e2e check-e2e-panics

COMPOSE_DEV = docker compose -p checkpoint-sampler-dev -f docker-compose.yml -f docker-compose.dev.yml
COMPOSE_TEST = docker compose -p checkpoint-sampler-test -f docker-compose.test.yml

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

# Build the custom Playwright Docker image with npm dependencies pre-installed.
# Run this once (or after package.json changes) to avoid npm ci overhead on each test run.
build-playwright:
	$(COMPOSE_TEST) build playwright

# Run Playwright E2E tests against a self-contained stack with test fixture data.
# Starts backend + frontend with test-fixtures/ data, waits until healthy, runs
# playwright, then captures logs to .ralph/temp/e2e-logs/ and tears down.
# Does not require make up-dev to be running.
test-e2e:
	$(COMPOSE_TEST) up -d --build --wait --remove-orphans backend frontend && \
	$(COMPOSE_TEST) run --rm --remove-orphans playwright sh -c "npx playwright test $(SPEC)"; \
	STATUS=$$?; \
	mkdir -p $(E2E_LOG_DIR) && \
	$(COMPOSE_TEST) logs --no-color backend > $(E2E_LOG_DIR)/backend.log 2>&1; \
	$(COMPOSE_TEST) logs --no-color frontend > $(E2E_LOG_DIR)/frontend.log 2>&1; \
	$(COMPOSE_TEST) down -v; \
	./scripts/check-e2e-panics.sh $(E2E_LOG_DIR) || STATUS=1; \
	exit $$STATUS

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
