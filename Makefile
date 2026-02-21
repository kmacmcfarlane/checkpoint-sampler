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

ralph-auto-once:
	claude-sandbox --ralph --dangerously-skip-permissions --limit 1

# make ralph-auto-resume ARGS="<resume id>"
ralph-auto-resume:
	claude-sandbox --ralph --dangerously-skip-permissions --resume ${ARGS}

# make ralph-auto-resume-once ARGS="<resume id>"
ralph-auto-resume-once:
	claude-sandbox --ralph --dangerously-skip-permissions --limit 1 --resume ${ARGS}

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
