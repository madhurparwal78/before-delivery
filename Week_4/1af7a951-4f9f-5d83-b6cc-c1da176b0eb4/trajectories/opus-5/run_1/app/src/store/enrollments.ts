import { randomBytes } from 'node:crypto';
import { oneRow, type Queryable } from '../db/pool.js';
import { wakeAlarm } from '../domain/night.js';
import type { DateKey } from '../domain/time.js';

export type EnrollmentStatus = 'pending_payment' | 'active' | 'refunded';
export type ReceiptStatus = 'none' | 'pending' | 'sent';

export interface EnrollmentRow {
  readonly id: string;
  readonly cohort_id: string;
  readonly name: string;
  readonly email: string;
  readonly status: EnrollmentStatus;
  readonly home_tz: string;
  readonly bedtime: string;
  readonly first_night: DateKey | null;
  readonly access_code: string;
  readonly comped: boolean;
  readonly receipt_status: ReceiptStatus;
  readonly paid_amount_cents: number | null;
  readonly cohort_name: string;
  readonly price_cents: number;
}

export interface EnrollmentView {
  readonly id: string;
  readonly cohort_id: string;
  readonly cohort_name: string;
  readonly name: string;
  readonly email: string;
  readonly status: EnrollmentStatus;
  readonly price_cents: number;
  readonly home_tz: string;
  readonly bedtime: string;
  readonly wake_alarm: string;
  readonly first_night: DateKey | null;
  readonly receipt_status: ReceiptStatus;
}

const ENROLLMENT_SELECT = `
  select e.id, e.cohort_id, e.name, e.email, e.status, e.home_tz, e.bedtime, e.first_night,
         e.access_code, e.comped, e.receipt_status, e.paid_amount_cents,
         c.name as cohort_name, c.price_cents
    from enrollments e
    join cohorts c on c.id = e.cohort_id`;

export function enrollmentView(row: EnrollmentRow): EnrollmentView {
  return {
    id: row.id,
    cohort_id: row.cohort_id,
    cohort_name: row.cohort_name,
    name: row.name,
    email: row.email,
    status: row.status,
    price_cents: row.price_cents,
    home_tz: row.home_tz,
    bedtime: row.bedtime,
    wake_alarm: wakeAlarm(row.bedtime),
    first_night: row.status === 'active' ? row.first_night : null,
    receipt_status: row.receipt_status,
  };
}

export async function findEnrollment(
  id: string,
  client?: Queryable,
): Promise<EnrollmentRow | null> {
  return oneRow<EnrollmentRow>(`${ENROLLMENT_SELECT} where e.id = $1`, [id], client);
}

export async function findEnrollmentByAccessCode(code: string): Promise<EnrollmentRow | null> {
  return oneRow<EnrollmentRow>(`${ENROLLMENT_SELECT} where e.access_code = $1`, [code]);
}

export async function findEnrollmentByEmail(
  cohortId: string,
  email: string,
): Promise<EnrollmentRow | null> {
  return oneRow<EnrollmentRow>(
    `${ENROLLMENT_SELECT}
      where e.cohort_id = $1 and lower(e.email) = lower($2) and e.status in ('pending_payment', 'active')`,
    [cohortId, email],
  );
}

export function newAccessCode(): string {
  return `lf-${randomBytes(12).toString('base64url')}`;
}

export async function latestStoredNightKey(
  enrollmentId: string,
  client?: Queryable,
): Promise<DateKey | null> {
  const row = await oneRow<{ night_key: DateKey | null }>(
    'select max(night_key)::text as night_key from entries where enrollment_id = $1',
    [enrollmentId],
    client,
  );
  return row?.night_key ?? null;
}
