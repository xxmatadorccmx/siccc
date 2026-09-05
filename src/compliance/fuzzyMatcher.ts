/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SICC — Motor de Cumplimiento: Fuzzy Matching Fonético
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Reemplaza la búsqueda LIKE simple por un motor de coincidencia difusa que
 * combina TRES técnicas complementarias:
 *
 *   1. NORMALIZACIÓN     → sin acentos, mayúsculas, orden de palabras
 *   2. FONÉTICA          → Double Metaphone (tolera "Smith" ≈ "Smyth",
 *                          "Guzman" ≈ "Guzmán", "Muhammad" ≈ "Mohammed")
 *   3. DISTANCIA DE EDIT → Levenshtein normalizado (tolera typos)
 *
 * El score final (0..1) prioriza: exacto > fonético > similar.
 *
 * Este motor es AGNÓSTICO de la base de datos: recibe la lista de candidatos
 * y hace el matching en memoria. En Supabase, la misma lógica vive en
 * db/04_compliance_fuzzy_supabase.sql (pg_trgm + dmetaphone).
 * ═══════════════════════════════════════════════════════════════════════════
 */

import natural from 'natural';
import levenshtein from 'fast-levenshtein';

const DoubleMetaphone = natural.DoubleMetaphone;

export type NivelMatch = 'EXACTO' | 'FONETICO' | 'SIMILAR';
export type TipoCoincidencia = 'RED' | 'AMARILLO';

export interface RegistroRiesgo {
  id: number | string;
  lista: 'OFAC' | 'PEP' | 'CNBV' | 'SAT';
  nombre_completo: string;
  tipo_coincidencia: TipoCoincidencia;
  detalles?: string;
  metadata?: Record<string, any>;
}

export interface ResultadoMatch extends RegistroRiesgo {
  score_similitud: number;   // 0..1
  match_fonetico: boolean;
  nivel_match: NivelMatch;
}

/**
 * Normaliza un nombre para comparación consistente.
 * "José  Guzmán Loera" → "JOSE GUZMAN LOERA"
 */
export function normalizarNombre(nombre: string): string {
  return nombre
    .normalize('NFD')                       // descompone acentos
    .replace(/[\u0300-\u036f]/g, '')        // elimina diacríticos
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')           // solo alfanumérico
    .replace(/\s+/g, ' ')                   // colapsa espacios
    .trim();
}

/**
 * Genera el código fonético Double Metaphone del nombre normalizado.
 * Devuelve el código primario (más estable para matching).
 */
export function codigoFonetico(nombreNormalizado: string): string {
  const dm = new DoubleMetaphone();
  // process() devuelve [primario, secundario]
  const [primario] = dm.process(nombreNormalizado);
  return primario || '';
}

/**
 * Compara dos nombres a nivel de TOKENS fonéticos.
 * Esto captura reordenamientos: "GUZMAN LOERA JOAQUIN" ≈ "JOAQUIN GUZMAN LOERA"
 * y coincidencias parciales de apellidos.
 */
function scoreFoneticoTokens(consulta: string, candidato: string): number {
  const dm = new DoubleMetaphone();
  const tokensC = consulta.split(' ').filter(Boolean);
  const tokensK = candidato.split(' ').filter(Boolean);
  if (tokensC.length === 0 || tokensK.length === 0) return 0;

  const foneticasK = new Set<string>();
  tokensK.forEach(t => {
    const [p] = dm.process(t);
    if (p) foneticasK.add(p);
  });

  let coincidencias = 0;
  tokensC.forEach(t => {
    const [p] = dm.process(t);
    if (p && foneticasK.has(p)) coincidencias++;
  });

  // Proporción de tokens de la consulta que tienen match fonético
  return coincidencias / tokensC.length;
}

/**
 * Distancia de Levenshtein normalizada a un score de similitud 0..1.
 */
function scoreLevenshtein(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  const dist = levenshtein.get(a, b);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - dist / maxLen;
}

/**
 * Compara la consulta contra UN registro de riesgo.
 * Devuelve el resultado con score y nivel de match, o null si no supera umbral.
 */
export function compararRegistro(
  consultaNorm: string,
  consultaFonetica: string,
  registro: RegistroRiesgo,
  umbral: number
): ResultadoMatch | null {
  const candidatoNorm = normalizarNombre(registro.nombre_completo);
  const candidatoFonetico = codigoFonetico(candidatoNorm);

  // 1. Match exacto normalizado
  if (candidatoNorm === consultaNorm) {
    return {
      ...registro,
      score_similitud: 1.0,
      match_fonetico: true,
      nivel_match: 'EXACTO',
    };
  }

  // 2. Match fonético (código completo idéntico)
  const matchFoneticoCompleto =
    !!consultaFonetica && candidatoFonetico === consultaFonetica;

  // 3. Scores parciales
  const scoreLev = scoreLevenshtein(consultaNorm, candidatoNorm);
  const scoreTokens = scoreFoneticoTokens(consultaNorm, candidatoNorm);

  // Score combinado: pondera fonética de tokens (0.6) y edit distance (0.4)
  const scoreCombinado = Math.max(
    scoreTokens * 0.6 + scoreLev * 0.4,
    matchFoneticoCompleto ? 0.85 : 0
  );

  if (scoreCombinado < umbral && !matchFoneticoCompleto) {
    return null;
  }

  return {
    ...registro,
    score_similitud: Math.round(scoreCombinado * 1000) / 1000,
    match_fonetico: matchFoneticoCompleto || scoreTokens >= 0.5,
    nivel_match: matchFoneticoCompleto ? 'FONETICO' : 'SIMILAR',
  };
}

/**
 * FUNCIÓN PRINCIPAL: busca una consulta contra un conjunto de registros.
 *
 * @param consulta  Nombre a buscar (raw, con acentos, etc.)
 * @param registros Lista completa de registros de riesgo a comparar
 * @param umbral    Umbral mínimo de similitud (default 0.55; baja = más tolerante)
 * @returns Resultados ordenados por relevancia (exacto → fonético → similar)
 */
export function buscarFuzzy(
  consulta: string,
  registros: RegistroRiesgo[],
  umbral: number = 0.55
): ResultadoMatch[] {
  const consultaNorm = normalizarNombre(consulta);
  if (!consultaNorm) return [];
  const consultaFonetica = codigoFonetico(consultaNorm);

  const resultados: ResultadoMatch[] = [];
  for (const registro of registros) {
    const match = compararRegistro(consultaNorm, consultaFonetica, registro, umbral);
    if (match) resultados.push(match);
  }

  // Orden: exactos primero, luego fonéticos, luego por score
  resultados.sort((a, b) => {
    const nivelPrioridad = { EXACTO: 3, FONETICO: 2, SIMILAR: 1 };
    const diff = nivelPrioridad[b.nivel_match] - nivelPrioridad[a.nivel_match];
    if (diff !== 0) return diff;
    return b.score_similitud - a.score_similitud;
  });

  return resultados.slice(0, 50);
}

/**
 * Determina el nivel de riesgo agregado de un conjunto de matches.
 * ROJO   → hay al menos un match RED con alto score
 * AMARILLO → matches AMARILLO o RED con score medio (posible homónimo)
 * VERDE  → sin coincidencias relevantes
 */
export function evaluarNivelRiesgo(matches: ResultadoMatch[], consultaTokens?: number): 'ROJO' | 'AMARILLO' | 'VERDE' {
  if (matches.length === 0) return 'VERDE';

  const hayRojoFuerte = matches.some(
    m => m.tipo_coincidencia === 'RED' && (m.nivel_match === 'EXACTO' || m.nivel_match === 'FONETICO' || m.score_similitud >= 0.85)
  );
  if (hayRojoFuerte) return 'ROJO';

  // ADICIONAL: si un match RED tiene match_fonetico=true, score >= 0.65, Y la consulta
  // tiene al menos 2 palabras (para evitar que un solo apellido como "Guzman" suba a ROJO),
  // también es ROJO. Caso real: "Joaquin Guzman Loera" vs "GUZMAN LOERA, Joaquin" (orden diferente).
  const numTokens = consultaTokens || 0;
  const hayRojoFonetico = matches.some(
    m => m.tipo_coincidencia === 'RED' && m.match_fonetico && m.score_similitud >= 0.65 && numTokens >= 2
  );
  if (hayRojoFonetico) return 'ROJO';

  const hayPosible = matches.some(
    m => m.tipo_coincidencia === 'RED' || m.tipo_coincidencia === 'AMARILLO' || m.score_similitud >= 0.6
  );
  if (hayPosible) return 'AMARILLO';

  return 'VERDE';
}
