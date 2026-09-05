/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SICC — Cargador de Listas OFAC SDN (Fase 4)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Parsea los archivos oficiales de OFAC (Office of Foreign Assets Control):
 *   - sdn.csv  → registro principal (nombre, tipo, programa, remarks)
 *   - alt.csv  → nombres alternativos / a.k.a.
 *   - add.csv  → direcciones (no se cargan al matcher pero se referencian)
 *
 * Formato oficial OFAC (sin header, valores -0- = nulo):
 *   sdn.csv: ent_num, SDN_Name, SDN_Type, Program, Title, Call_Sign,
 *            Vess_type, Tonnage, GRT, Vess_flag, Vess_owner, Remarks
 *   alt.csv: ent_num, alt_num, alt_type, alt_name, alt_remarks
 *
 * Uso:
 *   npx tsx src/compliance/ofacLoader.ts [ruta_carpeta_csv]
 *
 * Por defecto lee de: ~/Escritorio/Motor de Cumplimiento/
 * ═══════════════════════════════════════════════════════════════════════════
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';

const DEFAULT_CSV_DIR = path.join(os.homedir(), 'Escritorio', 'Motor de Cumplimiento');
const DB_PATH = process.env.DB_PATH || 'baas_platform.db';

/**
 * Parser CSV minimalista que respeta comillas dobles y comas internas.
 * OFAC usa el formato clásico: campos entre comillas, -0- para nulos.
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map(f => f.trim());
}

/** Convierte el valor OFAC nulo "-0-" a string vacío. */
function cleanOfac(value: string): string {
  const v = (value || '').trim();
  return v === '-0-' || v === '' ? '' : v;
}

interface OfacEntity {
  ent_num: string;
  name: string;
  sdn_type: string;
  program: string;
  title: string;
  remarks: string;
  akas: string[];
}

/**
 * Lee y parsea los archivos OFAC, agrupando entidades con sus a.k.a.
 */
export function parseOfacFiles(csvDir: string): OfacEntity[] {
  const sdnPath = path.join(csvDir, 'sdn.csv');
  const altPath = path.join(csvDir, 'alt.csv');

  if (!fs.existsSync(sdnPath)) {
    throw new Error(`No se encontró sdn.csv en: ${csvDir}`);
  }

  // 1. Parsear alt.csv → mapa de ent_num → [nombres alternativos]
  const akaMap = new Map<string, string[]>();
  if (fs.existsSync(altPath)) {
    const altLines = fs.readFileSync(altPath, 'utf-8').split(/\r?\n/).filter(Boolean);
    for (const line of altLines) {
      const cols = parseCSVLine(line);
      const entNum = cleanOfac(cols[0]);
      const altName = cleanOfac(cols[3]);
      if (entNum && altName) {
        if (!akaMap.has(entNum)) akaMap.set(entNum, []);
        akaMap.get(entNum)!.push(altName);
      }
    }
  }

  // 2. Parsear sdn.csv → entidades principales
  const sdnLines = fs.readFileSync(sdnPath, 'utf-8').split(/\r?\n/).filter(Boolean);
  const entities: OfacEntity[] = [];

  for (const line of sdnLines) {
    const cols = parseCSVLine(line);
    const entNum = cleanOfac(cols[0]);
    const name = cleanOfac(cols[1]);
    if (!entNum || !name) continue;

    entities.push({
      ent_num: entNum,
      name,
      sdn_type: cleanOfac(cols[2]) || 'entity',
      program: cleanOfac(cols[3]),
      title: cleanOfac(cols[4]),
      remarks: cleanOfac(cols[11]),
      akas: akaMap.get(entNum) || [],
    });
  }

  return entities;
}

/**
 * Carga las entidades OFAC en la tabla lista_ofac de SQLite.
 * Incluye nombres principales Y alternativos (cada a.k.a. es un registro).
 */
export function loadOfacToDb(csvDir: string = DEFAULT_CSV_DIR, dbPath: string = DB_PATH): {
  entidades: number; akas: number; total: number;
} {
  const entities = parseOfacFiles(csvDir);
  const db = new Database(dbPath);

  // Asegurar columnas extendidas (ent_num, sdn_type, program)
  const cols = db.prepare("PRAGMA table_info(lista_ofac)").all() as any[];
  const colNames = new Set(cols.map(c => c.name));
  if (!colNames.has('ent_num')) {
    db.exec("ALTER TABLE lista_ofac ADD COLUMN ent_num TEXT");
  }
  if (!colNames.has('sdn_type')) {
    db.exec("ALTER TABLE lista_ofac ADD COLUMN sdn_type TEXT");
  }
  if (!colNames.has('programa')) {
    db.exec("ALTER TABLE lista_ofac ADD COLUMN programa TEXT");
  }
  if (!colNames.has('es_alias')) {
    db.exec("ALTER TABLE lista_ofac ADD COLUMN es_alias INTEGER DEFAULT 0");
  }

  // Limpiar carga OFAC previa que provenga del CSV real (conserva seeds manuales
  // solo si no tienen ent_num). Aquí purgamos todo lo marcado como carga masiva.
  db.exec("DELETE FROM lista_ofac WHERE ent_num IS NOT NULL");

  const insert = db.prepare(`
    INSERT INTO lista_ofac (nombre_completo, motivo, tipo_coincidencia, ent_num, sdn_type, programa, es_alias)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let entCount = 0;
  let akaCount = 0;

  const tx = db.transaction(() => {
    for (const e of entities) {
      const motivo = [e.program, e.title, e.remarks].filter(Boolean).join(' | ').slice(0, 500)
        || 'OFAC SDN — Persona/entidad sancionada';
      // Registro principal
      insert.run(e.name, motivo, 'RED', e.ent_num, e.sdn_type, e.program, 0);
      entCount++;
      // Nombres alternativos (a.k.a.)
      for (const aka of e.akas) {
        insert.run(aka, `a.k.a. de ent#${e.ent_num} | ${motivo}`.slice(0, 500), 'RED', e.ent_num, e.sdn_type, e.program, 1);
        akaCount++;
      }
    }
  });
  tx();

  db.close();
  return { entidades: entCount, akas: akaCount, total: entCount + akaCount };
}

// Ejecución directa desde CLI (compatible ESM)
import { fileURLToPath } from 'url';
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const csvDir = process.argv[2] || DEFAULT_CSV_DIR;
  console.log(`[OFAC Loader] Cargando desde: ${csvDir}`);
  console.log(`[OFAC Loader] Base de datos: ${DB_PATH}`);
  try {
    const result = loadOfacToDb(csvDir);
    console.log(`[OFAC Loader] ✅ Cargados ${result.entidades} entidades + ${result.akas} alias = ${result.total} registros`);
  } catch (err) {
    console.error(`[OFAC Loader] ❌ Error:`, (err as Error).message);
    process.exit(1);
  }
}
