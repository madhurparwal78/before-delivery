import { DateTime } from 'luxon';
import { query, withTransaction } from './database';
import { ApiError } from '../http/errors';
import { checkinWindow } from '../domain/model';
import { iso, timeOnly } from '../time';


export interface DoorTicket {
  ticket_code: string;
  seat: string;
  initial: string;
  status: string;
  booking_ref: string;
}

/** The one initial rule: the first character of the booking name, uppercased, then a period. */
function initialFor(name: string): string {
  const ch = name.trim().charAt(0).toUpperCase();
  return `${ch || '?'}.`;
}

async function bookingNameFor(bookingRef: string): Promise<string> {
  const res = await query<{ name: string }>(
    `SELECT COALESCE(
        b.guest_name,
        (SELECT a.name FROM accounts a WHERE a.id = b.account_id)
      ) AS name
     FROM bookings b WHERE b.ref = $1`,
    [bookingRef],
  );
  return res.rows[0]?.name ?? '';
}

export async function doorScreenings(): Promise<{
  screenings: { id: string; film_title: string; starts_at: string; auditorium: string }[];
}> {
  const from = DateTime.now().minus({ hours: 24 });
  const to = DateTime.now().plus({ hours: 24 });
  const res = await query<{ id: string; film_title: string; starts_at: Date; auditorium: string }>(
    `SELECT id, film_title, starts_at, auditorium
     FROM screenings
     WHERE starts_at >= $1 AND starts_at <= $2
     ORDER BY starts_at`,
    [from.toJSDate(), to.toJSDate()],
  );
  return {
    screenings: res.rows.map(s => ({
      id: s.id,
      film_title: s.film_title,
      starts_at: iso(DateTime.fromJSDate(s.starts_at)),
      auditorium: s.auditorium,
    })),
  };
}

export async function doorList(screeningId: string): Promise<{
  screening: { id: string; film_title: string; starts_at: string; auditorium: string };
  tickets: DoorTicket[];
}> {
  const screening = await query<{ id: string; film_title: string; starts_at: Date; auditorium: string }>(
    'SELECT id, film_title, starts_at, auditorium FROM screenings WHERE id = $1',
    [screeningId],
  );
  const scr = screening.rows[0];
  if (!scr) throw new ApiError('not_found');
  const tickets = await query<{
    code: string; seat: string; status: string; booking_ref: string; name: string | null;
  }>(
    `SELECT t.code, t.seat, t.status, t.booking_ref,
            COALESCE(b.guest_name, (SELECT a.name FROM accounts a WHERE a.id = b.account_id)) AS name
     FROM tickets t JOIN bookings b ON b.ref = t.booking_ref
     WHERE t.booking_ref IN (SELECT ref FROM bookings WHERE screening_id = $1)
     ORDER BY substring(t.seat from 1 for 1), substring(t.seat from 2)::int`,
    [screeningId],
  );
  return {
    screening: {
      id: scr.id,
      film_title: scr.film_title,
      starts_at: iso(DateTime.fromJSDate(scr.starts_at)),
      auditorium: scr.auditorium,
    },
    tickets: tickets.rows.map(t => ({
      ticket_code: t.code,
      seat: t.seat,
      initial: initialFor(t.name ?? ''),
      status: t.status,
      booking_ref: t.booking_ref,
    })),
  };
}

export interface ScreeningTimes { startsAt: DateTime }

/** The one check-in window: [showtime − 45 min, showtime + 30 min). */
function assertCheckinWindow(startsAt: DateTime): void {
  const window = checkinWindow(startsAt);
  const now = DateTime.now();
  if (now < window.opensAt) {
    throw new ApiError('checkin_not_open', {
      params: { time: timeOnly(window.opensAt) },
    });
  }
  if (now >= window.closesAt) {
    throw new ApiError('checkin_closed', {
      params: { time: timeOnly(window.closesAt) },
    });
  }
}

export async function checkInTicket(code: string): Promise<{
  ticket: DoorTicket;
  checked_in_at: string;
}> {
  const found = await query<{
    code: string; seat: string; status: string; booking_ref: string;
    starts_at: Date; name: string | null;
  }>(
    `SELECT t.code, t.seat, t.status, t.booking_ref, s.starts_at,
            COALESCE(b.guest_name, (SELECT a.name FROM accounts a WHERE a.id = b.account_id)) AS name
     FROM tickets t
     JOIN bookings b ON b.ref = t.booking_ref
     JOIN screenings s ON s.id = b.screening_id
     WHERE upper(t.code) = upper($1)`,
    [code],
  );
  const ticket = found.rows[0];
  if (!ticket) throw new ApiError('not_found');
  assertCheckinWindow(DateTime.fromJSDate(ticket.starts_at));

  if (ticket.status === 'refunded') throw new ApiError('ticket_refunded');

  let checkedInAt: DateTime = DateTime.now();
  await withTransaction(async (client) => {
    const lock = await client.query<{ status: string }>(
      'SELECT status FROM tickets WHERE code=$1 FOR UPDATE',
      [ticket.code],
    );
    const status = lock.rows[0].status;
    if (status === 'checked-in') {
      const prior = await client.query<{ checked_in_at: Date }>(
        'SELECT checked_in_at FROM tickets WHERE code=$1',
        [ticket.code],
      );
      checkedInAt = DateTime.fromJSDate(prior.rows[0].checked_in_at as Date);
      throw new ApiError('already_checked_in', {
        params: { time: timeOnly(checkedInAt) },
      });
    }
    if (status === 'refunded') throw new ApiError('ticket_refunded');
    const now = DateTime.now();
    await client.query(
      `UPDATE tickets SET status='checked-in', checked_in_at=$2 WHERE code=$1`,
      [ticket.code, now.toJSDate()],
    );
    await client.query(
      `UPDATE bookings SET state='checked-in' WHERE ref=$1 AND state='paid'`,
      [ticket.booking_ref],
    );
    checkedInAt = now;
  });

  return {
    ticket: {
      ticket_code: ticket.code,
      seat: ticket.seat,
      initial: initialFor(ticket.name ?? ''),
      status: 'checked-in',
      booking_ref: ticket.booking_ref,
    },
    checked_in_at: iso(checkedInAt),
  };
}

export async function checkInBooking(ref: string): Promise<{
  booking_ref: string;
  checked_in: number;
  already_checked_in: number;
  tickets: DoorTicket[];
}> {
  const found = await query<{ ref: string; screening_id: string; state: string }>(
    'SELECT ref, screening_id, state FROM bookings WHERE upper(ref) = upper($1)',
    [ref],
  );
  const booking = found.rows[0];
  if (!booking) throw new ApiError('not_found');
  if (booking.state === 'refunded') throw new ApiError('ticket_refunded');
  const screening = await query<{ starts_at: Date }>(
    'SELECT starts_at FROM screenings WHERE id = $1',
    [booking.screening_id],
  );
  assertCheckinWindow(DateTime.fromJSDate(screening.rows[0].starts_at));

  let checkedIn = 0;
  let already = 0;
  const tickets = await withTransaction(async (client) => {
    const all = await client.query<{ code: string; seat: string; status: string; name: string | null }>(
      `SELECT t.code, t.seat, t.status,
              COALESCE(b.guest_name, (SELECT a.name FROM accounts a WHERE a.id = b.account_id)) AS name
       FROM tickets t JOIN bookings b ON b.ref = t.booking_ref
       WHERE t.booking_ref = $1
       ORDER BY substring(t.seat from 1 for 1), substring(t.seat from 2)::int`,
      [booking.ref],
    );
    const now = DateTime.now();
    const out: DoorTicket[] = [];
    for (const t of all.rows) {
      if (t.status === 'refunded') continue;
      if (t.status === 'checked-in') {
        already += 1;
      } else {
        const lock = await client.query<{ status: string }>(
          'SELECT status FROM tickets WHERE code=$1 FOR UPDATE',
          [t.code],
        );
        if (lock.rows[0].status === 'checked-in') {
          already += 1;
        } else {
          await client.query(
            `UPDATE tickets SET status='checked-in', checked_in_at=$2 WHERE code=$1`,
            [t.code, now.toJSDate()],
          );
          checkedIn += 1;
        }
      }
      out.push({
        ticket_code: t.code,
        seat: t.seat,
        initial: initialFor(t.name ?? ''),
        status: 'checked-in',
        booking_ref: booking.ref,
      });
    }
    if (checkedIn > 0) {
      await client.query(
        `UPDATE bookings SET state='checked-in' WHERE ref=$1 AND state='paid'`,
        [booking.ref],
      );
    }
    return out;
  });

  return {
    booking_ref: booking.ref,
    checked_in: checkedIn,
    already_checked_in: already,
    tickets,
  };
}
