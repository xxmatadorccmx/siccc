# Guía de Despliegue en Producción — SICC

## Requisitos

- VPS con Docker y Docker Compose (Hostinger VPS, DigitalOcean, AWS, etc.)
- Un dominio apuntando a la IP del servidor (registro A en DNS)

## Pasos

### 1. Clonar el repositorio en el servidor

```bash
ssh usuario@tu-servidor
git clone https://github.com/freddyizquierdo775-lang/SICC.git
cd SICC
```

### 2. Configurar variables de entorno

```bash
cp .env.production.example .env.production
nano .env.production
# Cambia POSTGRES_PASSWORD y JWT_SECRET por valores seguros
```

### 3. Configurar el dominio en Nginx

```bash
nano nginx/prod.conf
# Reemplaza TODAS las apariciones de "TU_DOMINIO.com" por tu dominio real
```

### 4. Iniciar los servicios

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Esto levanta 4 contenedores:
- **postgres** — Base de datos PostgreSQL 16 (persistente)
- **app** — Servidor Node.js (Express + frontend compilado)
- **nginx** — Reverse proxy con SSL
- **certbot** — Renovación automática de certificados

### 5. Obtener certificado SSL (Let's Encrypt)

Antes de obtener el certificado, Nginx necesita estar corriendo con el bloque HTTP (sin SSL).

Crea un nginx temporal solo con HTTP:

```bash
# Iniciar solo nginx con config temporal sin SSL
docker compose -f docker-compose.prod.yml up -d nginx

# Obtener certificado
docker compose -f docker-compose.prod.yml run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d TU_DOMINIO.com \
  --email tu@email.com \
  --agree-tos --no-eff-email

# Reiniciar nginx para cargar SSL
docker compose -f docker-compose.prod.yml restart nginx
```

### 6. Verificar

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
