-- ═══════════════════════════════════════════════════════════════════════════
-- SICC — Migración de seguridad compatible con SQLite (CORREGIDA Fase 5)
-- ═══════════════════════════════════════════════════════════════════════════
-- BUG CORREGIDO (Fase 5): La versión anterior recreaba la tabla User_Profiles
-- con "CREATE TABLE _new + DROP + RENAME", lo que PERDÍA las columnas de
-- negocio (puesto, custom_permissions, is_active, hire_date, id).
--
-- Ahora usa ALTER TABLE ADD COLUMN, que PRESERVA los datos y columnas
-- existentes. Es idempotente: ignora errores de "columna duplicada".
--
-- NOTA: Este archivo NO debe ejecutarse vía .split(';') — los comentarios con
-- '--' y los bloques multilinea rompen el parser. Se ejecuta statement por
-- statement con manejo de errores individual (ver vitest.setup.ts).
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Añadir columnas de seguridad (idempotente)
ALTER TABLE User_Profiles ADD COLUMN password_hash TEXT;
ALTER TABLE User_Profiles ADD COLUMN failed_login_attempts INTEGER DEFAULT 0;
ALTER TABLE User_Profiles ADD COLUMN locked_until DATETIME;
ALTER TABLE User_Profiles ADD COLUMN password_changed_at DATETIME;
ALTER TABLE User_Profiles ADD COLUMN force_password_change INTEGER DEFAULT 0;

-- 2. Actualizar con hashes de contraseña seguros (bcrypt 12 rounds, corregidos Fase 5)
UPDATE User_Profiles
SET password_hash = '$2b$12$7al3nbC//44VWvpN3uxl3eJNEeYBbJDDajRWiSw3egRNxAmjugLte',
    force_password_change = 0
WHERE password_hash IS NULL;

-- 3. Tabla de sesiones activas
CREATE TABLE IF NOT EXISTS active_sessions (
  id TEXT PRIMARY KEY,
  auth_user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (auth_user_id) REFERENCES User_Profiles(auth_user_id) ON DELETE CASCADE
);

-- 4. Tabla de auditoría de seguridad
CREATE TABLE IF NOT EXISTS security_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auth_user_id TEXT,
  event_type TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  success BOOLEAN,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. Índices para rendimiento
CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_active_sessions_expires ON active_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_security_audit_user ON security_audit_log(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_security_audit_event ON security_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_user_profiles_last_login ON User_Profiles(last_login);

-- 6. Trigger para limpiar sesiones expiradas
CREATE TRIGGER IF NOT EXISTS cleanup_expired_sessions
AFTER INSERT ON active_sessions
BEGIN
  DELETE FROM active_sessions
  WHERE expires_at < datetime('now')
    OR (is_active = 0 AND created_at < datetime('now', '-7 days'));
END;

-- 7. Usuario administrador con contraseña segura
INSERT OR IGNORE INTO User_Profiles (
  auth_user_id, nickname, puesto, role_level, branch_id, created_at,
  password_hash, force_password_change
) VALUES (
  'admin_sicc_2026',
  'ADMIN',
  'Super Administrador',
  5,
  'MAIN_BRANCH',
  CURRENT_TIMESTAMP,
  '$2b$12$bOaRs7EsjziDkXs/EGy/t.TAOdKMlJ5aJ2JvMgQybc.jnWm3Zxa7C',
  0
);

-- 8. Log de migración
INSERT INTO security_audit_log (
  auth_user_id, event_type, ip_address, details, success
) VALUES (
  'system',
  'SECURITY_MIGRATION',
  'localhost',
  '{"migration": "auth_security_v2", "note": "ALTER TABLE sin perdida de columnas"}',
  1
);
