/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SICC — Servicio de Compliance: búsqueda de listas + candados de captura
 * ═══════════════════════════════════════════════════════════════════════════
 * Capa de servicio que el backend (server.ts) consume. Usa el índice fonético
 * SQL para pre-filtrar candidatos y luego aplica el fuzzy matcher fino.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import Database from 'better-sqlite3';
import {
  buscarFuzzy, evaluarNivelRiesgo, normalizarNombre, codigoFonetico,
  RegistroRiesgo, ResultadoMatch,
} from './fuzzyMatcher';

const DB_PATH = process.env.DB_PATH || 'baas_platform.db';

export interface ResultadoBusquedaListas {
  matches: ResultadoMatch[];
  riskLevel: 'ROJO' | 'AMARILLO' | 'VERDE';
  totalRevisados: number;
  tiempoMs: number;
}

interface TablaConfig {
  tabla: string;
  lista: 'OFAC' | 'PEP' | 'CNBV' | 'SAT';
  campoDetalle: string;
}

const TABLAS: TablaConfig[] = [
  { tabla: 'lista_ofac', lista: 'OFAC', campoDetalle: 'motivo' },
  { tabla: 'lista_pep', lista: 'PEP', campoDetalle: 'cargo' },
  { tabla: 'lista_cnbv', lista: 'CNBV', campoDetalle: 'resolucion' },
  { tabla: 'lista_sat', lista: 'SAT', campoDetalle: 'situacion' },
];

/**
 * Busca un nombre contra TODAS las listas de riesgo usando el índice fonético
 * para pre-filtrar candidatos (rápido), luego fuzzy matching fino (preciso).
 *
 * @param consulta  Nombre a verificar
 * @param umbral    Umbral de similitud (default 0.55)
 * @param dbPath    Ruta a la base de datos
 */
export function buscarEnListas(
  consulta: string,
  umbral: number = 0.55,
  dbPath: string = DB_PATH
): ResultadoBusquedaListas {
  const inicio = Date.now();
  const consultaNorm = normalizarNombre(consulta);

  if (!consultaNorm) {
    return { matches: [], riskLevel: 'VERDE', totalRevisados: 0, tiempoMs: 0 };
  }

  const consultaFonetica = codigoFonetico(consultaNorm);
  // Códigos fonéticos de cada token (para pre-filtrado por apellido)
  const tokensFoneticos = consultaNorm
    .split(' ')
    .map(t => codigoFonetico(t))
    .filter(Boolean);

  const db = new Database(dbPath, { readonly: true });
  const candidatos: RegistroRiesgo[] = [];
  let totalRevisados = 0;

  for (const cfg of TABLAS) {
    // Verificar que la tabla y el índice existen
    const tieneIndice = db.prepare(
      "SELECT name FROM pragma_table_info(?) WHERE name = 'fonetico_dmeta'"
    ).get(cfg.tabla);

    let rows: any[];

    if (tieneIndice && tokensFoneticos.length > 0) {
      // PRE-FILTRADO POR ÍNDICE FONÉTICO (rápido):
      // trae registros cuyo código fonético completo coincide, O cuyo
      // nombre contiene algún token fonético de la consulta.
      const placeholders = tokensFoneticos.map(() => '?').join(',');
      rows = db.prepare(`
        SELECT id, nombre_completo, ${cfg.campoDetalle} AS detalle, tipo_coincidencia
        FROM ${cfg.tabla}
        WHERE fonetico_dmeta = ?
           OR fonetico_dmeta IN (${placeholders})
      `).all(consultaFonetica, ...tokensFoneticos) as any[];

      // Complemento por token largo (apellido probable). Se ejecuta SIEMPRE
      // que el token largo exista, para capturar nombres compuestos donde el
      // fonético del nombre completo difiere (p.ej. "Sheinbaum" vs
      // "Sheinbaum Pardo"). El fuzzy fino descarta falsos positivos después.
      const ids = new Set(rows.map(r => r.id));
      const tokenLargo = consultaNorm.split(' ').sort((a, b) => b.length - a.length)[0];
      if (tokenLargo && tokenLargo.length >= 4) {
        const tokenFon = codigoFonetico(tokenLargo);
        // Buscar por substring del token largo Y por fonético del token
        const extra = db.prepare(`
          SELECT id, nombre_completo, ${cfg.campoDetalle} AS detalle, tipo_coincidencia
          FROM ${cfg.tabla}
          WHERE UPPER(nombre_completo) LIKE ?
             OR fonetico_dmeta LIKE ?
          LIMIT 300
        `).all(`%${tokenLargo}%`, `%${tokenFon}%`) as any[];
        extra.forEach(e => { if (!ids.has(e.id)) { rows.push(e); ids.add(e.id); } });
      }
    } else {
      // Fallback sin índice: substring simple
      rows = db.prepare(`
        SELECT id, nombre_completo, ${cfg.campoDetalle} AS detalle, tipo_coincidencia
        FROM ${cfg.tabla}
        WHERE UPPER(nombre_completo) LIKE ?
        LIMIT 200
      `).all(`%${consultaNorm}%`) as any[];
    }

    totalRevisados += rows.length;
    rows.forEach(r => candidatos.push({
      id: `${cfg.lista}-${r.id}`,
      lista: cfg.lista,
      nombre_completo: r.nombre_completo,
      tipo_coincidencia: r.tipo_coincidencia || 'RED',
      detalles: r.detalle,
    }));
  }

  db.close();

  // Fuzzy matching fino sobre el conjunto pre-filtrado (pequeño → rápido)
  const matches = buscarFuzzy(consulta, candidatos, umbral);
  const numTokens = normalizarNombre(consulta).split(/\s+/).filter(Boolean).length;
  const riskLevel = evaluarNivelRiesgo(matches, numTokens);

  return {
    matches,
    riskLevel,
    totalRevisados,
    tiempoMs: Date.now() - inicio,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CANDADOS DE CAPTURA OBLIGATORIA
// ═══════════════════════════════════════════════════════════════════════════

export interface RequisitosCaptura {
  umbral: string;
  requiere_id: boolean;
  requiere_domicilio: boolean;
  requiere_expediente: boolean;
  requiere_clave_n5: boolean;
  descripcion: string;
}

/**
 * Determina qué documentación exige la regulación para un monto dado (USD).
 *
 *   < $1,000   → sin captura obligatoria
 *   $1k–$3k    → identificación oficial
 *   $3k–$5k    → identificación + comprobante de domicilio
 *   ≥ $5k      → expediente completo + clave de 9 caracteres Nivel 5
 */
export function requisitosCapturaPorMonto(montoUsd: number): RequisitosCaptura {
  if (montoUsd >= 5000) {
    return {
      umbral: '5000+',
      requiere_id: true,
      requiere_domicilio: true,
      requiere_expediente: true,
      requiere_clave_n5: true,
      descripcion: 'Umbral $5k USD — Expediente completo + clave Nivel 5 obligatoria',
    };
  }
  if (montoUsd >= 3000) {
    return {
      umbral: '3000-4999',
      requiere_id: true,
      requiere_domicilio: true,
      requiere_expediente: false,
      requiere_clave_n5: false,
      descripcion: 'Umbral $3k USD — Identificación + comprobante de domicilio',
    };
  }
  if (montoUsd >= 1000) {
    return {
      umbral: '1000-2999',
      requiere_id: true,
      requiere_domicilio: false,
      requiere_expediente: false,
      requiere_clave_n5: false,
      descripcion: 'Umbral $1k USD — Identificación oficial obligatoria',
    };
  }
  return {
    umbral: '0-999',
    requiere_id: false,
    requiere_domicilio: false,
    requiere_expediente: false,
    requiere_clave_n5: false,
    descripcion: 'Operación bajo umbral — sin captura obligatoria',
  };
}

export interface DatosClienteCaptura {
  tiene_id?: boolean;
  tiene_domicilio?: boolean;
  tiene_expediente?: boolean;
  clave_n5?: string;   // clave de 9 caracteres capturada
}

export interface ResultadoValidacionCaptura {
  permitido: boolean;
  requisitos: RequisitosCaptura;
  faltantes: string[];
}

/**
 * Valida si una operación de cierto monto puede proceder según los datos
 * capturados del cliente. Este es el CANDADO: si faltan datos, permitido=false.
 */
export function validarCandadoCaptura(
  montoUsd: number,
  datos: DatosClienteCaptura
): ResultadoValidacionCaptura {
  const req = requisitosCapturaPorMonto(montoUsd);
  const faltantes: string[] = [];

  if (req.requiere_id && !datos.tiene_id) {
    faltantes.push('Identificación oficial');
  }
  if (req.requiere_domicilio && !datos.tiene_domicilio) {
    faltantes.push('Comprobante de domicilio');
  }
  if (req.requiere_expediente && !datos.tiene_expediente) {
    faltantes.push('Expediente completo');
  }
  if (req.requiere_clave_n5) {
    const clave = (datos.clave_n5 || '').trim();
    if (!clave) {
      faltantes.push('Clave de autorización Nivel 5 (9 caracteres)');
    } else if (clave.length !== 9) {
      faltantes.push(`Clave Nivel 5 inválida (debe ser 9 caracteres, recibió ${clave.length})`);
    }
  }

  return {
    permitido: faltantes.length === 0,
    requisitos: req,
    faltantes,
  };
}
