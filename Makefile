.PHONY: claude claude-resume ralph ralph-resume ralph-auto ralph-auto-resume ralph-auto-debug ralph-debug capture-runtime-context up down logs up-dev down-dev logs-dev test-frontend-watch test-backend-watch up-test down-test test-e2e

COMPOSE_DEV = docker compose -p checkpoint-sampler-dev -f docker-compose.yml -f docker-compose.dev.yml
COMPOSE_TEST = docker compose -p checkpoint-sampler-test -f docker-compose.yml -f docker-compose.test.yml
COMPOSE_E2E = docker compose -p checkpoint-sampler-dev -f docker-compose.e2e.yml

claude:
	claude-sandbox

claude-resume:
	claude-sandbox --resume

ralph:
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

# Debug: run the normal story pipeline with full decision logging (autonomous, single pass).
# After the run, review .ralph-debug/ for the full decision trail of every agent.
ralph-auto-debug:
	claude-sandbox --ralph --dangerously-skip-permissions --log-context --limit 1 ${ARGS}

# Debug: interactive version with full decision logging
ralph-debug:
	claude-sandbox --ralph --interactive --log-context ${ARGS}

# Capture runtime context snapshot (container logs, errors) to .debug-context
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
	$(COMPOSE_DEV) exec backend ginkgo -r --cover --race ./internal/... ./cmd/...

test-backend-watch:
	$(COMPOSE_DEV) exec backend ginkgo watch -r --cover --race ./internal/... ./cmd/...

# Test environment: isolated volumes for E2E runs; use make down-test to wipe without affecting up-dev
up-test:
	$(COMPOSE_TEST) up -d --build

down-test:
	$(COMPOSE_TEST) down -v

# Run Playwright E2E tests using the official Playwright Docker image.
# Requires make up-dev to already be running. The playwright container joins the
# checkpoint-sampler-dev_default network and connects to the frontend service there.
test-e2e:
	$(COMPOSE_E2E) run --rm playwright sh -c "npm ci && npx playwright test"
