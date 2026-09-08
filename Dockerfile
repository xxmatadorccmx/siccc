# ── SICC: Dockerfile de producción para Hostinger ──
# Build multi-stage: compila el frontend y sirve todo desde un solo proceso Express.

# ── Stage 1: Build ──
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci || npm install

COPY . .
RUN npm run build

# ── Stage 2: Runtime ──
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/baas_platform.db

COPY package.json package-lock.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/vite.config.ts ./vite.config.ts
COPY --from=builder /app/index.html ./index.html

# Persistencia de DB y uploads
RUN mkdir -p /app/data /app/uploads

EXPOSE 3000

CMD ["npx", "tsx", "server.ts"]
