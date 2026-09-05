/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SICC — Dataset Semilla PEP México (Fase 4)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Personas Políticamente Expuestas (PEP) de nivel federal en México.
 * Fuente: cargos públicos de conocimiento general (poder ejecutivo, legislativo,
 * judicial y organismos autónomos federales).
 *
 * ⚠️  IMPORTANTE — LÍMITES DE ESTE DATASET:
 *   - Es un SEMILLA curado manualmente, NO exhaustivo.
 *   - Cubre cargos federales de alto nivel vigentes al momento de la carga.
 *   - Para cobertura completa (estatal, municipal, familiares, exfuncionarios)
 *     se requiere activar el scraper (ver pepScraper.ts), pendiente de que el
 *     usuario valide la fuente oficial.
 *   - La clasificación PEP debe revisarse periódicamente: los cargos cambian.
 *
 * REGULACIÓN: Las disposiciones AML mexicanas (CNBV/UIF) exigen identificar
 * PEPs nacionales y extranjeros. Un PEP no es un delincuente — es una persona
 * cuyo cargo implica MAYOR riesgo de corrupción/LD, por lo que requiere
 * debida diligencia reforzada (EDD).
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface RegistroPep {
  nombre_completo: string;
  cargo: string;
  nivel: 'FEDERAL' | 'ESTATAL' | 'MUNICIPAL';
  entidad: string;
  poder: 'EJECUTIVO' | 'LEGISLATIVO' | 'JUDICIAL' | 'AUTONOMO';
  tipo_coincidencia: 'RED' | 'AMARILLO';
}

/**
 * Semilla de PEPs federales de México.
 * Todos son 'RED' porque un cargo federal vigente es PEP confirmado.
 * Los familiares/asociados se marcarían 'AMARILLO' (no incluidos en semilla).
 */
export const PEP_MEXICO_SEED: RegistroPep[] = [
  // ── PODER EJECUTIVO FEDERAL ──────────────────────────────────────────────
  { nombre_completo: 'Claudia Sheinbaum Pardo', cargo: 'Presidenta de la República', nivel: 'FEDERAL', entidad: 'Presidencia', poder: 'EJECUTIVO', tipo_coincidencia: 'RED' },
  { nombre_completo: 'Andrés Manuel López Obrador', cargo: 'Ex-Presidente de la República (2018-2024)', nivel: 'FEDERAL', entidad: 'Presidencia', poder: 'EJECUTIVO', tipo_coincidencia: 'RED' },
  { nombre_completo: 'Enrique Peña Nieto', cargo: 'Ex-Presidente de la República (2012-2018)', nivel: 'FEDERAL', entidad: 'Presidencia', poder: 'EJECUTIVO', tipo_coincidencia: 'RED' },
  { nombre_completo: 'Felipe Calderón Hinojosa', cargo: 'Ex-Presidente de la República (2006-2012)', nivel: 'FEDERAL', entidad: 'Presidencia', poder: 'EJECUTIVO', tipo_coincidencia: 'RED' },
  { nombre_completo: 'Rogelio Ramírez de la O', cargo: 'Secretario de Hacienda y Crédito Público', nivel: 'FEDERAL', entidad: 'SHCP', poder: 'EJECUTIVO', tipo_coincidencia: 'RED' },
  { nombre_completo: 'Juan Ramón de la Fuente', cargo: 'Secretario de Relaciones Exteriores', nivel: 'FEDERAL', entidad: 'SRE', poder: 'EJECUTIVO', tipo_coincidencia: 'RED' },
  { nombre_completo: 'Omar García Harfuch', cargo: 'Secretario de Seguridad y Protección Ciudadana', nivel: 'FEDERAL', entidad: 'SSPC', poder: 'EJECUTIVO', tipo_coincidencia: 'RED' },
  { nombre_completo: 'Marcelo Ebrard Casaubón', cargo: 'Secretario de Economía', nivel: 'FEDERAL', entidad: 'SE', poder: 'EJECUTIVO', tipo_coincidencia: 'RED' },
  { nombre_completo: 'Rosa Icela Rodríguez Velázquez', cargo: 'Secretaria de Gobernación', nivel: 'FEDERAL', entidad: 'SEGOB', poder: 'EJECUTIVO', tipo_coincidencia: 'RED' },
  { nombre_completo: 'Ariadna Montiel Reyes', cargo: 'Secretaria de Bienestar', nivel: 'FEDERAL', entidad: 'Bienestar', poder: 'EJECUTIVO', tipo_coincidencia: 'RED' },
  { nombre_completo: 'Edna Elena Vega Rangel', cargo: 'Secretaria de Desarrollo Agrario, Territorial y Urbano', nivel: 'FEDERAL', entidad: 'SEDATU', poder: 'EJECUTIVO', tipo_coincidencia: 'RED' },
  { nombre_completo: 'Alicia Bárcena Ibarra', cargo: 'Secretaria de Medio Ambiente y Recursos Naturales', nivel: 'FEDERAL', entidad: 'SEMARNAT', poder: 'EJECUTIVO', tipo_coincidencia: 'RED' },
  { nombre_completo: 'David Kershenobich Stalnikowitz', cargo: 'Secretario de Salud', nivel: 'FEDERAL', entidad: 'SALUD', poder: 'EJECUTIVO', tipo_coincidencia: 'RED' },
  { nombre_completo: 'Mario Delgado Carrillo', cargo: 'Secretario de Educación Pública', nivel: 'FEDERAL', entidad: 'SEP', poder: 'EJECUTIVO', tipo_coincidencia: 'RED' },
  { nombre_completo: 'Julio Berdegué Sacristán', cargo: 'Secretario de Agricultura y Desarrollo Rural', nivel: 'FEDERAL', entidad: 'SADER', poder: 'EJECUTIVO', tipo_coincidencia: 'RED' },
  { nombre_completo: 'Jesús Antonio Esteva Medina', cargo: 'Secretario de Infraestructura, Comunicaciones y Transportes', nivel: 'FEDERAL', entidad: 'SICT', poder: 'EJECUTIVO', tipo_coincidencia: 'RED' },
  { nombre_completo: 'Raquel Buenrostro Sánchez', cargo: 'Secretaria de la Función Pública', nivel: 'FEDERAL', entidad: 'SFP', poder: 'EJECUTIVO', tipo_coincidencia: 'RED' },
  { nombre_completo: 'Ricardo Trevilla Trejo', cargo: 'Secretario de la Defensa Nacional', nivel: 'FEDERAL', entidad: 'SEDENA', poder: 'EJECUTIVO', tipo_coincidencia: 'RED' },
  { nombre_completo: 'Raymundo Pedro Morales Ángeles', cargo: 'Secretario de Marina', nivel: 'FEDERAL', entidad: 'SEMAR', poder: 'EJECUTIVO', tipo_coincidencia: 'RED' },

  // ── ORGANISMOS FINANCIEROS CLAVE (alto riesgo para casa de cambio) ────────
  { nombre_completo: 'Victoria Rodríguez Ceja', cargo: 'Gobernadora del Banco de México', nivel: 'FEDERAL', entidad: 'BANXICO', poder: 'AUTONOMO', tipo_coincidencia: 'RED' },
  { nombre_completo: 'Jesús de la Fuente Rodríguez', cargo: 'Presidente de la CNBV', nivel: 'FEDERAL', entidad: 'CNBV', poder: 'AUTONOMO', tipo_coincidencia: 'RED' },
  { nombre_completo: 'Antonio Martínez Dagnino', cargo: 'Jefe del SAT', nivel: 'FEDERAL', entidad: 'SAT', poder: 'EJECUTIVO', tipo_coincidencia: 'RED' },

  // ── PODER JUDICIAL FEDERAL ────────────────────────────────────────────────
  { nombre_completo: 'Norma Lucía Piña Hernández', cargo: 'Ministra Presidenta de la SCJN', nivel: 'FEDERAL', entidad: 'SCJN', poder: 'JUDICIAL', tipo_coincidencia: 'RED' },

  // ── PODER LEGISLATIVO FEDERAL (liderazgos) ────────────────────────────────
  { nombre_completo: 'Gerardo Fernández Noroña', cargo: 'Presidente de la Mesa Directiva del Senado', nivel: 'FEDERAL', entidad: 'Senado', poder: 'LEGISLATIVO', tipo_coincidencia: 'RED' },
  { nombre_completo: 'Ricardo Monreal Ávila', cargo: 'Coordinador de Morena en Cámara de Diputados', nivel: 'FEDERAL', entidad: 'Diputados', poder: 'LEGISLATIVO', tipo_coincidencia: 'RED' },
];
