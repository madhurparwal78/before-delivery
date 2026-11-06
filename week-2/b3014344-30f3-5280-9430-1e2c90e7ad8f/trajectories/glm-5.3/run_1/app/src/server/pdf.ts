import type { Amount } from './money.js';
import { formatMoney, amountToString } from './money.js';
import type { KbInvoice } from './killbill.js';
import type { Db } from './db.js';
import { invoiceKey, putObject } from './storage.js';

interface PdfLine {
  text: string;
  bold?: boolean;
  size?: number;
}

/** Escape a string for PDF literal use with WinAnsi encoding. */
function pdfEscape(value: string): string {
  return Buffer.from(value, 'latin1').toString('binary').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function buildPdf(lines: PdfLine[]): Buffer {
  const objects: string[] = [];
  let y = 780;
  const content: string[] = ['BT'];
  for (const line of lines) {
    const size = line.size ?? 11;
    const font = line.bold ? '/F2' : '/F1';
    y -= size + 6;
    content.push(`${font} ${size} Tf`);
    content.push(`1 0 0 1 56 ${y} Tm`);
    content.push(`(${pdfEscape(line.text)}) Tj`);
  }
  content.push('ET');
  const stream = content.join('\n');

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>');
  objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'binary');
}

export function invoicePdf(invoice: KbInvoice, businessName: string, currency: 'USD' | 'ARS'): Buffer {
  const toAmount = (value: number): Amount => ({ currency, minor: BigInt(Math.round(value * 100)) });
  const lines: PdfLine[] = [
    { text: 'Pampero Build Co.', bold: true, size: 18 },
    { text: `Invoice ${invoice.invoiceNumber}`, size: 14 },
    { text: `Date: ${invoice.invoiceDate}` },
    { text: `Billed to: ${businessName}` },
    { text: '' },
  ];
  for (const item of invoice.items) {
    lines.push({ text: `${item.description}: ${formatMoney(toAmount(item.amount))}` });
  }
  lines.push({ text: '' });
  lines.push({ text: `Total: ${formatMoney(toAmount(invoice.amount))}`, bold: true });
  lines.push({ text: `Balance: ${formatMoney(toAmount(invoice.balance))}` });
  lines.push({ text: `Currency: ${invoice.currency}` });
  lines.push({ text: `Amount due: ${amountToString(toAmount(invoice.balance))}` });
  return buildPdf(lines);
}

/** One pass of the invoice PDF writer: every invoice Kill Bill holds for a client account gets its PDF. */
export async function pdfScan(): Promise<void> {
  const { pool } = await import('./db.js');
  const { listAccountInvoices } = await import('./killbill.js');
  const client = await pool.connect().catch(() => null);
  if (!client) return;
  try {
    const accounts = await client.query('SELECT id, killbill_account_id FROM accounts WHERE killbill_account_id IS NOT NULL');
    for (const account of accounts.rows as { id: string; killbill_account_id: string }[]) {
      try {
        const invoices = await listAccountInvoices(account.killbill_account_id);
        for (const invoice of invoices) {
          const known = await client.query('SELECT 1 FROM invoice_records WHERE invoice_id = $1', [invoice.invoiceId]);
          if ((known.rowCount ?? 0) > 0) continue;
          const creditOnly = invoice.items.every((item) => item.itemType === 'CREDIT_ADJ' || item.itemType === 'CBA_ADJ') && invoice.items.length > 0;
          const recurring = invoice.items.some((item) => item.itemType === 'RECURRING');
          if (!creditOnly || recurring) continue;
          await client.query(
            `INSERT INTO invoice_records (invoice_id, account_id, order_id, kind, created_at)
             VALUES ($1, $2, NULL, 'credit', now()) ON CONFLICT (invoice_id) DO NOTHING`,
            [invoice.invoiceId, account.id],
          );
        }
      } catch {
        // billing unreachable: retried on the next scan
      }
    }
    const rows = await client.query(
      `SELECT r.invoice_id, r.order_id, r.account_id FROM invoice_records r WHERE r.pdf_stored_at IS NULL FOR UPDATE SKIP LOCKED`,
    );
    for (const row of rows.rows as { invoice_id: string; order_id: string | null; account_id: string }[]) {
      await writeInvoicePdf(client, row.invoice_id, row.order_id, row.account_id).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

async function writeInvoicePdf(db: Db, invoiceId: string, orderId: string | null, accountId: string): Promise<void> {
  const { getInvoice } = await import('./killbill.js');
  const { getAccount } = await import('./auth.js');
  const invoice = await getInvoice(invoiceId);
  const account = await getAccount(db, accountId);
  const currency = invoice.currency === 'ARS' ? 'ARS' : 'USD';
  const pdf = invoicePdf(invoice, account?.businessName ?? '', currency);
  if (orderId) {
    await putObject(invoiceKey(orderId, invoiceId), pdf, 'application/pdf');
  } else {
    await putObject(`portal/credits/${invoiceId}.pdf`, pdf, 'application/pdf');
  }
  await db.query('UPDATE invoice_records SET pdf_stored_at = now() WHERE invoice_id = $1', [invoiceId]);
}

export function startPdfWorker(): void {
  void (async () => {
    for (;;) {
      await pdfScan().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  })();
}
