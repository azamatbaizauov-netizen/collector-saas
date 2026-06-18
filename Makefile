dev-up:
	docker compose up -d
	@echo "Waiting for postgres to be ready..."
	@until docker compose exec postgres pg_isready -U saas_opt -q; do sleep 1; done
	@echo "Postgres ready."

dev-down:
	docker compose down

dev-reset:
	docker compose down -v
	docker compose up -d
	@until docker compose exec postgres pg_isready -U saas_opt -q; do sleep 1; done

migrate:
	pnpm db:migrate

migrate-deploy:
	pnpm --filter @repo/db migrate:deploy

logs:
	docker compose logs -f

psql:
	docker compose exec postgres psql -U saas_opt -d saas_opt

redis-cli:
	docker compose exec redis redis-cli
