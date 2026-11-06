import type { AssignmentRecord, SeatRecord } from '../domain/records.js';
import type { Queryable, QueryValue } from './pool.js';
import { pool } from './pool.js';

interface AssignmentRow {
  id: number;
  number: string;
  org_id: number;
  org_code: string;
  org_name: string;
  scheduler_id: number;
  scheduler_name: string;
  scheduler_phone: string;
  scheduler_email: string;
  language_code: string;
  language_name: string;
  setting: string;
  start_at: Date;
  duration_minutes: number;
  street_address: string;
  city: string;
  patient_initials: string;
  medical_notes: string;
  status: string;
  offer_round: number;
  coverage_round: number;
  cancelled_at: Date | null;
  fee_applies: boolean | null;
  business_minutes_notice: number | null;
  fee_cents: number | null;
  billing_status: string;
  total_cents: number | null;
  invoice_id: string | null;
  seats: SeatRecord[];
}

const ASSIGNMENT_SELECT = `
SELECT a.id, a.number, a.org_id, o.code AS org_code, o.name AS org_name,
       a.scheduler_id, u.name AS scheduler_name, u.phone AS scheduler_phone, u.email AS scheduler_email,
       a.language_code, l.name AS language_name, a.setting, a.start_at, a.duration_minutes,
       a.street_address, a.city, a.patient_initials, a.medical_notes, a.status,
       a.offer_round, a.coverage_round, a.cancelled_at, a.fee_applies, a.business_minutes_notice,
       a.fee_cents, a.billing_status, a.total_cents, a.invoice_id,
       COALESCE((
         SELECT json_agg(json_build_object(
                  'seat_id', s.id,
                  'seat_no', s.seat_no,
                  'status', s.status,
                  'holder_id', s.holder_id,
                  'holder_initials', h.initials,
                  'holder_name', h.name,
                  'verified', v.id IS NOT NULL,
                  'actual_minutes', v.actual_minutes,
                  'round_trip_miles', v.round_trip_miles
                ) ORDER BY s.seat_no)
         FROM seats s
         LEFT JOIN users h ON h.id = s.holder_id
         LEFT JOIN verifications v ON v.seat_id = s.id
         WHERE s.assignment_id = a.id
       ), '[]'::json) AS seats
FROM assignments a
JOIN orgs o ON o.id = a.org_id
JOIN users u ON u.id = a.scheduler_id
JOIN languages l ON l.code = a.language_code`;

function toRecord(row: AssignmentRow): AssignmentRecord {
  return { ...row, seats: row.seats } as AssignmentRecord;
}

export async function findAssignmentByNumber(
  db: Queryable,
  number: string,
): Promise<AssignmentRecord | null> {
  const result = await db.query<AssignmentRow>(`${ASSIGNMENT_SELECT} WHERE a.number = $1`, [number]);
  const row = result.rows[0];
  return row === undefined ? null : toRecord(row);
}

export async function findAssignmentById(db: Queryable, id: number): Promise<AssignmentRecord> {
  const result = await db.query<AssignmentRow>(`${ASSIGNMENT_SELECT} WHERE a.id = $1`, [id]);
  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`assignment ${id} disappeared`);
  }
  return toRecord(row);
}

export interface AssignmentQuery {
  orgId?: number;
  search?: string;
  languages?: string[];
  statuses?: string[];
  heldBy?: number;
  startsAfter?: Date;
  startsBetween?: { from: Date; to: Date };
  billingStatuses?: string[];
}

export async function queryAssignments(
  db: Queryable,
  filter: AssignmentQuery,
): Promise<AssignmentRecord[]> {
  const clauses: string[] = [];
  const values: QueryValue[] = [];
  const add = (clause: string, value: QueryValue): void => {
    values.push(value);
    clauses.push(clause.replace('$?', `$${values.length}`));
  };

  if (filter.orgId !== undefined) {
    add('a.org_id = $?', filter.orgId);
  }
  if (filter.search !== undefined && filter.search !== '') {
    values.push(`%${filter.search}%`);
    clauses.push(`(a.number ILIKE $${values.length} OR a.city ILIKE $${values.length})`);
  }
  if (filter.languages !== undefined) {
    add('a.language_code = ANY($?)', filter.languages);
  }
  if (filter.statuses !== undefined) {
    add('a.status = ANY($?)', filter.statuses);
  }
  if (filter.billingStatuses !== undefined) {
    add('a.billing_status = ANY($?)', filter.billingStatuses);
  }
  if (filter.heldBy !== undefined) {
    add('EXISTS (SELECT 1 FROM seats s WHERE s.assignment_id = a.id AND s.holder_id = $?)', filter.heldBy);
  }
  if (filter.startsAfter !== undefined) {
    add('a.start_at > $?', filter.startsAfter);
  }
  if (filter.startsBetween !== undefined) {
    add('a.start_at >= $?', filter.startsBetween.from);
    add('a.start_at < $?', filter.startsBetween.to);
  }

  const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`;
  const result = await db.query<AssignmentRow>(
    `${ASSIGNMENT_SELECT}${where} ORDER BY a.start_at ASC, a.id ASC`,
    values,
  );
  return result.rows.map(toRecord);
}

/** Locks the assignment row so that coverage decisions on it are serialised. */
export async function lockAssignment(db: Queryable, id: number): Promise<void> {
  await db.query('SELECT 1 FROM assignments WHERE id = $1 FOR UPDATE', [id]);
}

export async function nextAssignmentNumber(db: Queryable): Promise<string> {
  const result = await db.query<{ value: number }>("SELECT nextval('assignment_number_seq') AS value");
  const value = result.rows[0]?.value;
  if (value === undefined) {
    throw new Error('assignment number sequence returned nothing');
  }
  return `A-${value}`;
}

export async function listLanguages(): Promise<Array<{ code: string; name: string }>> {
  const result = await pool.query<{ code: string; name: string }>(
    'SELECT code, name FROM languages ORDER BY sort_order ASC',
  );
  return result.rows;
}
