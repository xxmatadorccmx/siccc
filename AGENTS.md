# Base44 development notes

- Start the app with `docker compose -f docker-compose.base44.yml up -d`; the Express server embeds Vite middleware and serves both UI and API on port 3000.
- SQLite is initialized and seeded automatically at startup. Its persistent database is stored in the Compose `app_data` volume via `DB_PATH=/data/baas_platform.db`.
- Verify readiness at `GET /api/health`; a healthy response includes `{"status":"ok"}`.
- Demo authentication is seeded for `user_cajero_1` and `user_gerente_1`; the repository's seed password is documented in `src/db/database.ts`.
- Supabase variables are optional and only needed for storage/webhook integration paths. The main local preview does not require external credentials.
- Run type checking with `docker compose -f docker-compose.base44.yml exec -T app npm run lint` and tests with `docker compose -f docker-compose.base44.yml exec -T app npm test`.
