import type pg from "pg";
import { compareSeats, type Fare, type Locale } from "../shared/domain.ts";
import { recordMovement } from "./credit.ts";
import { one, query, transaction, type Db } from "./db.ts";
import { bookingRefunded, type RefundReason } from "./emails.ts";
import { ApiError } from "./errors.ts";
import { addCredit, refundPayment, requireBilling } from "./killbill.ts";
import type { PriceLine } from "./money.ts";
import { enqueue, wakeOutbox } from "./outbox.ts";
import { isoToronto } from "./time.ts";

export type BookingRow = {
  ref: string; hold_id: string; screening_id: string; account_id: number | null; name: string; email: string; phone: string | null; locale: Locale;
  state: "paid" | "checked-in" | "refunded"; lines: PriceLine[]; admission_cents: number; gst_cents: number; qst_cents: number; uplift_cents: number;
  total_cents: number; credit_applied_cents: number; paid_cents: number; split: { name: string; seats: number; share_cents: number }[] | null;
  note: string; cardholder_name: string; kb_account_id: string; kb_invoice_id: string; kb_payment_id: string | null; guest_token_hash: string | null;
  paid_at: Date; refunded_at: Date | null; refunded_cents: number | null; recredited_cents: number | null;
  film_title: string; starts_at: Date; auditorium: string; season_slug: string; account_number: string | null;
};

type TicketRow = { code: string; seat: string; fare: Fare; status: "issued" | "checked-in" | "refunded" };

const BOOKING_SELECT = `SELECT b.*, s.film_title, s.starts_at, s.auditorium, s.season_slug, a.number AS account_number
  FROM bookings b JOIN screenings s ON s.id = b.screening_id LEFT JOIN accounts a ON a.id = b.account_id`;

export async function findBooking(ref: string, db?: Db, lock = false): Promise<BookingRow | undefined> {
  return one<BookingRow>(`${BOOKING_SELECT} WHERE b.ref = $1${lock ? " FOR UPDATE OF b" : ""}`, [ref.trim().toUpperCase()], db);
}

export async function findBookingWhere(condition: string, params: unknown[], db?: Db): Promise<BookingRow[]> {
  return query<BookingRow>(`${BOOKING_SELECT} WHERE ${condition}`, params, db);
}

async function bookingTickets(ref: string, db?: Db): Promise<TicketRow[]> {
  return query<TicketRow>("SELECT code, seat, fare, status FROM tickets WHERE booking_ref = $1", [ref], db).then((rows) =>
    rows.sort((a, b) => compareSeats(a.seat, b.seat)));
}

export async function bookingView(row: BookingRow, db?: Db): Promise<Record<string, unknown>> {
  const tickets = await bookingTickets(row.ref, db);
  return {
    ref: row.ref, state: row.state, locale: row.locale,
    screening: { id: row.screening_id, film_title: row.film_title, starts_at: isoToronto(row.starts_at), auditorium: row.auditorium },
    seats: tickets.map((t) => t.seat), tickets: tickets.map((t) => ({ code: t.code, seat: t.seat, fare: t.fare, status: t.status })),
    lines: row.lines, admission_cents: row.admission_cents, gst_cents: row.gst_cents, qst_cents: row.qst_cents, uplift_cents: row.uplift_cents,
    total_cents: row.total_cents, credit_applied_cents: row.credit_applied_cents, paid_cents: row.paid_cents, currency: "CAD",
    split: row.split, paid_at: isoToronto(row.paid_at),
  };
}

/** The refund cutoff: refunds are allowed while server time is strictly before showtime − 2 hours. */
function refundWindowOpen(startsAt: Date, now: Date): boolean {
  return now.getTime() < startsAt.getTime() - 2 * 3600_000;
}

type RefundActor = { actor: string; reason: string; emailReason: RefundReason };

/** Refund checks in published order; the state checks come before validation and billing. */
function checkRefundable(row: BookingRow, now: Date): void {
  if (row.state === "refunded") throw new ApiError("already_refunded");
  if (row.state === "checked-in") throw new ApiError("booking_checked_in");
  if (!refundWindowOpen(row.starts_at, now)) throw new ApiError("refund_window_closed");
}

/**
 * Refunds the whole booking: the paid portion to the Kill Bill payment, the credit portion back to
 * the account credit, all committed with the refund email and the audit entry.
 */
export async function refundLocked(tx: pg.PoolClient, row: BookingRow, who: RefundActor): Promise<Record<string, unknown>> {
  const refunded = row.paid_cents;
  const recredited = row.credit_applied_cents;
  if (refunded > 0 && row.kb_payment_id) await refundPayment(row.kb_payment_id, refunded, `${row.ref}-refund`);
  if (recredited > 0) await addCredit(row.kb_account_id, recredited, `${row.ref} RECREDIT`);
  await tx.query(
    `UPDATE bookings SET state = 'refunded', refunded_at = now(), refunded_cents = $2, recredited_cents = $3, guest_token_hash = NULL,
       refund_reason = $4 WHERE ref = $1`,
    [row.ref, refunded, recredited, who.emailReason.kind],
  );
  await tx.query("UPDATE tickets SET status = 'refunded' WHERE booking_ref = $1", [row.ref]);
  if (recredited > 0 && row.account_number) await recordMovement(tx, row.account_number, "reversal", recredited, row.ref);
  await enqueue(tx, { key: `booking-refunded:${row.ref}`, kind: "booking-refunded", to: row.email, ...bookingRefunded(row.locale, row.ref, refunded, recredited, who.emailReason) });
  const audit = await one<{ id: number }>(
    "INSERT INTO audit_log (actor, action, target, amount_cents, reason) VALUES ($1, 'refund', $2, $3, $4) RETURNING id",
    [who.actor, row.ref, refunded, who.reason], tx,
  );
  return { booking_ref: row.ref, refunded_cents: refunded, recredited_cents: recredited, currency: "CAD", state: "refunded", audit_id: audit?.id };
}

/** Patron, guest-link and finance refunds share this path. `owns` hides another patron's booking. */
export async function refundBooking(ref: string, owns: (row: BookingRow) => boolean, who: (row: BookingRow) => RefundActor, validate: () => void = () => undefined): Promise<Record<string, unknown>> {
  const result = await transaction(async (tx) => {
    const row = await findBooking(ref, tx, true);
    if (!row || !owns(row)) throw new ApiError("not_found");
    checkRefundable(row, new Date());
    validate();
    requireBilling();
    return refundLocked(tx, row, who(row));
  });
  wakeOutbox();
  return result;
}
