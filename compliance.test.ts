import { describe, it, expect, beforeAll } from 'vitest';
import {
  normalizarNombre,
  codigoFonetico,
  buscarFuzzy,
  evaluarNivelRiesgo,
  RegistroRiesgo,
} from './src/compliance/fuzzyMatcher';
import {
  requisitosCapturaPorMonto,
  validarCandadoCaptura,
} from './src/compliance/complianceService';
import {
  rangoTrimestre,
  generarReporteRip,
  reporteRipACsv,
} from './src/compliance/ripReporter';
import { PEP_MEXICO_SEED } from './src/compliance/pepSeedMexico';

// ═══════════════════════════════════════════════════════════════════════════
// FASE 4 — Motor de Cumplimiento Independiente: Tests Unitarios
// ═══════════════════════════════════════════════════════════════════════════

describe('FuzzyMatcher — Normalización y Fonética', () => {
  it('normaliza acentos y mayúsculas', () => {
    expect(normalizarNombre('José  Guzmán Loera')).toBe('JOSE GUZMAN LOERA');
  });

  it('colapsa espacios múltiples y elimina puntuación', () => {
    expect(normalizarNombre('  John   Smith, Jr.  ')).toBe('JOHN SMITH JR');
  });

  it('genera código fonético estable (GUZMAN ≈ GUSMAN)', () => {
    expect(codigoFonetico('GUZMAN')).toBe(codigoFonetico('GUSMAN'));
  });

  it('genera código fonético para nombres latinos', () => {
    const dm = codigoFonetico('SHEINBAUM');
    expect(dm.length).toBeGreaterThan(0);
  });
});

describe('FuzzyMatcher — Matching con typos y variaciones', () => {
  const registros: RegistroRiesgo[] = [
    { id: 1, lista: 'OFAC', nombre_completo: 'Joaquín Guzmán Loera', tipo_coincidencia: 'RED' },
    { id: 2, lista: 'PEP', nombre_completo: 'Claudia Sheinbaum Pardo', tipo_coincidencia: 'RED' },
    { id: 3, lista: 'OFAC', nombre_completo: 'BANCO NACIONAL DE CUBA', tipo_coincidencia: 'RED' },
  ];

  it('encuentra match EXACTO', () => {
    const r = buscarFuzzy('Joaquin Guzman Loera', registros, 0.55);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].nivel_match).toBe('EXACTO');
    expect(r[0].score_similitud).toBe(1);
  });

  it('detecta typo fonético (Loerra → Loera)', () => {
    const r = buscarFuzzy('Joaquin Guzman Loerra', registros, 0.55);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].nivel_match).toBe('FONETICO');
  });

  it('detecta variación fonética de nombre (Klaudia → Claudia)', () => {
    const r = buscarFuzzy('Klaudia Sheinbaum', registros, 0.5);
    expect(r.length).toBeGreaterThan(0);
  });

  it('no produce falsos positivos para nombres inventados', () => {
    const r = buscarFuzzy('Persona Totalmente Inexistente', registros, 0.55);
    expect(r.length).toBe(0);
  });
});

describe('FuzzyMatcher — Evaluación de nivel de riesgo', () => {
  it('devuelve VERDE sin matches', () => {
    expect(evaluarNivelRiesgo([])).toBe('VERDE');
  });

  it('devuelve ROJO con match RED exacto', () => {
    const m = buscarFuzzy('Joaquin Guzman Loera', [
      { id: 1, lista: 'OFAC', nombre_completo: 'Joaquín Guzmán Loera', tipo_coincidencia: 'RED' },
    ], 0.55);
    expect(evaluarNivelRiesgo(m)).toBe('ROJO');
  });

  it('devuelve AMARILLO con match de baja confianza', () => {
    const m = buscarFuzzy('Guzman', [
      { id: 1, lista: 'OFAC', nombre_completo: 'Joaquín Guzmán Loera', tipo_coincidencia: 'RED' },
    ], 0.4);
    // Un solo apellido común no debería ser ROJO automático
    const nivel = evaluarNivelRiesgo(m);
    expect(['AMARILLO', 'VERDE']).toContain(nivel);
  });
});

describe('Candados de Captura Obligatoria', () => {
  it('clasifica correctamente el umbral $1k USD', () => {
    const r = requisitosCapturaPorMonto(1000);
    expect(r.requiere_id).toBe(true);
    expect(r.requiere_domicilio).toBe(false);
    expect(r.requiere_expediente).toBe(false);
  });

  it('clasifica correctamente el umbral $3k USD', () => {
    const r = requisitosCapturaPorMonto(3000);
    expect(r.requiere_id).toBe(true);
    expect(r.requiere_domicilio).toBe(true);
    expect(r.requiere_expediente).toBe(false);
  });

  it('clasifica correctamente el umbral $5k USD (expediente + clave N5)', () => {
    const r = requisitosCapturaPorMonto(5000);
    expect(r.requiere_id).toBe(true);
    expect(r.requiere_domicilio).toBe(true);
    expect(r.requiere_expediente).toBe(true);
    expect(r.requiere_clave_n5).toBe(true);
  });

  it('bloquea operación $5k sin datos capturados', () => {
    const v = validarCandadoCaptura(5000, {});
    expect(v.permitido).toBe(false);
    expect(v.faltantes.length).toBe(4);
  });

  it('bloquea operación $5k con clave N5 inválida (longitud)', () => {
    const v = validarCandadoCaptura(5000, {
      tiene_id: true, tiene_domicilio: true, tiene_expediente: true, clave_n5: 'ABC12',
    });
    expect(v.permitido).toBe(false);
    expect(v.faltantes).toContain('Clave Nivel 5 inválida (debe ser 9 caracteres, recibió 5)');
  });

  it('permite operación $5k con todo capturado + clave 9 chars', () => {
    const v = validarCandadoCaptura(5000, {
      tiene_id: true, tiene_domicilio: true, tiene_expediente: true, clave_n5: 'ABC123456',
    });
    expect(v.permitido).toBe(true);
    expect(v.faltantes.length).toBe(0);
  });

  it('permite operación $1.5k con solo identificación', () => {
    const v = validarCandadoCaptura(1500, { tiene_id: true });
    expect(v.permitido).toBe(true);
  });
});

describe('Reportes RIP Trimestrales', () => {
  it('calcula rango de trimestre correcto (Q3 2026)', () => {
    const r = rangoTrimestre({ anio: 2026, trimestre: 3 });
    expect(r.inicio).toBe('2026-07-01T00:00:00.000Z');
    expect(r.fin).toBe('2026-09-30T23:59:59.000Z');
  });

  it('calcula rango de trimestre correcto (Q1 2026)', () => {
    const r = rangoTrimestre({ anio: 2026, trimestre: 1 });
    expect(r.inicio).toBe('2026-01-01T00:00:00.000Z');
    expect(r.fin).toBe('2026-03-31T23:59:59.000Z');
  });

  it('genera reporte con resumen correcto (vacío = cero operaciones)', () => {
    const rep = generarReporteRip({ anio: 2026, trimestre: 3 });
    expect(rep.periodo).toBe('2026-Q3');
    expect(rep.resumen.totalOperaciones).toBe(0);
    expect(rep.resumen.montoTotalUsd).toBe(0);
  });

  it('serializa a CSV con header', () => {
    const rep = generarReporteRip({ anio: 2026, trimestre: 3 });
    const csv = reporteRipACsv(rep);
    expect(csv.split('\n')[0]).toContain('ID,Fecha,Tipo,Cliente');
  });
});

describe('Dataset PEP México', () => {
  it('contiene PEPs federales válidos', () => {
    expect(PEP_MEXICO_SEED.length).toBeGreaterThan(20);
  });

  it('todos los PEPs tienen tipo RED y nivel FEDERAL', () => {
    PEP_MEXICO_SEED.forEach(p => {
      expect(p.tipo_coincidencia).toBe('RED');
      expect(p.nivel).toBe('FEDERAL');
    });
  });

  it('incluye a la Presidenta como PEP clave', () => {
    const presidenta = PEP_MEXICO_SEED.find(p => p.cargo.includes('Presidenta de la República'));
    expect(presidenta).toBeDefined();
    expect(presidenta!.nombre_completo).toBe('Claudia Sheinbaum Pardo');
  });
});
