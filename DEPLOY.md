# Guía de Despliegue en Producción — SICC

## Requisitos

- VPS con Docker y Docker Compose (Hostinger VPS, DigitalOcean, AWS, etc.)
- Un dominio apuntando a la IP del servidor (registro A en DNS)

## Despliegue rápido (automático)

```bash
ssh root@IP_DE_TU_VPS
bash <(curl -s https://raw.githubusercontent.com/freddyizquierdo775-lang/SICC/main/deploy.sh) TU_DOMINIO.com tu@email.com
```

O manualmente tras clonar el repo:

```bash
git clone https://github.com/freddyizquierdo775-lang/SICC.git /opt/SICC
cd /opt/SICC
bash deploy.sh TU_DOMINIO.com tu@email.com
```

El script hace todo automáticamente: instala Docker, clona el repo, genera contraseñas seguras, configura Nginx, levanta los servicios y obtiene el certificado SSL.

## Despliegue manual (paso a paso)

### 1. Preparar el VPS en Hostinger

1. hPanel → VPS → crear/seleccionar VPS con Ubuntu 22.04/24.04
2. hPanel → VPS → Firewall → abrir puertos 80, 443, 22
3. Apuntar dominio: registro A `@` → IP del VPS

### 2. Conectarse e instalar Docker

```bash
ssh root@IP_DEL_VPS
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
```

### 3. Clonar el repositorio en el servidor

```bash
git clone https://github.com/freddyizquierdo775-lang/SICC.git /opt/SICC
cd /opt/SICC
```

### 4. Configurar variables de entorno

```bash
cp .env.production.example .env.production
nano .env.production
# Cambia POSTGRES_PASSWORD y JWT_SECRET por valores seguros
```

### 5. Configurar el dominio en Nginx

```bash
sed -i 's|TU_DOMINIO.com|tu-dominio-real.com|g' nginx/prod.conf
```

### 6. Iniciar los servicios

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build postgres app
```

Esto levanta:
- **postgres** — Base de datos PostgreSQL 16 (persistente)
- **app** — Servidor Node.js (Express + frontend compilado)

### 7. Obtener certificado SSL (Let's Encrypt)

```bash
# Iniciar nginx con config HTTP
docker compose -f docker-compose.prod.yml --env-file .env.production up -d nginx

# Obtener certificado
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d TU_DOMINIO.com -d www.TU_DOMINIO.com \
  --email tu@email.com \
  --agree-tos --no-eff-email

# Reiniciar nginx para cargar SSL
docker compose -f docker-compose.prod.yml --env-file .env.production restart nginx
```

### 8. Verificar

```bash
# Health check
curl http://localhost:3000/api/health

# Login de prueba
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"auth_user_id":"user_gerente_1","password":"123456"}'
```

Abre `https://TU_DOMINIO.com` en el navegador.

## Usuarios de prueba

| Usuario | Contraseña | Rol |
|---------|-----------|-----|
| `user_gerente_1` | `123456` | Super Admin |
| `user_cajero_1` | `123456` | Super Admin |
| `admin_sicc_2026` | `123456` | Super Admin |

> **Importante:** Cambia estas contraseñas después del primer login.

## Comandos útiles

```bash
# Ver logs
docker compose -f docker-compose.prod.yml logs -f app

# Reiniciar la app
docker compose -f docker-compose.prod.yml restart app

# Actualizar el código
git pull origin main
docker compose -f docker-compose.prod.yml up -d --build app

# Backup de la base de datos
docker compose -f docker-compose.prod.yml exec postgres pg_dump -U sicc sicc > backup.sql

# Restaurar backup
docker compose -f docker-compose.prod.yml exec -T postgres psql -U sicc sicc < backup.sql
```

## Arquitectura

```
Internet → Nginx (443/SSL) → App (3000) → PostgreSQL (5432)
```

- El frontend se compila con Vite en el build de Docker
- El servidor Express sirve la API y los archivos estáticos del frontend
- PostgreSQL almacena todos los datos de forma persistente
- Los uploads se guardan en un volumen de Docker
