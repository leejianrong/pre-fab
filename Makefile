.DEFAULT_GOAL := help

.PHONY: help up dev down nuke logs test test-integration ci

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

.env:
	cp .env.example .env

up: .env ## Start postgres + api + editor in the background
	docker compose up -d

dev: .env ## Start postgres + api + editor in the foreground (Ctrl-C stops all)
	docker compose up --build

down: ## Stop the stack, keep volumes
	docker compose down

nuke: ## Stop the stack and wipe postgres data + the pnpm store cache
	docker compose down -v

logs: ## Tail logs from all services
	docker compose logs -f

test: ## Run unit tests (fast layer, no infra, no Docker)
	pnpm run test:unit

test-integration: up ## Run integration tests against the composed postgres
	pnpm run test:integration

ci: ## Run the full CI check locally (lint, typecheck, containment, unit, parity)
	pnpm run ci
