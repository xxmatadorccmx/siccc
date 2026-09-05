import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { calcularFIFO, ejecutarFIFO, LoteInventario } from './src/db/fifo';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FASE 5 — Tests de integración del motor PEPS/FIFO (fraccionamiento de lotes)
 * ═══════════════════════════════════════════════════════════════════════════
 * Caso crítico: cuando una venta de divisas supera la cantidad disponible en un
 * solo lote de inventario, el sistema debe FRACCIONAR el consumo entre varios
 * lotes consecutivos (los más antiguos primero).
 * ═══════════════════════════════════════════════════════════════════════════
 */

// Lotes de ejemplo ordenados por antigüedad (PEPS: los más antiguos primero).
// cost_basis = precio de compra original en MXN por unidad.
const lotesDeEjemplo: LoteInventario[] = [
  { id: 1, currency_code: 'USD', quantity: 100, remaining_quantity: 100, cost_basis: 17.50, created_at: '2026-01-01T00:00:00Z' }, // lote más antiguo
  { id: 2, currency_code: 'USD', quantity: 200, remaining_quantity: 200, cost_basis: 18.00, created_at: '2026-02-01T00:00:00Z' },
  { id: 3, currency_code: 'USD', quantity: 300, remaining_quantity: 300, cost_basis: 18.50, created_at: '2026-03-01T00:00:00Z' }, // lote más nuevo
];

describe('calcularFIFO — función pura (fraccionamiento)', () => {
  it('venta menor a un lote: consume solo del lote más antiguo', () => {
    const r = calcularFIFO(lotesDeEjemplo, 50);
    expect(r.cantidadVendida).toBe(50);
    expect(r.cantidadFaltante).toBe(0);
    expect(r.fracciones.length).toBe(1);
    expect(r.fracciones[0].lote_id).toBe(1);
    expect(r.fracciones[0].tomado).toBe(50);
    expect(r.costoTotal).toBe(50 * 17.50);
  });

  it('venta exacta de un lote completo', () => {
    const r = calcularFIFO(lotesDeEjemplo, 100);
    expect(r.cantidadVendida).toBe(100);
    expect(r.fracciones.length).toBe(1);
    expect(r.fracciones[0].lote_id).toBe(1);
    expect(r.fracciones[0].tomado).toBe(100);
    expect(r.costoTotal).toBe(100 * 17.50);
  });

  it('★ CRÍTICO: venta que SUPERA un lote → fracciona en múltiples lotes PEPS', () => {
    // Vender 150 USD: 100 del lote 1 (17.50) + 50 del lote 2 (18.00)
    const r = calcularFIFO(lotesDeEjemplo, 150);
    expect(r.cantidadVendida).toBe(150);
    expect(r.cantidadFaltante).toBe(0);
    expect(r.fracciones.length).toBe(2);

    // Primera fracción: lote más antiguo (id 1)
    expect(r.fracciones[0].lote_id).toBe(1);
    expect(r.fracciones[0].tomado).toBe(100);
    expect(r.fracciones[0].cost_basis).toBe(17.50);

    // Segunda fracción: siguiente lote (id 2)
    expect(r.fracciones[1].lote_id).toBe(2);
    expect(r.fracciones[1].tomado).toBe(50);
    expect(r.fracciones[1].cost_basis).toBe(18.00);

    // Costo total PEPS = 100*17.50 + 50*18.00 = 1750 + 900 = 2650
    expect(r.costoTotal).toBe(100 * 17.50 + 50 * 18.00);
    expect(r.costoTotal).toBe(2650);
  });

  it('venta que abarca 3 lotes completos', () => {
    // 100 + 200 + 300 = 600 total. Vender 550 → consume lote 1 (100), lote 2 (200), lote 3 (250)
    const r = calcularFIFO(lotesDeEjemplo, 550);
    expect(r.cantidadVendida).toBe(550);
    expect(r.cantidadFaltante).toBe(0);
    expect(r.fracciones.length).toBe(3);
    expect(r.fracciones[0].tomado).toBe(100);
    expect(r.fracciones[1].tomado).toBe(200);
    expect(r.fracciones[2].tomado).toBe(250);
    expect(r.costoTotal).toBe(100 * 17.50 + 200 * 18.00 + 250 * 18.50);
  });

  it('venta que excede el inventario total → cantidadFaltante > 0', () => {
    const r = calcularFIFO(lotesDeEjemplo, 700); // solo hay 600
    expect(r.cantidadVendida).toBe(600);
    expect(r.cantidadFaltante).toBe(100);
    expect(r.fracciones.length).toBe(3); // consumió todo lo disponible
  });

  it('ignora lotes con remaining_quantity = 0', () => {
    const lotesConVacio = [
      { id: 1, currency_code: 'USD', quantity: 100, remaining_quantity: 0, cost_basis: 17.50 }, // ya agotado
      { id: 2, currency_code: 'USD', quantity: 100, remaining_quantity: 100, cost_basis: 19.00 },
    ];
    const r = calcularFIFO(lotesConVacio, 50);
    expect(r.fracciones.length).toBe(1);
    expect(r.fracciones[0].lote_id).toBe(2);
  });
});

describe('ejecutarFIFO — integración con SQLite (mutación de lotes)', () => {
  let db: any;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE Inventory_Batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        currency_code TEXT NOT NULL,
        quantity NUMERIC(18,8) NOT NULL,
        remaining_quantity NUMERIC(18,8) NOT NULL,
        cost_basis NUMERIC(18,8) NOT NULL,
        reference_op_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    // Sembrar 3 lotes de USD con costos y fechas distintas (PEPS)
    const insert = db.prepare(
      'INSERT INTO Inventory_Batches (currency_code, quantity, remaining_quantity, cost_basis, reference_op_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    insert.run('USD', 100, 100, 17.50, 'OP-1', '2026-01-01T00:00:00Z');
    insert.run('USD', 200, 200, 18.00, 'OP-2', '2026-02-01T00:00:00Z');
    insert.run('USD', 300, 300, 18.50, 'OP-3', '2026-03-01T00:00:00Z');
  });

  afterEach(() => {
    db.close();
  });

  it('consume lotes en orden PEPS y actualiza remaining_quantity', () => {
    // Vender 250 USD → lote 1 (100) + lote 2 (150)
    const r = ejecutarFIFO(db, 'USD', 250);

    expect(r.cantidadVendida).toBe(250);
    expect(r.costoTotal).toBe(100 * 17.50 + 150 * 18.00);

    // Verificar el estado de la BD tras el consumo
    const lotes = db.prepare('SELECT * FROM Inventory_Batches ORDER BY id').all() as any[];
    expect(lotes[0].remaining_quantity).toBe(0);    // lote 1 agotado
    expect(lotes[1].remaining_quantity).toBe(50);   // lote 2 parcial (200 - 150)
    expect(lotes[2].remaining_quantity).toBe(300);  // lote 3 intacto
  });

  it('no consume lotes de otra moneda', () => {
    db.prepare('INSERT INTO Inventory_Batches (currency_code, quantity, remaining_quantity, cost_basis, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('EUR', 500, 500, 20.00, '2026-01-01T00:00:00Z');

    const r = ejecutarFIFO(db, 'USD', 100);
    expect(r.cantidadVendida).toBe(100);

    const eur = db.prepare('SELECT remaining_quantity FROM Inventory_Batches WHERE currency_code = ?').get('EUR') as any;
    expect(eur.remaining_quantity).toBe(500); // EUR intacto
  });

  it('venta que excede inventario: consume todo lo disponible y reporta faltante', () => {
    const r = ejecutarFIFO(db, 'USD', 1000); // solo hay 600
    expect(r.cantidadVendida).toBe(600);
    expect(r.cantidadFaltante).toBe(400);

    const total = db.prepare('SELECT SUM(remaining_quantity) AS s FROM Inventory_Batches WHERE currency_code = ?').get('USD') as any;
    expect(total.s).toBe(0); // todo el inventario USD agotado
  });
});
