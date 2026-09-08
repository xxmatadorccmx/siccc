import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { createHash } from "crypto";
let db: any;

if (process.env.DATABASE_URL) {
  // === PostgreSQL production mode ===
  const pgMod: any = await import('./pg-adapter');
  db = await pgMod.createPgAdapter();
  pgMod.runPgSchemaSetup(db);
} else {
  // === SQLite development mode ===
  const dbPath = process.env.DB_PATH || "baas_platform.db";

try {
  db = new Database(dbPath);
  // Quick test query to see if database disk image is malformed
  db.prepare("SELECT 1").get();
  console.log("Database initialized successfully");
} catch (error) {
  console.error("Failed to initialize database, trying to delete or fallback:", error);
  try {
    if (db) db.close();
  } catch (e) {}
  if (fs.existsSync(dbPath)) {
    try {
      fs.unlinkSync(dbPath);
      console.log("Corrupted database file deleted.");
    } catch (e) {}
  }
  try {
    db = new Database(dbPath);
  } catch (e) {
    db = new Database(":memory:");
  }
}

// Initialize tables wrapped in a function for potential recovery
function runMigrationsAndSetup() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS Operaciones_Captacion (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      client_name TEXT NOT NULL,
      currency_in TEXT NOT NULL,
      amount_in REAL NOT NULL,
      method_in TEXT NOT NULL,
      currency_out TEXT NOT NULL,
      amount_out REAL NOT NULL,
      method_out TEXT NOT NULL,
      rate REAL NOT NULL,
      markup REAL NOT NULL,
      transfer_bank_name TEXT,
      transfer_account_number TEXT,
      transfer_payer_name TEXT,
      transfer_date TEXT,
      transfer_tracking_id TEXT,
      transfer_txid TEXT,
      transfer_receipt_url TEXT,
      status TEXT DEFAULT 'COMPLETED',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS Operaciones_Liquidacion_P2P (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      client_name TEXT NOT NULL,
      currency_in TEXT NOT NULL,
      amount_in REAL NOT NULL,
      method_in TEXT NOT NULL,
      currency_out TEXT NOT NULL,
      amount_out REAL NOT NULL,
      method_out TEXT NOT NULL,
      rate REAL NOT NULL,
      markup REAL NOT NULL,
      transfer_bank_name TEXT,
      transfer_account_number TEXT,
      transfer_payer_name TEXT,
      transfer_date TEXT,
      transfer_tracking_id TEXT,
      transfer_txid TEXT,
      transfer_receipt_url TEXT,
      status TEXT DEFAULT 'COMPLETED',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS Traz_Flujo_Rentabilidad (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      captacion_id TEXT,
      liquidacion_id TEXT,
      spread REAL,
      profit_mxn REAL,
      fifo_rank INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (captacion_id) REFERENCES Operaciones_Captacion(id),
      FOREIGN KEY (liquidacion_id) REFERENCES Operaciones_Liquidacion_P2P(id)
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS Wallets (
      id TEXT PRIMARY KEY,
      customer_id TEXT UNIQUE,
      balance_mxn REAL DEFAULT 0,
      balance_usd REAL DEFAULT 0,
      balance_usdt REAL DEFAULT 0,
      status TEXT DEFAULT 'ACTIVE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES Customers(id)
    );

    CREATE TABLE IF NOT EXISTS Cards (
      id TEXT PRIMARY KEY,
      customer_id TEXT UNIQUE,
      card_number TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT DEFAULT 'ACTIVE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES Customers(id)
    );

    CREATE TABLE IF NOT EXISTS Compliance_Expedientes (
      customer_id TEXT PRIMARY KEY,
      risk_score TEXT DEFAULT 'PENDING',
      verified INTEGER DEFAULT 0,
      last_review DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES Customers(id)
    );

    CREATE TABLE IF NOT EXISTS Compliance_Documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id TEXT,
      type TEXT NOT NULL,
      url TEXT NOT NULL,
      verified INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES Customers(id)
    );

    CREATE TABLE IF NOT EXISTS Boveda (
      id TEXT PRIMARY KEY,
      currency TEXT UNIQUE NOT NULL,
      balance REAL DEFAULT 0,
      last_update DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS Cat_Denominaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      currency TEXT NOT NULL,
      denominacion REAL NOT NULL,
      type TEXT DEFAULT 'BILL', -- 'BILL' or 'COIN'
      status TEXT DEFAULT 'ACTIVE'
    );

    CREATE TABLE IF NOT EXISTS Inventario_Boveda_Detalle (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch_id TEXT DEFAULT 'MAIN_BRANCH',
      currency TEXT NOT NULL,
      denominacion REAL NOT NULL,
      quantity INTEGER DEFAULT 0,
      last_update DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(branch_id, currency, denominacion)
    );

    CREATE TABLE IF NOT EXISTS Operaciones_Denominaciones_Detalle (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id TEXT NOT NULL,
      direction TEXT NOT NULL, -- 'IN' (received) or 'OUT' (delivered)
      currency TEXT NOT NULL,
      denominacion REAL NOT NULL,
      quantity INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Initialize Boveda with default currencies if empty
  const bovedaCount = db.prepare('SELECT COUNT(*) as count FROM Boveda').get();
  if (bovedaCount.count === 0) {
    const currencies = ['MXN', 'USD', 'USDT', 'EUR'];
    const insert = db.prepare('INSERT INTO Boveda (id, currency, balance) VALUES (?, ?, ?)');
    currencies.forEach(curr => insert.run(`BOV-${curr}`, curr, 1000000)); // Start with 1M each for demo
  }

  // Initialize Catalog of Denominations if empty
  const denCount = db.prepare('SELECT COUNT(*) as count FROM Cat_Denominaciones').get();
  if (denCount.count === 0) {
    const denoms = [
      { currency: 'MXN', values: [1000, 500, 200, 100, 50, 20], type: 'BILL' },
      { currency: 'MXN', values: [10, 5, 2, 1, 0.5], type: 'COIN' },
      { currency: 'USD', values: [100, 50, 20, 10, 5, 2, 1], type: 'BILL' },
      { currency: 'EUR', values: [500, 200, 100, 50, 20, 10, 5], type: 'BILL' }
    ];
    const insertDen = db.prepare('INSERT OR IGNORE INTO Cat_Denominaciones (currency, denominacion, type) VALUES (?, ?, ?)');
    const insertInv = db.prepare('INSERT OR IGNORE INTO Inventario_Boveda_Detalle (currency, denominacion, quantity) VALUES (?, ?, ?)');
    
    denoms.forEach(d => {
      d.values.forEach(v => {
        insertDen.run(d.currency, v, d.type);
        // Start with some inventory for demo
        insertInv.run(d.currency, v, 1000); 
      });
    });
  }

  // --- CORE ERP CONTABLE (Partida Doble) ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS Accounting_Accounts (
      account_code TEXT PRIMARY KEY,
      account_name TEXT NOT NULL,
      account_type TEXT NOT NULL, -- Activo, Pasivo, Capital, Ingreso, Egreso
      balance NUMERIC(18,8) DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS Accounting_Journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id TEXT, -- Referencia a Operacion_ID
      date DATETIME DEFAULT CURRENT_TIMESTAMP,
      account_code TEXT,
      description TEXT,
      debit NUMERIC(18,8) DEFAULT 0,
      credit NUMERIC(18,8) DEFAULT 0,
      FOREIGN KEY(account_code) REFERENCES Accounting_Accounts(account_code)
    );

    -- --- INVENTARIO FIFO (PEPS) ---
    CREATE TABLE IF NOT EXISTS Inventory_Batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      currency_code TEXT NOT NULL,
      quantity NUMERIC(18,8) NOT NULL,
      remaining_quantity NUMERIC(18,8) NOT NULL,
      cost_basis NUMERIC(18,8) NOT NULL, -- Precio de compra original
      reference_op_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
 
    -- --- MÓDULO DE ALIADOS & COMISIONISTAS EVOLUCIONADO ---
    CREATE TABLE IF NOT EXISTS Partners (
      partner_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      partner_code TEXT UNIQUE, -- Ej: M001
      is_wholesale INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
 
    CREATE TABLE IF NOT EXISTS Affiliate_Pre_Registros (
      ticket_code TEXT PRIMARY KEY, -- Ej: TICKET-1234
      partner_id TEXT,
      affiliate_code TEXT,
      amount_usd NUMERIC(18,8) NOT NULL,
      customer_name TEXT,
      status TEXT DEFAULT 'PENDIENTE', -- PENDIENTE, LIQUIDADO, CANCELADO
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(partner_id) REFERENCES Partners(partner_id)
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
 
    CREATE TABLE IF NOT EXISTS Aliado_Comisiones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id TEXT,
      operation_id TEXT,
      ticket_code TEXT,
      amount_usd NUMERIC(18,8),
      commission_per_usd NUMERIC(18,8),
      total_commission_mxn NUMERIC(18,8),
      spread_mxn NUMERIC(18,8) DEFAULT 0,
      status TEXT DEFAULT 'PENDING',
      accrued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(partner_id) REFERENCES Partners(partner_id)
    );

    CREATE TABLE IF NOT EXISTS Partner_Recolecciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id TEXT,
      packages_count INTEGER,
      safety_seals TEXT,
      photo_url TEXT,
      status TEXT DEFAULT 'Efectivo en Tránsito', -- Efectivo en Tránsito, Completado, Rechazado
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(partner_id) REFERENCES Partners(partner_id)
    );

    CREATE TABLE IF NOT EXISTS Partner_Cortes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id TEXT,
      amount_usd NUMERIC(18,8) NOT NULL,
      commission_rate NUMERIC(18,8),
      commission_mxn NUMERIC(18,8),
      status TEXT DEFAULT 'LIQUIDADO_CORTE', -- LIQUIDADO_CORTE, PENDIENTE
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(partner_id) REFERENCES Partners(partner_id)
    );
 
    -- --- ADAPTADOR DE CUMPLIMIENTO (RIP/CNBV) ---
    CREATE TABLE IF NOT EXISTS Compliance_Profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id TEXT,
      risk_level TEXT,
      kyc_status TEXT,
      id_file_path TEXT,
      address_proof_path TEXT,
      last_review DATETIME
    );

    -- --- MÓDULO DE APERTURA Y CONTROL DE TURNOS ---
    CREATE TABLE IF NOT EXISTS shift_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cajero_id TEXT NOT NULL,
      nickname TEXT,
      hora_apertura DATETIME DEFAULT CURRENT_TIMESTAMP,
      hora_cierre DATETIME,
      saldo_declarado_json TEXT NOT NULL, -- JSON de conteo físico por denominación y totales
      saldo_esperado_json TEXT NOT NULL,  -- JSON de saldos esperados en base de datos
      desviaciones_json TEXT,             -- JSON de desviaciones calculadas por divisa
      cierre_declarado_json TEXT,         -- Conteo físico al cierre de turno
      cierre_esperado_json TEXT,          -- Saldos esperados contablemente al cierre
      cierre_desviaciones_json TEXT,       -- Desviaciones al cierre
      pdf_report_url TEXT,                -- URL/Ruta del PDF de corte
      status TEXT DEFAULT 'OPEN',         -- 'OPEN', 'PENDING_AUTHORIZATION', 'CLOSED', 'PENDING_CLOSE_AUTHORIZATION'
      folio_documento TEXT NOT NULL UNIQUE,
      authorized_by TEXT,
      authorization_date DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cash_deviations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id INTEGER NOT NULL,
      sucursal_id TEXT NOT NULL,
      cajero_id TEXT NOT NULL,
      type TEXT NOT NULL, -- 'APERTURA' or 'CIERRE'
      currency TEXT NOT NULL,
      expected_amount REAL NOT NULL,
      declared_amount REAL NOT NULL,
      difference REAL NOT NULL,
      status TEXT DEFAULT 'PENDING', -- 'PENDING', 'AUTHORIZED'
      authorized_by TEXT,
      authorization_date DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (shift_id) REFERENCES shift_logs(id)
    );

    CREATE TABLE IF NOT EXISTS caja_gastos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sucursal_id TEXT NOT NULL,
      shift_id INTEGER,
      concept TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      authorized_by TEXT,
      receipt_image_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (shift_id) REFERENCES shift_logs(id)
    );
  `);

  // Inicializar Catálogo de Cuentas Básico si está vacío
  const checkAccounts = db.prepare('SELECT count(*) as count FROM Accounting_Accounts').get() as { count: number };
  if (checkAccounts.count === 0) {
    const accounts = [
      ['1101', 'Caja y Bóveda (Efectivo)', 'Activo'],
      ['1102', 'Bancos P2P/Digitales', 'Activo'],
      ['1201', 'Inventario Divisas (Costo)', 'Activo'],
      ['2101', 'Cuentas por Pagar Aliados', 'Pasivo'],
      ['4101', 'Ingreso por Spread Cambiario', 'Ingreso'],
      ['4102', 'Ingreso por Comisiones', 'Ingreso'],
      ['5101', 'Costo de Ventas (FIFO)', 'Egreso'],
      ['5201', 'Pérdida por Revaluación', 'Egreso']
    ];
    const stmt = db.prepare('INSERT INTO Accounting_Accounts (account_code, account_name, account_type) VALUES (?, ?, ?)');
    accounts.forEach(acc => stmt.run(acc[0], acc[1], acc[2]));
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS User_Profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      auth_user_id TEXT UNIQUE,
      nickname TEXT NOT NULL,
      puesto TEXT,
      role_level INTEGER DEFAULT 1,
      branch_id TEXT DEFAULT 'MAIN_BRANCH',
      custom_permissions TEXT,
      is_active INTEGER DEFAULT 1,
      last_login DATETIME,
      hire_date DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS hr_vault_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      curp TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      puesto TEXT,
      sucursal TEXT,
      sueldo_mensual REAL,
      metadata_json TEXT,
      documents_json TEXT,
      created_by TEXT,
      is_finalized INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_sucursales_matriz_unica ON sucursales(es_matriz) WHERE es_matriz = 1;
  `);

  // Migration: Add password_hash column if it doesn't exist
  try {
    db.prepare("ALTER TABLE User_Profiles ADD COLUMN password_hash TEXT").run();
    console.log("[Migration] Added password_hash to User_Profiles");
  } catch (e) {
    // Column already exists
  }

  // Set default password for existing mock users (password: "123456")
  const defaultHash = createHash('sha256').update('123456').digest('hex');
  try {
    db.prepare("UPDATE User_Profiles SET password_hash = ? WHERE password_hash IS NULL").run(defaultHash);
  } catch (e) {
    // skip if update fails
  }

  // Migration: Add es_matriz column if it doesn't exist
  try {
    db.prepare("ALTER TABLE sucursales ADD COLUMN es_matriz INTEGER DEFAULT 0").run();
  } catch (e) {
    // Column already exists
  }

  // Migration: Add saldo_minimo column if it doesn't exist
  try {
    db.prepare("ALTER TABLE sucursales ADD COLUMN saldo_minimo NUMERIC(18,8) DEFAULT 100000.00").run();
  } catch (e) {
    // Column already exists
  }

  // Initialize MAIN_BRANCH if not present
  const branchCount = db.prepare('SELECT COUNT(*) as count FROM sucursales WHERE sucursal_id = ?').get('MAIN_BRANCH') as { count: number };
  if (branchCount.count === 0) {
    db.prepare(`
      INSERT INTO sucursales (
        sucursal_id, razon_social, nombre, rfc, calle, numero, colonia, ciudad, codigo_postal, telefono, email, licencia_cnbv, logo_url, es_matriz
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'MAIN_BRANCH',
      'FINTECH SOLUTIONS S.A. DE C.V.',
      'Sucursal Matriz - Centro',
      'FSO121205ABC',
      'Av. Paseo de la Reforma',
      '222',
      'Juárez',
      'Ciudad de México',
      '06600',
      '5555555555',
      'matriz@fintechsolutions.mx',
      'CNBV-LIC-100293-2024',
      '',
      1
    );
  } else {
    // Ensure MAIN_BRANCH has es_matriz set to 1
    try {
      db.prepare("UPDATE sucursales SET es_matriz = 1 WHERE sucursal_id = 'MAIN_BRANCH'").run();
    } catch (e) {
      console.error("Error setting MAIN_BRANCH es_matriz:", e);
    }
  }


  // Insertar/Asegurar Usuarios de Prueba con permisos frescos
  const defaultPermissions = JSON.stringify({
    tc_limit: 2.5,
    can_cancel: false,
    show_vault_balance: false
  });

  const adminPermissions = JSON.stringify({
    tc_limit: 100,
    can_cancel: true,
    show_vault_balance: true
  });

  const upsertUser = db.prepare(`
    INSERT OR REPLACE INTO User_Profiles (auth_user_id, nickname, puesto, role_level, branch_id, custom_permissions, password_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // FIX P0 #2 (auditoria 20260903): antes INSERT OR REPLACE con hash SHA-256,
  // lo que PISABA el hash bcrypt de usuarios existentes en cada arranque,
  // dejandolos sin login (verifyPassword usa solo bcrypt.compare).
  // Ahora: INSERT con hash bcrypt verificado; ON CONFLICT solo actualiza
  // metadatos si el usuario aun no tiene contrasena (preserva hashes existentes).
  const cajeroHash = '$2b$12$7al3nbC//44VWvpN3uxl3eJNEeYBbJDDajRWiSw3egRNxAmjugLte'; // bcrypt('123456') 12 rounds
  const seedUser = db.prepare(`
    INSERT INTO User_Profiles (auth_user_id, nickname, puesto, role_level, branch_id, custom_permissions, password_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(auth_user_id) DO UPDATE SET
      nickname = excluded.nickname,
      puesto = excluded.puesto,
      role_level = excluded.role_level,
      custom_permissions = excluded.custom_permissions
    WHERE User_Profiles.password_hash IS NULL
  `);
  seedUser.run('user_cajero_1', 'FREDDY', 'Super Administrador', 5, 'MAIN_BRANCH', adminPermissions, cajeroHash);
  seedUser.run('user_gerente_1', 'ADMIN_MASTER', 'Gerente de Sucursal', 5, 'MAIN_BRANCH', adminPermissions, cajeroHash);

  // Migration for hire_date
  try {
    db.prepare('ALTER TABLE User_Profiles ADD COLUMN hire_date DATE').run();
  } catch (e) {}

  // Migrations for shift_logs close-related columns
  try {
    const shiftCols = db.prepare(`PRAGMA table_info(shift_logs)`).all() as any[];
    const shiftColNames = shiftCols.map(c => c.name);
    if (!shiftColNames.includes('cierre_declarado_json')) {
      db.exec(`ALTER TABLE shift_logs ADD COLUMN cierre_declarado_json TEXT`);
    }
    if (!shiftColNames.includes('cierre_esperado_json')) {
      db.exec(`ALTER TABLE shift_logs ADD COLUMN cierre_esperado_json TEXT`);
    }
    if (!shiftColNames.includes('cierre_desviaciones_json')) {
      db.exec(`ALTER TABLE shift_logs ADD COLUMN cierre_desviaciones_json TEXT`);
    }
    if (!shiftColNames.includes('pdf_report_url')) {
      db.exec(`ALTER TABLE shift_logs ADD COLUMN pdf_report_url TEXT`);
    }
  } catch (e) {
    console.error("Migration for shift_logs columns failed:", e);
  }

  // Migrations for missing columns in existing tables
  const tablesToMigrate = ['Operaciones_Captacion', 'Operaciones_Liquidacion_P2P'];
  tablesToMigrate.forEach(table => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    const columnNames = columns.map((c: any) => c.name);

    if (!columnNames.includes('customer_id')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN customer_id TEXT`);
    }
    if (!columnNames.includes('branch_id')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN branch_id TEXT DEFAULT 'MAIN_BRANCH'`);
    }
    if (!columnNames.includes('currency_out')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN currency_out TEXT NOT NULL DEFAULT 'MXN'`);
    }
    if (!columnNames.includes('amount_out')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN amount_out REAL NOT NULL DEFAULT 0`);
    }
    if (!columnNames.includes('method_out')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN method_out TEXT NOT NULL DEFAULT 'CASH'`);
    }
    if (!columnNames.includes('rate')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN rate REAL NOT NULL DEFAULT 1`);
    }
    if (!columnNames.includes('markup')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN markup REAL NOT NULL DEFAULT 0`);
    }
    if (!columnNames.includes('settlement_status')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN settlement_status TEXT DEFAULT 'PENDING'`);
    }
    
    // Transfer traceability columns
    if (table === 'Operaciones_Captacion' || table === 'Operaciones_Liquidacion_P2P') {
      if (!columnNames.includes('transfer_bank_name')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN transfer_bank_name TEXT`);
      }
      if (!columnNames.includes('transfer_account_number')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN transfer_account_number TEXT`);
      }
      if (!columnNames.includes('transfer_payer_name')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN transfer_payer_name TEXT`);
      }
      if (!columnNames.includes('transfer_date')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN transfer_date TEXT`);
      }
      if (!columnNames.includes('transfer_tracking_id')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN transfer_tracking_id TEXT`);
      }
      if (!columnNames.includes('transfer_txid')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN transfer_txid TEXT`);
      }
      if (!columnNames.includes('transfer_receipt_url')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN transfer_receipt_url TEXT`);
      }
    }
  });

  // Migration for Liquidacion_Tickets
  const ticketColumns = db.prepare(`PRAGMA table_info(Liquidacion_Tickets)`).all();
  const ticketColumnNames = ticketColumns.map((c: any) => c.name);
  if (!ticketColumnNames.includes('customer_id')) {
    db.exec(`ALTER TABLE Liquidacion_Tickets ADD COLUMN customer_id TEXT`);
  }
  if (!ticketColumnNames.includes('transfer_receipt_url')) {
    db.exec(`ALTER TABLE Liquidacion_Tickets ADD COLUMN transfer_receipt_url TEXT`);
  }

  // Migration for Affiliate_Pre_Registros (affiliate_code link)
  try {
    const preRegColumns = db.prepare(`PRAGMA table_info(Affiliate_Pre_Registros)`).all() as any[];
    const preRegColumnNames = preRegColumns.map(c => c.name);
    if (!preRegColumnNames.includes('affiliate_code')) {
      db.exec(`ALTER TABLE Affiliate_Pre_Registros ADD COLUMN affiliate_code TEXT`);
    }
  } catch (e) {
    console.error("Migration for affiliate_code column in Affiliate_Pre_Registros failed:", e);
  }

  // Migration for Aliado_Comisiones (spread_mxn column)
  try {
    const commColumns = db.prepare(`PRAGMA table_info(Aliado_Comisiones)`).all() as any[];
    const commColumnNames = commColumns.map(c => c.name);
    if (!commColumnNames.includes('spread_mxn')) {
      db.exec(`ALTER TABLE Aliado_Comisiones ADD COLUMN spread_mxn NUMERIC(18,8) DEFAULT 0`);
    }
  } catch (e) {
    console.error("Migration for spread_mxn column in Aliado_Comisiones failed:", e);
  }

  // Ensure fx_transactions is created during migration
  try {
    db.exec(`
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (e) {
    console.error("Migration to create fx_transactions table failed:", e);
  }

  // Ensure operadores, cajas, caja_dotaciones, and inventario_caja_detalle tables and triggers exist
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS operadores (
        id TEXT PRIMARY KEY,
        nombre TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        nivel_autorizacion INTEGER DEFAULT 2, -- 2 = Cajero, 5 = Gerente
        branch_id TEXT DEFAULT 'MAIN_BRANCH',
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS cajas (
        cajero_id TEXT PRIMARY KEY,
        saldo_actual_mxn NUMERIC(18,8) DEFAULT 0,
        sucursal_id TEXT,
        last_update DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS inventario_caja_detalle (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cajero_id TEXT NOT NULL,
        currency TEXT NOT NULL,
        denominacion REAL NOT NULL,
        quantity INTEGER DEFAULT 0,
        last_update DATETIME DEFAULT CURRENT_TIMESTAMP,
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed default table operadores if empty
    const checkOperadores = db.prepare('SELECT COUNT(*) as count FROM operadores').get() as { count: number };
    if (checkOperadores.count === 0) {
      const insertOp = db.prepare('INSERT INTO operadores (id, nombre, username, nivel_autorizacion, branch_id) VALUES (?, ?, ?, ?, ?)');
      insertOp.run('user_cajero_1', 'Cajero Polanco', 'cajero_polanco', 2, 'MAIN_BRANCH');
      insertOp.run('user_cajero_2', 'Cajera Santa Fe', 'cajera_santa_fe', 2, 'SANTA_FE');
      insertOp.run('user_gerente_1', 'Gerente General', 'gerente_general', 5, 'MAIN_BRANCH');
      insertOp.run('user_gerente_2', 'Supervisor Liquidez', 'supervisor_liquidez', 5, 'MAIN_BRANCH');
      console.log("Seeded default table operadores successfully");
    }

    // Safety check to alter existing table if column is missing
    const dotacionesColumns = db.prepare(`PRAGMA table_info(caja_dotaciones)`).all();
    const dotacionesColumnNames = dotacionesColumns.map((c: any) => c.name);
    if (!dotacionesColumnNames.includes('desglose_json')) {
      db.exec(`ALTER TABLE caja_dotaciones ADD COLUMN desglose_json TEXT`);
    }

    // SQLite Trigger to execute on dotation approval (APLICADO)
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS tr_caja_dotaciones_aplicar
      AFTER UPDATE OF estatus ON caja_dotaciones
      WHEN NEW.estatus = 'APLICADO' AND OLD.estatus = 'PENDIENTE'
      BEGIN
        -- Incrementar el saldo_actual_mxn en cajas
        INSERT INTO cajas (cajero_id, saldo_actual_mxn, last_update)
        VALUES (NEW.cajero_id, NEW.monto_mxn, CURRENT_TIMESTAMP)
        ON CONFLICT(cajero_id) DO UPDATE SET
          saldo_actual_mxn = saldo_actual_mxn + NEW.monto_mxn,
          last_update = CURRENT_TIMESTAMP;

        -- Generar asientos en Accounting_Journal (1001: Cuenta operativa cajero, 1000: Cuenta resguardo)
        INSERT INTO Accounting_Journal (transaction_id, account_code, description, debit, credit, date)
        VALUES (
          'DOT-' || NEW.id,
          '1001',
          'CARGO por dotacion ' || NEW.tipo_dotacion || ' - Folio Boveda: ' || COALESCE(NEW.folio_boveda, 'N/A') || ' - Ref: ' || NEW.id,
          NEW.monto_mxn,
          0,
          CURRENT_TIMESTAMP
        );

        INSERT INTO Accounting_Journal (transaction_id, account_code, description, debit, credit, date)
        VALUES (
          'DOT-' || NEW.id,
          '1000',
          'ABONO por dotacion ' || NEW.tipo_dotacion || ' - Folio Boveda: ' || COALESCE(NEW.folio_boveda, 'N/A') || ' - Ref: ' || NEW.id,
          0,
          NEW.monto_mxn,
          CURRENT_TIMESTAMP
        );

        -- Actualizar balances de cuentas
        UPDATE Accounting_Accounts SET balance = balance + NEW.monto_mxn WHERE account_code = '1001';
        UPDATE Accounting_Accounts SET balance = balance - NEW.monto_mxn WHERE account_code = '1000';
      END;
    `);

    // Ensure accounting accounts 1000 and 1001 exist
    db.prepare(`INSERT OR IGNORE INTO Accounting_Accounts (account_code, account_name, account_type, balance) VALUES (?, ?, ?, ?)`).run('1000', 'Cuenta de Resguardo/Boveda', 'Activo', 10000000);
    db.prepare(`INSERT OR IGNORE INTO Accounting_Accounts (account_code, account_name, account_type, balance) VALUES (?, ?, ?, ?)`).run('1001', 'Cuenta Operativa de Cajero', 'Activo', 0);
    
    console.log("Cajas, caja_dotaciones tables, triggers and accounts initialized successfully.");
  } catch (e) {
    console.error("Migration to create cajas/caja_dotaciones failed:", e);
  }

  // Migration for Customers is_vip and advanced KYC/B2B properties
  const customerColumns = db.prepare(`PRAGMA table_info(Customers)`).all();
  const customerColumnNames = customerColumns.map((c: any) => c.name);
  if (!customerColumnNames.includes('is_vip')) {
    db.exec(`ALTER TABLE Customers ADD COLUMN is_vip INTEGER DEFAULT 0`);
  }
  if (!customerColumnNames.includes('client_type')) {
    db.exec(`ALTER TABLE Customers ADD COLUMN client_type TEXT DEFAULT 'PHYSICAL'`);
  }
  if (!customerColumnNames.includes('first_name')) {
    db.exec(`ALTER TABLE Customers ADD COLUMN first_name TEXT`);
  }
  if (!customerColumnNames.includes('last_name')) {
    db.exec(`ALTER TABLE Customers ADD COLUMN last_name TEXT`);
  }
  if (!customerColumnNames.includes('rfc_curp')) {
    db.exec(`ALTER TABLE Customers ADD COLUMN rfc_curp TEXT`);
  }
  if (!customerColumnNames.includes('official_id_url')) {
    db.exec(`ALTER TABLE Customers ADD COLUMN official_id_url TEXT`);
  }
  if (!customerColumnNames.includes('razon_social')) {
    db.exec(`ALTER TABLE Customers ADD COLUMN razon_social TEXT`);
  }
  if (!customerColumnNames.includes('company_rfc')) {
    db.exec(`ALTER TABLE Customers ADD COLUMN company_rfc TEXT`);
  }
  if (!customerColumnNames.includes('business_line')) {
    db.exec(`ALTER TABLE Customers ADD COLUMN business_line TEXT`);
  }
  if (!customerColumnNames.includes('legal_rep_name')) {
    db.exec(`ALTER TABLE Customers ADD COLUMN legal_rep_name TEXT`);
  }
  if (!customerColumnNames.includes('legal_rep_id')) {
    db.exec(`ALTER TABLE Customers ADD COLUMN legal_rep_id TEXT`);
  }
  if (!customerColumnNames.includes('is_b2b')) {
    db.exec(`ALTER TABLE Customers ADD COLUMN is_b2b INTEGER DEFAULT 0`);
  }
  if (!customerColumnNames.includes('acta_constitutiva_url')) {
    db.exec(`ALTER TABLE Customers ADD COLUMN acta_constitutiva_url TEXT`);
  }
  if (!customerColumnNames.includes('comprobante_domicilio_url')) {
    db.exec(`ALTER TABLE Customers ADD COLUMN comprobante_domicilio_url TEXT`);
  }

  // Ensure Wallets table exists (redundant but safe for migrations)
  db.exec(`
    CREATE TABLE IF NOT EXISTS Wallets (
      id TEXT PRIMARY KEY,
      customer_id TEXT UNIQUE,
      balance_mxn REAL DEFAULT 0,
      balance_usd REAL DEFAULT 0,
      balance_usdt REAL DEFAULT 0,
      status TEXT DEFAULT 'ACTIVE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES Customers(id)
    );
  `);

  // --- SEGURIDAD FINANCIERA: MONITOREO DE SALDOS Y BLOQUEO ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS security_thresholds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Add branch_id to Inventory_Batches if not present
  try {
    db.prepare("ALTER TABLE Inventory_Batches ADD COLUMN branch_id TEXT DEFAULT 'MAIN_BRANCH'").run();
  } catch (e) {
    // Already exists
  }

  // Seed default thresholds if empty
  const thresholdCount = db.prepare('SELECT COUNT(*) as count FROM security_thresholds').get() as { count: number };
  if (thresholdCount.count === 0) {
    const insertThreshold = db.prepare('INSERT OR IGNORE INTO security_thresholds (sucursal_id, divisa, monto_maximo) VALUES (?, ?, ?)');
    insertThreshold.run('MAIN_BRANCH', 'USD', 5000.0); // 5,000 USD limit
    insertThreshold.run('MAIN_BRANCH', 'EUR', 3000.0); // 3,000 EUR limit
    insertThreshold.run('MAIN_BRANCH', 'USDT', 8000.0); // 8,000 USDT limit
    console.log("Seeded default security thresholds");
  }

  // Seed default terminal if empty
  const terminalCount = db.prepare('SELECT COUNT(*) as count FROM terminales WHERE terminal_id = ?').get('TERM-MAIN_BRANCH') as { count: number };
  if (terminalCount.count === 0) {
    db.prepare("INSERT INTO terminales (terminal_id, sucursal_id, terminal_locked, warning_count) VALUES (?, ?, ?, ?)")
      .run('TERM-MAIN_BRANCH', 'MAIN_BRANCH', 0, 0);
    console.log("Seeded default terminal for MAIN_BRANCH");
  }

  // --- VIEWS PARA EL GLOBAL LIQUIDITY HUB (COMPATIBLES CON PG Y SQLITE) ---
  try {
    db.exec(`DROP VIEW IF EXISTS vw_saldos_totales_por_divisa;`);
    db.exec(`
      CREATE VIEW vw_saldos_totales_por_divisa AS
      SELECT 
        currency_code AS currency,
        SUM(remaining_quantity) AS total_batches_quantity,
        SUM(remaining_quantity * cost_basis) AS total_batches_value_mxn,
        COUNT(id) AS active_batches_count
      FROM Inventory_Batches
      WHERE remaining_quantity > 0
      GROUP BY currency_code;
    `);
    console.log("View vw_saldos_totales_por_divisa created successfully.");
  } catch (e) {
    console.error("Error creating view vw_saldos_totales_por_divisa:", e);
  }

  try {
    db.exec(`DROP VIEW IF EXISTS vw_saldos_fisicos_por_sucursal;`);
    db.exec(`
      CREATE VIEW vw_saldos_fisicos_por_sucursal AS
      SELECT 
        branch_id AS sucursal_id,
        currency,
        SUM(denominacion * quantity) AS total_physical_balance,
        MAX(last_update) AS last_update
      FROM Inventario_Boveda_Detalle
      GROUP BY branch_id, currency;
    `);
    console.log("View vw_saldos_fisicos_por_sucursal created successfully.");
  } catch (e) {
    console.error("Error creating view vw_saldos_fisicos_por_sucursal:", e);
  }

  // --- COMPLIANCE AND AML TABLES (OFAC, PEP, CNBV, SAT 69-B) ---
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS lista_ofac (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre_completo TEXT NOT NULL,
        motivo TEXT,
        tipo_coincidencia TEXT NOT NULL, -- 'RED' (Hit confirmado) or 'AMARILLO' (Posible homónimo)
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS lista_pep (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre_completo TEXT NOT NULL,
        cargo TEXT,
        tipo_coincidencia TEXT NOT NULL, -- 'RED' or 'AMARILLO'
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS lista_cnbv (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre_completo TEXT NOT NULL,
        resolucion TEXT,
        tipo_coincidencia TEXT NOT NULL, -- 'RED' or 'AMARILLO'
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS lista_sat (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre_completo TEXT NOT NULL,
        situacion TEXT,
        tipo_coincidencia TEXT NOT NULL, -- 'RED' or 'AMARILLO'
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS authorization_logs (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        client_name TEXT NOT NULL,
        amount_usd REAL,
        reason TEXT NOT NULL, -- 'UMBRAL_LIMITE_5000', 'LISTA_NEGRA_OFAC', etc.
        requested_by TEXT NOT NULL, -- Cajero ID
        authorized_by TEXT, -- Oficial ID
        passcode TEXT NOT NULL, -- 9 character passcode (3 letters, 6 numbers)
        status TEXT DEFAULT 'PENDING', -- 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL, -- 30 minutes after creation
        used_at DATETIME,
        transaction_id TEXT
      );

      CREATE TABLE IF NOT EXISTS reportes_aml (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL, -- 'RELEVANTE' (>= 7500 USD equivalent or general relevant), 'INUSUAL' (triggered by high-risk actions, homonyms, or bypass), 'PREOCUPANTE'
        client_id TEXT NOT NULL,
        client_name TEXT NOT NULL,
        amount_usd REAL,
        description TEXT,
        oficial_id TEXT, -- ID of compliance officer who authorized or reviewed
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed Blacklists if empty
    const checkOfac = db.prepare('SELECT COUNT(*) as count FROM lista_ofac').get() as { count: number };
    if (checkOfac.count === 0) {
      // OFAC Seeding
      const insertOfac = db.prepare('INSERT INTO lista_ofac (nombre_completo, motivo, tipo_coincidencia) VALUES (?, ?, ?)');
      insertOfac.run('Joaquín Guzmán Loera', 'Narcotráfico - Cartel de Sinaloa', 'RED');
      insertOfac.run('Ayman al-Zawahiri', 'Terrorismo Internacional Al-Qaeda', 'RED');
      insertOfac.run('John Smith OFAC', 'Financiamiento al Terrorismo', 'RED');
      insertOfac.run('Juan Manuel Gómez', 'Coincidencia parcial con persona sancionada en OFAC SDN', 'AMARILLO');

      // PEP Seeding
      const insertPep = db.prepare('INSERT INTO lista_pep (nombre_completo, cargo, tipo_coincidencia) VALUES (?, ?, ?)');
      insertPep.run('Andrés Manuel López Obrador', 'Ex-Presidente de la República (México)', 'RED');
      insertPep.run('Claudia Sheinbaum Pardo', 'Presidenta de la República (México)', 'RED');
      insertPep.run('Enrique Peña Nieto', 'Ex-Presidente de la República (México)', 'RED');
      insertPep.run('Luis Gerardo Ramírez', 'Posible familiar de Gobernador Estatal (Coincidencia de apellidos)', 'AMARILLO');

      // CNBV Seeding
      const insertCnbv = db.prepare('INSERT INTO lista_cnbv (nombre_completo, resolucion, tipo_coincidencia) VALUES (?, ?, ?)');
      insertCnbv.run('Jose CNBV Bloqueado', 'Resolución de congelamiento de cuentas CNBV/UIF-2025', 'RED');
      insertCnbv.run('Inverfin Scammer', 'Fraude piramidal y captación ilegal', 'RED');
      insertCnbv.run('Carlos Slim Helú', 'Persona con cargo relevante en sector financiero supervisado', 'AMARILLO');

      // SAT 69-B Seeding
      const insertSat = db.prepare('INSERT INTO lista_sat (nombre_completo, situacion, tipo_coincidencia) VALUES (?, ?, ?)');
      insertSat.run('SAT Facturera S.A.', 'Empresa que factura operaciones simuladas (EFOS) Art. 69-B', 'RED');
      insertSat.run('SAT Deudor Delincuente', 'Créditos fiscales firmes y no pagados', 'RED');
      insertSat.run('Juan Pérez SAT', 'Sujeto a auditoría fiscal por discrepancia', 'AMARILLO');

      console.log("Seeded default AML Blacklists (OFAC, PEP, CNBV, SAT 69-B) successfully");
    }

  } catch (err) {
    console.error("Error setting up compliance and AML tables:", err);
  }

}

// ═══════════════════════════════════════════════════════════════════════════
// FIX P0 #1 (auditoria 20260903): Runner de migraciones SQL.
// Antes: los .sql de src/migrations/ NUNCA se aplicaban al arrancar (solo los
// tests los usaban via vitest.setup.ts). Una DB nueva no tenia las columnas
// de seguridad -> login 500 (no such column: failed_login_attempts).
// Ahora: se aplican al arranque, statement por statement, idempotente:
// errores de "duplicate column"/"already exists" se ignoran; cualquier otro
// error se reporta pero NO detiene el arranque.
// ═══════════════════════════════════════════════════════════════════════════
function applySqlMigrations() {
  const migrationsDir = path.join(process.cwd(), 'src', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.warn('[Migrations] Directorio src/migrations no encontrado, se omite');
    return;
  }
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort(); // orden lexicografico: 001, 002, 003...
  for (const file of files) {
    const sqlText = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    // Separar statements respetando BEGIN...END de triggers: split por ';'
    // seguido de newline, y filtrar lineas de comentario sueltas
    // Separar statements respetando bloques BEGIN...END de triggers:
    // un ';' SOLO cierra statement si no estamos dentro de un BEGIN...END.
    const statements: string[] = [];
    let current = '';
    let depth = 0;
    for (const line of sqlText.split('\n')) {
      const stripped = line.replace(/^(\s*--[^\n]*)$/, '').trim();
      current += line + '\n';
      const ups = (line.match(/\bBEGIN\b/gi) || []).length;
      const downs = (line.match(/\bEND\b/gi) || []).length;
      depth += ups - downs;
      // contar ';' solo si depth==0 (fuera de trigger body)
      const semi = (line.match(/;/g) || []).length;
      if (depth <= 0 && semi > 0) {
        const clean = current.replace(/^(\s*--[^\n]*\n)+/g, '').trim();
        if (clean.length > 0) statements.push(clean);
        current = '';
        depth = Math.max(0, depth);
      }
    }
    const tail = current.replace(/^(\s*--[^\n]*\n)+/g, '').trim();
    if (tail.length > 0) statements.push(tail);
    let applied = 0, skipped = 0;
    for (const stmt of statements) {
      try {
        db.exec(stmt);
        applied++;
      } catch (e: any) {
        const msg = String(e.message || '');
        if (msg.includes('duplicate column') || msg.includes('already exists')) {
          skipped++; // idempotente: ya aplicado
        } else {
          console.warn(`[Migrations] ${file}: statement omitido — ${msg}`);
        }
      }
    }
    console.log(`[Migrations] ${file}: ${applied} aplicados, ${skipped} ya existentes`);
  }
}

try {
  runMigrationsAndSetup();
  applySqlMigrations();
} catch (error: any) {
  console.error("Error creating tables or migrating:", error);
  if (error && error.message && (error.message.includes("malformed") || error.message.includes("corrupt"))) {
    console.warn("Database malformed during schema setup. Resetting database file...");
    try {
      if (db) db.close();
    } catch (e) {}
    if (fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath);
        console.log("Deleted corrupted database file.");
      } catch (e) {}
    }
    try {
      db = new Database(dbPath);
      runMigrationsAndSetup();
      console.log("Database successfully reset and rebuilt.");
    } catch (e) {
      console.error("Failed to rebuild database, falling back to in-memory:", e);
      db = new Database(":memory:");
      try {
        runMigrationsAndSetup();
      } catch (innerErr) {
        console.error("Even in-memory database setup failed:", innerErr);
      }
    }
  }
}

} // end SQLite mode

export default db;
