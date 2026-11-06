import { CHECKIN_CLOSES_SECONDS, CHECKIN_OPENS_SECONDS } from '../../shared/domain.ts';
import { one, query, transaction } from '../db/pool.ts';
import { ApiError } from '../http/errors.ts';
import { toIso, torontoTime } from '../domain/time.ts';

export type DoorTicket = {
  ticket_code: string;
  seat: string;
  initial: string;
  status: string;
  booking_ref: string;
};

export type DoorScreening = { id: string; film_title: string; starts_at: string; auditorium: string };

/** The one check-in window rule: 45 minutes before showtime until 30 minutes after. */
export function assertCheckinWindow(startsAt: Date, now: Date): void {
  const opensAt = new Date(startsAt.getTime() - CHECKIN_OPENS_SECONDS * 1000);
  const closesAt = new Date(startsAt.getTime() + CHECKIN_CLOSES_SECONDS * 1000);
  if (now.getTime() < opensAt.getTime()) {
    throw new ApiError('checkin_not_open', { args: { time: torontoTime(opensAt) } });
  }
  if (now.getTime() >= closesAt.getTime()) {
    throw new ApiError('checkin_closed', { args: { time: torontoTime(closesAt) } });
  }
}

export async function doorScreenings(): Promise<DoorScreening[]> {
  const rows = await query<{ id: string; film_title: string; starts_at: Date; auditorium_code: string }>(
    `select id, film_title, starts_at, auditorium_code from screenings
       where starts_at between now() - interval '24 hours' and now() + interval '24 hours'
       order by starts_at asc`,
  );
  return rows.map((row) => ({
    id: row.id,
    film_title: row.film_title,
    starts_at: toIso(row.starts_at),
    auditorium: row.auditorium_code,
  }));
}

export async function doorList(screeningId: string): Promise<DoorTicket[]> {
  const rows = await query<{ code: string; seat: string; name: string; status: string; ref: string }>(
    `select t.code, t.seat, b.name, t.status, b.ref
       from tickets t join bookings b on b.id = t.booking_id
      where t.screening_id = $1 and b.state <> 'refunded'
      order by seat_sort(t.seat)`,
    [screeningId],
  );
  return rows.map((row) => ({
    ticket_code: row.code,
    seat: row.seat,
    initial: `${row.name.trim().charAt(0).toUpperCase()}.`,
    status: row.status,
    booking_ref: row.ref,
  }));
}

async function ticketDoorRow(code: string): Promise<DoorTicket | null> {
  const row = await one<{ code: string; seat: string; name: string; status: string; ref: string }>(
    `select t.code, t.seat, b.name, t.status, b.ref from tickets t join bookings b on b.id = t.booking_id
       where upper(t.code) = upper($1)`,
    [code],
  );
  if (row === null) return null;
  return {
    ticket_code: row.code,
    seat: row.seat,
    initial: `${row.name.trim().charAt(0).toUpperCase()}.`,
    status: row.status,
    booking_ref: row.ref,
  };
}

export async function checkInTicket(code: string, now: Date): Promise<{ ticket: DoorTicket; checked_in_at: string }> {
  const info = await one<{ status: string; checked_in_at: Date | null; starts_at: Date }>(
    `select t.status, t.checked_in_at, s.starts_at from tickets t join screenings s on s.id = t.screening_id
       where upper(t.code) = upper($1)`,
    [code],
  );
  if (info === null) throw new ApiError('not_found');
  if (info.status === 'refunded') throw new ApiError('ticket_refunded');
  if (info.status === 'checked-in' && info.checked_in_at !== null) {
    throw new ApiError('already_checked_in', { args: { time: torontoTime(info.checked_in_at) } });
  }
  assertCheckinWindow(info.starts_at, now);
  const claimed = await transaction(async (tx) => {
    const rows = await tx.query<{ code: string; checked_in_at: Date; booking_id: number }>(
      `update tickets set status='checked-in', checked_in_at=now()
         where upper(code) = upper($1) and status='issued' returning code, checked_in_at, booking_id`,
      [code],
    );
    if (rows.length === 0) return null;
    await tx.query("update bookings set state='checked-in' where id = $1 and state='paid'", [rows[0].booking_id]);
    return rows[0];
  });
  if (claimed === null) {
    const current = await one<{ checked_in_at: Date | null }>(
      'select checked_in_at from tickets where upper(code) = upper($1)',
      [code],
    );
    throw new ApiError('already_checked_in', {
      args: { time: torontoTime(current?.checked_in_at ?? now) },
    });
  }
  const ticket = await ticketDoorRow(code);
  return { ticket: ticket!, checked_in_at: toIso(claimed.checked_in_at) };
}

export async function checkInBooking(
  ref: string,
  now: Date,
): Promise<{ booking_ref: string; checked_in: number; already_checked_in: number; tickets: DoorTicket[] }> {
  const booking = await one<{ id: number; ref: string; state: string; starts_at: Date }>(
    `select b.id, b.ref, b.state, s.starts_at from bookings b join screenings s on s.id = b.screening_id
       where upper(b.ref) = upper($1)`,
    [ref],
  );
  if (booking === null) throw new ApiError('not_found');
  if (booking.state === 'refunded') throw new ApiError('ticket_refunded');
  assertCheckinWindow(booking.starts_at, now);
  const result = await transaction(async (tx) => {
    const before = await tx.one<{ already: number }>(
      `select count(*)::int as already from tickets where booking_id = $1 and status = 'checked-in'`,
      [booking.id],
    );
    const updated = await tx.query<{ code: string }>(
      `update tickets set status='checked-in', checked_in_at=now()
         where booking_id = $1 and status='issued' returning code`,
      [booking.id],
    );
    await tx.query("update bookings set state='checked-in' where id = $1 and state='paid'", [booking.id]);
    return { checkedIn: updated.length, already: before?.already ?? 0 };
  });
  const tickets = await query<{ code: string }>('select code from tickets where booking_id = $1', [booking.id]);
  const doorTickets: DoorTicket[] = [];
  for (const ticket of tickets) {
    const row = await ticketDoorRow(ticket.code);
    if (row !== null) doorTickets.push(row);
  }
  doorTickets.sort((a, b) => (a.seat < b.seat ? -1 : 1));
  return {
    booking_ref: booking.ref,
    checked_in: result.checkedIn,
    already_checked_in: result.already,
    tickets: doorTickets,
  };
}
