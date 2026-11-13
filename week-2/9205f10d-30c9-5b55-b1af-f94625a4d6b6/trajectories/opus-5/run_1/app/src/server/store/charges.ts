import type { Queryable, QueryValue } from '../db.js';
import { query } from '../db.js';
import type { BillingStatus, Invoice, InvoiceKind } from '../../shared/types.js';
import { toAgencyIso } from '../domain/agency-time.js';
import { newId } from '../ids.js';

export interface ChargeRow {
  id: string;
  request_id: string;
  reference: string;
  organisation_id: string;
  organisation_name: string;
  organisation_code: string;
  kind: InvoiceKind;
  billable_minutes: number;
  seats: number;
  hourly_rate: string;
  amount: string;
  billing_status: BillingStatus;
  killbill_invoice_id: string | null;
  created_at: Date;
  attempts: number;
}

const CHARGE_COLUMNS = `
  c.id, c.request_id, r.reference, o.id AS organisation_id, o.name AS organisation_name,
  o.code AS organisation_code, c.kind, c.billable_minutes, c.seats, c.hourly_rate, c.amount,
  c.billing_status, c.killbill_invoice_id, c.created_at, c.attempts`;

export async function insertCharge(
  client: Queryable,
  charge: {
    request_id: string;
    kind: InvoiceKind;
    billable_minutes: number;
    seats: number;
    hourly_rate: string;
    amount: string;
  },
): Promise<string> {
  const id = newId('chg');
  await client.query(
    `INSERT INTO charges (id, request_id, kind, billable_minutes, seats, hourly_rate, amount, billing_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
    [
      id,
      charge.request_id,
      charge.kind,
      charge.billable_minutes,
      charge.seats,
      charge.hourly_rate,
      charge.amount,
    ],
  );
  return id;
}

const defaultClient: Queryable = { query };

export async function loadCharges(
  where: string,
  values: QueryValue[],
  client: Queryable = defaultClient,
): Promise<ChargeRow[]> {
  const result = await client.query<ChargeRow>(
    `SELECT ${CHARGE_COLUMNS} FROM charges c
       JOIN requests r ON r.id = c.request_id
       JOIN organisations o ON o.id = r.organisation_id
      WHERE ${where}
      ORDER BY c.created_at DESC, c.id DESC`,
    values,
  );
  return result.rows;
}

export async function reloadCharge(id: string): Promise<ChargeRow> {
  const rows = await loadCharges('c.id = $1', [id]);
  const row = rows[0];
  if (row === undefined) throw new Error(`Charge ${id} is missing`);
  return row;
}

export function projectInvoice(charge: ChargeRow): Invoice {
  return {
    id: charge.id,
    request_reference: charge.reference,
    organisation: {
      id: charge.organisation_id,
      name: charge.organisation_name,
      code: charge.organisation_code,
    },
    kind: charge.kind,
    billable_minutes: charge.billable_minutes,
    seats: charge.seats,
    hourly_rate: charge.hourly_rate,
    amount: charge.amount,
    billing_status: charge.billing_status,
    killbill_invoice_id: charge.killbill_invoice_id,
    created_at: toAgencyIso(charge.created_at),
  };
}

export function chargeDescription(charge: Pick<ChargeRow, 'reference' | 'kind'>): string {
  return charge.kind === 'interpreting'
    ? `${charge.reference} interpreting`
    : `${charge.reference} late cancellation`;
}

/** Locks pending charges for posting so only one instance ever posts each one. */
export async function lockPendingCharges(
  client: Queryable,
  limit: number,
  onlyChargeId: string | null,
): Promise<ChargeRow[]> {
  const locked = await client.query<{ id: string }>(
    `SELECT id FROM charges
      WHERE billing_status = 'pending' AND ($2::text IS NULL OR id = $2)
      ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
    [limit, onlyChargeId],
  );
  const ids = locked.rows.map((row) => row.id);
  if (ids.length === 0) return [];
  return loadCharges('c.id = ANY($1::text[])', [ids], client);
}

export async function markPosted(
  client: Queryable,
  chargeId: string,
  killbillInvoiceId: string,
): Promise<void> {
  await client.query(
    `UPDATE charges SET billing_status = 'posted', killbill_invoice_id = $2, attempts = attempts + 1
      WHERE id = $1`,
    [chargeId, killbillInvoiceId],
  );
}

export async function markAttempt(client: Queryable, chargeId: string): Promise<void> {
  await client.query(`UPDATE charges SET attempts = attempts + 1 WHERE id = $1`, [chargeId]);
}
