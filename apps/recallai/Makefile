.DEFAULT_GOAL := help
COMPOSE := docker compose

help: ## Show this help
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk -F':.*?## ' '{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

up: ## Build and start everything
	$(COMPOSE) up --build

up-local: ## Start with Ollama for local models
	$(COMPOSE) --profile local up --build

down: ## Stop everything
	$(COMPOSE) down

logs: ## Follow the API logs
	$(COMPOSE) logs -f api

logs-worker: ## Follow the worker logs
	$(COMPOSE) logs -f worker

migrate: ## Apply database migrations
	$(COMPOSE) exec api alembic upgrade head

revision: ## Create a migration: make revision m="add x"
	$(COMPOSE) exec api alembic revision --autogenerate -m "$(m)"

seed: ## Load the demo group from the specification
	$(COMPOSE) exec api python -m scripts.seed

test: ## Run the test suite in the container
	$(COMPOSE) exec api pytest

test-local: ## Run the test suite on the host
	.venv/bin/python -m pytest

pull-models: ## Download the Ollama models
	$(COMPOSE) exec ollama ollama pull qwen2.5
	$(COMPOSE) exec ollama ollama pull nomic-embed-text

.PHONY: help up up-local down logs logs-worker migrate revision seed test test-local pull-models
