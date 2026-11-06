import { flavourName } from '../../shared/catalogue.js';
import { formatLongDate } from '../../shared/time.js';
import type { OrderRecord } from '../db/orders.js';
import { objectKeys, putObjectOnce } from '../services/files.js';
import { renderTextPdf, type PdfLine } from '../services/pdf.js';
import { lineRows, receiptRows, shipToLines } from './receipt.js';

/**
 * Neither document carries card data, provider identifiers, keys or any address
 * other than this order's ship-to address.
 */
function invoicePdf(order: OrderRecord): Buffer {
  const lines: PdfLine[] = [
    { text: 'Ceibo', size: 22, bold: true },
    { text: 'Organic sparkling yerba mate', size: 10 },
    { text: `Invoice for order ${order.number}`, size: 15, bold: true, gap: 18 },
    { text: `Placed ${formatLongDate(order.placed_at.slice(0, 10))}`, size: 10 },
    { text: 'Ship to', size: 11, bold: true, gap: 14 },
    ...shipToLines(order).map((text) => ({ text, size: 10 })),
    { text: 'Your cans', size: 11, bold: true, gap: 14 },
    ...lineRows(order).map((row) => ({ text: `${row.label}   ${row.value}`, size: 10 })),
    { text: 'Totals', size: 11, bold: true, gap: 14 },
    ...receiptRows(order).map((row) => ({ text: `${row.label}   ${row.value}`, size: 10 })),
  ];
  return renderTextPdf(lines);
}

function packingSlipPdf(order: OrderRecord): Buffer {
  const lines: PdfLine[] = [
    { text: 'Ceibo', size: 22, bold: true },
    { text: `Packing slip ${order.number}`, size: 15, bold: true, gap: 18 },
    { text: 'Ship to', size: 11, bold: true, gap: 14 },
    ...shipToLines(order).map((text) => ({ text, size: 10 })),
    { text: 'Cans', size: 11, bold: true, gap: 14 },
    ...order.lines.map((line) => ({
      text: `${line.quantity} x ${flavourName(line.flavour)}`,
      size: 10,
    })),
  ];
  return renderTextPdf(lines);
}

/** Writes both PDFs once. For a checkout this runs before the charge. */
export async function storeOrderDocuments(order: OrderRecord): Promise<void> {
  await putObjectOnce(objectKeys.invoice(order.number), invoicePdf(order), 'application/pdf');
  await putObjectOnce(
    objectKeys.packingSlip(order.number),
    packingSlipPdf(order),
    'application/pdf',
  );
}
