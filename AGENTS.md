# Base44 development notes

- Start the app with `docker compose -f docker-compose.base44.yml up -d`; the Express server embeds Vite middleware and serves both UI and API on port 3000.
- SQLite is initialized and seeded automatically at startup. Its persistent database is stored in the Compose `app_data` volume via `DB_PATH=/data/baas_platform.db`.
- Verify readiness at `GET /api/health`; a healthy response includes `{"status":"ok"}`.
- Demo authentication is seeded for `user_cajero_1` and `user_gerente_1`; the repository's seed password is documented in `src/db/database.ts`.
- Run type checking with `docker compose -f docker-compose.base44.yml exec -T app npm run lint` and tests with `docker compose -f docker-compose.base44.yml exec -T app npm test`.

## Production (Hostinger + PostgreSQL)

- The app supports PostgreSQL via a sync adapter (`src/db/pg-adapter.ts`) that uses `deasync` with a pre-connected `pg` client. When `DATABASE_URL` is set, `database.ts` uses the PG adapter; otherwise it uses SQLite.
- Production infrastructure: `Dockerfile` (multi-stage: Vite build + Node.js runtime), `docker-compose.prod.yml` (app + PostgreSQL 16 + nginx + certbot), `nginx/prod.conf` (reverse proxy + SSL).
- PostgreSQL schema is in `db/pg_schema.sql`; seeding logic is in `src/db/pg-adapter.ts` (`seedPgData`).
- Deploy guide: `DEPLOY.md` — covers cloning, env config, domain/SSL setup, and verification.
- Key files for production: `Dockerfile`, `docker-compose.prod.yml`, `nginx/prod.conf`, `.env.production.example`, `db/pg_schema.sql`, `src/db/pg-adapter.ts`.
