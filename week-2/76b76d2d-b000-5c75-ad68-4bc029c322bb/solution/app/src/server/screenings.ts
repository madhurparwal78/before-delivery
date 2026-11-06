import { compareSeats, type AuditoriumCode } from "../shared/domain.ts";
import { one, query, type Db } from "./db.ts";
import { isoToronto, torontoLocal } from "./time.ts";

export type ScreeningRow = {
  id: string; season_slug: string; film_title: string; format: string; auditorium: AuditoriumCode; starts_at: Date;
  auditorium_name: string; venue_name: string; first_row: string; last_row: string; seats_per_row: number;
};

const SCREENING_SELECT = `SELECT s.id, s.season_slug, s.film_title, s.format, s.auditorium, s.starts_at, a.name AS auditorium_name,
  v.name AS venue_name, a.first_row, a.last_row, a.seats_per_row
  FROM screenings s JOIN auditoriums a ON a.code = s.auditorium JOIN venues v ON v.id = a.venue_id`;

export async function findScreening(id: string, db?: Db, lock = false): Promise<ScreeningRow | undefined> {
  return one<ScreeningRow>(`${SCREENING_SELECT} WHERE s.id = $1${lock ? " FOR UPDATE OF s" : ""}`, [id], db);
}

export async function seasonScreenings(slug: string, db?: Db): Promise<ScreeningRow[]> {
  return query<ScreeningRow>(`${SCREENING_SELECT} WHERE s.season_slug = $1 ORDER BY s.starts_at, s.id`, [slug], db);
}

/** Every seat code of an auditorium, in seat order (row, then number). */
export function seatCodes(screening: Pick<ScreeningRow, "first_row" | "last_row" | "seats_per_row">): string[] {
  const seats: string[] = [];
  for (let row = screening.first_row.charCodeAt(0); row <= screening.last_row.charCodeAt(0); row += 1) {
    for (let n = 1; n <= screening.seats_per_row; n += 1) seats.push(`${String.fromCharCode(row)}${n}`);
  }
  return seats;
}

const capacity = (screening: ScreeningRow): number => seatCodes(screening).length;

/** Hold liveness, decided here only: not ended, not paid, and server time strictly before `expires_at`. */
export const liveHold = (now: string): string => `(h.ended_by IS NULL AND h.booking_ref IS NULL AND ${now} < h.expires_at)`;

type Occupancy = { sold: Set<string>; held: Map<string, string> };

/** Sold seats (paid or checked-in tickets) and seats in live holds, keyed by hold id. */
export async function occupancy(screeningIds: string[], now: Date, db?: Db): Promise<Map<string, Occupancy>> {
  const result = new Map<string, Occupancy>(screeningIds.map((id) => [id, { sold: new Set(), held: new Map() }]));
  const sold = await query<{ screening_id: string; seat: string }>(
    "SELECT screening_id, seat FROM tickets WHERE screening_id = ANY($1) AND status <> 'refunded'", [screeningIds], db,
  );
  for (const row of sold) result.get(row.screening_id)?.sold.add(row.seat);
  const held = await query<{ screening_id: string; id: string; seats: string[] }>(
    `SELECT h.screening_id, h.id, h.seats FROM holds h WHERE h.screening_id = ANY($1) AND ${liveHold("$2")}`, [screeningIds, now], db,
  );
  for (const row of held) for (const seat of row.seats) result.get(row.screening_id)?.held.set(seat, row.id);
  return result;
}

/** Seats remaining = capacity − sold − seats in live holds, never below 0. */
function seatsRemaining(screening: ScreeningRow, occupied: Occupancy): number {
  return Math.max(0, capacity(screening) - occupied.sold.size - occupied.held.size);
}

export function seasonScreeningView(screening: ScreeningRow, occupied: Occupancy): Record<string, unknown> {
  return {
    id: screening.id, film_title: screening.film_title, format: screening.format, auditorium: screening.auditorium,
    starts_at: isoToronto(screening.starts_at), starts_local: torontoLocal(screening.starts_at), capacity: capacity(screening),
    seats_remaining: seatsRemaining(screening, occupied),
  };
}

export function screeningView(screening: ScreeningRow, occupied: Occupancy, mine: Set<string>): Record<string, unknown> {
  return {
    id: screening.id, season_slug: screening.season_slug, film_title: screening.film_title, format: screening.format,
    auditorium: { code: screening.auditorium, name: screening.auditorium_name, venue: screening.venue_name },
    starts_at: isoToronto(screening.starts_at), starts_local: torontoLocal(screening.starts_at), capacity: capacity(screening),
    sold: occupied.sold.size, held: occupied.held.size, seats_remaining: seatsRemaining(screening, occupied),
    seats: seatCodes(screening).map((code) => ({
      code,
      state: occupied.sold.has(code) ? "sold" : occupied.held.has(code) ? (mine.has(occupied.held.get(code) ?? "") ? "mine" : "held") : "available",
    })),
  };
}

export function sortSeats(seats: string[]): string[] {
  return [...seats].sort(compareSeats);
}
