import { config } from '../config.js';
import { many, nextSequence, one, type Queryable } from '../db/pool.js';
import { newId } from '../lib/codes.js';
import { addSeconds, toUtcIso } from '../lib/time.js';
import { loadEdition } from './programme.js';

export type InvoiceStatus = 'issued' | 'paid' | 'retried' | 'payment_failed' | 'written_off';

export interface InvoiceRow {
  id: string;
  number: string;
  organisation_id: string;
  order_id: string;
  status: InvoiceStatus;
  amount_cents: number;
  issued_at: Date;
  due_at: Date;
  retries_used: number;
  next_retry_at: Date | null;
  collection_pending: boolean;
  killbill_invoice_id: string | null;
}

const INVOICE_COLUMNS = `id, number, organisation_id, order_id, status, amount_cents, issued_at,
  due_at, retries_used, next_retry_at, collection_pending, killbill_invoice_id`;

export const BILLING_DAYS_UNTIL_DUE = 30;
export const RETRY_BILLING_DAYS: readonly number[] = [1, 3, 7];
export const RETRY_SETTLE_BILLING_DAYS = 2;

export function billingDays(count: number): number {
  return count * config.times.billingDaySeconds;
}

export async function invoiceNumber(db: Queryable): Promise<string> {
  const edition = await loadEdition(db);
  const year = edition.first_day.slice(0, 4);
  const sequence = await nextSequence(db, `invoice:${year}`);
  return `INV-${year}-${String(sequence).padStart(4, '0')}`;
}

export async function creditNoteNumber(db: Queryable): Promise<string> {
  const edition = await loadEdition(db);
  const year = edition.first_day.slice(0, 4);
  const sequence = await nextSequence(db, `credit-note:${year}`);
  return `CN-${year}-${String(sequence).padStart(4, '0')}`;
}

export async function loadInvoice(db: Queryable, id: string): Promise<InvoiceRow | null> {
  return one<InvoiceRow>(db, `SELECT ${INVOICE_COLUMNS} FROM invoices WHERE id = $1`, [id]);
}

export async function loadInvoiceByOrder(
  db: Queryable,
  orderId: string,
): Promise<InvoiceRow | null> {
  return one<InvoiceRow>(db, `SELECT ${INVOICE_COLUMNS} FROM invoices WHERE order_id = $1`, [
    orderId,
  ]);
}

export async function listInvoices(
  db: Queryable,
  organisationId: string | null,
): Promise<InvoiceRow[]> {
  if (organisationId === null) {
    return many<InvoiceRow>(db, `SELECT ${INVOICE_COLUMNS} FROM invoices ORDER BY issued_at DESC`);
  }
  return many<InvoiceRow>(
    db,
    `SELECT ${INVOICE_COLUMNS} FROM invoices WHERE organisation_id = $1 ORDER BY issued_at DESC`,
    [organisationId],
  );
}

export interface SerialisedInvoice {
  id: string;
  number: string;
  organisation_id: string;
  order_id: string;
  status: InvoiceStatus;
  amount_cents: number;
  credited_cents: number;
  paid_cents: number;
  balance_cents: number;
  issued_at: string;
  due_at: string;
  retries_used: number;
  next_retry_at: string | null;
  credit_note_ids: string[];
  lines: Array<{ line_id: string; description: string; amount_cents: number }>;
}

export async function creditedCents(db: Queryable, invoiceId: string): Promise<number> {
  const row = await one<{ total: number }>(
    db,
    `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM credit_notes WHERE invoice_id = $1`,
    [invoiceId],
  );
  return row?.total ?? 0;
}

/** Collections minus returns. */
export async function paidCents(db: Queryable, invoiceId: string): Promise<number> {
  const collected = await one<{ total: number }>(
    db,
    `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM invoice_collections
     WHERE invoice_id = $1 AND killbill_payment_id IS NOT NULL`,
    [invoiceId],
  );
  const returned = await one<{ total: number }>(
    db,
    `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM invoice_returns WHERE invoice_id = $1`,
    [invoiceId],
  );
  return (collected?.total ?? 0) - (returned?.total ?? 0);
}

export async function serialiseInvoice(
  db: Queryable,
  invoice: InvoiceRow,
): Promise<SerialisedInvoice> {
  const credited = await creditedCents(db, invoice.id);
  const paid = invoice.status === 'written_off' ? invoice.amount_cents - credited : await paidCents(db, invoice.id);
  const items = await many<{ line_id: string; description: string; amount_cents: number }>(
    db,
    `SELECT line_id, description, amount_cents FROM invoice_items WHERE invoice_id = $1
     ORDER BY amount_cents DESC, description`,
    [invoice.id],
  );
  const notes = await many<{ id: string }>(
    db,
    `SELECT id FROM credit_notes WHERE invoice_id = $1 ORDER BY issued_at`,
    [invoice.id],
  );
  return {
    id: invoice.id,
    number: invoice.number,
    organisation_id: invoice.organisation_id,
    order_id: invoice.order_id,
    status: invoice.status,
    amount_cents: invoice.amount_cents,
    credited_cents: credited,
    paid_cents: paid,
    balance_cents: invoice.amount_cents - credited - paid,
    issued_at: toUtcIso(invoice.issued_at),
    due_at: toUtcIso(invoice.due_at),
    retries_used: invoice.retries_used,
    next_retry_at: invoice.next_retry_at === null ? null : toUtcIso(invoice.next_retry_at),
    credit_note_ids: notes.map((note) => note.id),
    lines: items,
  };
}

export interface SerialisedCreditNote {
  id: string;
  number: string;
  invoice_id: string;
  amount_cents: number;
  issued_at: string;
  lines: Array<{ line_id: string; description: string; amount_cents: number }>;
}

export async function serialiseCreditNote(
  db: Queryable,
  id: string,
): Promise<SerialisedCreditNote | null> {
  const note = await one<{
    id: string;
    number: string;
    invoice_id: string;
    amount_cents: number;
    issued_at: Date;
  }>(db, `SELECT id, number, invoice_id, amount_cents, issued_at FROM credit_notes WHERE id = $1`, [
    id,
  ]);
  if (note === null) return null;
  const lines = await many<{ line_id: string; description: string; amount_cents: number }>(
    db,
    `SELECT line_id, description, amount_cents FROM credit_note_lines WHERE credit_note_id = $1`,
    [id],
  );
  return {
    id: note.id,
    number: note.number,
    invoice_id: note.invoice_id,
    amount_cents: note.amount_cents,
    issued_at: toUtcIso(note.issued_at),
    lines,
  };
}

export function dueInstant(issuedAt: Date): Date {
  return addSeconds(issuedAt, billingDays(BILLING_DAYS_UNTIL_DUE));
}

export function nextRetryInstant(firstReturnAt: Date, retriesUsed: number): Date | null {
  const offset = RETRY_BILLING_DAYS[retriesUsed];
  if (offset === undefined) return null;
  return addSeconds(firstReturnAt, billingDays(offset));
}

export async function latestCollection(
  db: Queryable,
  invoiceId: string,
): Promise<{ id: string; attempt: number; amount_cents: number; killbill_payment_id: string | null } | null> {
  return one(
    db,
    `SELECT id, attempt, amount_cents, killbill_payment_id FROM invoice_collections
     WHERE invoice_id = $1 ORDER BY attempt DESC LIMIT 1`,
    [invoiceId],
  );
}

export async function firstReturnAt(db: Queryable, invoiceId: string): Promise<Date | null> {
  const row = await one<{ created_at: Date }>(
    db,
    `SELECT created_at FROM invoice_returns WHERE invoice_id = $1 ORDER BY created_at LIMIT 1`,
    [invoiceId],
  );
  return row?.created_at ?? null;
}

export function newInvoiceId(): string {
  return newId();
}
