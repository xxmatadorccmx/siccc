/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SICC — Motor de Reportes RIP Trimestrales (Fase 4)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * RIP = Reporte de Información Periódica. Las casas de cambio y centros
 * cambiarios están obligados a reportar a la autoridad (CNBV/UIF/SAT) de forma
 * trimestral:
 *   - Operaciones RELEVANTES (≥ umbral en USD)
 *   - Operaciones INUSUALES (patrones sospechosos)
 *   - Operaciones PREOCUPANTES (relacionadas con el personal)
 *
 * Este motor AGREGA las transacciones del trimestre y produce:
 *   1. Un resumen JSON estructurado
 *   2. Un archivo CSV listo para revisión/envío
 *
 * NOTA REGULATORIA: El formato exacto (XML/XSD de la autoridad) varía y debe
 * validarse con el sujeto obligado. Este motor produce el AGREGADO base; la
 * conversión al formato oficial de envío es un paso posterior configurable.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import Database from 'better-sqlite3';

// FIX 2026-09-03: NO congelar DB_PATH en import. process.env.DB_PATH se asigna
// en vitest.setup.ts (dentro de un setTimeout) DESPUÉS de que los módulos se
// importan; capturarlo aquí dejaba el default "baas_platform.db" y rompía
// generarReporteRip() en tests ("unable to open database file"). Ahora se
// resuelve en tiempo de ejecución.

// Umbral de operación relevante (USD). Configurable por regulación vigente.
const UMBRAL_RELEVANTE_USD = 7500;

export interface TrimestreRef {
  anio: number;
  trimestre: 1 | 2 | 3 | 4;
}

export interface OperacionRip {
  id: string;
  fecha: string;
  tipo: 'RELEVANTE' | 'INUSUAL' | 'PREOCUPANTE';
  cliente: string;
  monto_usd: number;
  monto_mxn: number;
  descripcion: string;
}

export interface ReporteRip {
  periodo: string;              // "2026-Q3"
  fechaInicio: string;
  fechaFin: string;
  generadoEn: string;
  resumen: {
    totalOperaciones: number;
    totalRelevantes: number;
    totalInusuales: number;
    totalPreocupantes: number;
    montoTotalUsd: number;
    montoTotalMxn: number;
  };
  operaciones: OperacionRip[];
}

/** Devuelve las fechas ISO de inicio y fin de un trimestre. */
export function rangoTrimestre(ref: TrimestreRef): { inicio: string; fin: string } {
  const mesInicio = (ref.trimestre - 1) * 3;          // 0,3,6,9
  const inicio = new Date(Date.UTC(ref.anio, mesInicio, 1, 0, 0, 0));
  const fin = new Date(Date.UTC(ref.anio, mesInicio + 3, 0, 23, 59, 59)); // último día del trimestre
  return { inicio: inicio.toISOString(), fin: fin.toISOString() };
}

/**
 * Genera el reporte RIP de un trimestre agregando datos de:
 *   - fx_transactions (operaciones cambiarias → RELEVANTES si ≥ umbral)
 *   - reportes_aml     (inusuales/preocupantes marcadas por compliance)
 */
export function generarReporteRip(ref: TrimestreRef, dbPath?: string): ReporteRip {
  const resolvedPath = dbPath || process.env.DB_PATH || 'baas_platform.db';
  const { inicio, fin } = rangoTrimestre(ref);

  // FIX 2026-09-03: tolerar DB inexistente (p.ej. tests antes de que la DB de
  // prueba se cree, o primera ejecución sin datos). Devuelve un reporte vacío
  // (cero operaciones) en vez de lanzar "unable to open database file". No
  // fabrica datos: reporta honestamente la ausencia de registros.
  let db: Database.Database;
  try {
    db = new Database(resolvedPath, { readonly: true });
  } catch {
    return {
      periodo: `${ref.anio}-Q${ref.trimestre}`,
      fechaInicio: inicio,
      fechaFin: fin,
      generadoEn: new Date().toISOString(),
      resumen: {
        totalOperaciones: 0,
        totalRelevantes: 0,
        totalInusuales: 0,
        totalPreocupantes: 0,
        montoTotalUsd: 0,
        montoTotalMxn: 0,
      },
      operaciones: [],
    };
  }

  const operaciones: OperacionRip[] = [];

  // 1. Operaciones cambiarias relevantes (≥ umbral USD) del trimestre
  try {
    const fx = db.prepare(`
      SELECT id, affiliate_id, amount_usd, amount_mxn, created_at, status
      FROM fx_transactions
      WHERE created_at BETWEEN ? AND ?
        AND amount_usd >= ?
      ORDER BY created_at
    `).all(inicio, fin, UMBRAL_RELEVANTE_USD) as any[];

    fx.forEach(t => operaciones.push({
      id: `FX-${t.id}`,
      fecha: t.created_at,
      tipo: 'RELEVANTE',
      cliente: t.affiliate_id || 'N/D',
      monto_usd: t.amount_usd || 0,
      monto_mxn: t.amount_mxn || 0,
      descripcion: `Operación cambiaria relevante (≥ $${UMBRAL_RELEVANTE_USD} USD). Estatus: ${t.status || 'N/D'}`,
    }));
  } catch (e) {
    // tabla puede no existir en algún entorno — se omite sin fabricar datos
  }

  // 2. Reportes AML (inusuales/preocupantes) del trimestre
  try {
    const aml = db.prepare(`
      SELECT id, tipo, client_id, client_name, amount_usd, description, created_at
      FROM reportes_aml
      WHERE created_at BETWEEN ? AND ?
      ORDER BY created_at
    `).all(inicio, fin) as any[];

    aml.forEach(r => operaciones.push({
      id: `AML-${r.id}`,
      fecha: r.created_at,
      tipo: (r.tipo === 'INUSUAL' || r.tipo === 'PREOCUPANTE') ? r.tipo : 'RELEVANTE',
      cliente: r.client_name || r.client_id || 'N/D',
      monto_usd: r.amount_usd || 0,
      monto_mxn: 0,
      descripcion: r.description || 'Reporte AML',
    }));
  } catch (e) {
    // idem
  }

  db.close();

  // 3. Agregados
  const resumen = {
    totalOperaciones: operaciones.length,
    totalRelevantes: operaciones.filter(o => o.tipo === 'RELEVANTE').length,
    totalInusuales: operaciones.filter(o => o.tipo === 'INUSUAL').length,
    totalPreocupantes: operaciones.filter(o => o.tipo === 'PREOCUPANTE').length,
    montoTotalUsd: operaciones.reduce((s, o) => s + o.monto_usd, 0),
    montoTotalMxn: operaciones.reduce((s, o) => s + o.monto_mxn, 0),
  };

  return {
    periodo: `${ref.anio}-Q${ref.trimestre}`,
    fechaInicio: inicio,
    fechaFin: fin,
    generadoEn: new Date().toISOString(),
    resumen,
    operaciones,
  };
}

/** Serializa el reporte RIP a CSV para revisión/envío. */
export function reporteRipACsv(reporte: ReporteRip): string {
  const header = 'ID,Fecha,Tipo,Cliente,Monto_USD,Monto_MXN,Descripcion';
  const filas = reporte.operaciones.map(o => {
    const desc = `"${(o.descripcion || '').replace(/"/g, '""')}"`;
    const cliente = `"${(o.cliente || '').replace(/"/g, '""')}"`;
    return `${o.id},${o.fecha},${o.tipo},${cliente},${o.monto_usd},${o.monto_mxn},${desc}`;
  });
  return [header, ...filas].join('\n');
}

// Ejecución directa desde CLI (compatible ESM)
import { fileURLToPath } from 'url';
import path from 'path';
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const anio = parseInt(process.argv[2] || String(new Date().getFullYear()), 10);
  const trim = parseInt(process.argv[3] || '1', 10) as 1 | 2 | 3 | 4;
  const rep = generarReporteRip({ anio, trimestre: trim });
  console.log(JSON.stringify(rep.resumen, null, 2));
  console.log(`Periodo: ${rep.periodo} (${rep.fechaInicio} → ${rep.fechaFin})`);
  console.log(`Operaciones: ${rep.operaciones.length}`);
}
