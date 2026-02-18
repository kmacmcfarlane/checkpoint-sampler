.PHONY: claude claude-resume ralph ralph-resume ralph-auto ralph-auto-resume up down logs up-dev down-dev logs-dev test-frontend-watch test-backend-watch

COMPOSE_DEV = docker compose -f docker-compose.yml -f docker-compose.dev.yml

claude:
	claude-sandbox

claude-resume:
	claude-sandbox --resume

ralph:
	claude-sandbox --ralph --interactive

ralph-resume:
	claude-sandbox --ralph --interactive --resume

ralph-auto:
	claude-sandbox --ralph --dangerously-skip-permissions

ralph-auto-resume:
	claude-sandbox --ralph --dangerously-skip-permissions --resume

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

test-frontend-watch:
	$(COMPOSE_DEV) exec frontend npm run test:watch

test-backend-watch:
	$(COMPOSE_DEV) exec backend ginkgo watch -r --race ./internal/... ./cmd/...
