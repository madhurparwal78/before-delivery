import pg from 'pg';
import type { Config } from './config.js';
import type { Clock } from './clock.js';
import { buildRoute, priceRange, segmentPrice, wholePriceValid, type RouteSpec } from './route.js';
import { cancelQuote as cancelQuoteRule, freeCancelDeadline, shiftQualifies, type CancelQuote } from './refunds.js';
import { bookingCutoff, chooseSeats, holdDeadline, requestDeadline, seatsFreeOnSpan, type LegStatus } from './seats.js';
import { bookingTransition, type BookingAction, type BookingState } from './states.js';
import { ratingCloses } from './ratings.js';
import { brusselsDate, brusselsHHMM, isoInBrussels, brusselsDayRange, brusselsMonthRange, parseBrusselsLocal } from './time.js';
import { money } from './money.js';
import { ApiError, err, notFound, forbidden, unauthenticated } from '../http/errors.js';
import { newId, newToken, newCode } from '../services/ids.js';
import type { Mailer } from '../services/mailer.js';
import type { ValkeyStore } from '../services/valkeys.js';
import type { LiveHub } from '../services/live.js';
import { audienceFor } from '../services/live.js';
import type { Ctx } from '../http/router.js';

export interface StopRow { city: string; km: number; time: number }

export type IdState = 'none' | 'pending' | 'verified' | 'rejected';

export interface MemberRow {
  id: string;
  email: string;
  display_name: string;
  roles: string[];
  id_state: IdState;
  id_reason: string | null;
  photo_file_id: string | null;
}

export interface RideRow {
  id: string;
  driver_id: string;
  vehicle_id: string;
  state: 'published' | 'changed' | 'departed' | 'arrived' | 'cancelled';
  version: number;
  booking_mode: 'instant' | 'request';
  seats: number;
  price_cents: number;
  route_km: number;
  departure: number;
  arrival: number;
  free_cancel_until: number | null;
}

export interface BookingRow {
  id: string;
  ride_id: string;
  passenger_id: string;
  boarding: string;
  alighting: string;
  boarding_time: number;
  alighting_time: number;
  seats: number;
  seat_numbers: number[];
  segment_km: number;
  price_cents: number;
  state: BookingState;
  created_at: number;
  hold_expires_at: number | null;
  request_expires_at: number | null;
  ride_version: number;
  free_cancel_until: number | null;
}

export interface VehicleRow { id: string; owner_id: string; make_model: string; colour: string; seats: number }

export class Model {
  constructor(
    readonly db: pg.Pool,
    readonly cfg: Config,
    readonly clock: Clock,
    readonly valkey: ValkeyStore,
    readonly mailer: Mailer,
    readonly live: LiveHub,
  ) {}

  now(): number { return this.clock.nowMs(); }

  // ================= members =================

  async memberById(id: string): Promise<MemberRow | null> {
    const r = await this.db.query<MemberRow>('SELECT * FROM members WHERE id = $1', [id]);
    return r.rows[0] ?? null;
  }

  async memberByEmail(email: string): Promise<MemberRow | null> {
    const r = await this.db.query<MemberRow>('SELECT * FROM members WHERE lower(email) = lower($1)', [email]);
    return r.rows[0] ?? null;
  }

  async walletBalance(client: pg.Pool | pg.PoolClient, memberId: string): Promise<number> {
    const r = await client.query(
      `SELECT COALESCE(SUM(l.amount_cents),0)::int AS balance
       FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
       WHERE l.account = $1`,
      [`wallet:${memberId}`],
    );
    return r.rows[0].balance;
  }

  async memberRating(client: pg.Pool | pg.PoolClient, memberId: string): Promise<{ average: number | null; count: number }> {
    // A member's average counts only ratings revealed to them: booking state 'rated'.
    const r2 = await client.query(
      `SELECT rt.stars FROM ratings rt
       JOIN bookings b ON b.id = rt.booking_id
       JOIN rides rd ON rd.id = b.ride_id
       WHERE b.state = 'rated' AND rt.by_member_id <> $1 AND (rd.driver_id = $1 OR b.passenger_id = $1)`,
      [memberId],
    );
    const stars = r2.rows.map(x => Number(x.stars));
    if (stars.length === 0) return { average: null, count: 0 };
    const mean = stars.reduce((a, b) => a + b, 0) / stars.length;
    return { average: Math.round(mean * 10) / 10, count: stars.length };
  }

  memberPublic(m: MemberRow, rating: { average: number | null; count: number }): Record<string, unknown> {
    return {
      id: m.id,
      display_name: m.display_name,
      roles: m.roles,
      id_state: m.id_state,
      photo_url: m.photo_file_id ? `/api/files/${m.photo_file_id}` : null,
      rating: { average: rating.average, count: rating.count },
    };
  }

  // ================= sessions =================

  async sessionMember(token: string): Promise<MemberRow | null> {
    const r = await this.db.query(
      'SELECT m.* FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.token = $1',
      [token],
    );
    return r.rows[0] ?? null;
  }

  async createSession(memberId: string): Promise<string> {
    const token = newToken();
    await this.db.query('INSERT INTO sessions (token, member_id, created_at) VALUES ($1,$2,$3)', [token, memberId, this.now()]);
    return token;
  }

  async dropSession(token: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE token = $1', [token]);
  }

  // ================= sign-in codes =================

  async issueCode(email: string): Promise<string> {
    const now = this.now();
    const code = newCode();
    await this.db.query(`UPDATE sign_in_codes SET used_at = $2 WHERE email = $1 AND used_at IS NULL`, [email, now]);
    await this.db.query('INSERT INTO sign_in_codes (id, email, code, issued_at) VALUES ($1,$2,$3,$4)', [newId(), email, code, now]);
    return code;
  }

  async verifyCode(email: string, code: string): Promise<MemberRow | null> {
    const now = this.now();
    const r = await this.db.query(
      `SELECT * FROM sign_in_codes WHERE email = $1 AND code = $2 AND used_at IS NULL ORDER BY issued_at DESC LIMIT 1`,
      [email, code],
    );
    if (r.rows.length === 0) return null;
    const row = r.rows[0] as { id: string; issued_at: number };
    if (now >= row.issued_at + this.cfg.emailCodeTtlSeconds * 1000) return null;
    await this.db.query('UPDATE sign_in_codes SET used_at = $2 WHERE id = $1', [row.id, now]);
    return this.memberByEmail(email);
  }

  // ================= vehicles =================

  async vehiclesOf(ownerId: string): Promise<VehicleRow[]> {
    const r = await this.db.query<VehicleRow>('SELECT * FROM vehicles WHERE owner_id = $1', [ownerId]);
    return r.rows;
  }

  async createVehicle(ownerId: string, makeModel: string, colour: string, seats: number): Promise<VehicleRow> {
    const id = newId();
    await this.db.query('INSERT INTO vehicles (id, owner_id, make_model, colour, seats) VALUES ($1,$2,$3,$4,$5)', [id, ownerId, makeModel, colour, seats]);
    return { id, owner_id: ownerId, make_model: makeModel, colour: colour, seats };
  }

  // ================= rides =================

  async rideById(id: string): Promise<RideRow | null> {
    const r = await this.db.query<RideRow>('SELECT * FROM rides WHERE id = $1', [id]);
    return r.rows[0] ?? null;
  }

  async stopsOf(rideId: string): Promise<StopRow[]> {
    const r = await this.db.query<StopRow>('SELECT city, km, time FROM ride_stops WHERE ride_id = $1 ORDER BY idx', [rideId]);
    return r.rows.map(s => ({ city: s.city, km: Number(s.km), time: Number(s.time) }));
  }

  async vehicleById(id: string): Promise<VehicleRow | null> {
    const r = await this.db.query<VehicleRow>('SELECT * FROM vehicles WHERE id = $1', [id]);
    return r.rows[0] ?? null;
  }

  async activeBookingsForRide(client: pg.Pool | pg.PoolClient, rideId: string): Promise<BookingRow[]> {
    const r = await client.query<BookingRow>(
      `SELECT * FROM bookings WHERE ride_id = $1 AND state IN ('held','requested','confirmed') ORDER BY created_at`,
      [rideId],
    );
    return r.rows.map((row: pg.QueryResultRow) => castBooking(row));
  }

  /** The seat map: one row per ride seat, legs marked free/taken by holds, requests and bookings. */
  seatMap(ride: RideRow, stops: StopRow[], bookings: BookingRow[]): Array<{ seat: number; legs: LegStatus[] }> {
    const legCount = stops.length - 1;
    const rows: Array<{ seat: number; legs: LegStatus[] }> = [];
    for (let s = 1; s <= ride.seats; s++) {
      rows.push({ seat: s, legs: Array.from({ length: legCount }, () => 'free' as LegStatus) });
    }
    for (const b of bookings) {
      const fromIdx = stops.findIndex(st => st.city === b.boarding);
      const toIdx = stops.findIndex(st => st.city === b.alighting);
      if (fromIdx < 0 || toIdx < 0) continue;
      for (const seat of b.seat_numbers) {
        const row = rows.find(r => r.seat === seat);
        if (!row) continue;
        for (let leg = fromIdx; leg < toIdx; leg++) row.legs[leg] = 'taken';
      }
    }
    return rows;
  }

  rideSpec(ride: RideRow, stops: StopRow[]): RouteSpec {
    return { stops, routeKm: ride.route_km };
  }

  // ================= bookings =================

  bookingCancelQuote(b: BookingRow): CancelQuote | null {
    if (b.state !== 'confirmed') return null;
    return cancelQuoteRule(b.price_cents, this.now(), b.boarding_time, b.free_cancel_until, this.cfg);
  }

  // ================= ledger =================

  async ledgerEntry(
    client: pg.PoolClient,
    kind: string,
    bookingId: string | null,
    at: number,
    lines: Array<{ account: string; amount_cents: number }>,
  ): Promise<string> {
    const id = newId();
    await client.query('INSERT INTO ledger_entries (id, kind, booking_id, at) VALUES ($1,$2,$3,$4)', [id, kind, bookingId, at]);
    for (const line of lines) {
      await client.query('INSERT INTO ledger_lines (entry_id, account, amount_cents) VALUES ($1,$2,$3)', [id, line.account, line.amount_cents]);
    }
    return id;
  }

  async walletLines(memberId: string): Promise<Array<{ id: string; entry_id: string; label: string; amount_cents: number; at: number }>> {
    const r = await this.db.query(
      `SELECT e.id AS entry_id, e.kind, e.booking_id, e.at, l.amount_cents
       FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
       WHERE l.account = $1 ORDER BY e.at DESC, e.id DESC`,
      [`wallet:${memberId}`],
    );
    const out = [];
    for (const row of r.rows) {
      const label = await this.walletLabel(this.db, row);
      out.push({ id: row.entry_id + ':' + row.amount_cents, entry_id: row.entry_id, label, amount_cents: Number(row.amount_cents), at: Number(row.at) });
    }
    return out;
  }

  async walletLabel(db: pg.Pool | pg.PoolClient, row: { kind: string; booking_id: string | null }): Promise<string> {
    if (row.kind === 'topup') return 'Added to wallet';
    if (!row.booking_id) return row.kind;
    const b = await this.bookingByIdWithClient(db, row.booking_id);
    if (!b) return row.kind;
    const span = `${b.boarding} to ${b.alighting}, ${shortDate(b.boarding_time)}`;
    const [kind, percent] = row.kind.split(':');
    switch (kind) {
      case 'payment': return `Seat booked: ${span}`;
      case 'request_payment': return `Seat requested: ${span}`;
      case 'refund': return `Refund ${percent ?? 100}%: ${span}`;
      default: return row.kind;
    }
  }

  async bookingByIdWithClient(client: pg.Pool | pg.PoolClient, id: string): Promise<BookingRow | null> {
    const r = await client.query('SELECT * FROM bookings WHERE id = $1', [id]);
    return r.rows[0] ? castBooking(r.rows[0]) : null;
  }
}


export function castBooking(row: Record<string, unknown>): BookingRow {
  return {
    id: String(row.id),
    ride_id: String(row.ride_id),
    passenger_id: String(row.passenger_id),
    boarding: String(row.boarding),
    alighting: String(row.alighting),
    boarding_time: Number(row.boarding_time),
    alighting_time: Number(row.alighting_time),
    seats: Number(row.seats),
    seat_numbers: (row.seat_numbers as number[]) ?? [],
    segment_km: Number(row.segment_km),
    price_cents: Number(row.price_cents),
    state: row.state as BookingState,
    created_at: Number(row.created_at),
    hold_expires_at: row.hold_expires_at === null ? null : Number(row.hold_expires_at),
    request_expires_at: row.request_expires_at === null ? null : Number(row.request_expires_at),
    ride_version: Number(row.ride_version),
    free_cancel_until: row.free_cancel_until === null ? null : Number(row.free_cancel_until),
  };
}

export { ApiError, err, notFound, forbidden, unauthenticated, money, isoInBrussels, brusselsDate, brusselsHHMM, brusselsDayRange, brusselsMonthRange, parseBrusselsLocal, buildRoute, priceRange, segmentPrice, wholePriceValid, cancelQuoteRule, freeCancelDeadline, shiftQualifies, bookingCutoff, chooseSeats, holdDeadline, requestDeadline, seatsFreeOnSpan, bookingTransition, ratingCloses, newId, newToken, newCode, audienceFor };
export type { BookingAction, CancelQuote, Ctx };

/** <date> as in the brief: Ddd D Mon. */
export function shortDate(epochMs: number): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(new Date(epochMs));
  const wd = p.find(x => x.type === 'weekday')?.value ?? '';
  const day = p.find(x => x.type === 'day')?.value ?? '';
  const mon = p.find(x => x.type === 'month')?.value ?? '';
  return `${wd} ${day} ${mon}`;
}
