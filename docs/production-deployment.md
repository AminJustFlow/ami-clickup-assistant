# Production deployment

The production stack is Next.js, PostgreSQL 17, a multi-client ClickUp sync worker, a leased AI worker, and Caddy. PostgreSQL is only on the private Compose network. Basic authentication protects all application pages and APIs except the health check and signed ClickUp webhook.

## Required environment variables

Copy `.env.example` to `.env.production` on the server and set strong secret values. Required keys are `POSTGRES_PASSWORD`, `DATABASE_URL` (use host `postgres`), `APP_DOMAIN`, `APP_URL`, `APP_AUTH_USER`, `APP_AUTH_PASSWORD`, `CLICKUP_API_TOKEN`, `CLICKUP_WORKSPACE_ID`, `CLICKUP_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `OPENAI_INTELLIGENCE_MODEL`, and all AI budget/pricing keys. Never commit this file.

Production DNS is an `A` record for `intelligence.justflownh.com` pointing to the Lightsail static IP `34.224.54.213`.

## Safe database migration

Export the validated local data without changing it: `pg_dump --format=custom --no-owner --no-acl --dbname "$env:DATABASE_URL" --file ami-local.dump`. On the new empty production database, start PostgreSQL, restore with `pg_restore -U ami -d ami_assistant --no-owner --no-acl`, then run `docker compose -f docker-compose.prod.yml run --rm migrate`. Compare `TaskIntelligence` counts before and after. Do not start the AI worker until counts match and budgets are set.

## Deploy and rollback

Run `docker compose -f docker-compose.prod.yml build`, `docker compose -f docker-compose.prod.yml run --rm migrate`, and `docker compose -f docker-compose.prod.yml up -d`. Verify with `docker compose -f docker-compose.prod.yml ps` and `curl -fsS https://$APP_DOMAIN/api/health`. Tag every deployed commit. To roll back, check out the prior tag and rebuild; restore the pre-deploy dump only for an incompatible migration. Never run `migrate reset` in production.

Pushes to `main` deploy through `.github/workflows/deploy-production.yml` after `npm ci`, TypeScript, and production build checks pass. The workflow uses the protected `production` GitHub environment and the `PROD_SSH_KEY` repository secret. It serializes deployments, takes a database dump before changing files, applies forward migrations, recreates services with restart policies, records the deployed commit in `.deployed-commit`, and verifies the public database-backed health endpoint. Feature branches never deploy.

## Backup, restore, logs, and monitoring

Run `deploy/backup.sh` daily and copy encrypted dumps off-instance. Lightsail snapshots protect the disk; database dumps provide granular recovery. Use `docker compose -f docker-compose.prod.yml logs --tail=200 web sync-worker ai-worker`, `df -h`, `free -m`, and the dashboard worker panel. Logs rotate at 10 MB with five files. AI estimates are safeguards, not guaranteed provider billing caps; configure OpenAI project budgets and alerts too.
