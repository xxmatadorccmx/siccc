/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SICC — Motor PEPS/FIFO de Inventario de Divisas (extraído para testing)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Este módulo encapsula la REGLA DE ORO de la inteligencia financiera de SICC:
 * la venta de divisas consume el inventario respetando PEPS/FIFO (Primeras
 * Entradas, Primeras Salidas) — se venden primero los lotes más antiguos.
 *
 * Fue extraído de la lógica `processFIFO` que vivía como closure dentro de
 * `createApp()` en server.ts, para hacerlo TESTEABLE de forma aislada (Fase 5).
 *
 * El caso crítico que este módulo debe manejar: cuando una venta supera la
 * cantidad disponible en un solo lote, debe FRACCIONAR el consumo entre varios
 * lotes consecutivos (los más antiguos primero), sin exceder el inventario.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface LoteInventario {
  id: number | string;
  currency_code: string;
  quantity: number;
  remaining_quantity: number;
  cost_basis: number;        // precio de compra original (MXN por unidad)
  reference_op_id?: string | null;
  created_at?: string;
}

export interface FraccionLote {
  lote_id: number | string;
  tomado: number;            // cantidad tomada de este lote
  cost_basis: number;        // costo unitario de este lote
  costoParcial: number;      // tomado * cost_basis
}

export interface ResultadoFIFO {
  cantidadVendida: number;
  costoTotal: number;        // suma de costoParcial de todas las fracciones
  fracciones: FraccionLote[];
  cantidadFaltante: number;  // 0 si había inventario suficiente, >0 si no
}

/**
 * FUNCIÓN PURA: calcula el fraccionamiento FIFO sobre una lista de lotes.
 *
 * Los lotes DEBEN venir ordenados por antigüedad ascendente (PEPS). Esta
 * función NO muta la base de datos — devuelve el plan de consumo y el costo.
 * Es la pieza que se testea de forma aislada en fifo.test.ts.
 *
 * @param batches        Lotes ordenados por created_at ASC (los más antiguos primero)
 * @param quantityToSell Cantidad a vender (en la moneda del lote)
 */
export function calcularFIFO(
  batches: LoteInventario[],
  quantityToSell: number
): ResultadoFIFO {
  let remaining = quantityToSell;
  let costoTotal = 0;
  const fracciones: FraccionLote[] = [];

  for (const batch of batches) {
    if (remaining <= 0) break;
    if (batch.remaining_quantity <= 0) continue;

    // Tomar lo mínimo entre lo que falta vender y lo disponible en este lote
    const tomado = Math.min(remaining, batch.remaining_quantity);
    const costoParcial = tomado * batch.cost_basis;

    costoTotal += costoParcial;
    fracciones.push({
      lote_id: batch.id,
      tomado,
      cost_basis: batch.cost_basis,
      costoParcial,
    });

    remaining -= tomado;
  }

  return {
    cantidadVendida: quantityToSell - remaining,
    costoTotal,
    fracciones,
    cantidadFaltante: remaining, // >0 significa inventario insuficiente
  };
}

/**
 * Aplica el FIFO sobre la base de datos: lee los lotes, calcula el plan de
 * consumo y ACTUALIZA remaining_quantity de cada lote consumido.
 *
 * @param db             Instancia better-sqlite3
 * @param currency       Código de moneda (USD, EUR, etc.)
 * @param quantityToSell Cantidad a vender
 */
export function ejecutarFIFO(
  db: any,
  currency: string,
  quantityToSell: number
): ResultadoFIFO {
  // Leer lotes disponibles ordenados por antigüedad ascendente (PEPS)
  const batches = db.prepare(
    `SELECT * FROM Inventory_Batches
     WHERE currency_code = ? AND remaining_quantity > 0
     ORDER BY created_at ASC, id ASC`
  ).all(currency) as LoteInventario[];

  const plan = calcularFIFO(batches, quantityToSell);

  // Aplicar el consumo sobre la base de datos dentro de una transacción
  const update = db.prepare(
    `UPDATE Inventory_Batches SET remaining_quantity = remaining_quantity - ? WHERE id = ?`
  );
  const aplicar = db.transaction(() => {
    for (const fraccion of plan.fracciones) {
      update.run(fraccion.tomado, fraccion.lote_id);
    }
  });
  aplicar();

  return plan;
}
