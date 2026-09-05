import { buscarEnListas, requisitosCapturaPorMonto, validarCandadoCaptura } from './complianceService';

console.log('=== TEST: Búsqueda optimizada con índice fonético ===\n');

const casos = [
  'Joaquin Guzman Loera',
  'Joaquín Guzmán Loerra',   // typo
  'Claudia Sheinbaum',        // PEP México
  'Klaudia Sheinbaom',        // PEP con typos fonéticos
  'Persona Inexistente ZZZ',  // VERDE
];

for (const q of casos) {
  const r = buscarEnListas(q, 0.55);
  console.log(`▶ "${q}"`);
  console.log(`  Nivel: ${r.riskLevel} | Candidatos revisados: ${r.totalRevisados} | ${r.tiempoMs}ms`);
  r.matches.slice(0, 2).forEach(m =>
    console.log(`    - [${m.lista}] ${m.nombre_completo} (${m.nivel_match}, ${m.score_similitud})`)
  );
  console.log('');
}

console.log('=== TEST: Candados de captura obligatoria ===\n');
[500, 1000, 3000, 5000, 12000].forEach(monto => {
  const req = requisitosCapturaPorMonto(monto);
  console.log(`$${monto} USD → ${req.descripcion}`);
  console.log(`  ID:${req.requiere_id} Dom:${req.requiere_domicilio} Exp:${req.requiere_expediente} ClaveN5:${req.requiere_clave_n5}`);
});

console.log('\n=== TEST: Validación de candado (bloqueo real) ===\n');
// $5k sin nada capturado → debe bloquear
const v1 = validarCandadoCaptura(5000, {});
console.log(`$5k sin datos → permitido=${v1.permitido}, faltantes=[${v1.faltantes.join(', ')}]`);
// $5k con todo + clave 9 chars → debe permitir
const v2 = validarCandadoCaptura(5000, { tiene_id: true, tiene_domicilio: true, tiene_expediente: true, clave_n5: 'ABC123456' });
console.log(`$5k completo → permitido=${v2.permitido}`);
// $5k con clave inválida (5 chars) → debe bloquear
const v3 = validarCandadoCaptura(5000, { tiene_id: true, tiene_domicilio: true, tiene_expediente: true, clave_n5: 'ABC12' });
console.log(`$5k clave corta → permitido=${v3.permitido}, faltantes=[${v3.faltantes.join(', ')}]`);
// $1500 solo con ID → debe permitir
const v4 = validarCandadoCaptura(1500, { tiene_id: true });
console.log(`$1.5k con ID → permitido=${v4.permitido}`);
