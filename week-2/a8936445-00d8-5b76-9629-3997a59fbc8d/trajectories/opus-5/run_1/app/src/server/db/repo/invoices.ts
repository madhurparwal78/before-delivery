import { randomUUID } from 'node:crypto';
import { pool, type Queryable } from '../pool.js';
import type { InvoiceLineKind } from '../../domain/constants.js';
import type { InvoiceLineRecord, InvoiceRecord } from '../../domain/types.js';

interface InvoiceRow {
  id: string;
  number: string;
  tenant_id: string;
  period: string;
  status: 'issued' | 'paid';
  subtotal_cents: number;
  tax_rate_percent: string;
  tax_cents: number;
  total_cents: number;
  pdf_key: string;
  issued_at: Date;
  paid_at: Date | null;
}

interface LineRow {
  invoice_id: string;
  kind: InvoiceLineKind;
  description: string;
  booking_ref: string | null;
  shelf_id: string | null;
  amount_cents: number;
}

function toInvoice(row: InvoiceRow, lines: InvoiceLineRecord[]): InvoiceRecord {
  return {
    id: row.id,
    number: row.number,
    tenantId: row.tenant_id,
    period: row.period,
    status: row.status,
    lines,
    subtotalCents: row.subtotal_cents,
    taxRatePercent: row.tax_rate_percent,
    taxCents: row.tax_cents,
    totalCents: row.total_cents,
    pdfKey: row.pdf_key,
    issuedAt: row.issued_at,
    paidAt: row.paid_at,
  };
}

async function linesFor(invoiceIds: readonly string[]): Promise<Map<string, InvoiceLineRecord[]>> {
  const grouped = new Map<string, InvoiceLineRecord[]>();
  if (invoiceIds.length === 0) return grouped;
  const result = await pool.query<LineRow>(
    'SELECT * FROM invoice_lines WHERE invoice_id = ANY($1::uuid[]) ORDER BY invoice_id, position',
    [invoiceIds],
  );
  for (const row of result.rows) {
    const list = grouped.get(row.invoice_id) ?? [];
    list.push({
      kind: row.kind,
      description: row.description,
      bookingRef: row.booking_ref,
      shelfId: row.shelf_id,
      amountCents: row.amount_cents,
    });
    grouped.set(row.invoice_id, list);
  }
  return grouped;
}

export async function listInvoices(tenantId: string | null): Promise<InvoiceRecord[]> {
  const result = tenantId
    ? await pool.query<InvoiceRow>(
        'SELECT * FROM invoices WHERE tenant_id = $1 ORDER BY issued_at DESC, number DESC',
        [tenantId],
      )
    : await pool.query<InvoiceRow>('SELECT * FROM invoices ORDER BY issued_at DESC, number DESC');
  const lines = await linesFor(result.rows.map((row) => row.id));
  return result.rows.map((row) => toInvoice(row, lines.get(row.id) ?? []));
}

export async function findInvoice(id: string, db: Queryable = pool): Promise<InvoiceRecord | null> {
  const result = await db.query<InvoiceRow>('SELECT * FROM invoices WHERE id = $1', [id]);
  const row = result.rows[0];
  if (!row) return null;
  const lines = await linesFor([row.id]);
  return toInvoice(row, lines.get(row.id) ?? []);
}

export async function lockInvoice(db: Queryable, id: string): Promise<InvoiceRow | null> {
  const result = await db.query<InvoiceRow>('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [id]);
  return result.rows[0] ?? null;
}

export async function nextInvoiceNumber(db: Queryable, period: string): Promise<string> {
  const prefix = `INV-${period.replace('-', '')}-`;
  const result = await db.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM invoices WHERE period = $1',
    [period],
  );
  const sequence = (result.rows[0]?.count ?? 0) + 1;
  return `${prefix}${String(sequence).padStart(4, '0')}`;
}

export async function insertInvoice(db: Queryable, invoice: InvoiceRecord): Promise<void> {
  await db.query(
    `INSERT INTO invoices (id, number, tenant_id, period, status, subtotal_cents, tax_rate_percent,
       tax_cents, total_cents, pdf_key, issued_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      invoice.id,
      invoice.number,
      invoice.tenantId,
      invoice.period,
      invoice.status,
      invoice.subtotalCents,
      invoice.taxRatePercent,
      invoice.taxCents,
      invoice.totalCents,
      invoice.pdfKey,
      invoice.issuedAt,
    ],
  );
  for (const [position, line] of invoice.lines.entries()) {
    await db.query(
      `INSERT INTO invoice_lines (id, invoice_id, position, kind, description, booking_ref, shelf_id, amount_cents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        randomUUID(),
        invoice.id,
        position,
        line.kind,
        line.description,
        line.bookingRef,
        line.shelfId,
        line.amountCents,
      ],
    );
  }
}

export async function markInvoicePaid(db: Queryable, id: string, paidAt: Date): Promise<void> {
  await db.query("UPDATE invoices SET status = 'paid', paid_at = $2 WHERE id = $1", [id, paidAt]);
}

export async function shelvesAlreadyBilled(
  db: Queryable,
  tenantId: string,
  period: string,
): Promise<Set<string>> {
  const result = await db.query<{ shelf_id: string }>(
    `SELECT l.shelf_id FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
      WHERE i.tenant_id = $1 AND i.period = $2 AND l.shelf_id IS NOT NULL`,
    [tenantId, period],
  );
  return new Set(result.rows.map((row) => row.shelf_id));
}
