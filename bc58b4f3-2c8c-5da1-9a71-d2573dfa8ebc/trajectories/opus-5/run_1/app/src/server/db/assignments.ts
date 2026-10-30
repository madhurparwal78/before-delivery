import { chargesFor, rateInForce, serviceLineFor } from '../domain/charges.js';
import type {
  AssignmentRecord,
  AssignmentStatus,
  BillingStatus,
  RateEntry,
  SeatRecord,
  SeatStatus,
  Setting,
} from '../domain/types.js';
import { query, type QueryValue, type Transaction } from './pool.js';
import { listRateEntries } from './rateCards.js';

interface AssignmentRow {
  id: number;
  number: string;
  org_code: string;
  org_name: string;
  scheduler_id: string;
  scheduler_name: string;
  scheduler_phone: string;
  language_code: string;
  language_name: string;
  setting: Setting;
  start_at: Date;
  duration_minutes: number;
  street_address: string;
  city: string;
  patient_initials: string;
  medical_notes: string;
  status: AssignmentStatus;
  seat_count: number;
  cancelled_at: Date | null;
  cancel_fee_applies: boolean | null;
  cancel_business_minutes: number | null;
  cancel_fee_cents: number | null;
  billing_status: BillingStatus;
  invoice_id: string | null;
  total_cents: number | null;
}

interface SeatRow {
  assignment_id: number;
  seat: number;
  status: SeatStatus;
  holder_id: string | null;
  holder_initials: string | null;
  holder_name: string | null;
  actual_minutes: number | null;
  round_trip_miles: number | null;
}

const ASSIGNMENT_COLUMNS = `
  a.id, a.number, a.org_code, o.name as org_name, a.scheduler_id,
  u.name as scheduler_name, u.phone as scheduler_phone,
  a.language_code, l.name as language_name, a.setting, a.start_at, a.duration_minutes,
  a.street_address, a.city, a.patient_initials, a.medical_notes, a.status, a.seat_count,
  a.cancelled_at, a.cancel_fee_applies, a.cancel_business_minutes, a.cancel_fee_cents,
  a.billing_status, a.invoice_id, a.total_cents
`;

const ASSIGNMENT_FROM = `
  from assignments a
  join orgs o on o.code = a.org_code
  join users u on u.id = a.scheduler_id
  join languages l on l.code = a.language_code
`;

const SEAT_SQL = `
  select s.assignment_id, s.seat, s.status, s.holder_id,
         h.initials as holder_initials, h.name as holder_name,
         v.actual_minutes, v.round_trip_miles
  from seats s
  left join users h on h.id = s.holder_id
  left join verifications v on v.assignment_id = s.assignment_id and v.seat = s.seat
  where s.assignment_id = any($1::bigint[])
  order by s.assignment_id, s.seat
`;

function toSeat(row: SeatRow): SeatRecord {
  return {
    seat: row.seat,
    status: row.status,
    holderId: row.holder_id,
    holderInitials: row.holder_initials,
    holderName: row.holder_name,
    actualMinutes: row.actual_minutes,
    roundTripMiles: row.round_trip_miles,
  };
}

function toRecord(row: AssignmentRow, seats: SeatRecord[]): AssignmentRecord {
  return {
    id: row.id,
    number: row.number,
    orgCode: row.org_code,
    orgName: row.org_name,
    schedulerId: row.scheduler_id,
    schedulerName: row.scheduler_name,
    schedulerPhone: row.scheduler_phone,
    languageCode: row.language_code,
    languageName: row.language_name,
    setting: row.setting,
    startAt: row.start_at,
    durationMinutes: row.duration_minutes,
    streetAddress: row.street_address,
    city: row.city,
    patientInitials: row.patient_initials,
    medicalNotes: row.medical_notes,
    status: row.status,
    seatCount: row.seat_count,
    cancelledAt: row.cancelled_at,
    cancelFeeApplies: row.cancel_fee_applies,
    cancelBusinessMinutes: row.cancel_business_minutes,
    cancelFeeCents: row.cancel_fee_cents,
    billingStatus: row.billing_status,
    invoiceId: row.invoice_id,
    totalCents: row.total_cents,
    seats,
  };
}

/** The amount an item would be invoiced for, at the rate in force on its date. */
function billableTotalCents(assignment: AssignmentRecord, rates: readonly RateEntry[]): number {
  const rate = rateInForce(
    rates.filter((entry) => entry.orgCode === assignment.orgCode),
    assignment.startAt,
    serviceLineFor(assignment.languageCode),
  );
  return chargesFor(assignment, rate).totalCents;
}

async function hydrate(rows: AssignmentRow[]): Promise<AssignmentRecord[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => String(row.id));
  const seatRows = await query<SeatRow>(SEAT_SQL, [`{${ids.join(',')}}`]);
  const grouped = new Map<number, SeatRecord[]>();
  for (const seatRow of seatRows) {
    const list = grouped.get(seatRow.assignment_id) ?? [];
    list.push(toSeat(seatRow));
    grouped.set(seatRow.assignment_id, list);
  }
  const records = rows.map((row) => toRecord(row, grouped.get(row.id) ?? []));
  const needsTotal = records.filter(
    (record) => record.billingStatus === 'ready' || record.billingStatus === 'queued',
  );
  if (needsTotal.length > 0) {
    const rates = await listRateEntries();
    for (const record of needsTotal) {
      record.totalCents = billableTotalCents(record, rates);
    }
  }
  return records;
}

export async function findAssignments(
  where: string,
  values: QueryValue[],
  order = 'a.start_at asc, a.id asc',
): Promise<AssignmentRecord[]> {
  const rows = await query<AssignmentRow>(
    `select ${ASSIGNMENT_COLUMNS} ${ASSIGNMENT_FROM} where ${where} order by ${order}`,
    values,
  );
  return hydrate(rows);
}

export async function findAssignmentByNumber(number: string): Promise<AssignmentRecord | null> {
  const records = await findAssignments('a.number = $1', [number]);
  return records[0] ?? null;
}

/** Locks the assignment row for the rest of the transaction. */
export async function lockAssignmentByNumber(
  tx: Transaction,
  number: string,
): Promise<{ id: number; status: AssignmentStatus; billingStatus: BillingStatus } | null> {
  const row = await tx.queryOne<{ id: number; status: AssignmentStatus; billing_status: BillingStatus }>(
    'select id, status, billing_status from assignments where number = $1 for update',
    [number],
  );
  return row === null ? null : { id: row.id, status: row.status, billingStatus: row.billing_status };
}

export async function loadAssignmentInTransaction(
  tx: Transaction,
  id: number,
): Promise<AssignmentRecord> {
  const row = await tx.queryOne<AssignmentRow>(
    `select ${ASSIGNMENT_COLUMNS} ${ASSIGNMENT_FROM} where a.id = $1`,
    [id],
  );
  if (row === null) throw new Error(`Assignment ${id} vanished`);
  const seatRows = await tx.query<SeatRow>(SEAT_SQL, [`{${row.id}}`]);
  return toRecord(row, seatRows.map(toSeat));
}
