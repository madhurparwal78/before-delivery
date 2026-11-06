import PDFDocument from 'pdfkit';
import { formatAmount, t, type Locale } from '../locales.js';
import type { OrderRow } from '../domain/commerce.js';

/** The receipt's invoice PDF: extractable text, the receipt Total line, one Refunded line per refund. */
export function renderInvoicePdf(
  order: OrderRow,
  modelTitle: string,
  refunds: { amount_cents: number; created_at: string }[],
): Promise<Buffer> {
  const locale = order.locale as Locale;
  const doc = new PDFDocument({ size: 'A4', margin: 60 });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>(resolve => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  doc.fontSize(20).font('Helvetica-Bold').text(t(locale, 'brand'));
  doc.moveDown();
  doc.fontSize(14).text(`${t(locale, 'invoice.heading')}: ${order.order_ref}`);
  doc.moveDown(0.5);
  doc.fontSize(11).font('Helvetica').text(`${t(locale, 'receipt.licence')}: ${licenceLabel(order, locale)}`);
  doc.text(modelTitle);
  doc.text(order.buyer_email);
  doc.moveDown();
  doc.font('Helvetica-Bold').fontSize(13).text(t(locale, 'receipt.total', { amount: formatAmount(order.amount_cents, locale) }));
  doc.font('Helvetica').moveDown(0.5);
  for (const refund of refunds) {
    doc.fontSize(11).text(t(locale, 'receipt.refunded_line', { amount: formatAmount(refund.amount_cents, locale) }));
  }
  if (order.edition_number !== null && order.edition_total !== null) {
    doc.fontSize(11).text(t(locale, 'receipt.edition_line', { n: order.edition_number, total: order.edition_total }));
  }
  doc.moveDown();
  doc.fontSize(9).text(`${t(locale, 'brand')} · Turnstone Studio`);
  doc.end();
  return done;
}

function licenceLabel(order: OrderRow, locale: Locale): string {
  if (order.licence === 'edition') return t(locale, 'licence.edition');
  if (order.licence === 'personal') return t(locale, 'licence.personal');
  if (order.licence === 'commercial') return t(locale, 'licence.commercial');
  return t(locale, 'licence.studio');
}


