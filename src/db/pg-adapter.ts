/**
 * PostgreSQL Sync Adapter — wraps a pre-connected pg client with deasync
 * to provide a synchronous API identical to better-sqlite3.
 *
 * The client is pre-connected asynchronously during init; all subsequent
 * queries run synchronously via deasync.loopWhile. This works because
 * query I/O on an established connection is processed by the nested
 * event loop, unlike initial connection establishment.
 */

import { Pool, PoolClient } from 'pg';
import * as deasync from 'deasync';
import * as fs from 'fs';
import * as path from 'path';

let pool: Pool | null = null;
let client: PoolClient | null = null;

/**
 * Convert SQLite-flavour SQL to PostgreSQL:
 * 1. INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
 * 2. INSERT OR REPLACE (Inventario_Boveda_Detalle) → ON CONFLICT DO UPDATE
 * 3. Double-quoted string literals → single-quoted
 * 4. ? placeholders → $N
 * 5. DATETIME → TIMESTAMP (for DDL)
 */
function convertSql(sql: string): string {
  let result = sql;

  let appendOnConflictNothing = false;
  let appendOnConflictUpdate = false;

  if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(result)) {
    appendOnConflictNothing = true;
    result = result.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
  }

  if (/INSERT\s+OR\s+REPLACE\s+INTO\s+Inventario_Boveda_Detalle/i.test(result)) {
    appendOnConflictUpdate = true;
    result = result.replace(
      /INSERT\s+OR\s+REPLACE\s+INTO\s+Inventario_Boveda_Detalle/gi,
      'INSERT INTO Inventario_Boveda_Detalle'
    );
  }

  // Double-quoted strings → single-quoted
  result = result.replace(/"([^"]*)"/g, "'$1'");

  // DATETIME → TIMESTAMP
  result = result.replace(/\bDATETIME\b/gi, 'TIMESTAMP');

  // ? → $N
  let idx = 0;
  result = result.replace(/\?/g, () => `$${++idx}`);

  // Append ON CONFLICT clauses
  result = result.replace(/;?\s*$/, '');
  if (appendOnConflictNothing) {
    result += ' ON CONFLICT DO NOTHING';
  }
  if (appendOnConflictUpdate) {
    result += ' ON CONFLICT (branch_id, currency, denominacion) DO UPDATE SET quantity = EXCLUDED.quantity, last_update = EXCLUDED.last_update';
  }

  return result;
}

function syncQuery(sql: string, params: any[] = []): any {
  if (!client) throw new Error('[PG] Client not initialized');
  let result: any, error: any, done = false;
  client.query(sql, params, (err: any, res: any) => {
    error = err;
    result = res;
    done = true;
  });
  deasync.loopWhile(() => !done);
  if (error) throw error;
  return result;
}

class PreparedStatement {
  constructor(private sql: string) {}

  run(...params: any[]): { changes: number; lastInsertRowid: any } {
    const converted = convertSql(this.sql);

    if (/^\s*INSERT\s+INTO/i.test(converted) && !/RETURNING/i.test(converted)) {
      const withReturning = converted + ' RETURNING *';
      try {
        const res = syncQuery(withReturning, params);
        return { changes: res.rowCount, lastInsertRowid: res.rows[0]?.id };
      } catch (e: any) {
        if (String(e.message || '').includes('does not exist')) {
          const res = syncQuery(converted, params);
          return { changes: res.rowCount, lastInsertRowid: undefined };
        }
        throw e;
      }
    }

    const res = syncQuery(converted, params);
    return { changes: res.rowCount, lastInsertRowid: undefined };
  }

  get(...params: any[]): any {
    const converted = convertSql(this.sql);
    const res = syncQuery(converted, params);
    return res.rows[0] || undefined;
  }

  all(...params: any[]): any[] {
    const converted = convertSql(this.sql);
    const res = syncQuery(converted, params);
    return res.rows;
  }
}

export class PgAdapter {
  readonly isPg = true;

  prepare(sql: string): PreparedStatement {
    return new PreparedStatement(sql);
  }

  exec(sql: string): void {
    // Skip SQLite-specific trigger DDL — PG triggers are created in schema setup
    if (/CREATE\s+TRIGGER/i.test(sql) && /BEGIN/i.test(sql)) return;
    if (/DROP\s+TRIGGER\s+IF\s+EXISTS/i.test(sql)) return;

    const converted = convertSql(sql);
    const statements = converted
      .split(/;(?=\s*(?:CREATE|ALTER|INSERT|UPDATE|DELETE|DROP|SELECT|BEGIN|COMMIT|ROLLBACK|SET|COMMENT))/gi)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      try {
        syncQuery(stmt);
      } catch (e: any) {
        if (String(e.message || '').includes('already exists')) continue;
        throw e;
      }
    }
  }

  transaction(fn: (...args: any[]) => any): (...args: any[]) => any {
    return (...args: any[]) => {
      try {
        syncQuery('BEGIN');
        const result = fn(...args);
        syncQuery('COMMIT');
        return result;
      } catch (e) {
        try { syncQuery('ROLLBACK'); } catch {}
        throw e;
      }
    };
  }

  close(): void {
    if (client) { client.release(); client = null; }
    if (pool) { pool.end(); pool = null; }
  }
}

/**
 * Create and initialize a PgAdapter with a pre-connected client.
 * Must be awaited before any sync queries are used.
 */
export async function createPgAdapter(): Promise<PgAdapter> {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
  });
  pool.on('error', (err) => console.error('[PG] Pool error:', err.message));

  client = await pool.connect();
  client.on('error', (err) => console.error('[PG] Client error:', err.message));

  console.log('[PG] Client connected successfully');
  return new PgAdapter();
}

/**
 * Run the PostgreSQL schema setup: create all tables, indexes, triggers,
 * views, and seed initial data. Synchronous (uses deasync with pre-connected client).
 */
export function runPgSchemaSetup(db: PgAdapter): void {
  console.log('[PG] Starting schema setup...');

  const schemaPath = path.join(process.cwd(), 'db', 'pg_schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    const statements: string[] = [];
    let current = '';
    let inDollarQuote = false;
    for (const line of schemaSql.split('\n')) {
      const dollarTags = line.match(/\$\$/g);
      if (dollarTags) inDollarQuote = !inDollarQuote;
      current += line + '\n';
      if (!inDollarQuote && line.trim().endsWith(';')) {
        const clean = current.trim();
        if (clean.length > 0) statements.push(clean);
        current = '';
      }
    }
    const tail = current.trim();
    if (tail.length > 0) statements.push(tail);

    for (const stmt of statements) {
      try {
        syncQuery(convertSql(stmt));
      } catch (e: any) {
        const msg = String(e.message || '');
        if (msg.includes('already exists')) continue;
        console.warn(`[PG] Schema statement skipped: ${msg}`);
      }
    }
  }

  seedPgData(db);
  console.log('[PG] Schema setup complete.');
}

function seedPgData(db: PgAdapter): void {
  const bovedaCount = db.prepare('SELECT COUNT(*) as count FROM Boveda').get() as any;
  if (bovedaCount.count === 0) {
    const ins = db.prepare('INSERT INTO Boveda (id, currency, balance) VALUES ($1, $2, $3)');
    ['MXN', 'USD', 'USDT', 'EUR'].forEach((curr) => ins.run(`BOV-${curr}`, curr, 1000000));
  }

  const denCount = db.prepare('SELECT COUNT(*) as count FROM Cat_Denominaciones').get() as any;
  if (denCount.count === 0) {
    const denoms = [
      { c: 'MXN', v: [1000, 500, 200, 100, 50, 20], t: 'BILL' },
      { c: 'MXN', v: [10, 5, 2, 1, 0.5], t: 'COIN' },
      { c: 'USD', v: [100, 50, 20, 10, 5, 2, 1], t: 'BILL' },
      { c: 'EUR', v: [500, 200, 100, 50, 20, 10, 5], t: 'BILL' },
    ];
    const insDen = db.prepare('INSERT INTO Cat_Denominaciones (currency, denominacion, type) VALUES ($1, $2, $3)');
    const insInv = db.prepare('INSERT INTO Inventario_Boveda_Detalle (currency, denominacion, quantity) VALUES ($1, $2, $3)');
    denoms.forEach((d) => d.v.forEach((v) => { insDen.run(d.c, v, d.t); insInv.run(d.c, v, 1000); }));
  }

  const acctCount = db.prepare('SELECT COUNT(*) as count FROM Accounting_Accounts').get() as any;
  if (acctCount.count === 0) {
    const accounts = [
      ['1101', 'Caja y Bóveda (Efectivo)', 'Activo'],
      ['1102', 'Bancos P2P/Digitales', 'Activo'],
      ['1201', 'Inventario Divisas (Costo)', 'Activo'],
      ['2101', 'Cuentas por Pagar Aliados', 'Pasivo'],
      ['4101', 'Ingreso por Spread Cambiario', 'Ingreso'],
      ['4102', 'Ingreso por Comisiones', 'Ingreso'],
      ['5101', 'Costo de Ventas (FIFO)', 'Egreso'],
      ['5201', 'Pérdida por Revaluación', 'Egreso'],
    ];
    const ins = db.prepare('INSERT INTO Accounting_Accounts (account_code, account_name, account_type) VALUES ($1, $2, $3)');
    accounts.forEach((a) => ins.run(...a));
  }

  db.prepare('INSERT INTO Accounting_Accounts (account_code, account_name, account_type, balance) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING')
    .run('1000', 'Cuenta de Resguardo/Boveda', 'Activo', 10000000);
  db.prepare('INSERT INTO Accounting_Accounts (account_code, account_name, account_type, balance) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING')
    .run('1001', 'Cuenta Operativa de Cajero', 'Activo', 0);

  const branchCount = db.prepare("SELECT COUNT(*) as count FROM sucursales WHERE sucursal_id = 'MAIN_BRANCH'").get() as any;
  if (branchCount.count === 0) {
    db.prepare(`INSERT INTO sucursales
      (sucursal_id, razon_social, nombre, rfc, calle, numero, colonia, ciudad, codigo_postal, telefono, email, licencia_cnbv, logo_url, es_matriz)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`)
      .run('MAIN_BRANCH', 'FINTECH SOLUTIONS S.A. DE C.V.', 'Sucursal Matriz - Centro', 'FSO121205ABC',
        'Av. Paseo de la Reforma', '222', 'Juárez', 'Ciudad de México', '06600',
        '5555555555', 'matriz@fintechsolutions.mx', 'CNBV-LIC-100293-2024', '', 1);
  }

  const opCount = db.prepare('SELECT COUNT(*) as count FROM operadores').get() as any;
  if (opCount.count === 0) {
    const insOp = db.prepare('INSERT INTO operadores (id, nombre, username, nivel_autorizacion, branch_id) VALUES ($1, $2, $3, $4, $5)');
    insOp.run('user_cajero_1', 'Cajero Polanco', 'cajero_polanco', 2, 'MAIN_BRANCH');
    insOp.run('user_cajero_2', 'Cajera Santa Fe', 'cajera_santa_fe', 2, 'SANTA_FE');
    insOp.run('user_gerente_1', 'Gerente General', 'gerente_general', 5, 'MAIN_BRANCH');
    insOp.run('user_gerente_2', 'Supervisor Liquidez', 'supervisor_liquidez', 5, 'MAIN_BRANCH');
  }

  const cajeroHash = '$2b$12$7al3nbC//44VWvpN3uxl3eJNEeYBbJDDajRWiSw3egRNxAmjugLte';
  const adminPerms = JSON.stringify({ tc_limit: 100, can_cancel: true, show_vault_balance: true });
  const seedUser = db.prepare(`INSERT INTO User_Profiles
    (auth_user_id, nickname, puesto, role_level, branch_id, custom_permissions, password_hash, is_active, force_password_change)
    VALUES ($1,$2,$3,$4,$5,$6,$7,1,0)
    ON CONFLICT (auth_user_id) DO UPDATE SET
      nickname = EXCLUDED.nickname, puesto = EXCLUDED.puesto,
      role_level = EXCLUDED.role_level, custom_permissions = EXCLUDED.custom_permissions
    WHERE User_Profiles.password_hash IS NULL`);
  seedUser.run('user_cajero_1', 'FREDDY', 'Super Administrador', 5, 'MAIN_BRANCH', adminPerms, cajeroHash);
  seedUser.run('user_gerente_1', 'ADMIN_MASTER', 'Gerente de Sucursal', 5, 'MAIN_BRANCH', adminPerms, cajeroHash);

  db.prepare(`INSERT INTO User_Profiles
    (auth_user_id, nickname, puesto, role_level, branch_id, password_hash, is_active, force_password_change)
    VALUES ($1,$2,$3,$4,$5,$6,1,0)
    ON CONFLICT (auth_user_id) DO NOTHING`)
    .run('admin_sicc_2026', 'ADMIN', 'Super Administrador', 5, 'MAIN_BRANCH',
      '$2b$12$bOaRs7EsjziDkXs/EGy/t.TAOdKMlJ5aJ2JvMgQybc.jnWm3Zxa7C');

  const thrCount = db.prepare('SELECT COUNT(*) as count FROM security_thresholds').get() as any;
  if (thrCount.count === 0) {
    const insThr = db.prepare('INSERT INTO security_thresholds (sucursal_id, divisa, monto_maximo) VALUES ($1, $2, $3)');
    insThr.run('MAIN_BRANCH', 'USD', 5000.0);
    insThr.run('MAIN_BRANCH', 'EUR', 3000.0);
    insThr.run('MAIN_BRANCH', 'USDT', 8000.0);
  }

  const termCount = db.prepare("SELECT COUNT(*) as count FROM terminales WHERE terminal_id = 'TERM-MAIN_BRANCH'").get() as any;
  if (termCount.count === 0) {
    db.prepare('INSERT INTO terminales (terminal_id, sucursal_id, terminal_locked, warning_count) VALUES ($1, $2, 0, 0)')
      .run('TERM-MAIN_BRANCH', 'MAIN_BRANCH');
  }

  const ofacCount = db.prepare('SELECT COUNT(*) as count FROM lista_ofac').get() as any;
  if (ofacCount.count === 0) {
    const insOfac = db.prepare('INSERT INTO lista_ofac (nombre_completo, motivo, tipo_coincidencia) VALUES ($1, $2, $3)');
    insOfac.run('Joaquín Guzmán Loera', 'Narcotráfico - Cartel de Sinaloa', 'RED');
    insOfac.run('Ayman al-Zawahiri', 'Terrorismo Internacional Al-Qaeda', 'RED');
    insOfac.run('John Smith OFAC', 'Financiamiento al Terrorismo', 'RED');
    insOfac.run('Juan Manuel Gómez', 'Coincidencia parcial con persona sancionada en OFAC SDN', 'AMARILLO');

    const insPep = db.prepare('INSERT INTO lista_pep (nombre_completo, cargo, tipo_coincidencia) VALUES ($1, $2, $3)');
    insPep.run('Andrés Manuel López Obrador', 'Ex-Presidente de la República (México)', 'RED');
    insPep.run('Claudia Sheinbaum Pardo', 'Presidenta de la República (México)', 'RED');
    insPep.run('Enrique Peña Nieto', 'Ex-Presidente de la República (México)', 'RED');
    insPep.run('Luis Gerardo Ramírez', 'Posible familiar de Gobernador Estatal (Coincidencia de apellidos)', 'AMARILLO');

    const insCnbv = db.prepare('INSERT INTO lista_cnbv (nombre_completo, resolucion, tipo_coincidencia) VALUES ($1, $2, $3)');
    insCnbv.run('Jose CNBV Bloqueado', 'Resolución de congelamiento de cuentas CNBV/UIF-2025', 'RED');
    insCnbv.run('Inverfin Scammer', 'Fraude piramidal y captación ilegal', 'RED');
    insCnbv.run('Carlos Slim Helú', 'Persona con cargo relevante en sector financiero supervisado', 'AMARILLO');

    const insSat = db.prepare('INSERT INTO lista_sat (nombre_completo, situacion, tipo_coincidencia) VALUES ($1, $2, $3)');
    insSat.run('SAT Facturera S.A.', 'Empresa que factura operaciones simuladas (EFOS) Art. 69-B', 'RED');
    insSat.run('SAT Deudor Delincuente', 'Créditos fiscales firmes y no pagados', 'RED');
    insSat.run('Juan Pérez SAT', 'Sujeto a auditoría fiscal por discrepancia', 'AMARILLO');
  }
}
