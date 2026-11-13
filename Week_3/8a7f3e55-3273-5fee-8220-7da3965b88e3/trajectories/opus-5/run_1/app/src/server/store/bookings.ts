import type { PoolClient } from 'pg';
import type { BookingStatus, LineKind, Setting, SyncStatus } from '../../shared/api.js';
import { pool } from '../db/pool.js';
import type { HeldCredential } from '../domain/qualification.js';
import { allContracts, type ContractRecord } from './contracts.js';

export interface HolderRecord {
  id: string;
  name: string;
  initials: string;
  email: string;
  phone: string;
  home_city: string;
  pay_rate_cents: number;
  credentials: HeldCredential[];
}

export interface SeatRecord {
  seat: number;
  holder: HolderRecord | null;
}

export interface MaterialRecord {
  id: string;
  name: string;
  size_bytes: number;
  content_type: string;
  sha256: string;
  object_key: string;
  uploaded_at: string;
}

export interface LineRecord {
  line_ref: string;
  booking_id: string;
  booking_ref: string;
  org_id: string;
  kind: LineKind;
  assignment_date: string;
  rate_effective_from: string;
  hourly_rate_cents: number;
  team_surcharge_bp: number;
  basis_minutes: number;
  billable_minutes: number;
  interpreter_count: number;
  time_amount_cents: number;
  mileage_miles: number;
  mileage_cents_per_mile: number;
  mileage_amount_cents: number;
  amount_cents: number;
  billing_week: string;
  sync_status: SyncStatus;
  killbill_item_id: string | null;
  created_at: string;
}

export interface BookingRecord {
  id: string;
  ref: string;
  org_id: string;
  org_name: string;
  requester_id: string;
  requester_name: string;
  requester_email: string;
  setting: Setting;
  title: string;
  location: string;
  onsite_contact_name: string;
  onsite_contact_phone: string;
  consumer_name: string;
  start_at: Date;
  duration_minutes: number;
  assignment_date: string;
  status: BookingStatus;
  seat_count: number;
  open_call_closes_at: Date | null;
  requester_notes: string;
  created_at: Date;
  completed_at: Date | null;
  seats: SeatRecord[];
  materials: MaterialRecord[];
  line: LineRecord | null;
  contract: ContractRecord;
}

interface BookingRow extends Omit<BookingRecord, 'seats' | 'materials' | 'line' | 'contract'> {
  seats: SeatRecord[] | null;
  materials: MaterialRecord[] | null;
  line: LineRecord | null;
}

const BOOKING_SELECT = `
  SELECT b.id, b.ref, b.org_id, o.name AS org_name, b.requester_id,
         r.name AS requester_name, r.email AS requester_email,
         b.setting, b.title, b.location, b.onsite_contact_name, b.onsite_contact_phone,
         b.consumer_name, b.start_at, b.duration_minutes, b.assignment_date, b.status,
         b.seat_count, b.open_call_closes_at, b.requester_notes, b.created_at, b.completed_at,
         (SELECT json_agg(json_build_object(
                   'seat', s.seat,
                   'holder', CASE WHEN s.holder_id IS NULL THEN NULL ELSE json_build_object(
                     'id', h.id, 'name', h.name, 'initials', h.initials, 'email', h.email,
                     'phone', h.phone, 'home_city', h.home_city, 'pay_rate_cents', h.pay_rate_cents,
                     'credentials', COALESCE((
                        SELECT json_agg(json_build_object('code', c.code, 'expires_on', c.expires_on)
                               ORDER BY c.code)
                        FROM credentials c WHERE c.user_id = h.id), '[]'::json)
                   ) END) ORDER BY s.seat)
          FROM seats s LEFT JOIN users h ON h.id = s.holder_id
          WHERE s.booking_id = b.id) AS seats,
         COALESCE((SELECT json_agg(json_build_object(
                   'id', m.id, 'name', m.name, 'size_bytes', m.size_bytes,
                   'content_type', m.content_type, 'sha256', m.sha256,
                   'object_key', m.object_key, 'uploaded_at', m.uploaded_at)
                   ORDER BY m.uploaded_at, m.id)
          FROM materials m WHERE m.booking_id = b.id), '[]'::json) AS materials,
         (SELECT json_build_object(
                   'line_ref', l.line_ref, 'booking_id', l.booking_id, 'booking_ref', b.ref,
                   'org_id', l.org_id, 'kind', l.kind, 'assignment_date', l.assignment_date,
                   'rate_effective_from', l.rate_effective_from,
                   'hourly_rate_cents', l.hourly_rate_cents,
                   'team_surcharge_bp', l.team_surcharge_bp, 'basis_minutes', l.basis_minutes,
                   'billable_minutes', l.billable_minutes, 'interpreter_count', l.interpreter_count,
                   'time_amount_cents', l.time_amount_cents, 'mileage_miles', l.mileage_miles,
                   'mileage_cents_per_mile', l.mileage_cents_per_mile,
                   'mileage_amount_cents', l.mileage_amount_cents, 'amount_cents', l.amount_cents,
                   'billing_week', l.billing_week, 'sync_status', l.sync_status,
                   'killbill_item_id', l.killbill_item_id, 'created_at', l.created_at)
          FROM invoice_lines l WHERE l.booking_id = b.id) AS line
  FROM bookings b
  JOIN orgs o ON o.id = b.org_id
  JOIN users r ON r.id = b.requester_id
`;

function hydrate(row: BookingRow, contracts: Map<string, ContractRecord>): BookingRecord {
  const contract = contracts.get(row.org_id);
  if (!contract) throw new Error(`No contract for organisation ${row.org_id}`);
  return {
    ...row,
    start_at: new Date(row.start_at),
    created_at: new Date(row.created_at),
    completed_at: row.completed_at === null ? null : new Date(row.completed_at),
    open_call_closes_at:
      row.open_call_closes_at === null ? null : new Date(row.open_call_closes_at),
    seats: row.seats ?? [],
    materials: row.materials ?? [],
    line: row.line,
    contract,
  };
}

async function contractsByOrg(): Promise<Map<string, ContractRecord>> {
  const contracts = await allContracts();
  return new Map(contracts.map((contract) => [contract.orgId, contract]));
}

export async function loadBookings(
  where: string,
  params: readonly unknown[],
  orderBy = 'b.start_at, b.ref',
  client?: PoolClient,
): Promise<BookingRecord[]> {
  const sql = `${BOOKING_SELECT} WHERE ${where} ORDER BY ${orderBy}`;
  const runner = client ?? pool;
  const [result, contracts] = await Promise.all([
    runner.query<BookingRow>(sql, params as unknown[]),
    contractsByOrg(),
  ]);
  return result.rows.map((row) => hydrate(row, contracts));
}

export async function loadBooking(
  id: string,
  client?: PoolClient,
): Promise<BookingRecord | null> {
  const rows = await loadBookings('b.id = $1', [id], 'b.start_at', client);
  return rows[0] ?? null;
}

export function seatsHeld(booking: BookingRecord): number {
  return booking.seats.filter((seat) => seat.holder !== null).length;
}

export function holders(booking: BookingRecord): HolderRecord[] {
  return booking.seats
    .map((seat) => seat.holder)
    .filter((holder): holder is HolderRecord => holder !== null);
}

export function seatOf(booking: BookingRecord, interpreterId: string): number | null {
  return booking.seats.find((seat) => seat.holder?.id === interpreterId)?.seat ?? null;
}
