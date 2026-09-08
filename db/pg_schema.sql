-- ============================================================================
-- SICC · PostgreSQL Production Schema
-- All tables, indexes, triggers, and views — ported from SQLite (database.ts)
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- CORE ERP TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS Operaciones_Captacion (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  client_name TEXT NOT NULL,
  currency_in TEXT NOT NULL,
  amount_in REAL NOT NULL,
  method_in TEXT NOT NULL,
  currency_out TEXT NOT NULL DEFAULT 'MXN',
  amount_out REAL NOT NULL DEFAULT 0,
  method_out TEXT NOT NULL DEFAULT 'CASH',
  rate REAL NOT NULL DEFAULT 1,
  markup REAL NOT NULL DEFAULT 0,
  transfer_bank_name TEXT,
  transfer_account_number TEXT,
  transfer_payer_name TEXT,
  transfer_date TEXT,
  transfer_tracking_id TEXT,
  transfer_txid TEXT,
  transfer_receipt_url TEXT,
  status TEXT DEFAULT 'COMPLETED',
  settlement_status TEXT DEFAULT 'PENDING',
  branch_id TEXT DEFAULT 'MAIN_BRANCH',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Operaciones_Liquidacion_P2P (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  client_name TEXT NOT NULL,
  currency_in TEXT NOT NULL,
  amount_in REAL NOT NULL,
  method_in TEXT NOT NULL,
  currency_out TEXT NOT NULL DEFAULT 'MXN',
  amount_out REAL NOT NULL DEFAULT 0,
  method_out TEXT NOT NULL DEFAULT 'CASH',
  rate REAL NOT NULL DEFAULT 1,
  markup REAL NOT NULL DEFAULT 0,
  transfer_bank_name TEXT,
  transfer_account_number TEXT,
  transfer_payer_name TEXT,
  transfer_date TEXT,
  transfer_tracking_id TEXT,
  transfer_txid TEXT,
  transfer_receipt_url TEXT,
  status TEXT DEFAULT 'COMPLETED',
  settlement_status TEXT DEFAULT 'PENDING',
  branch_id TEXT DEFAULT 'MAIN_BRANCH',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Traz_Flujo_Rentabilidad (
  id SERIAL PRIMARY KEY,
  captacion_id TEXT,
  liquidacion_id TEXT,
  spread REAL,
  profit_mxn REAL,
  fifo_rank INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Liquidacion_Tickets (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  client_name TEXT NOT NULL,
  base_currency TEXT NOT NULL,
  base_amount REAL NOT NULL,
  quote_currency TEXT NOT NULL,
  quote_amount REAL NOT NULL,
  markup REAL NOT NULL,
  delivery_method TEXT NOT NULL,
  destination_bank TEXT,
  destination_account TEXT,
  wallet_address TEXT,
  transfer_receipt_url TEXT,
  status TEXT DEFAULT 'PENDING',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Customers (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  risk_level TEXT DEFAULT 'LOW',
  is_vip INTEGER DEFAULT 0,
  estimated_monthly_amount REAL,
  estimated_operations_per_month INTEGER,
  source_destination_funds TEXT,
  client_type TEXT DEFAULT 'PHYSICAL',
  first_name TEXT,
  last_name TEXT,
  rfc_curp TEXT,
  official_id_url TEXT,
  razon_social TEXT,
  company_rfc TEXT,
  business_line TEXT,
  legal_rep_name TEXT,
  legal_rep_id TEXT,
  is_b2b INTEGER DEFAULT 0,
  acta_constitutiva_url TEXT,
  comprobante_domicilio_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Wallets (
  id TEXT PRIMARY KEY,
  customer_id TEXT UNIQUE,
  balance_mxn REAL DEFAULT 0,
  balance_usd REAL DEFAULT 0,
  balance_usdt REAL DEFAULT 0,
  status TEXT DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Cards (
  id TEXT PRIMARY KEY,
  customer_id TEXT UNIQUE,
  card_number TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Compliance_Expedientes (
  customer_id TEXT PRIMARY KEY,
  risk_score TEXT DEFAULT 'PENDING',
  verified INTEGER DEFAULT 0,
  last_review TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Compliance_Documents (
  id SERIAL PRIMARY KEY,
  customer_id TEXT,
  type TEXT NOT NULL,
  url TEXT NOT NULL,
  verified INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Boveda (
  id TEXT PRIMARY KEY,
  currency TEXT UNIQUE NOT NULL,
  balance REAL DEFAULT 0,
  last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Cat_Denominaciones (
  id SERIAL PRIMARY KEY,
  currency TEXT NOT NULL,
  denominacion REAL NOT NULL,
  type TEXT DEFAULT 'BILL',
  status TEXT DEFAULT 'ACTIVE'
);

CREATE TABLE IF NOT EXISTS Inventario_Boveda_Detalle (
  id SERIAL PRIMARY KEY,
  branch_id TEXT DEFAULT 'MAIN_BRANCH',
  currency TEXT NOT NULL,
  denominacion REAL NOT NULL,
  quantity INTEGER DEFAULT 0,
  last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(branch_id, currency, denominacion)
);

CREATE TABLE IF NOT EXISTS Operaciones_Denominaciones_Detalle (
  id SERIAL PRIMARY KEY,
  operation_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  currency TEXT NOT NULL,
  denominacion REAL NOT NULL,
  quantity INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- ACCOUNTING (Partida Doble)
-- ============================================================================

CREATE TABLE IF NOT EXISTS Accounting_Accounts (
  account_code TEXT PRIMARY KEY,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  balance NUMERIC(18,8) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS Accounting_Journal (
  id SERIAL PRIMARY KEY,
  transaction_id TEXT,
  date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  account_code TEXT,
  description TEXT,
  debit NUMERIC(18,8) DEFAULT 0,
  credit NUMERIC(18,8) DEFAULT 0
);

-- ============================================================================
-- INVENTORY FIFO (PEPS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS Inventory_Batches (
  id SERIAL PRIMARY KEY,
  currency_code TEXT NOT NULL,
  quantity NUMERIC(18,8) NOT NULL,
  remaining_quantity NUMERIC(18,8) NOT NULL,
  cost_basis NUMERIC(18,8) NOT NULL,
  reference_op_id TEXT,
  branch_id TEXT DEFAULT 'MAIN_BRANCH',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- PARTNERS & AFFILIATES
-- ============================================================================

CREATE TABLE IF NOT EXISTS Partners (
  partner_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  partner_code TEXT UNIQUE,
  is_wholesale INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Affiliate_Pre_Registros (
  ticket_code TEXT PRIMARY KEY,
  partner_id TEXT,
  affiliate_code TEXT,
  amount_usd NUMERIC(18,8) NOT NULL,
  customer_name TEXT,
  status TEXT DEFAULT 'PENDIENTE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fx_transactions (
  id TEXT PRIMARY KEY,
  affiliate_id TEXT,
  ticket_code TEXT,
  amount_usd NUMERIC(18,8),
  amount_mxn NUMERIC(18,8),
  rate NUMERIC(18,8),
  spread_mxn NUMERIC(18,8) DEFAULT 0,
  commission_mxn NUMERIC(18,8) DEFAULT 0,
  status TEXT DEFAULT 'COMPLETED',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Aliado_Comisiones (
  id SERIAL PRIMARY KEY,
  partner_id TEXT,
  operation_id TEXT,
  ticket_code TEXT,
  amount_usd NUMERIC(18,8),
  commission_per_usd NUMERIC(18,8),
  total_commission_mxn NUMERIC(18,8),
  spread_mxn NUMERIC(18,8) DEFAULT 0,
  status TEXT DEFAULT 'PENDING',
  accrued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Partner_Recolecciones (
  id SERIAL PRIMARY KEY,
  partner_id TEXT,
  packages_count INTEGER,
  safety_seals TEXT,
  photo_url TEXT,
  status TEXT DEFAULT 'Efectivo en Tránsito',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Partner_Cortes (
  id SERIAL PRIMARY KEY,
  partner_id TEXT,
  amount_usd NUMERIC(18,8) NOT NULL,
  commission_rate NUMERIC(18,8),
  commission_mxn NUMERIC(18,8),
  status TEXT DEFAULT 'LIQUIDADO_CORTE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- COMPLIANCE PROFILES
-- ============================================================================

CREATE TABLE IF NOT EXISTS Compliance_Profiles (
  id SERIAL PRIMARY KEY,
  customer_id TEXT,
  risk_level TEXT,
  kyc_status TEXT,
  id_file_path TEXT,
  address_proof_path TEXT,
  last_review TIMESTAMP
);

-- ============================================================================
-- SHIFT MANAGEMENT
-- ============================================================================

CREATE TABLE IF NOT EXISTS shift_logs (
  id SERIAL PRIMARY KEY,
  cajero_id TEXT NOT NULL,
  nickname TEXT,
  hora_apertura TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  hora_cierre TIMESTAMP,
  saldo_declarado_json TEXT NOT NULL,
  saldo_esperado_json TEXT NOT NULL,
  desviaciones_json TEXT,
  cierre_declarado_json TEXT,
  cierre_esperado_json TEXT,
  cierre_desviaciones_json TEXT,
  pdf_report_url TEXT,
  status TEXT DEFAULT 'OPEN',
  folio_documento TEXT NOT NULL UNIQUE,
  authorized_by TEXT,
  authorization_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cash_deviations (
  id SERIAL PRIMARY KEY,
  shift_id INTEGER NOT NULL,
  sucursal_id TEXT NOT NULL,
  cajero_id TEXT NOT NULL,
  type TEXT NOT NULL,
  currency TEXT NOT NULL,
  expected_amount REAL NOT NULL,
  declared_amount REAL NOT NULL,
  difference REAL NOT NULL,
  status TEXT DEFAULT 'PENDING',
  authorized_by TEXT,
  authorization_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS caja_gastos (
  id SERIAL PRIMARY KEY,
  sucursal_id TEXT NOT NULL,
  shift_id INTEGER,
  concept TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  authorized_by TEXT,
  receipt_image_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- USER MANAGEMENT
-- ============================================================================

CREATE TABLE IF NOT EXISTS User_Profiles (
  id SERIAL PRIMARY KEY,
  auth_user_id TEXT UNIQUE,
  nickname TEXT NOT NULL,
  puesto TEXT,
  role_level INTEGER DEFAULT 1,
  branch_id TEXT DEFAULT 'MAIN_BRANCH',
  custom_permissions TEXT,
  is_active INTEGER DEFAULT 1,
  last_login TIMESTAMP,
  hire_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  password_hash TEXT,
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMP,
  password_changed_at TIMESTAMP,
  force_password_change INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hr_vault_metadata (
  id SERIAL PRIMARY KEY,
  curp TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  puesto TEXT,
  sucursal TEXT,
  sueldo_mensual REAL,
  metadata_json TEXT,
  documents_json TEXT,
  created_by TEXT,
  is_finalized INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- SUCURSALES
-- ============================================================================

CREATE TABLE IF NOT EXISTS sucursales (
  sucursal_id TEXT PRIMARY KEY,
  razon_social TEXT,
  nombre TEXT NOT NULL,
  rfc TEXT,
  calle TEXT,
  numero TEXT,
  colonia TEXT,
  ciudad TEXT,
  codigo_postal TEXT,
  telefono TEXT,
  email TEXT,
  licencia_cnbv TEXT,
  logo_url TEXT,
  es_matriz INTEGER DEFAULT 0,
  saldo_minimo NUMERIC(18,8) DEFAULT 100000.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sucursales_matriz_unica ON sucursales(es_matriz) WHERE es_matriz = 1;

-- ============================================================================
-- OPERADORES & CAJAS
-- ============================================================================

CREATE TABLE IF NOT EXISTS operadores (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  nivel_autorizacion INTEGER DEFAULT 2,
  branch_id TEXT DEFAULT 'MAIN_BRANCH',
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cajas (
  cajero_id TEXT PRIMARY KEY,
  saldo_actual_mxn NUMERIC(18,8) DEFAULT 0,
  sucursal_id TEXT,
  last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventario_caja_detalle (
  id SERIAL PRIMARY KEY,
  cajero_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  denominacion REAL NOT NULL,
  quantity INTEGER DEFAULT 0,
  last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(cajero_id, currency, denominacion)
);

CREATE TABLE IF NOT EXISTS caja_dotaciones (
  id TEXT PRIMARY KEY,
  gerente_id TEXT,
  cajero_id TEXT,
  monto_mxn NUMERIC(18,8),
  tipo_dotacion TEXT CHECK(tipo_dotacion IN ('APERTURA', 'EMERGENCIA')),
  folio_boveda TEXT,
  clave_autorizacion TEXT,
  estatus TEXT DEFAULT 'PENDIENTE',
  desglose_json TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- SECURITY THRESHOLDS & TERMINALS
-- ============================================================================

CREATE TABLE IF NOT EXISTS security_thresholds (
  id SERIAL PRIMARY KEY,
  sucursal_id TEXT NOT NULL,
  divisa TEXT NOT NULL,
  monto_maximo REAL NOT NULL,
  UNIQUE(sucursal_id, divisa)
);

CREATE TABLE IF NOT EXISTS terminales (
  terminal_id TEXT PRIMARY KEY,
  sucursal_id TEXT NOT NULL,
  terminal_locked INTEGER DEFAULT 0,
  warning_count INTEGER DEFAULT 0,
  last_warning_at TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- COMPLIANCE & AML TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS lista_ofac (
  id SERIAL PRIMARY KEY,
  nombre_completo TEXT NOT NULL,
  motivo TEXT,
  tipo_coincidencia TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lista_pep (
  id SERIAL PRIMARY KEY,
  nombre_completo TEXT NOT NULL,
  cargo TEXT,
  tipo_coincidencia TEXT NOT NULL,
  entidad TEXT,
  poder TEXT,
  fuente_origen TEXT,
  nombre_normalizado TEXT,
  fonetico_dmeta TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lista_cnbv (
  id SERIAL PRIMARY KEY,
  nombre_completo TEXT NOT NULL,
  resolucion TEXT,
  tipo_coincidencia TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lista_sat (
  id SERIAL PRIMARY KEY,
  nombre_completo TEXT NOT NULL,
  situacion TEXT,
  tipo_coincidencia TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS authorization_logs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  amount_usd REAL,
  reason TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  authorized_by TEXT,
  passcode TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  transaction_id TEXT
);

CREATE TABLE IF NOT EXISTS reportes_aml (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  amount_usd REAL,
  description TEXT,
  oficial_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- SECURITY TABLES (from migrations)
-- ============================================================================

CREATE TABLE IF NOT EXISTS active_sessions (
  id TEXT PRIMARY KEY,
  auth_user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS security_audit_log (
  id SERIAL PRIMARY KEY,
  auth_user_id TEXT,
  event_type TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  success BOOLEAN,
  details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_active_sessions_expires ON active_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_security_audit_user ON security_audit_log(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_security_audit_event ON security_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_user_profiles_last_login ON User_Profiles(last_login);

-- ============================================================================
-- SERVER.TS DDL (pending_authorizations, pld_alert_status)
-- ============================================================================

CREATE TABLE IF NOT EXISTS pending_authorizations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'PENDING',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pld_alert_status (
  alert_id TEXT PRIMARY KEY,
  status TEXT DEFAULT 'PENDING',
  notes TEXT,
  resolved_by TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- VIEWS
-- ============================================================================

CREATE OR REPLACE VIEW vw_saldos_totales_por_divisa AS
SELECT
  currency_code AS currency,
  SUM(remaining_quantity) AS total_batches_quantity,
  SUM(remaining_quantity * cost_basis) AS total_batches_value_mxn,
  COUNT(id) AS active_batches_count
FROM Inventory_Batches
WHERE remaining_quantity > 0
GROUP BY currency_code;

CREATE OR REPLACE VIEW vw_saldos_fisicos_por_sucursal AS
SELECT
  branch_id AS sucursal_id,
  currency,
  SUM(denominacion * quantity) AS total_physical_balance,
  MAX(last_update) AS last_update
FROM Inventario_Boveda_Detalle
GROUP BY branch_id, currency;

-- ============================================================================
-- TRIGGERS (PL/pgSQL — converted from SQLite syntax)
-- ============================================================================

-- Trigger: caja_dotaciones → on APLICADO, update cajas + accounting journal
CREATE OR REPLACE FUNCTION tr_caja_dotaciones_aplicar_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.estatus = 'APLICADO' AND OLD.estatus = 'PENDIENTE' THEN
    -- Increment cajas saldo
    INSERT INTO cajas (cajero_id, saldo_actual_mxn, last_update)
    VALUES (NEW.cajero_id, NEW.monto_mxn, CURRENT_TIMESTAMP)
    ON CONFLICT(cajero_id) DO UPDATE SET
      saldo_actual_mxn = cajas.saldo_actual_mxn + NEW.monto_mxn,
      last_update = CURRENT_TIMESTAMP;

    -- Accounting journal entries
    INSERT INTO Accounting_Journal (transaction_id, account_code, description, debit, credit, date)
    VALUES ('DOT-' || NEW.id, '1001', 'CARGO por dotacion ' || NEW.tipo_dotacion || ' - Ref: ' || NEW.id, NEW.monto_mxn, 0, CURRENT_TIMESTAMP);

    INSERT INTO Accounting_Journal (transaction_id, account_code, description, debit, credit, date)
    VALUES ('DOT-' || NEW.id, '1000', 'ABONO por dotacion ' || NEW.tipo_dotacion || ' - Ref: ' || NEW.id, 0, NEW.monto_mxn, CURRENT_TIMESTAMP);

    -- Update account balances
    UPDATE Accounting_Accounts SET balance = balance + NEW.monto_mxn WHERE account_code = '1001';
    UPDATE Accounting_Accounts SET balance = balance - NEW.monto_mxn WHERE account_code = '1000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_caja_dotaciones_aplicar ON caja_dotaciones;
CREATE TRIGGER tr_caja_dotaciones_aplicar
AFTER UPDATE OF estatus ON caja_dotaciones
FOR EACH ROW EXECUTE FUNCTION tr_caja_dotaciones_aplicar_fn();

-- Trigger: cleanup expired sessions on insert
CREATE OR REPLACE FUNCTION cleanup_expired_sessions_fn()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM active_sessions
  WHERE expires_at < NOW()
    OR (is_active = false AND created_at < NOW() - INTERVAL '7 days');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cleanup_expired_sessions ON active_sessions;
CREATE TRIGGER cleanup_expired_sessions
AFTER INSERT ON active_sessions
FOR EACH ROW EXECUTE FUNCTION cleanup_expired_sessions_fn();
