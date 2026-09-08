# ============================================================================
# SICC · Dockerfile de Producción
# Multi-stage: construye el frontend con Vite, luego ejecuta el servidor Express
# ============================================================================

# --- Stage 1: Build frontend ---
FROM node:22-bookworm-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Stage 2: Production runtime ---
FROM node:22-bookworm-slim AS production

# Install build tools for native modules (deasync, better-sqlite3 fallback)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built frontend
COPY --from=builder /app/dist ./dist

# Copy source (server.ts, src/, db/, public/, etc.)
COPY server.ts ./
COPY src/ ./src/
COPY db/ ./db/
COPY public/ ./public/
COPY index.html ./
COPY vite.config.ts ./
COPY tsconfig.json ./

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
