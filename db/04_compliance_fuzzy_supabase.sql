-- ═══════════════════════════════════════════════════════════════════════════
-- SICC — Motor de Cumplimiento Independiente (Fase 4)
-- Esquema Supabase: Listas de Riesgo con Fuzzy Matching Fonético
-- Fecha: 15 agosto 2026
-- ═══════════════════════════════════════════════════════════════════════════
--
-- OBJETIVO: Reemplazar la dependencia de SOFTExchange con un motor de riesgos
-- nativo. Este esquema habilita búsqueda difusa (fuzzy) usando dos técnicas
-- complementarias de PostgreSQL:
--   1. pg_trgm  → similitud por trigramas (tolera typos: "Guzman" ≈ "Guzmán")
--   2. fuzzystrmatch → fonética (Soundex/Metaphone/Levenshtein): "Smith" ≈ "Smyth"
--
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. EXTENSIONES REQUERIDAS -------------------------------------------------
-- pg_trgm: similitud por trigramas + índices GIN para búsqueda difusa rápida
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- fuzzystrmatch: soundex(), metaphone(), dmetaphone(), levenshtein()
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
-- unaccent: normaliza acentos ("José" → "Jose") para matching consistente
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 2. TABLA MAESTRA DE LISTAS DE RIESGO --------------------------------------
-- Modelo unificado: una sola tabla para OFAC, PEP, CNBV y SAT 69-B.
-- Esto permite una única consulta de fuzzy matching sobre todas las listas.
CREATE TABLE IF NOT EXISTS compliance_listas_riesgo (
    id                BIGSERIAL PRIMARY KEY,
    lista             TEXT NOT NULL CHECK (lista IN ('OFAC', 'PEP', 'CNBV', 'SAT')),
    nombre_completo   TEXT NOT NULL,
    -- Nombre normalizado (sin acentos, mayúsculas) — se llena por trigger
    nombre_normalizado TEXT,
    -- Código fonético double-metaphone primario (calculado por trigger)
    fonetico_dmeta    TEXT,
    -- Metadatos específicos de cada lista (JSON flexible)
    -- OFAC: {ent_num, sdn_type, program, remarks}
    -- PEP:  {cargo, nivel, entidad, periodo}
    -- CNBV: {resolucion, fecha}
    -- SAT:  {situacion, rfc}
    metadata          JSONB DEFAULT '{}'::jsonb,
    -- Clasificación del riesgo del registro en sí
    tipo_coincidencia TEXT NOT NULL DEFAULT 'RED' CHECK (tipo_coincidencia IN ('RED', 'AMARILLO')),
    -- Trazabilidad de origen del dato
    fuente_origen     TEXT,               -- 'OFAC_SDN_CSV', 'PEP_SEED', 'PEP_SCRAPER', 'MANUAL'
    fecha_carga       TIMESTAMPTZ DEFAULT now(),
    activo            BOOLEAN DEFAULT true
);

-- 3. TRIGGER DE NORMALIZACIÓN FONÉTICA --------------------------------------
-- Cada nombre que entra genera automáticamente su forma normalizada y su
-- código fonético. Esto es la REGLA DE ORO: la inteligencia vive en la BD.
CREATE OR REPLACE FUNCTION fn_normalizar_nombre_riesgo()
RETURNS TRIGGER AS $$
BEGIN
    -- Normalización: sin acentos, mayúsculas, espacios colapsados
    NEW.nombre_normalizado := upper(trim(regexp_replace(
        unaccent(NEW.nombre_completo), '\s+', ' ', 'g'
    )));
    -- Código fonético: double-metaphone del nombre normalizado
    -- (dmetaphone maneja bien nombres latinos e ingleses)
    NEW.fonetico_dmeta := dmetaphone(NEW.nombre_normalizado);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_normalizar_riesgo ON compliance_listas_riesgo;
CREATE TRIGGER trg_normalizar_riesgo
    BEFORE INSERT OR UPDATE OF nombre_completo ON compliance_listas_riesgo
    FOR EACH ROW EXECUTE FUNCTION fn_normalizar_nombre_riesgo();

-- 4. ÍNDICES PARA FUZZY MATCHING RÁPIDO -------------------------------------
-- GIN sobre trigramas del nombre normalizado (búsqueda por similitud)
CREATE INDEX IF NOT EXISTS idx_riesgo_trgm
    ON compliance_listas_riesgo USING gin (nombre_normalizado gin_trgm_ops);
-- Índice sobre el código fonético (búsqueda fonética exacta O(log n))
CREATE INDEX IF NOT EXISTS idx_riesgo_fonetico
    ON compliance_listas_riesgo (fonetico_dmeta);
-- Índice por lista para filtrado rápido
CREATE INDEX IF NOT EXISTS idx_riesgo_lista
    ON compliance_listas_riesgo (lista) WHERE activo = true;

-- 5. FUNCIÓN DE BÚSQUEDA FUZZY UNIFICADA ------------------------------------
-- Esta es la función principal que consume el backend. Combina:
--   - Similitud por trigrama (umbral configurable)
--   - Coincidencia fonética double-metaphone
-- Devuelve un score 0..1 y clasifica el nivel de coincidencia.
CREATE OR REPLACE FUNCTION fn_buscar_listas_riesgo(
    p_nombre       TEXT,
    p_umbral_trgm  REAL DEFAULT 0.35   -- 0.35 = tolerante; sube a 0.6 para estricto
)
RETURNS TABLE (
    id                BIGINT,
    lista             TEXT,
    nombre_completo   TEXT,
    tipo_coincidencia TEXT,
    metadata          JSONB,
    score_similitud   REAL,
    match_fonetico    BOOLEAN,
    nivel_match       TEXT   -- 'EXACTO', 'FONETICO', 'SIMILAR'
) AS $$
DECLARE
    v_norm    TEXT;
    v_fonetico TEXT;
BEGIN
    -- Normalizar la consulta igual que los registros almacenados
    v_norm := upper(trim(regexp_replace(unaccent(p_nombre), '\s+', ' ', 'g')));
    v_fonetico := dmetaphone(v_norm);

    RETURN QUERY
    SELECT
        r.id,
        r.lista,
        r.nombre_completo,
        r.tipo_coincidencia,
        r.metadata,
        similarity(r.nombre_normalizado, v_norm) AS score_similitud,
        (r.fonetico_dmeta = v_fonetico) AS match_fonetico,
        CASE
            WHEN r.nombre_normalizado = v_norm THEN 'EXACTO'
            WHEN r.fonetico_dmeta = v_fonetico THEN 'FONETICO'
            ELSE 'SIMILAR'
        END AS nivel_match
    FROM compliance_listas_riesgo r
    WHERE r.activo = true
      AND (
            r.nombre_normalizado % v_norm                       -- trigram operator
         OR similarity(r.nombre_normalizado, v_norm) >= p_umbral_trgm
         OR r.fonetico_dmeta = v_fonetico                        -- match fonético
      )
    ORDER BY
        (r.nombre_normalizado = v_norm) DESC,   -- exactos primero
        (r.fonetico_dmeta = v_fonetico) DESC,   -- luego fonéticos
        score_similitud DESC                    -- luego por similitud
    LIMIT 50;
END;
$$ LANGUAGE plpgsql STABLE;

-- 6. TABLA DE UMBRALES DE CAPTURA OBLIGATORIA -------------------------------
-- Los candados regulatorios: qué documentación exige cada rango de monto.
CREATE TABLE IF NOT EXISTS compliance_umbrales_captura (
    id                  SERIAL PRIMARY KEY,
    monto_min_usd       NUMERIC(18,2) NOT NULL,
    monto_max_usd       NUMERIC(18,2),          -- NULL = sin límite superior
    requiere_id         BOOLEAN DEFAULT false,   -- identificación oficial
    requiere_domicilio  BOOLEAN DEFAULT false,   -- comprobante de domicilio
    requiere_expediente BOOLEAN DEFAULT false,   -- expediente completo
    requiere_clave_n5   BOOLEAN DEFAULT false,   -- clave 9 chars de Nivel 5
    descripcion         TEXT,
    activo              BOOLEAN DEFAULT true
);

-- Seed de umbrales regulatorios (CNBV / disposiciones de carácter general AML)
INSERT INTO compliance_umbrales_captura
    (monto_min_usd, monto_max_usd, requiere_id, requiere_domicilio, requiere_expediente, requiere_clave_n5, descripcion)
VALUES
    (0,    999.99,  false, false, false, false, 'Operación bajo umbral — sin captura obligatoria'),
    (1000, 2999.99, true,  false, false, false, 'Umbral $1k USD — Identificación oficial obligatoria'),
    (3000, 4999.99, true,  true,  false, false, 'Umbral $3k USD — Identificación + comprobante de domicilio'),
    (5000, NULL,    true,  true,  true,  true,  'Umbral $5k USD — Expediente completo + clave Nivel 5')
ON CONFLICT DO NOTHING;

-- 7. FUNCIÓN QUE RESUELVE QUÉ CAPTURA APLICA A UN MONTO ----------------------
CREATE OR REPLACE FUNCTION fn_umbral_para_monto(p_monto_usd NUMERIC)
RETURNS TABLE (
    requiere_id         BOOLEAN,
    requiere_domicilio  BOOLEAN,
    requiere_expediente BOOLEAN,
    requiere_clave_n5   BOOLEAN,
    descripcion         TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT u.requiere_id, u.requiere_domicilio, u.requiere_expediente,
           u.requiere_clave_n5, u.descripcion
    FROM compliance_umbrales_captura u
    WHERE u.activo = true
      AND p_monto_usd >= u.monto_min_usd
      AND (u.monto_max_usd IS NULL OR p_monto_usd <= u.monto_max_usd)
    ORDER BY u.monto_min_usd DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

-- ═══════════════════════════════════════════════════════════════════════════
-- FIN DEL ESQUEMA. Ejecutar en Supabase SQL Editor o vía migración.
-- ═══════════════════════════════════════════════════════════════════════════
