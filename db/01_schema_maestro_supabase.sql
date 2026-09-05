-- Esquema SQL Maestro para Supabase (PostgreSQL)
-- Generado el 3 de agosto de 2026
-- Por: Senior Database Engineer (GPT-4o)

CREATE SCHEMA sicc;

-- Tabla de operadores
CREATE TABLE sicc.operadores (
    id SERIAL PRIMARY KEY,
    nombre_completo TEXT NOT NULL,
    nivel_autorizacion INTEGER NOT NULL CHECK (nivel_autorizacion BETWEEN 1 AND 5),
    creado_en TIMESTAMP DEFAULT NOW()
);

-- Tabla de terminales
CREATE TABLE sicc.terminales (
    terminal_id TEXT PRIMARY KEY,
    sucursal_id TEXT NOT NULL,
    operador_id INTEGER NOT NULL,
    terminal_bloqueada BOOLEAN DEFAULT FALSE,
    creado_en TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (operador_id) REFERENCES sicc.operadores(id) ON DELETE CASCADE
);

-- Tabla de inventario
CREATE TABLE sicc.inventarios (
    id SERIAL PRIMARY KEY,
    sucursal_id TEXT NOT NULL,
    divisa TEXT NOT NULL,
    cantidad NUMERIC(18,8) NOT NULL,
    costo_unitario NUMERIC(18,8) NOT NULL,
    creado_en TIMESTAMP DEFAULT NOW()
);

-- Tabla de inventario batches para PEPS/FIFO
CREATE TABLE sicc.inventario_batches (
    id SERIAL PRIMARY KEY,
    inventario_id INTEGER NOT NULL,
    cantidad_remanente NUMERIC(18,8) NOT NULL,
    costo_unitario NUMERIC(18,8) NOT NULL,
    FOREIGN KEY (inventario_id) REFERENCES sicc.inventarios(id) ON DELETE CASCADE
);

-- Tabla accounting_journal para partida doble
CREATE TABLE sicc.accounting_journal (
    id SERIAL PRIMARY KEY,
    cuenta TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    monto NUMERIC(18,8) NOT NULL,
    tipo_movimiento TEXT NOT NULL CHECK (tipo_movimiento IN ('CARGO', 'ABONO')),
    referencia TEXT,
    creado_en TIMESTAMP DEFAULT NOW()
);

-- Tablas adicionales de complimiento (AML/KYC)
CREATE TABLE sicc.lista_ofac (
    id SERIAL PRIMARY KEY,
    nombre_completo TEXT NOT NULL,
    motivo TEXT,
    tipo_coincidencia TEXT NOT NULL CHECK (tipo_coincidencia IN ('RED', 'AMARILLO')),
    creado_en TIMESTAMP DEFAULT NOW()
);

CREATE TABLE sicc.lista_pep (
    id SERIAL PRIMARY KEY,
    nombre_completo TEXT NOT NULL,
    cargo TEXT,
    tipo_coincidencia TEXT NOT NULL CHECK (tipo_coincidencia IN ('RED', 'AMARILLO')),
    creado_en TIMESTAMP DEFAULT NOW()
);