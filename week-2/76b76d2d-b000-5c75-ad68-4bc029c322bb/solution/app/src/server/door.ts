import { compareSeats } from "../shared/domain.ts";
import { one, query, transaction } from "./db.ts";
import { ApiError } from "./errors.ts";
import { findScreening, type ScreeningRow } from "./screenings.ts";
import { isoToronto, torontoTime } from "./time.ts";

const OPENS_BEFORE_MS = 45 * 60_000;
const CLOSES_AFTER_MS = 30 * 60_000;

type DoorRow = { ticket_code: string; seat: string; name: string; status: "issued" | "checked-in" | "refunded"; booking_ref: string; checked_in_at: Date | null };

/** The door list projection: exactly these five keys, nothing about the patron beyond an initial. */
function doorTicket(row: DoorRow): { ticket_code: string; seat: string; initial: string; status: string; booking_ref: string } {
  return { ticket_code: row.ticket_code, seat: row.seat, initial: `${[...row.name.trim()][0]?.toUpperCase() ?? ""}.`, status: row.status, booking_ref: row.booking_ref };
}

const DOOR_SELECT = `SELECT t.code AS ticket_code, t.seat, b.name, t.status, t.booking_ref, t.checked_in_at
  FROM tickets t JOIN bookings b ON b.ref = t.booking_ref`;

function screeningHeader(screening: ScreeningRow): Record<string, string> {
  return { id: screening.id, film_title: screening.film_title, starts_at: isoToronto(screening.starts_at), auditorium: screening.auditorium };
}

export async function doorScreenings(now: Date): Promise<Record<string, unknown>> {
  const rows = await query<{ id: string; film_title: string; starts_at: Date; auditorium: string }>(
    `SELECT s.id, s.film_title, s.starts_at, s.auditorium FROM screenings s JOIN seasons se ON se.slug = s.season_slug
      WHERE se.lifecycle <> 'draft' AND s.starts_at BETWEEN $1 AND $2 ORDER BY s.starts_at, s.id`,
    [new Date(now.getTime() - 86_400_000), new Date(now.getTime() + 86_400_000)],
  );
  return { screenings: rows.map((row) => ({ id: row.id, film_title: row.film_title, starts_at: isoToronto(row.starts_at), auditorium: row.auditorium })) };
}

export async function doorList(screeningId: string): Promise<Record<string, unknown>> {
  const screening = await findScreening(screeningId);
  if (!screening) throw new ApiError("not_found");
  const rows = await query<DoorRow>(`${DOOR_SELECT} WHERE t.screening_id = $1`, [screening.id]);
  return { screening: screeningHeader(screening), tickets: rows.sort((a, b) => compareSeats(a.seat, b.seat)).map(doorTicket) };
}

/** The door window: showtime − 45 minutes ≤ server time < showtime + 30 minutes. */
function checkWindow(startsAt: Date, now: Date): void {
  const opens = new Date(startsAt.getTime() - OPENS_BEFORE_MS);
  const closes = new Date(startsAt.getTime() + CLOSES_AFTER_MS);
  if (now < opens) throw new ApiError("checkin_not_open", { time: torontoTime(opens) });
  if (now >= closes) throw new ApiError("checkin_closed", { time: torontoTime(closes) });
}

const normalise = (code: string): string => code.trim().toUpperCase();

/** Each ticket checks in once: the conditional update decides it in the database. */
export async function checkInTicket(code: string): Promise<Record<string, unknown>> {
  const found = await one<DoorRow & { starts_at: Date }>(
    `SELECT t.code AS ticket_code, t.seat, b.name, t.status, t.booking_ref, t.checked_in_at, s.starts_at
       FROM tickets t JOIN bookings b ON b.ref = t.booking_ref JOIN screenings s ON s.id = t.screening_id WHERE t.code = $1`, [normalise(code)],
  );
  if (!found) throw new ApiError("not_found");
  checkWindow(found.starts_at, new Date());
  return transaction(async (tx) => {
    const updated = await one<{ checked_in_at: Date }>(
      "UPDATE tickets SET status = 'checked-in', checked_in_at = now() WHERE code = $1 AND status = 'issued' RETURNING checked_in_at", [found.ticket_code], tx,
    );
    if (!updated) {
      const current = await one<DoorRow>(`${DOOR_SELECT} WHERE t.code = $1`, [found.ticket_code], tx);
      if (current?.status === "refunded") throw new ApiError("ticket_refunded");
      throw new ApiError("already_checked_in", { time: torontoTime(current?.checked_in_at ?? new Date()) });
    }
    await tx.query("UPDATE bookings SET state = 'checked-in' WHERE ref = $1 AND state = 'paid'", [found.booking_ref]);
    return { ticket: doorTicket({ ...found, status: "checked-in" }), checked_in_at: isoToronto(updated.checked_in_at) };
  });
}

/** Checks in every issued ticket of a booking; simultaneous calls together check each ticket in once. */
export async function checkInBooking(ref: string): Promise<Record<string, unknown>> {
  const booking = await one<{ ref: string; state: string; starts_at: Date }>(
    "SELECT b.ref, b.state, s.starts_at FROM bookings b JOIN screenings s ON s.id = b.screening_id WHERE b.ref = $1", [normalise(ref)],
  );
  if (!booking) throw new ApiError("not_found");
  if (booking.state === "refunded") throw new ApiError("ticket_refunded");
  checkWindow(booking.starts_at, new Date());
  return transaction(async (tx) => {
    const updated = await query<{ code: string }>(
      "UPDATE tickets SET status = 'checked-in', checked_in_at = now() WHERE booking_ref = $1 AND status = 'issued' RETURNING code", [booking.ref], tx,
    );
    if (updated.length) await tx.query("UPDATE bookings SET state = 'checked-in' WHERE ref = $1 AND state = 'paid'", [booking.ref]);
    const tickets = await query<DoorRow>(`${DOOR_SELECT} WHERE t.booking_ref = $1`, [booking.ref], tx);
    const already = tickets.filter((t) => t.status === "checked-in").length - updated.length;
    return { booking_ref: booking.ref, checked_in: updated.length, already_checked_in: already, tickets: tickets.sort((a, b) => compareSeats(a.seat, b.seat)).map(doorTicket) };
  });
}
