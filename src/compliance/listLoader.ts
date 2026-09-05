/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SICC — Cargador de listas de riesgo (PEP semilla + OFAC + índices)
 * ═══════════════════════════════════════════════════════════════════════════
 * Orquesta la carga de todas las listas de riesgo en SQLite y construye el
 * índice fonético que acelera el fuzzy matching.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import Database from 'better-sqlite3';
import { PEP_MEXICO_SEED } from './pepSeedMexico';
import { codigoFonetico, normalizarNombre } from './fuzzyMatcher';

const DB_PATH = process.env.DB_PATH || 'baas_platform.db';

/**
 * Carga el dataset semilla PEP México en lista_pep.
 * Reemplaza cualquier carga semilla previa (fuente_origen='PEP_SEED').
 */
export function cargarPepSeed(dbPath: string = DB_PATH): number {
  const db = new Database(dbPath);

  // Asegurar columnas de trazabilidad
  const cols = db.prepare("PRAGMA table_info(lista_pep)").all() as any[];
  const colNames = new Set(cols.map(c => c.name));
  if (!colNames.has('entidad')) db.exec("ALTER TABLE lista_pep ADD COLUMN entidad TEXT");
  if (!colNames.has('poder')) db.exec("ALTER TABLE lista_pep ADD COLUMN poder TEXT");
  if (!colNames.has('fuente_origen')) db.exec("ALTER TABLE lista_pep ADD COLUMN fuente_origen TEXT");

  // Limpiar semilla previa (conserva registros del scraper)
  db.exec("DELETE FROM lista_pep WHERE fuente_origen = 'PEP_SEED' OR fuente_origen IS NULL");

  const insert = db.prepare(`
    INSERT INTO lista_pep (nombre_completo, cargo, tipo_coincidencia, entidad, poder, fuente_origen)
    VALUES (?, ?, ?, ?, ?, 'PEP_SEED')
  `);
  const tx = db.transaction(() => {
    for (const p of PEP_MEXICO_SEED) {
      insert.run(p.nombre_completo, p.cargo, p.tipo_coincidencia, p.entidad, p.poder);
    }
  });
  tx();
  db.close();
  return PEP_MEXICO_SEED.length;
}

/**
 * Construye una columna de índice fonético en cada tabla de lista para
 * acelerar el fuzzy matching (pre-filtrado por código dmetaphone).
 * Esto reduce las búsquedas de ~1s a milisegundos.
 */
export function construirIndiceFonetico(dbPath: string = DB_PATH): { tabla: string; indexados: number }[] {
  const db = new Database(dbPath);
  const tablas = ['lista_ofac', 'lista_pep', 'lista_cnbv', 'lista_sat'];
  const resultado: { tabla: string; indexados: number }[] = [];

  for (const tabla of tablas) {
    // Verificar que la tabla existe
    const exists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(tabla);
    if (!exists) continue;

    // Añadir columnas de índice si no existen
    const cols = db.prepare(`PRAGMA table_info(${tabla})`).all() as any[];
    const colNames = new Set(cols.map(c => c.name));
    if (!colNames.has('nombre_normalizado')) {
      db.exec(`ALTER TABLE ${tabla} ADD COLUMN nombre_normalizado TEXT`);
    }
    if (!colNames.has('fonetico_dmeta')) {
      db.exec(`ALTER TABLE ${tabla} ADD COLUMN fonetico_dmeta TEXT`);
    }

    // Poblar índice para registros que aún no lo tienen
    const rows = db.prepare(
      `SELECT id, nombre_completo FROM ${tabla} WHERE fonetico_dmeta IS NULL`
    ).all() as any[];

    const update = db.prepare(
      `UPDATE ${tabla} SET nombre_normalizado = ?, fonetico_dmeta = ? WHERE id = ?`
    );
    const tx = db.transaction(() => {
      for (const r of rows) {
        const norm = normalizarNombre(r.nombre_completo);
        const fon = codigoFonetico(norm);
        update.run(norm, fon, r.id);
      }
    });
    tx();

    // Crear índice SQL sobre el código fonético
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${tabla}_fonetico ON ${tabla}(fonetico_dmeta)`);

    resultado.push({ tabla, indexados: rows.length });
  }

  db.close();
  return resultado;
}

// Ejecución directa desde CLI (compatible ESM)
import { fileURLToPath } from 'url';
import path from 'path';
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  console.log('[Listas] Cargando dataset semilla PEP México...');
  const pepCount = cargarPepSeed();
  console.log(`[Listas] ✅ ${pepCount} PEPs federales cargados`);

  console.log('[Listas] Construyendo índice fonético (puede tardar en 39k registros OFAC)...');
  const idx = construirIndiceFonetico();
  idx.forEach(r => console.log(`[Listas] ✅ ${r.tabla}: ${r.indexados} registros indexados`));
  console.log('[Listas] Listo.');
}
