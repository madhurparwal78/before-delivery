import type { Locale } from '../../shared/money.ts';
import type { BookingState, Fare, TicketStatus } from '../../shared/domain.ts';
import { one, query } from '../db/pool.ts';
import { toIso } from '../domain/time.ts';

export type BookingRow = {
  id: number;
  ref: string;
  screening_id: string;
  account_id: number | null;
  hold_id: string | null;
  state: BookingState;
  locale: Locale;
  is_group: boolean;
  name: string;
  email: string;
  phone: string | null;
  note: string;
  cardholder_name: string;
  admission_cents: number;
  gst_cents: number;
  qst_cents: number;
  uplift_cents: number;
  total_cents: number;
  credit_applied_cents: number;
  paid_cents: number;
  kb_invoice_id: string | null;
  kb_payment_id: string | null;
  paid_at: Date | null;
  refunded_at: Date | null;
  refunded_cents: number | null;
  recredited_cents: number | null;
  guest_token: string | null;
  guest_token_seq: number;
  film_title: string;
  starts_at: Date;
  auditorium_code: string;
  auditorium_name: string;
  season_slug: string;
};

const BOOKING_SELECT = `
  select b.*, s.film_title, s.starts_at, s.auditorium_code, s.season_slug, a.name as auditorium_name
    from bookings b
    join screenings s on s.id = b.screening_id
    join auditoriums a on a.code = s.auditorium_code`;

export type BookingPayload = {
  ref: string;
  state: BookingState;
  locale: Locale;
  screening: { id: string; film_title: string; starts_at: string; auditorium: string };
  seats: string[];
  tickets: Array<{ code: string; seat: string; fare: Fare; status: TicketStatus }>;
  lines: Array<{
    fare: Fare;
    quantity: number;
    unit_cents: number;
    subtotal_cents: number;
    gst_cents: number;
    qst_cents: number;
  }>;
  admission_cents: number;
  gst_cents: number;
  qst_cents: number;
  uplift_cents: number;
  total_cents: number;
  credit_applied_cents: number;
  paid_cents: number;
  currency: 'CAD';
  split: Array<{ name: string; seats: number; share_cents: number }> | null;
  paid_at: string | null;
};

export async function bookingPayload(row: BookingRow): Promise<BookingPayload> {
  const tickets = await query<{ code: string; seat: string; fare: Fare; status: TicketStatus }>(
    'select code, seat, fare, status from tickets where booking_id = $1 order by seat_sort(seat)',
    [row.id],
  );
  const lines = await query<{
    fare: Fare;
    quantity: number;
    unit_cents: number;
    subtotal_cents: number;
    gst_cents: number;
    qst_cents: number;
  }>(
    `select fare, quantity, unit_cents, subtotal_cents, gst_cents, qst_cents
       from booking_lines where booking_id = $1 order by position asc`,
    [row.id],
  );
  const payers = await query<{ name: string; seats: number; share_cents: number }>(
    'select name, seats, share_cents from booking_payers where booking_id = $1 order by position asc',
    [row.id],
  );
  return {
    ref: row.ref,
    state: row.state,
    locale: row.locale,
    screening: {
      id: row.screening_id,
      film_title: row.film_title,
      starts_at: toIso(row.starts_at),
      auditorium: row.auditorium_code,
    },
    seats: tickets.map((ticket) => ticket.seat),
    tickets: tickets.map((ticket) => ({
      code: ticket.code,
      seat: ticket.seat,
      fare: ticket.fare,
      status: ticket.status,
    })),
    lines,
    admission_cents: row.admission_cents,
    gst_cents: row.gst_cents,
    qst_cents: row.qst_cents,
    uplift_cents: row.uplift_cents,
    total_cents: row.total_cents,
    credit_applied_cents: row.credit_applied_cents,
    paid_cents: row.paid_cents,
    currency: 'CAD',
    split: row.is_group ? payers : null,
    paid_at: row.paid_at === null ? null : toIso(row.paid_at),
  };
}

export async function bookingByRef(ref: string): Promise<BookingRow | null> {
  return one<BookingRow>(`${BOOKING_SELECT} where upper(b.ref) = upper($1)`, [ref]);
}

export async function bookingById(id: number): Promise<BookingRow | null> {
  return one<BookingRow>(`${BOOKING_SELECT} where b.id = $1`, [id]);
}

export async function bookingByGuestToken(token: string): Promise<BookingRow | null> {
  return one<BookingRow>(`${BOOKING_SELECT} where b.guest_token = $1`, [token]);
}

export async function bookingsForAccount(accountId: number): Promise<BookingRow[]> {
  return query<BookingRow>(
    `${BOOKING_SELECT} where b.account_id = $1 and b.state <> 'held' and b.state <> 'expired'
       order by b.id desc`,
    [accountId],
  );
}

export async function bookingByTicketCode(code: string): Promise<BookingRow | null> {
  return one<BookingRow>(
    `${BOOKING_SELECT} where b.id = (select booking_id from tickets where upper(code) = upper($1))`,
    [code],
  );
}
