-- ============================================================================
-- SICC · SCRIPT MAESTRO DE BASE DE DATOS (Supabase / PostgreSQL) — v2
-- ----------------------------------------------------------------------------
-- Misión 1 — Reparación y Despliegue.
--
-- IMPORTANTE: este script se ADAPTA al esquema LEGADO ya existente en Supabase:
--   operadores(id TEXT PK, nombre, username, nivel_autorizacion INT, branch_id, is_active INT)
--   sucursales(sucursal_id TEXT PK, ..., es_matriz INT, saldo_minimo NUMERIC)
--   terminales(terminal_id TEXT PK, sucursal_id TEXT, terminal_locked INT, ...)
-- No recrea esas tablas: solo AGREGA columnas faltantes (ADD COLUMN IF NOT EXISTS)
-- y CREA la tabla que faltaba (caja_turnos) usando los MISMOS tipos (TEXT FKs).
--
-- Toda la inteligencia financiera (arqueo ciego, desviación, folio, contabilidad
-- de ajuste) reside en Triggers/Funciones PL/pgSQL — NUNCA en el frontend.
-- Idempotente: re-ejecutable sin romper estado.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- crypt() / gen_salt() para clave de 9 chars

-- ============================================================================
-- 1. OPERADORES — completar columnas faltantes sobre el esquema legado
-- ============================================================================
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS clave_autorizacion_hash TEXT;
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS puesto TEXT;

COMMENT ON COLUMN operadores.nivel_autorizacion IS
    '1=Consulta, 2=Caja, 3=Cajero Principal, 4=Gerente, 5=Super Admin';
COMMENT ON COLUMN operadores.clave_autorizacion_hash IS
    'Hash bcrypt de la clave de 9 caracteres. Requerida para autorizar desviaciones (solo Nivel 5).';

-- Asegurar rango de nivel 1..5 (constraint idempotente)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_operadores_nivel'
    ) THEN
        ALTER TABLE operadores
            ADD CONSTRAINT chk_operadores_nivel
            CHECK (nivel_autorizacion BETWEEN 1 AND 5);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_operadores_nivel ON operadores(nivel_autorizacion);

-- ============================================================================
-- 2. SUCURSALES — completar columnas faltantes (capital mínimo por divisa)
-- ============================================================================
-- Ya tiene saldo_minimo NUMERIC (capital mínimo consolidado MXN). Añadimos JSONB
-- por divisa sin romper lo existente.
ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS capital_minimo JSONB DEFAULT '{}'::jsonb;
ALTER TABLE sucursales ADD COLUMN IF NOT EXISTS moneda_base TEXT DEFAULT 'MXN';

COMMENT ON COLUMN sucursales.capital_minimo IS
    'Capital mínimo operativo por divisa en JSONB. Debajo de este umbral el sistema obliga a dotar.';

-- Solo una matriz (es_matriz es INTEGER en el legado: 1=true)
CREATE UNIQUE INDEX IF NOT EXISTS idx_sucursales_matriz_unica
    ON sucursales (es_matriz) WHERE (es_matriz = 1);

-- ============================================================================
-- 3. TERMINALES — vincular id_terminal con operador
-- ============================================================================
ALTER TABLE terminales ADD COLUMN IF NOT EXISTS operador_id TEXT;
ALTER TABLE terminales ADD COLUMN IF NOT EXISTS descripcion TEXT;

-- FK lógica a operadores(id). Se agrega solo si no existe.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_terminales_operador'
    ) THEN
        ALTER TABLE terminales
            ADD CONSTRAINT fk_terminales_operador
            FOREIGN KEY (operador_id) REFERENCES operadores(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_terminales_operador ON terminales(operador_id);
CREATE INDEX IF NOT EXISTS idx_terminales_sucursal ON terminales(sucursal_id);

-- ============================================================================
-- 4. CAJA_TURNOS — LA TABLA QUE FALTABA (causa de los 404) [History]
--    Tipos TEXT para FKs, coherente con el esquema legado.
-- ============================================================================
CREATE TABLE IF NOT EXISTS caja_turnos (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    folio_documento   TEXT NOT NULL UNIQUE,          -- FOLIO-AP-YYYYMMDD-NNNN (autogenerado por trigger)
    operador_id       TEXT NOT NULL REFERENCES operadores(id) ON DELETE RESTRICT,
    terminal_id       TEXT REFERENCES terminales(terminal_id) ON DELETE SET NULL,
    sucursal_id       TEXT REFERENCES sucursales(sucursal_id) ON DELETE RESTRICT,

    estado            TEXT NOT NULL DEFAULT 'PENDIENTE_AUTORIZACION'
        CHECK (estado IN ('ABIERTO', 'CERRADO', 'PENDIENTE_AUTORIZACION')),

    saldo_declarado_json  JSONB NOT NULL DEFAULT '{}'::jsonb,  -- conteo físico (arqueo ciego)
    saldo_esperado_json   JSONB NOT NULL DEFAULT '{}'::jsonb,  -- calculado por trigger (server-side)
    desviaciones_json     JSONB,                                -- calculado por trigger

    autorizado_por        TEXT REFERENCES operadores(id),       -- solo Nivel 5
    autorizacion_fecha    TIMESTAMPTZ,

    cierre_desviaciones_json JSONB,
    pdf_report_url        TEXT,

    hora_apertura         TIMESTAMPTZ NOT NULL DEFAULT now(),
    hora_cierre           TIMESTAMPTZ,
    creado_en             TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE caja_turnos IS
    'Historial de turnos de caja. La lógica de arqueo ciego, desviación y folio vive en triggers PL/pgSQL.';
COMMENT ON COLUMN caja_turnos.saldo_esperado_json IS
    'Calculado por trigger. El frontend NUNCA lo ve antes de la apertura (conteo ciego).';

CREATE INDEX IF NOT EXISTS idx_caja_turnos_operador ON caja_turnos(operador_id);
CREATE INDEX IF NOT EXISTS idx_caja_turnos_estado   ON caja_turnos(estado);
CREATE INDEX IF NOT EXISTS idx_caja_turnos_sucursal ON caja_turnos(sucursal_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_caja_turnos_un_turno_activo
    ON caja_turnos (operador_id)
    WHERE (estado IN ('ABIERTO', 'PENDIENTE_AUTORIZACION'));

-- ============================================================================
-- FUNCIONES AUXILIARES (INTELIGENCIA FINANCIERA — Regla de Oro)
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_total_desde_conteo(conteo JSONB)
RETURNS NUMERIC(18,2) AS $$
DECLARE
    divisa TEXT; denom TEXT; total NUMERIC(18,2) := 0; denoms JSONB;
BEGIN
    FOR divisa IN SELECT jsonb_object_keys(COALESCE(conteo, '{}'::jsonb)) LOOP
        denoms := conteo -> divisa;
        FOR denom IN SELECT jsonb_object_keys(denoms) LOOP
            total := total + (denom::NUMERIC * (denoms ->> denom)::NUMERIC);
        END LOOP;
    END LOOP;
    RETURN total;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Saldo esperado: continuidad del último turno CERRADO, o capital mínimo si no hay historial.
CREATE OR REPLACE FUNCTION fn_saldo_esperado_sucursal(p_sucursal_id TEXT)
RETURNS NUMERIC(18,2) AS $$
DECLARE
    v_capital JSONB; v_min NUMERIC(18,2); v_esperado NUMERIC(18,2) := 0; v_ultimo caja_turnos%ROWTYPE;
BEGIN
    SELECT * INTO v_ultimo FROM caja_turnos
    WHERE sucursal_id = p_sucursal_id AND estado = 'CERRADO'
    ORDER BY hora_cierre DESC NULLS LAST, creado_en DESC LIMIT 1;

    IF FOUND THEN
        RETURN fn_total_desde_conteo(v_ultimo.saldo_declarado_json);
    END IF;

    SELECT capital_minimo, saldo_minimo INTO v_capital, v_min
    FROM sucursales WHERE sucursal_id = p_sucursal_id;

    IF v_capital IS NOT NULL AND v_capital ? 'MXN' THEN
        v_esperado := (v_capital ->> 'MXN')::NUMERIC;
    ELSIF v_min IS NOT NULL THEN
        v_esperado := v_min;   -- fallback al saldo_minimo legado
    END IF;
    RETURN v_esperado;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- TRIGGER 1: ARQUEO CIEGO (BEFORE INSERT)
-- ============================================================================
CREATE OR REPLACE FUNCTION tr_caja_turnos_arqueo_ciego()
RETURNS TRIGGER AS $$
DECLARE
    v_declarado NUMERIC(18,2); v_esperado NUMERIC(18,2); v_diff NUMERIC(18,2);
    v_fecha TEXT; v_rand TEXT;
BEGIN
    IF NEW.folio_documento IS NULL OR NEW.folio_documento = '' THEN
        v_fecha := to_char(now(), 'YYYYMMDD');
        v_rand  := lpad((1000 + floor(random() * 9000))::INT::TEXT, 4, '0');
        NEW.folio_documento := 'FOLIO-AP-' || v_fecha || '-' || v_rand;
    END IF;

    v_declarado := fn_total_desde_conteo(NEW.saldo_declarado_json);
    v_esperado  := fn_saldo_esperado_sucursal(NEW.sucursal_id);
    v_diff      := v_declarado - v_esperado;

    NEW.saldo_esperado_json := jsonb_build_object('MXN', v_esperado);
    NEW.desviaciones_json := jsonb_build_object(
        'MXN', jsonb_build_object(
            'declared', v_declarado, 'expected', v_esperado,
            'diff', v_diff, 'valueDiff', v_diff
        )
    );

    IF abs(v_diff) > 0.01 THEN
        NEW.estado := 'PENDIENTE_AUTORIZACION';
    ELSE
        NEW.estado := 'ABIERTO';
        NEW.hora_apertura := now();
    END IF;

    NEW.actualizado_en := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_arqueo_ciego ON caja_turnos;
CREATE TRIGGER trg_arqueo_ciego
    BEFORE INSERT ON caja_turnos
    FOR EACH ROW EXECUTE FUNCTION tr_caja_turnos_arqueo_ciego();

-- ============================================================================
-- TRIGGER 2: CONTABILIDAD DE AJUSTE (BEFORE UPDATE) — partida doble
-- ============================================================================
CREATE TABLE IF NOT EXISTS asientos_contables (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tx_id TEXT NOT NULL, descripcion TEXT, cuenta TEXT NOT NULL,
    debe NUMERIC(18,2) NOT NULL DEFAULT 0, haber NUMERIC(18,2) NOT NULL DEFAULT 0,
    turno_id UUID REFERENCES caja_turnos(id), creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION tr_caja_turnos_ajuste_contable()
RETURNS TRIGGER AS $$
DECLARE
    v_diff NUMERIC(18,2); v_txid TEXT; v_desc TEXT; v_abs NUMERIC(18,2);
BEGIN
    IF NEW.estado = 'ABIERTO' AND OLD.estado = 'PENDIENTE_AUTORIZACION' THEN
        v_diff := COALESCE((NEW.desviaciones_json -> 'MXN' ->> 'valueDiff')::NUMERIC, 0);
        IF abs(v_diff) > 0.01 THEN
            v_txid := 'ADJUST-SH-' || NEW.folio_documento;
            v_desc := 'Ajuste contable por desviación autorizada en apertura. Folio: ' || NEW.folio_documento;
            v_abs  := abs(v_diff);
            IF v_diff > 0 THEN
                INSERT INTO asientos_contables (tx_id, descripcion, cuenta, debe, haber, turno_id) VALUES
                    (v_txid, v_desc, '1101', v_abs, 0, NEW.id),
                    (v_txid, v_desc, '4102', 0, v_abs, NEW.id);
            ELSE
                INSERT INTO asientos_contables (tx_id, descripcion, cuenta, debe, haber, turno_id) VALUES
                    (v_txid, v_desc, '5201', v_abs, 0, NEW.id),
                    (v_txid, v_desc, '1101', 0, v_abs, NEW.id);
            END IF;
        END IF;
        NEW.hora_apertura := COALESCE(NEW.hora_apertura, now());
    END IF;
    NEW.actualizado_en := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ajuste_contable ON caja_turnos;
CREATE TRIGGER trg_ajuste_contable
    BEFORE UPDATE ON caja_turnos
    FOR EACH ROW EXECUTE FUNCTION tr_caja_turnos_ajuste_contable();

-- ============================================================================
-- RPC: AUTORIZAR DESVIACIÓN (Nivel 5 + clave de 9 caracteres)
-- POST /rest/v1/rpc/autorizar_desviacion_turno
-- ============================================================================
CREATE OR REPLACE FUNCTION autorizar_desviacion_turno(
    p_turno_id UUID, p_operador_id TEXT, p_clave TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_op operadores%ROWTYPE; v_turno caja_turnos%ROWTYPE;
BEGIN
    IF p_clave IS NULL OR char_length(p_clave) <> 9 THEN
        RAISE EXCEPTION 'La clave de autorización debe tener exactamente 9 caracteres.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_op FROM operadores WHERE id = p_operador_id AND is_active = 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Operador autorizador no encontrado o inactivo.' USING ERRCODE = 'P0002';
    END IF;

    IF v_op.nivel_autorizacion <> 5 THEN
        RAISE EXCEPTION 'Acceso denegado: se requiere un usuario Nivel 5 (Super Admin) para autorizar desviaciones.' USING ERRCODE = '42501';
    END IF;

    IF v_op.clave_autorizacion_hash IS NULL
       OR v_op.clave_autorizacion_hash <> crypt(p_clave, v_op.clave_autorizacion_hash) THEN
        RAISE EXCEPTION 'Clave de autorización incorrecta.' USING ERRCODE = '28P01';
    END IF;

    SELECT * INTO v_turno FROM caja_turnos WHERE id = p_turno_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Turno no encontrado.' USING ERRCODE = 'P0002';
    END IF;
    IF v_turno.estado <> 'PENDIENTE_AUTORIZACION' THEN
        RAISE EXCEPTION 'El turno no requiere autorización o ya fue procesado.' USING ERRCODE = '22023';
    END IF;

    UPDATE caja_turnos
       SET estado = 'ABIERTO', autorizado_por = p_operador_id, autorizacion_fecha = now()
     WHERE id = p_turno_id;

    RETURN jsonb_build_object(
        'success', true, 'turno_id', p_turno_id, 'estado', 'ABIERTO',
        'autorizado_por', v_op.nombre,
        'message', 'Turno desbloqueado. Inventario y asiento contable de ajuste alineados.'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION set_clave_autorizacion(p_operador_id TEXT, p_clave TEXT)
RETURNS VOID AS $$
BEGIN
    IF char_length(p_clave) <> 9 THEN
        RAISE EXCEPTION 'La clave debe tener exactamente 9 caracteres.';
    END IF;
    UPDATE operadores SET clave_autorizacion_hash = crypt(p_clave, gen_salt('bf')) WHERE id = p_operador_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- ROW LEVEL SECURITY (solo caja_turnos; las legadas ya tienen RLS habilitado)
-- ============================================================================
ALTER TABLE caja_turnos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lectura_autenticados" ON caja_turnos;
CREATE POLICY "lectura_autenticados" ON caja_turnos FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insert_autenticados" ON caja_turnos;
CREATE POLICY "insert_autenticados" ON caja_turnos FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_autenticados" ON caja_turnos;
CREATE POLICY "update_autenticados" ON caja_turnos FOR UPDATE TO authenticated USING (true);

-- ============================================================================
-- SEED MÍNIMO — coherente con el esquema legado (evita 404 iniciales)
-- ============================================================================
INSERT INTO sucursales (sucursal_id, nombre, es_matriz, capital_minimo, razon_social, rfc, saldo_minimo)
VALUES ('MAIN_BRANCH', 'Matriz Principal', 1,
        '{"MXN": 50000, "USD": 3000}'::jsonb, 'SICC Cambios SA de CV', 'XAXX010101000', 50000)
ON CONFLICT (sucursal_id) DO UPDATE
    SET capital_minimo = EXCLUDED.capital_minimo;

INSERT INTO operadores (id, nombre, username, nivel_autorizacion, branch_id, is_active)
VALUES
    ('user_cajero_1',  'María',   'maria',  2, 'MAIN_BRANCH', 1),
    ('user_gerente_1', 'Gerente', 'gerente',4, 'MAIN_BRANCH', 1),
    ('user_admin_1',   'Freddy',  'freddy', 5, 'MAIN_BRANCH', 1)
ON CONFLICT (id) DO UPDATE SET nivel_autorizacion = EXCLUDED.nivel_autorizacion;

-- Clave de 9 caracteres para Freddy (Nivel 5). CAMBIAR en producción.
SELECT set_clave_autorizacion('user_admin_1', 'SICC-2026');

INSERT INTO terminales (terminal_id, sucursal_id, operador_id, descripcion)
VALUES ('TERM-01', 'MAIN_BRANCH', 'user_cajero_1', 'Terminal de ventanilla principal')
ON CONFLICT (terminal_id) DO UPDATE SET operador_id = EXCLUDED.operador_id;

-- ============================================================================
-- FIN DEL SCRIPT MAESTRO v2
-- ============================================================================
