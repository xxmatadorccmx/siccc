import { buscarFuzzy, evaluarNivelRiesgo, normalizarNombre, codigoFonetico, RegistroRiesgo } from './fuzzyMatcher';
import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

const DB_PATH = process.env.DB_PATH || 'baas_platform.db';

function cargarOfac(): RegistroRiesgo[] {
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare(
    "SELECT id, nombre_completo, motivo, tipo_coincidencia FROM lista_ofac LIMIT 40000"
  ).all() as any[];
  db.close();
  return rows.map(r => ({
    id: r.id,
    lista: 'OFAC' as const,
    nombre_completo: r.nombre_completo,
    tipo_coincidencia: r.tipo_coincidencia,
    detalles: r.motivo,
  }));
}

console.log('=== SMOKE TEST: Fuzzy Matcher contra OFAC real ===\n');

// Normalización básica
console.log('normalizarNombre("José  Guzmán Loera"):', normalizarNombre('José  Guzmán Loera'));
console.log('codigoFonetico("GUZMAN"):', codigoFonetico('GUZMAN'), '| codigoFonetico("GUSMAN"):', codigoFonetico('GUSMAN'));
console.log('');

const ofac = cargarOfac();
console.log(`Registros OFAC cargados: ${ofac.length}\n`);

const casos = [
  { q: 'Joaquin Guzman Loera', desc: 'Exacto — El Chapo' },
  { q: 'Joaquín Guzmán Loera', desc: 'Con acentos (debe normalizar)' },
  { q: 'Joaquin Guzman Loerra', desc: 'Typo en apellido (Loerra)' },
  { q: 'Guzman Loera', desc: 'Solo apellidos' },
  { q: 'Persona Totalmente Inventada XYZ', desc: 'Sin coincidencia (debe ser VERDE)' },
];

for (const caso of casos) {
  const inicio = Date.now();
  const matches = buscarFuzzy(caso.q, ofac, 0.55);
  const ms = Date.now() - inicio;
  const nivel = evaluarNivelRiesgo(matches);
  console.log(`▶ "${caso.q}" [${caso.desc}]`);
  console.log(`  Nivel: ${nivel} | Matches: ${matches.length} | ${ms}ms`);
  matches.slice(0, 3).forEach(m => {
    console.log(`    - ${m.nombre_completo} (${m.nivel_match}, score=${m.score_similitud}, ${m.tipo_coincidencia})`);
  });
  console.log('');
}
