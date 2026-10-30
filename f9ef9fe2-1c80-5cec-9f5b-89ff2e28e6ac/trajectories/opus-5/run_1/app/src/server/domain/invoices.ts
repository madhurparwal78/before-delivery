import type { DescriptionLine, Invoice, Line } from '../../shared/types.js';
import { formatHours, formatMoney } from '../../shared/format.js';
import { query, queryOne, type Sql } from '../db/pool.js';
import { readInvoiceAmountCents } from '../services/killbill.js';
import { serviceHealth, withService } from '../services/health.js';
import { newId } from './secrets.js';
import type { StationRef } from './pricing.js';

export interface InvoiceRow {
  id: string;
  ref: string;
  kitchen_id: string;
  member_id: string;
  kind: 'booking' | 'series' | 'pack';
  total_cents: number;
  killbill_invoice_id: string | null;
  issued_at: Date;
  business?: string;
}

export interface InvoiceLineRow {
  invoice_id: string;
  booking_id: string | null;
  cell_date: string | null;
  station_id: string | null;
  tier: 1 | 2 | 3 | 4 | null;
  paid_by: 'cash' | 'pack' | null;
  quarters: number | null;
  hourly_rate_cents: number | null;
  description: string | null;
  amount_cents: number;
}

export interface InvoiceLineInput {
  booking_id?: string | null;
  cell_date?: string | null;
  line?: Line;
  description?: string;
  amount_cents: number;
}

export async function nextInvoiceRef(client: Sql): Promise<string> {
  const row = await queryOne<{ value: string }>(
    client,
    "SELECT nextval('invoice_ref_seq')::text AS value",
  );
  return `INV-${String(row ? Number(row.value) : 0).padStart(6, '0')}`;
}

export async function createInvoice(
  client: Sql,
  input: {
    kitchenId: string;
    memberId: string;
    kind: 'booking' | 'series' | 'pack';
    lines: InvoiceLineInput[];
    totalCents: number;
    killbillInvoiceId: string | null;
    now: Date;
  },
): Promise<{ id: string; ref: string }> {
  const id = newId('inv');
  const ref = await nextInvoiceRef(client);
  await client.query(
    `INSERT INTO invoices (id, ref, kitchen_id, member_id, kind, total_cents, killbill_invoice_id, issued_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, ref, input.kitchenId, input.memberId, input.kind, input.totalCents, input.killbillInvoiceId, input.now],
  );
  for (const [index, entry] of input.lines.entries()) {
    const line = entry.line;
    await client.query(
      `INSERT INTO invoice_lines
         (invoice_id, idx, booking_id, cell_date, station_id, tier, paid_by, quarters,
          hourly_rate_cents, description, amount_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        index,
        entry.booking_id ?? null,
        entry.cell_date ?? null,
        line ? line.station_id : null,
        line ? line.tier : null,
        line ? line.paid_by : null,
        line ? line.quarters : null,
        line ? line.hourly_rate_cents : null,
        entry.description ?? null,
        entry.amount_cents,
      ],
    );
  }
  return { id, ref };
}

const INVOICE_COLUMNS = `i.id, i.ref, i.kitchen_id, i.member_id, i.kind, i.total_cents,
  i.killbill_invoice_id, i.issued_at, m.business`;

export async function loadInvoice(client: Sql, invoiceId: string): Promise<InvoiceRow | null> {
  return queryOne<InvoiceRow>(
    client,
    `SELECT ${INVOICE_COLUMNS} FROM invoices i JOIN members m ON m.id = i.member_id WHERE i.id = $1`,
    [invoiceId],
  );
}

export async function loadInvoices(
  client: Sql,
  filter: { kitchenId: string; memberId?: string; month?: string },
): Promise<InvoiceRow[]> {
  const conditions = ['i.kitchen_id = $1'];
  const values: unknown[] = [filter.kitchenId];
  if (filter.memberId !== undefined) {
    values.push(filter.memberId);
    conditions.push(`i.member_id = $${values.length}`);
  }
  if (filter.month !== undefined) {
    values.push(filter.month);
    conditions.push(
      `to_char(i.issued_at AT TIME ZONE (SELECT timezone FROM kitchens WHERE id = i.kitchen_id), 'YYYY-MM') = $${values.length}`,
    );
  }
  return query<InvoiceRow>(
    client,
    `SELECT ${INVOICE_COLUMNS} FROM invoices i JOIN members m ON m.id = i.member_id
      WHERE ${conditions.join(' AND ')} ORDER BY i.issued_at, i.ref`,
    values,
  );
}

export async function loadInvoiceLines(
  client: Sql,
  invoiceIds: readonly string[],
): Promise<InvoiceLineRow[]> {
  if (invoiceIds.length === 0) return [];
  return query<InvoiceLineRow>(
    client,
    `SELECT invoice_id, booking_id, cell_date, station_id, tier, paid_by, quarters,
            hourly_rate_cents, description, amount_cents
       FROM invoice_lines WHERE invoice_id = ANY($1::text[]) ORDER BY invoice_id, idx`,
    [[...invoiceIds]],
  );
}

export async function bookingIdsOfInvoice(client: Sql, invoiceId: string): Promise<string[]> {
  const rows = await query<{ id: string }>(
    client,
    'SELECT id FROM bookings WHERE invoice_id = $1 ORDER BY ref',
    [invoiceId],
  );
  return rows.map((row) => row.id);
}

export function invoiceLineView(
  row: InvoiceLineRow,
  stations: Map<string, StationRef>,
): Line | DescriptionLine {
  if (row.station_id === null || row.tier === null || row.paid_by === null || row.quarters === null) {
    return { description: row.description ?? '', amount_cents: row.amount_cents };
  }
  const station = stations.get(row.station_id);
  return {
    station_id: row.station_id,
    station: station ? station.name : row.station_id,
    tier: row.tier,
    paid_by: row.paid_by,
    quarters: row.quarters,
    hours: formatHours(row.quarters),
    hourly_rate_cents: row.hourly_rate_cents ?? 0,
    amount_cents: row.amount_cents,
  };
}

export function invoiceView(
  row: InvoiceRow,
  lines: readonly InvoiceLineRow[],
  bookingIds: readonly string[],
  stations: Map<string, StationRef>,
  billingAmountCents: number | null,
): Invoice {
  return {
    id: row.id,
    ref: row.ref,
    member_id: row.member_id,
    kind: row.kind,
    booking_ids: [...bookingIds],
    lines: lines.map((line) => invoiceLineView(line, stations)),
    total_cents: row.total_cents,
    total: formatMoney(row.total_cents),
    killbill_invoice_id: row.killbill_invoice_id,
    billing_amount_cents: billingAmountCents,
    issued_at: row.issued_at.toISOString(),
  };
}

/** The billing system's amount for an invoice, read live and null while billing is down. */
export async function billingAmountCents(
  killbillInvoiceId: string | null,
): Promise<number | null> {
  if (killbillInvoiceId === null) return null;
  if (serviceHealth('billing') === 'down') return null;
  try {
    return await withService('billing', () => readInvoiceAmountCents(killbillInvoiceId));
  } catch {
    return null;
  }
}
