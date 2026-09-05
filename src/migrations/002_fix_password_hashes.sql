-- ═══════════════════════════════════════════════════════════════════════════
-- SICC — Migración 002: Corrección de hashes de contraseña (bug de Fase 2)
-- ═══════════════════════════════════════════════════════════════════════════
-- BUG ENCONTRADO POR LOS TESTS E2E (Fase 5):
--   La migración 001_security_auth.sql contenía un hash bcrypt hardcodeado con
--   el comentario "123456 hasheado con bcrypt", pero el hash NO correspondía a
--   la contraseña "123456". Resultado: ningún usuario de prueba podía hacer
--   login → "Credenciales inválidas" siempre.
--
-- CORRECCIÓN:
--   Regeneramos los hashes con bcrypt (12 rounds) para las contraseñas reales
--   documentadas de los usuarios de prueba:
--     - user_cajero_1   → "123456"
--     - user_gerente_1  → "123456"
--     - admin_sicc_2026 → "123456"
--
-- IDEMPOTENCIA (fix 2026-09-05):
--   Solo actualizar si el hash actual NO empieza con $2b$ (es decir, si es
--   SHA-256 legacy). Si ya es bcrypt, preservar el hash existente para no
--   pisar passwords cambiados por el admin.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE User_Profiles
SET password_hash = '$2b$12$7al3nbC//44VWvpN3uxl3eJNEeYBbJDDajRWiSw3egRNxAmjugLte',
    force_password_change = FALSE,
    password_changed_at = CURRENT_TIMESTAMP
WHERE auth_user_id IN ('user_cajero_1', 'user_gerente_1')
  AND password_hash NOT LIKE '$2b$%';

UPDATE User_Profiles
SET password_hash = '$2b$12$7al3nbC//44VWvpN3uxl3eJNEeYBbJDDajRWiSw3egRNxAmjugLte',
    force_password_change = FALSE,
    password_changed_at = CURRENT_TIMESTAMP
WHERE auth_user_id = 'admin_sicc_2026'
  AND password_hash NOT LIKE '$2b$%';
