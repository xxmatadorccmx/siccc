-- ═══════════════════════════════════════════════════════════════════════════
-- SICC — Migración 003: Restaurar columnas perdidas de User_Profiles
-- ═══════════════════════════════════════════════════════════════════════════
-- BUG DE LA FASE 2: La migración 001_security_auth_fixed.sql recreó la tabla
-- User_Profiles usando "CREATE TABLE User_Profiles_new + DROP + RENAME", pero
-- OMITIÓ las columnas de negocio originales:
--     puesto, custom_permissions, is_active
-- Esto rompió:
--   - El seed de usuarios (database.ts línea 536 usa 'puesto' y 'custom_permissions')
--   - El frontend, que espera profile.puesto y profile.custom_permissions
--   - La verificación de permisos (tc_limit, can_cancel, show_vault_balance)
--
-- CORRECCIÓN: Re-añadir las columnas faltantes y poblarlas para los usuarios
-- existentes.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Re-añadir columnas de negocio
-- (La sintaxis "ADD COLUMN IF NOT EXISTS" no existe en SQLite; el runner
--  de migraciones hace los ALTER idempotentes ignorando "duplicate column",
--  asi que aqui un ALTER fallido = columna ya presente = estado correcto.)
ALTER TABLE User_Profiles ADD COLUMN puesto TEXT;
ALTER TABLE User_Profiles ADD COLUMN custom_permissions TEXT;
ALTER TABLE User_Profiles ADD COLUMN is_active INTEGER DEFAULT 1;

-- 2. Poblar 'puesto' según role_level para usuarios existentes (solo si es NULL)
UPDATE User_Profiles SET puesto = CASE role_level
    WHEN 1 THEN 'Auditor / Consulta'
    WHEN 2 THEN 'Operador de Caja'
    WHEN 3 THEN 'Cajero Principal'
    WHEN 4 THEN 'Gerente Sucursal'
    WHEN 5 THEN 'Super Administrador'
    ELSE 'Usuario'
  END
WHERE puesto IS NULL;

-- 3. Poblar 'custom_permissions' con permisos según rol (solo si es NULL)
UPDATE User_Profiles SET custom_permissions = CASE
    WHEN role_level >= 4 THEN '{"tc_limit":100,"can_cancel":true,"show_vault_balance":true}'
    WHEN role_level >= 2 THEN '{"tc_limit":2.5,"can_cancel":false,"show_vault_balance":false}'
    ELSE '{"tc_limit":0,"can_cancel":false,"show_vault_balance":false}'
  END
WHERE custom_permissions IS NULL;

-- 4. Asegurar is_active = 1 para los usuarios de prueba
UPDATE User_Profiles SET is_active = 1 WHERE is_active IS NULL;
