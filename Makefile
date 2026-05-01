.PHONY: up down test lint build integration

up:
	docker compose up --build

down:
	docker compose down

test:
	cd compute-engine && python -m pytest -q
	cd api-gateway && go test ./...
	cd edge-ui && npm run test

lint:
	cd compute-engine && python -m compileall app
	cd api-gateway && go test ./...
	cd edge-ui && npm run lint

build:
	cd compute-engine && python -m compileall app
	cd api-gateway && go build ./cmd/api-gateway
	cd edge-ui && npm run build

integration:
	python scripts/integration_smoke.py

benchmark:
	python scripts/integration_smoke.py
