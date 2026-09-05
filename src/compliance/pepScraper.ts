/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SICC — Scraper PEP México (Fase 4) — ⚠️ DESACTIVADO POR DEFECTO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Este scraper alimenta la lista PEP desde fuentes oficiales abiertas de México.
 * Está DESACTIVADO por defecto y solo corre si:
 *   process.env.PEP_SCRAPER_ENABLED === 'true'
 *
 * ══════════════════ POR QUÉ ESTÁ DESACTIVADO ══════════════════
 *
 * Antes de activarlo, el usuario (Product Lead) debe VALIDAR:
 *   1. FUENTE: ¿Qué portal oficial se usará?
 *        - Declaranet (declaraciones patrimoniales) — https://declaranet.gob.mx
 *        - Plataforma Nacional de Transparencia (PNT) — https://www.plataformadetransparencia.org.mx
 *        - Sistema Nacional Anticorrupción (SNA) / S3 datos abiertos
 *      Cada fuente tiene términos de uso distintos y formatos distintos.
 *   2. LEGALIDAD: Verificar que el scraping cumple los términos de servicio
 *      del portal y la Ley Federal de Protección de Datos Personales.
 *      Muchos portales ofrecen APIs/datasets descargables que EVITAN scraping.
 *   3. FRECUENCIA: Un scraper agresivo puede ser bloqueado. Se recomienda
 *      cron diario/semanal, no en cada búsqueda.
 *
 * ══════════════════ ARQUITECTURA (cuando se active) ══════════════════
 *
 * Preferir SIEMPRE dataset descargable > API oficial > scraping HTML.
 * El SNA publica el "Sistema 3 de 3" con datos de servidores públicos que
 * suele ser descargable como JSON/CSV — esa es la ruta recomendada.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH || 'baas_platform.db';
const SCRAPER_ENABLED = process.env.PEP_SCRAPER_ENABLED === 'true';

export interface PepScrapedRecord {
  nombre_completo: string;
  cargo: string;
  entidad: string;
  fuente: string;
}

/**
 * Punto de entrada del scraper. Si está desactivado, no hace nada y avisa.
 *
 * @returns número de registros insertados (0 si desactivado)
 */
export async function ejecutarScraperPep(): Promise<number> {
  if (!SCRAPER_ENABLED) {
    console.log(
      '[PEP Scraper] ⏸️  DESACTIVADO. Para activar: PEP_SCRAPER_ENABLED=true.\n' +
      '              Antes valida la fuente oficial (ver comentarios en pepScraper.ts).'
    );
    return 0;
  }

  console.log('[PEP Scraper] ▶️  Activado. Iniciando ingesta...');

  // ── IMPLEMENTACIÓN REAL (a completar tras validar fuente) ─────────────────
  //
  // OPCIÓN A (RECOMENDADA): Descargar dataset abierto del SNA/S3-de-3
  //   const resp = await fetch('https://<endpoint-datos-abiertos>/servidores.json');
  //   const data = await resp.json();
  //   const registros = data.map(normalizarRegistroSNA);
  //
  // OPCIÓN B: Scraping HTML con Playwright (solo si no hay dataset)
  //   Requiere: npm install playwright; npx playwright install chromium
  //   const { chromium } = await import('playwright');
  //   const browser = await chromium.launch();
  //   ... navegar, extraer, paginar, respetar robots.txt y rate limits ...
  //
  // Por ahora devolvemos 0 con un aviso claro — NO se fabrica data falsa.
  console.warn(
    '[PEP Scraper] ⚠️  Fuente no configurada. Implementa la ingesta real en ' +
    'ejecutarScraperPep() tras validar el portal oficial. No se insertaron registros.'
  );
  return 0;
}

/**
 * Inserta registros scrapeados en la tabla lista_pep marcándolos con
 * fuente_origen='PEP_SCRAPER' para trazabilidad.
 */
export function insertarPepScrapeados(registros: PepScrapedRecord[]): number {
  if (registros.length === 0) return 0;
  const db = new Database(DB_PATH);

  // Asegurar columnas de trazabilidad
  const cols = db.prepare("PRAGMA table_info(lista_pep)").all() as any[];
  const colNames = new Set(cols.map(c => c.name));
  if (!colNames.has('entidad')) db.exec("ALTER TABLE lista_pep ADD COLUMN entidad TEXT");
  if (!colNames.has('fuente_origen')) db.exec("ALTER TABLE lista_pep ADD COLUMN fuente_origen TEXT");

  const insert = db.prepare(`
    INSERT INTO lista_pep (nombre_completo, cargo, tipo_coincidencia, entidad, fuente_origen)
    VALUES (?, ?, 'RED', ?, 'PEP_SCRAPER')
  `);
  const tx = db.transaction(() => {
    for (const r of registros) insert.run(r.nombre_completo, r.cargo, r.entidad);
  });
  tx();
  db.close();
  return registros.length;
}

// Ejecución directa desde CLI (compatible ESM)
import { fileURLToPath } from 'url';
import path from 'path';
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  ejecutarScraperPep()
    .then(n => console.log(`[PEP Scraper] Finalizado. ${n} registros insertados.`))
    .catch(e => { console.error('[PEP Scraper] Error:', e); process.exit(1); });
}
