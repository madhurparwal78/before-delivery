// Booking persistence and state decisions. The status of a booking is decided in exactly
// one place: statusFor. Qualification, busy spans and open-call timing come from the domain.
import type { DbClient } from './db.js';
import { ApiError } from './errors.js';
import {
  formatInstant, formatDate, localParts, resolveWallClock, businessDaysBack,
} from '../domain/time.js';
import { buildRotationPlan, entryTimes } from '../domain/rotation.js';
import { isQualified, spansOverlap } from '../domain/qualification.js';
import { type ContractInfo, type RateInfo } from '../domain/billing.js';
import type { Booking, HolderCard, MaterialInfo, Rotation, RotationTurn, SeatInfo, CoverageInfo } from '../shared/api.js';
import type { BookingStatus, OpenCallStatus } from '../shared/terms.js';
import { AGENCY } from './config.js';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  org_id: string | null;
}

export interface BookingRow {
  id: string;
  ref: string;
  org_id: string;
  org_name: string;
  requester_name: string | null;
  requester_id: string | null;
  setting: string;
  title: string;
  location: string;
  onsite_contact_name: string;
  onsite_contact_phone: string;
  consumer_name: string;
  start_instant: Date;
  end_instant: Date;
  duration_minutes: number;
  seat_count: number;
  status: string;
  requester_notes: string;
  open_call_posted_at: Date | null;
  open_call_closes_at: Date | null;
  contract_interval: number;
  contract_id: string;
  created_at: Date;
  completed_at: Date | null;
  cancelled_at: Date | null;
}

interface SeatRow {
  booking_id: string;
  seat: number;
  holder_id: string | null;
  holder_name: string | null;
  holder_initials: string | null;
  holder_credentials: Array<{ code: string; expires_on: string }> | null;
  holder_phone: string | null;
  holder_email: string | null;
  holder_city: string | null;
  holder_pay: number | null;
}

interface MaterialRow {
  id: string;
  name: string;
  size_bytes: string | number;
  content_type: string;
  sha256: string;
  uploaded_at: Date;
}

const BOOKING_SELECT = `
  SELECT b.id, b.ref, b.org_id, o.name AS org_name, u.name AS requester_name, b.requester_id,
         b.setting, b.title, b.location, b.onsite_contact_name, b.onsite_contact_phone,
         b.consumer_name, b.start_instant, b.end_instant, b.duration_minutes, b.seat_count,
         b.status, b.requester_notes, b.open_call_posted_at, b.open_call_closes_at,
         c.rotation_interval_minutes AS contract_interval, c.id AS contract_id,
         b.created_at, b.completed_at, b.cancelled_at
  FROM bookings b
  JOIN organisations o ON o.id = b.org_id
  JOIN contracts c ON c.org_id = b.org_id
  LEFT JOIN users u ON u.id = b.requester_id
`;

/** The status of a booking before check-in follows from its seats; final states stay final. */
export function statusFor(row: { status: string; seat_count: number; held: number; open_call_posted: boolean }): string {
  if (row.status === 'in_progress' || row.status === 'completed' || row.status === 'cancelled' || row.status === 'cancelled_late') {
    return row.status;
  }
  if (row.held === 0) return row.open_call_posted ? 'open' : 'submitted';
  if (row.held >= row.seat_count) return 'covered';
  return 'partially_covered';
}

export class BookingRepository {
  async loadBooking(client: DbClient, id: string): Promise<BookingRow> {
    const res = await client.query<BookingRow>(`${BOOKING_SELECT} WHERE b.id = $1`, [id]);
    if (res.rowCount === 0) throw new ApiError('not_found', 'That booking is not available.');
    return res.rows[0];
  }

  async loadSeats(client: DbClient, bookingId: string): Promise<SeatRow[]> {
    const res = await client.query<SeatRow>(
      `SELECT s.booking_id, s.seat, s.holder_id, u.name AS holder_name, u.initials AS holder_initials,
              u.phone AS holder_phone, u.email AS holder_email, u.home_city AS holder_city,
              u.pay_rate_cents AS holder_pay,
              (SELECT json_agg(json_build_object('code', ic.code, 'expires_on', ic.expires_on::text) ORDER BY ic.code)
                 FROM interpreter_credentials ic WHERE ic.interpreter_id = s.holder_id) AS holder_credentials
       FROM seats s LEFT JOIN users u ON u.id = s.holder_id
       WHERE s.booking_id = $1 ORDER BY s.seat`,
      [bookingId],
    );
    return res.rows;
  }

  async loadMaterials(client: DbClient, bookingId: string): Promise<MaterialRow[]> {
    const res = await client.query<MaterialRow>(
      'SELECT id, name, size_bytes, content_type, sha256, uploaded_at FROM materials WHERE booking_id = $1 ORDER BY seq',
      [bookingId],
    );
    return res.rows;
  }

  /** The computed booking status from seats, without saving. */
  async currentStatus(client: DbClient, row: BookingRow): Promise<BookingStatus> {
    const held = (await this.loadSeats(client, row.id)).filter((s) => s.holder_id !== null).length;
    return statusFor({
      status: row.status,
      seat_count: row.seat_count,
      held,
      open_call_posted: row.open_call_posted_at !== null,
    }) as BookingStatus;
  }

  async holderCredentials(client: DbClient, interpreterId: string): Promise<Array<{ code: string; expires_on: string }>> {
    const res = await client.query<{ code: string; expires_on: string }>(
      'SELECT code, expires_on::text AS expires_on FROM interpreter_credentials WHERE interpreter_id = $1 ORDER BY code',
      [interpreterId],
    );
    return res.rows;
  }

  /** Whether the interpreter is busy: holding a seat on an overlapping, uncancelled booking. */
  async isBusy(client: DbClient, interpreterId: string, startMs: number, endMs: number, excludeBookingId: string): Promise<boolean> {
    const res = await client.query<{ start_instant: Date; end_instant: Date }>(
      `SELECT b.start_instant, b.end_instant
       FROM seats s JOIN bookings b ON b.id = s.booking_id
       WHERE s.holder_id = $1 AND s.booking_id <> $2 AND b.status NOT IN ('cancelled', 'cancelled_late')`,
      [interpreterId, excludeBookingId],
    );
    for (const row of res.rows) {
      if (spansOverlap(startMs, endMs, row.start_instant.getTime(), row.end_instant.getTime())) return true;
    }
    return false;
  }

  async interpreterVisible(client: DbClient, user: SessionUser, booking: BookingRow): Promise<boolean> {
    if (user.role !== 'interpreter') return true;
    const seats = await this.loadSeats(client, booking.id);
    if (seats.some((s) => s.holder_id === user.id)) return true;
    if (booking.open_call_posted_at === null) return false;
    if (booking.status === 'in_progress' || booking.status === 'completed' || booking.status === 'cancelled' || booking.status === 'cancelled_late') return false;
    const creds = await this.holderCredentials(client, user.id);
    return isQualified(booking.setting, creds, assignmentDateOf(booking));
  }

  /** Who can see this booking: requesters only their own organisation, interpreters by
   * seat or offer. Everything else reads as not found. */
  async visibleTo(client: DbClient, user: SessionUser, bookingId: string): Promise<BookingRow | null> {
    const row = await this.loadBookingOrNull(client, bookingId);
    if (row === null) return null;
    if (user.role === 'coordinator' || user.role === 'billing_manager') return row;
    if (user.role === 'requester') return row.org_id === user.org_id ? row : null;
    return (await this.interpreterVisible(client, user, row)) ? row : null;
  }

  async loadBookingOrNull(client: DbClient, id: string): Promise<BookingRow | null> {
    const res = await client.query<BookingRow>(`${BOOKING_SELECT} WHERE b.id = $1`, [id]);
    return res.rowCount === 0 ? null : res.rows[0];
  }

  contractOf(row: BookingRow): ContractInfo {
    return {
      minimum_minutes: 120,
      increment_minutes: 15,
      rotation_interval_minutes: row.contract_interval,
      rates: [],
    };
  }

  async ratesFor(client: DbClient, contractId: string): Promise<RateInfo[]> {
    const res = await client.query<RateInfo>(
      'SELECT effective_from::text AS effective_from, hourly_rate_cents, team_surcharge_bp, mileage_cents_per_mile FROM contract_rates WHERE contract_id = $1 ORDER BY effective_from',
      [contractId],
    );
    return res.rows;
  }

  /** Build the booking response for the caller's role, with only the published fields. */
  async serialize(client: DbClient, user: SessionUser, row: BookingRow, opts: { materials?: boolean } = {}): Promise<Booking> {
    const seats = await this.loadSeats(client, row.id);
    const held = seats.filter((s) => s.holder_id !== null).length;
    const status = statusFor({ status: row.status, seat_count: row.seat_count, held, open_call_posted: row.open_call_posted_at !== null }) as BookingStatus;
    const nowMs = Date.now();
    const openCallStatus: OpenCallStatus =
      row.open_call_posted_at === null ? 'none'
        : nowMs < row.open_call_closes_at!.getTime() ? 'open' : 'closed';
    const rates = await this.ratesFor(client, row.contract_id);
    const startMs = row.start_instant.getTime();
    const plan = buildRotationPlan({
      startMs,
      durationMinutes: row.duration_minutes,
      seatCount: row.seat_count,
      soloThresholdMinutes: AGENCY.solo_threshold_minutes,
      intervalMinutes: row.contract_interval,
      holders: seats.map((s) =>
        s.holder_id === null ? null : { seat: s.seat, name: s.holder_name!, initials: s.holder_initials! },
      ),
    });
    const entries = plan.entries.map((e) => {
      const times = entryTimes(startMs, e);
      const turn: RotationTurn = {
        index: e.index,
        kind: e.kind,
        seat: e.seat,
        holder_name: e.holderName,
        holder_initials: e.holderInitials,
        start: times.start,
        end: times.end,
        label: e.label,
      };
      return turn;
    });
    const rotation: Rotation = {
      mode: plan.mode,
      interval_minutes: row.contract_interval,
      threshold_minutes: AGENCY.solo_threshold_minutes,
      coverage_text: plan.coverageText,
      turns: entries,
    };
    const coverage: CoverageInfo = {
      state: held === 0 ? 'uncovered' : held >= row.seat_count ? 'covered' : 'partly_covered',
      covered_minutes: plan.coveredMinutes,
      percent: plan.percent,
    };
    const includeMaterials = user.role !== 'interpreter' || held > 0 && seats.some((s) => s.holder_id === user.id);
    const materials: MaterialInfo[] = includeMaterials
      ? (await this.loadMaterials(client, row.id)).map((m) => ({
          id: m.id,
          name: m.name,
          size_bytes: Number(m.size_bytes),
          content_type: m.content_type,
          sha256: m.sha256,
          uploaded_at: formatInstant(m.uploaded_at.getTime()),
        }))
      : [];
    const seatInfos: SeatInfo[] = seats.map((s) => ({
      seat: s.seat,
      holder: s.holder_id === null ? null : this.holderCard(user, s),
    }));

    const booking: Booking = {
      id: row.id,
      ref: row.ref,
      org_name: row.org_name,
      setting: row.setting,
      title: row.title,
      location: row.location,
      onsite_contact_name: row.onsite_contact_name,
      onsite_contact_phone: row.onsite_contact_phone,
      consumer_name: row.consumer_name,
      start: formatInstant(startMs),
      end: formatInstant(row.end_instant.getTime()),
      duration_minutes: row.duration_minutes,
      status,
      seat_count: row.seat_count,
      open_call_status: openCallStatus,
      open_call_closes_at: row.open_call_closes_at ? formatInstant(row.open_call_closes_at.getTime()) : null,
      coverage,
      seats: seatInfos,
      rotation,
      materials,
    };
    if (user.role === 'requester') {
      booking.requester_name = row.requester_name ?? undefined;
      booking.requester_notes = row.requester_notes;
      booking.charge = await this.chargeOf(client, row.id);
    } else if (user.role === 'coordinator' || user.role === 'billing_manager') {
      booking.org_id = row.org_id;
      booking.requester_name = row.requester_name ?? undefined;
      booking.requester_notes = row.requester_notes;
      booking.charge = await this.chargeOf(client, row.id);
      booking.created_at = formatInstant(row.created_at.getTime());
    }
    return booking;
  }

  async chargeOf(client: DbClient, bookingId: string): Promise<Booking['charge']> {
    const res = await client.query<{ line_ref: string; kind: string; amount_cents: number; sync_status: string }>(
      'SELECT line_ref, kind, amount_cents, sync_status FROM invoice_lines WHERE booking_id = $1 ORDER BY seq LIMIT 1',
      [bookingId],
    );
    if (res.rowCount === 0) return null;
    const row = res.rows[0];
    return {
      line_ref: row.line_ref,
      kind: row.kind as 'completed' | 'late_cancellation',
      amount_cents: row.amount_cents,
      sync_status: row.sync_status as 'synced' | 'pending_sync',
    };
  }

  holderCard(user: SessionUser, seat: SeatRow): HolderCard {
    const credentials = (seat.holder_credentials ?? []).map((c) => c.code);
    if (user.role === 'coordinator') {
      return {
        id: seat.holder_id!,
        name: seat.holder_name!,
        initials: seat.holder_initials!,
        credentials: seat.holder_credentials ?? [],
        phone: seat.holder_phone ?? '',
        email: seat.holder_email ?? '',
        home_city: seat.holder_city ?? '',
        pay_rate_cents: seat.holder_pay ?? 0,
      };
    }
    if (user.role === 'billing_manager') {
      return { id: seat.holder_id!, name: seat.holder_name!, initials: seat.holder_initials!, credentials };
    }
    if (user.role === 'requester') {
      return { name: seat.holder_name!, initials: seat.holder_initials!, credentials };
    }
    return {
      name: seat.holder_name!,
      initials: seat.holder_initials!,
      credentials,
      is_me: seat.holder_id === user.id,
    };
  }

  /** Open-call close instant: the lead time in elapsed minutes before the start. */
  openCallClosesAt(startMs: number, leadMinutes: number): Date {
    return new Date(startMs - leadMinutes * 60000);
  }

  /** The late-cancellation cutoff, decided once in the domain. */
  cancellationCutoff(startMs: number): Date {
    return new Date(businessDaysBack(startMs, 2));
  }

  async auditEntry(
    client: DbClient,
    bookingId: string,
    actor: { id: string | null; name: string },
    action: string,
    fromStatus: BookingStatus | null,
    toStatus: BookingStatus | null,
    seat: number | null,
    interpreterName: string | null,
  ): Promise<void> {
    await client.query(
      'INSERT INTO audit_trail (booking_id, actor_id, actor_name, action, from_status, to_status, seat, interpreter_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [bookingId, actor.id, actor.name, action, fromStatus, toStatus, seat, interpreterName],
    );
  }
}

export function assignmentDateOf(row: { start_instant: Date }): string {
  return formatDate(row.start_instant.getTime());
}

export function seatCountForRule(durationMinutes: number, setting: string): number {
  if (durationMinutes > AGENCY.solo_threshold_minutes || setting === 'legal') return 2;
  return 1;
}

/** Reserve the next booking reference inside the caller's transaction. */
export async function nextBookingRef(client: DbClient): Promise<{ ref: string; seq: number }> {
  const res = await client.query<{ last_value: number }>(
    'UPDATE booking_sequence SET last_value = last_value + 1 WHERE id = 1 RETURNING last_value',
    [],
  );
  const seq = res.rows[0].last_value;
  return { ref: `BK-${seq}`, seq };
}

export async function nextLineRef(client: DbClient): Promise<{ line_ref: string; seq: number }> {
  const res = await client.query<{ last_value: number }>(
    'UPDATE line_sequence SET last_value = last_value + 1 WHERE id = 1 RETURNING last_value',
    [],
  );
  const seq = res.rows[0].last_value;
  return { line_ref: `LN-${seq}`, seq };
}

export function resolveStart(startStr: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(startStr);
  if (!match) return NaN;
  const [, y, m, d, hh, mm] = match;
  const resolved = resolveWallClock(Number(y), Number(m), Number(d), Number(hh), Number(mm));
  return resolved.ok ? resolved.instantMs : NaN;
}

export function localWall(instantMs: number): string {
  const p = localParts(instantMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
