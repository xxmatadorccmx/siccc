# Base44 development notes

- Run the full-stack app with `docker compose -f docker-compose.base44.yml up -d`; Express and Vite share port 3000.
- SQLite must use the persisted `/app/data/baas_platform.db` path. The app initializes and migrates its schema during startup.
- Verify readiness with `curl http://localhost:3000/api/health` and verify the Vite-served UI with `curl http://localhost:3000/`.
- The Supabase upload integration and Gemini key are optional; the core app boots without external credentials.
- Run static checks with `docker compose -f docker-compose.base44.yml exec -T app npm run lint` and tests with `docker compose -f docker-compose.base44.yml exec -T app npm test`.
