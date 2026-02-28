.PHONY: claude claude-resume ralph ralph-resume ralph-auto ralph-auto-resume capture-runtime-context up down logs up-dev down-dev logs-dev test-frontend-watch test-backend-watch up-test down-test test-e2e test-e2e-logs down-e2e

COMPOSE_DEV = docker compose -p checkpoint-sampler-dev -f docker-compose.yml -f docker-compose.dev.yml
COMPOSE_TEST = docker compose -p checkpoint-sampler-test -f docker-compose.yml -f docker-compose.test.yml
COMPOSE_E2E = docker compose -p checkpoint-sampler-e2e -f docker-compose.e2e.yml

claude:
	claude-sandbox

claude-resume:
	claude-sandbox --resume

ralph:
	claude-sandbox --ralph --interactive ${ARGS}

ralph-dangerous:
	claude-sandbox --ralph --interactive ${ARGS}

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

# Capture runtime context snapshot (container logs, errors) to .ralph-temp/debug-context
capture-runtime-context:
	./scripts/capture-runtime-context.sh

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f

up-dev:
	$(COMPOSE_DEV) up -d --build

down-dev:
	$(COMPOSE_DEV) down -v

logs-dev:
	$(COMPOSE_DEV) logs -f

test-frontend:
	$(COMPOSE_DEV) exec frontend npm run test

test-frontend-watch:
	$(COMPOSE_DEV) exec frontend npm run test:watch

test-backend:
	$(COMPOSE_DEV) exec -w /app/backend backend ginkgo -r --cover --race ./internal/... ./cmd/...

test-backend-watch:
	$(COMPOSE_DEV) exec -w /app/backend backend ginkgo watch -r --cover --race ./internal/... ./cmd/...

# Test environment: isolated volumes for E2E runs; use make down-test to wipe without affecting up-dev
up-test:
	$(COMPOSE_TEST) up -d --build

down-test:
	$(COMPOSE_TEST) down -v

E2E_LOG_DIR = .ralph-temp/e2e-logs

# Run Playwright E2E tests against a self-contained stack with test fixture data.
# Starts backend + frontend with test-fixtures/ data, waits until healthy, runs
# playwright, then captures logs to .ralph-temp/e2e-logs/ and tears down.
# Does not require make up-dev to be running.
test-e2e:
	$(COMPOSE_E2E) up -d --build --wait backend frontend && \
	$(COMPOSE_E2E) run --rm playwright sh -c "npm ci && npx playwright test"; \
	STATUS=$$?; \
	mkdir -p $(E2E_LOG_DIR) && \
	$(COMPOSE_E2E) logs --no-color backend > $(E2E_LOG_DIR)/backend.log 2>&1; \
	$(COMPOSE_E2E) logs --no-color frontend > $(E2E_LOG_DIR)/frontend.log 2>&1; \
	$(COMPOSE_E2E) down -v; \
	exit $$STATUS

# Capture logs from a running E2E stack without tearing it down.
# Useful for manual inspection when the stack is still up.
test-e2e-logs:
	mkdir -p $(E2E_LOG_DIR)
	$(COMPOSE_E2E) logs --no-color backend > $(E2E_LOG_DIR)/backend.log 2>&1
	$(COMPOSE_E2E) logs --no-color frontend > $(E2E_LOG_DIR)/frontend.log 2>&1
	@echo "E2E logs saved to $(E2E_LOG_DIR)/"

down-e2e:
	$(COMPOSE_E2E) down -v
