import type { AssignmentBillingView, ChargesResponse } from '../../shared/contract.js';
import { agencyDateString } from '../../shared/zone.js';
import { findAssignmentByNumber } from '../db/assignments.js';
import { pool, type Queryable } from '../db/pool.js';
import { rateInForce } from '../db/rates.js';
import { billableKindOf, chargeDescriptionOf } from '../domain/billing.js';
import {
  chargeLinesFor,
  serviceLineFor,
  totalCentsOf,
  type RateInForce,
  type SeatWork,
} from '../domain/charges.js';
import type { AssignmentRecord } from '../domain/records.js';
import {
  createExternalCharge,
  ensureAccount,
  findChargeInvoiceId,
  KillBillUnavailableError,
} from './killbill.js';

const INVOICE_LOCK_NAMESPACE = 8471;

/** The rate entry that governs an assignment: its organisation and service line on its start date. */
export async function requireRateInForce(db: Queryable, record: AssignmentRecord): Promise<RateInForce> {
  const rate = await rateInForce(
    db,
    record.org_id,
    serviceLineFor(record.language_code),
    agencyDateString(record.start_at),
  );
  if (rate === null) {
    throw new Error(`no rate card entry in force for ${record.number}`);
  }
  return rate;
}

export async function chargesFor(
  db: Queryable,
  record: AssignmentRecord,
): Promise<ChargesResponse | null> {
  const kind = billableKindOf(record);
  if (kind === null) {
    return null;
  }
  const rate = await requireRateInForce(db, record);
  const seats: SeatWork[] =
    kind === 'late_cancellation'
      ? record.seats.map((seat) => ({ seat: seat.seat_no, actual_minutes: null, round_trip_miles: 0 }))
      : record.seats.map((seat) => ({
          seat: seat.seat_no,
          actual_minutes: seat.actual_minutes,
          round_trip_miles: seat.round_trip_miles ?? 0,
        }));
  const lines = chargeLinesFor(seats, rate);
  return { number: record.number, kind, rate, lines, total_cents: totalCentsOf(lines) };
}

/** Moves an assignment's billing status to ready and stores the total it will be invoiced for. */
export async function markBillable(db: Queryable, record: AssignmentRecord): Promise<void> {
  const charges = await chargesFor(db, record);
  if (charges === null) {
    return;
  }
  await db.query("UPDATE assignments SET billing_status = 'ready', total_cents = $1 WHERE id = $2", [
    charges.total_cents,
    record.id,
  ]);
}

export type PostOutcome = 'posted' | 'already_posted' | 'queued';

export interface PostResult {
  outcome: PostOutcome;
  billing: AssignmentBillingView;
}

function billingViewOf(record: AssignmentRecord): AssignmentBillingView {
  return {
    status: record.billing_status,
    invoice_id: record.invoice_id,
    total_cents: record.total_cents,
  };
}

export async function postInvoice(number: string, actorId: number | null): Promise<PostResult | null> {
  const client = await pool.connect();
  try {
    const assignment = await findAssignmentByNumber(client, number);
    if (assignment === null) {
      return null;
    }
    await client.query('SELECT pg_advisory_lock($1, $2)', [INVOICE_LOCK_NAMESPACE, assignment.id]);
    try {
      return await postInvoiceLocked(number, actorId);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1, $2)', [INVOICE_LOCK_NAMESPACE, assignment.id]);
    }
  } finally {
    client.release();
  }
}

async function postInvoiceLocked(number: string, actorId: number | null): Promise<PostResult | null> {
  const record = await findAssignmentByNumber(pool, number);
  if (record === null) {
    return null;
  }
  const kind = billableKindOf(record);
  if (kind === null) {
    return null;
  }
  if (record.billing_status === 'posted' && record.invoice_id !== null) {
    return { outcome: 'already_posted', billing: billingViewOf(record) };
  }

  const charges = await chargesFor(pool, record);
  if (charges === null) {
    return null;
  }
  const description = chargeDescriptionOf(record.number, kind);

  try {
    const accountId = await ensureAccount(record.org_id, record.org_code, record.org_name);
    const reconciled =
      record.billing_status === 'queued' ? await findChargeInvoiceId(accountId, description) : null;
    if (reconciled !== null) {
      return { outcome: 'posted', billing: await storePosted(record, reconciled, charges.total_cents, actorId) };
    }
    await pool.query(
      "UPDATE assignments SET billing_status = 'queued', total_cents = $1 WHERE id = $2",
      [charges.total_cents, record.id],
    );
    const invoiceId = await createExternalCharge(accountId, charges.total_cents, description);
    return { outcome: 'posted', billing: await storePosted(record, invoiceId, charges.total_cents, actorId) };
  } catch (error) {
    if (error instanceof KillBillUnavailableError) {
      await pool.query(
        "UPDATE assignments SET billing_status = 'queued', total_cents = $1 WHERE id = $2",
        [charges.total_cents, record.id],
      );
      return {
        outcome: 'queued',
        billing: { status: 'queued', invoice_id: null, total_cents: charges.total_cents },
      };
    }
    throw error;
  }
}

async function storePosted(
  record: AssignmentRecord,
  invoiceId: string,
  totalCents: number,
  actorId: number | null,
): Promise<AssignmentBillingView> {
  await pool.query(
    `UPDATE assignments
     SET billing_status = 'posted', invoice_id = $1, total_cents = $2,
         status = CASE WHEN status = 'verified' THEN 'invoiced' ELSE status END
     WHERE id = $3`,
    [invoiceId, totalCents, record.id],
  );
  await pool.query(
    "INSERT INTO audit_entries (kind, assignment_id, actor_id, detail) VALUES ('invoice_posted', $1, $2, $3)",
    [record.id, actorId, JSON.stringify({ invoice_id: invoiceId, total_cents: totalCents })],
  );
  return { status: 'posted', invoice_id: invoiceId, total_cents: totalCents };
}

export async function retryQueuedInvoices(): Promise<void> {
  const queued = await pool.query<{ number: string }>(
    "SELECT number FROM assignments WHERE billing_status = 'queued' ORDER BY id ASC",
  );
  for (const row of queued.rows) {
    await postInvoice(row.number, null);
  }
}
