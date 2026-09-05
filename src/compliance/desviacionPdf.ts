/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SICC — Generador de PDF: Formato de Desviación de Arqueo (Fase 4)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Genera el "Formato de Desviación" oficial cuando el arqueo ciego de un cajero
 * no coincide con el saldo esperado del libro mayor. Este documento es el
 * soporte físico/digital que el gerente firma al autorizar la discrepancia.
 *
 * Usa pdfkit (backend). Devuelve un Buffer que el endpoint envía como
 * application/pdf.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import PDFDocument from 'pdfkit';

export interface DesviacionMoneda {
  moneda: string;          // 'MXN', 'USD', 'EUR'
  declarado: number;       // conteo físico del cajero
  esperado: number;        // saldo del libro mayor
  diferencia: number;      // declarado - esperado
  equivalenteMxn?: number; // diferencia convertida a MXN
}

export interface DatosFormatoDesviacion {
  folio: string;
  fecha: string;
  cajeroNombre: string;
  cajeroId: string;
  sucursal: string;
  terminal?: string;
  turnoId: string | number;
  desviaciones: DesviacionMoneda[];
  totalEquivalenteMxn: number;
  autorizadoPor?: string;
  claveAutorizacion?: string;
  observaciones?: string;
}

/**
 * Genera el PDF del Formato de Desviación y devuelve un Buffer.
 */
export function generarFormatoDesviacionPDF(datos: DatosFormatoDesviacion): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const azul = '#1a3a5c';
      const rojo = '#c0392b';
      const gris = '#555555';

      // ── ENCABEZADO ──────────────────────────────────────────────────────
      doc.rect(0, 0, doc.page.width, 90).fill(azul);
      doc.fillColor('white').fontSize(20).font('Helvetica-Bold')
        .text('SICC', 50, 28);
      doc.fontSize(9).font('Helvetica')
        .text('Sistema de Intercompensación Cambiaria y Compensación', 50, 52);
      doc.fontSize(14).font('Helvetica-Bold')
        .text('FORMATO DE DESVIACIÓN DE ARQUEO', 50, 66, { align: 'right', width: doc.page.width - 100 });

      doc.moveDown(4);
      doc.fillColor(gris).fontSize(9).font('Helvetica');

      // ── DATOS DE CABECERA ───────────────────────────────────────────────
      let y = 110;
      const col1 = 50, col2 = 310;
      const linea = (label: string, valor: string, x: number, yy: number) => {
        doc.font('Helvetica-Bold').fillColor(azul).fontSize(8).text(label, x, yy);
        doc.font('Helvetica').fillColor('#000').fontSize(10).text(valor || '—', x, yy + 11);
      };

      linea('FOLIO', datos.folio, col1, y);
      linea('FECHA', datos.fecha, col2, y);
      y += 32;
      linea('CAJERO', `${datos.cajeroNombre} (${datos.cajeroId})`, col1, y);
      linea('TURNO', String(datos.turnoId), col2, y);
      y += 32;
      linea('SUCURSAL', datos.sucursal, col1, y);
      linea('TERMINAL', datos.terminal || 'N/A', col2, y);
      y += 40;

      // ── AVISO DE ARQUEO CIEGO ───────────────────────────────────────────
      doc.rect(50, y, doc.page.width - 100, 28).fillAndStroke('#fff3cd', '#ffc107');
      doc.fillColor('#856404').fontSize(8).font('Helvetica-Bold')
        .text('⚠ Documento generado por discrepancia entre el ARQUEO CIEGO físico y el saldo del libro mayor.',
          58, y + 9, { width: doc.page.width - 116 });
      y += 44;

      // ── TABLA DE DESVIACIONES ───────────────────────────────────────────
      doc.fillColor(azul).fontSize(11).font('Helvetica-Bold')
        .text('Detalle de Diferencias por Moneda', 50, y);
      y += 20;

      const tblX = 50;
      const tblW = doc.page.width - 100;
      const colW = [70, 110, 110, 110, tblW - 400];

      // Cabecera de tabla
      doc.rect(tblX, y, tblW, 22).fill(azul);
      doc.fillColor('white').fontSize(8).font('Helvetica-Bold');
      const headers = ['MONEDA', 'DECLARADO', 'ESPERADO', 'DIFERENCIA', 'EQUIV. MXN'];
      let cx = tblX + 6;
      headers.forEach((h, i) => { doc.text(h, cx, y + 7, { width: colW[i] - 8 }); cx += colW[i]; });
      y += 22;

      // Filas
      doc.font('Helvetica').fontSize(9);
      datos.desviaciones.forEach((d, idx) => {
        const bg = idx % 2 === 0 ? '#f7f7f7' : '#ffffff';
        doc.rect(tblX, y, tblW, 20).fill(bg);
        const esNeg = d.diferencia < 0;
        cx = tblX + 6;
        const fmt = (n: number) => n.toLocaleString('es-MX', { minimumFractionDigits: 2 });
        const cells = [
          d.moneda,
          fmt(d.declarado),
          fmt(d.esperado),
          `${d.diferencia >= 0 ? '+' : ''}${fmt(d.diferencia)}`,
          d.equivalenteMxn !== undefined ? `${d.equivalenteMxn >= 0 ? '+' : ''}${fmt(d.equivalenteMxn)}` : '—',
        ];
        cells.forEach((c, i) => {
          doc.fillColor(i >= 3 && esNeg ? rojo : '#000').text(c, cx, y + 6, { width: colW[i] - 8 });
          cx += colW[i];
        });
        y += 20;
      });

      // Total
      doc.rect(tblX, y, tblW, 24).fill('#e8eef4');
      doc.fillColor(azul).fontSize(9).font('Helvetica-Bold')
        .text('TOTAL EQUIVALENTE MXN', tblX + 6, y + 8);
      const totalNeg = datos.totalEquivalenteMxn < 0;
      doc.fillColor(totalNeg ? rojo : '#1e7e34').fontSize(11)
        .text(
          `${datos.totalEquivalenteMxn >= 0 ? '+' : ''}$${datos.totalEquivalenteMxn.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`,
          tblX + tblW - 200, y + 6, { width: 194, align: 'right' }
        );
      y += 40;

      // ── OBSERVACIONES ───────────────────────────────────────────────────
      if (datos.observaciones) {
        doc.fillColor(azul).fontSize(10).font('Helvetica-Bold').text('Observaciones', 50, y);
        y += 15;
        doc.fillColor('#000').fontSize(9).font('Helvetica')
          .text(datos.observaciones, 50, y, { width: doc.page.width - 100 });
        y += 40;
      }

      // ── BLOQUE DE AUTORIZACIÓN ──────────────────────────────────────────
      y = Math.max(y, 640);
      doc.moveTo(50, y).lineTo(doc.page.width - 50, y).stroke('#cccccc');
      y += 15;
      doc.fillColor(azul).fontSize(10).font('Helvetica-Bold')
        .text('Autorización de Desviación', 50, y);
      y += 20;

      linea('AUTORIZADO POR (Gerente/Cumplimiento)', datos.autorizadoPor || '__________________________', 50, y);
      linea('CLAVE DE AUTORIZACIÓN', datos.claveAutorizacion || '_________', 340, y);
      y += 50;

      // Líneas de firma
      doc.fontSize(8).fillColor(gris).font('Helvetica');
      doc.moveTo(70, y).lineTo(240, y).stroke('#333');
      doc.text('Firma del Cajero', 70, y + 4);
      doc.moveTo(330, y).lineTo(500, y).stroke('#333');
      doc.text('Firma del Autorizante', 330, y + 4);

      // ── PIE ─────────────────────────────────────────────────────────────
      doc.fontSize(7).fillColor('#999')
        .text(
          `Documento generado automáticamente por SICC · ${new Date().toISOString()} · Folio ${datos.folio}`,
          50, doc.page.height - 40, { align: 'center', width: doc.page.width - 100 }
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
