#!/bin/bash
# ============================================================================
# SICC · Script de despliegue automático para Hostinger VPS (Ubuntu)
# Uso: bash deploy.sh tu-dominio.com tu@email.com
# ============================================================================
set -e

DOMAIN="$1"
EMAIL="$2"
REPO_URL="https://github.com/freddyizquierdo775-lang/SICC.git"
APP_DIR="/opt/SICC"

# Colores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo_step() { echo -e "${GREEN}➤ $1${NC}"; }
echo_warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
echo_err()  { echo -e "${RED}✗ $1${NC}"; }

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  echo "Uso: bash deploy.sh TU_DOMINIO.com tu@email.com"
  exit 1
fi

echo_step "=== Despliegue de SICC en Hostinger ==="
echo "  Dominio: $DOMAIN"
echo "  Email:   $EMAIL"
echo ""

# ---------------------------------------------------------------------------
# 1. Instalar Docker si no está
# ---------------------------------------------------------------------------
if ! command -v docker &> /dev/null; then
  echo_step "Instalando Docker..."
  apt update -y && apt upgrade -y
  apt install -y curl git
  curl -fsSL https://get.docker.com | sh
  echo_step "Docker instalado: $(docker --version)"
else
  echo_step "Docker ya instalado: $(docker --version)"
fi

if ! docker compose version &> /dev/null; then
  echo_err "Docker Compose no disponible. Instala el plugin compose."
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Clonar o actualizar el repositorio
# ---------------------------------------------------------------------------
if [ -d "$APP_DIR/.git" ]; then
  echo_step "Actualizando repositorio existente..."
  cd "$APP_DIR"
  git pull origin main || git pull
else
  echo_step "Clonando repositorio..."
  rm -rf "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

# ---------------------------------------------------------------------------
# 3. Configurar variables de entorno
# ---------------------------------------------------------------------------
if [ ! -f .env.production ]; then
  echo_step "Creando .env.production..."
  cp .env.production.example .env.production

  PG_PASS=$(openssl rand -hex 16)
  JWT_SECRET=$(openssl rand -hex 32)

  sed -i "s|POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PG_PASS}|" .env.production
  sed -i "s|JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" .env.production

  echo_warn "Contraseñas generadas automáticamente. Guarda .env.production en lugar seguro."
else
  echo_step ".env.production ya existe, conservando."
fi

# ---------------------------------------------------------------------------
# 4. Configurar dominio en Nginx
# ---------------------------------------------------------------------------
echo_step "Configurando Nginx para $DOMAIN..."
sed -i "s|TU_DOMINIO.com|${DOMAIN}|g" nginx/prod.conf

# ---------------------------------------------------------------------------
# 5. Levantar servicios (sin nginx todavía — primero certbot)
# ---------------------------------------------------------------------------
echo_step "Construyendo e iniciando app + postgres..."
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build postgres app

echo_step "Esperando a que la app responda..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
    echo_step "App responde correctamente ✓"
    break
  fi
  sleep 2
  if [ $i -eq 30 ]; then
    echo_err "La app no respondió en 60s. Revisa: docker compose -f docker-compose.prod.yml logs app"
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# 6. Iniciar Nginx (HTTP) y obtener certificado SSL
# ---------------------------------------------------------------------------
echo_step "Iniciando Nginx (HTTP)..."
docker compose -f docker-compose.prod.yml --env-file .env.production up -d nginx

echo_step "Obteniendo certificado SSL con Let's Encrypt..."
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d "$DOMAIN" \
  -d "www.$DOMAIN" \
  --email "$EMAIL" \
  --agree-tos --no-eff-email

echo_step "Reiniciando Nginx con SSL..."
docker compose -f docker-compose.prod.yml --env-file .env.production restart nginx

# ---------------------------------------------------------------------------
# 7. Verificación final
# ---------------------------------------------------------------------------
echo_step "=== Verificación ==="
echo ""
echo "  Health:  http://localhost:3000/api/health"
curl -sf http://localhost:3000/api/health && echo " ✓" || echo_warn " (falló)"
echo ""
echo "  URL:     https://$DOMAIN"
echo ""
echo "  Usuarios de prueba:"
echo "    user_gerente_1 / 123456  (Super Admin)"
echo "    admin_sicc_2026 / 123456 (Super Admin)"
echo ""
echo_warn "⚠  Cambia las contraseñas después del primer login."
echo_step "=== Despliegue completado ==="
