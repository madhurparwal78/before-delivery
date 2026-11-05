import { addDays, isoSeconds, storeDateOf, storeWallTimeToInstant, weekdayOf } from '../../shared/time';
import { instrumentLabel } from '../../shared/labels';
import {
  DELIVERY_STATUS_ORDER,
  OPEN_STATUSES,
  type ContractStatus,
  type DeliveryStatus,
  type InstrumentType,
  type RosterResponse,
  type RosterRow,
  type School,
  type Size,
} from '../../shared/types';
import type { Db } from './pricing';

const CUTOFF_HOUR = 17;

/** The cutoff for a delivery day: 5:00 PM store wall-clock time on the day before. */
export function cutoffAt(deliveryDate: string): Date {
  return storeWallTimeToInstant(addDays(deliveryDate, -1), CUTOFF_HOUR);
}

/** The delivery days of a weekday whose cutoff is still later than the clock. */
export function upcomingDeliveryDays(
  weekday: number,
  at: Date,
  count: number,
): Array<{ date: string; cutoff_at: Date }> {
  const days: Array<{ date: string; cutoff_at: Date }> = [];
  let date = storeDateOf(at);
  for (let step = 0; days.length < count && step < 400; step += 1, date = addDays(date, 1)) {
    if (weekdayOf(date) !== weekday) continue;
    const cutoff = cutoffAt(date);
    if (cutoff.getTime() <= at.getTime()) continue;
    days.push({ date, cutoff_at: cutoff });
  }
  return days;
}

export interface SchoolRow {
  id: string;
  name: string;
  delivery_weekday: number;
}

export async function schoolRows(db: Db): Promise<SchoolRow[]> {
  const { rows } = await db.query<SchoolRow>('select id, name, delivery_weekday from schools order by seed_order, id');
  return rows;
}

export async function schoolRow(db: Db, id: string): Promise<SchoolRow | null> {
  const { rows } = await db.query<SchoolRow>('select id, name, delivery_weekday from schools where id = $1', [id]);
  return rows[0] ?? null;
}

export function schoolListing(row: SchoolRow, at: Date): School {
  const days = upcomingDeliveryDays(row.delivery_weekday, at, 4);
  const first = days[0];
  return {
    id: row.id,
    name: row.name,
    delivery_weekday: row.delivery_weekday,
    next_delivery_date: first?.date ?? null,
    cutoff_at: first === undefined ? null : isoSeconds(first.cutoff_at),
    upcoming_delivery_days: days.map((day) => ({ date: day.date, cutoff_at: isoSeconds(day.cutoff_at) })),
  };
}

/** The delivery day a reservation makes: the next day whose cutoff is strictly later than now. */
export function deliveryDateFor(weekday: number, at: Date): string | null {
  return upcomingDeliveryDays(weekday, at, 1)[0]?.date ?? null;
}

const DELIVERY_STATUS_BY_CONTRACT: Record<ContractStatus, DeliveryStatus> = {
  reserved: 'awaiting_agreement',
  agreement_sent: 'awaiting_agreement',
  signed: 'scheduled',
  active: 'delivered',
  paid_off: 'owned',
  returned: 'no_instrument',
  written_off: 'no_instrument',
  exchanged: 'no_instrument',
  expired: 'no_instrument',
};

interface RosterQueryRow {
  student_id: string;
  student_name: string;
  grade: number;
  status: ContractStatus | null;
  instrument_type: InstrumentType | null;
  size: Size | null;
  serial: string | null;
  delivery_date: string | null;
}

export async function roster(db: Db, school: SchoolRow, at: Date): Promise<RosterResponse> {
  const { rows } = await db.query<RosterQueryRow>(
    `select s.id as student_id, s.name as student_name, s.grade,
            c.status, i.instrument_type, i.size, c.serial, c.delivery_date
       from students s
       left join lateral (
         select * from contracts c2
          where c2.student_id = s.id and c2.status <> 'expired'
          order by c2.created_at desc, c2.seq desc limit 1
       ) c on true
       left join instruments i on i.serial = c.serial
      where s.school_id = $1
      order by s.name`,
    [school.id],
  );
  const students: RosterRow[] = rows.map((row) => {
    const status: DeliveryStatus = row.status === null ? 'no_instrument' : DELIVERY_STATUS_BY_CONTRACT[row.status];
    const hasInstrument = status !== 'no_instrument';
    return {
      student_id: row.student_id,
      student_name: row.student_name,
      grade: row.grade,
      instrument_type: hasInstrument ? row.instrument_type : null,
      size: hasInstrument ? row.size : null,
      serial: hasInstrument ? row.serial : null,
      delivery_date: hasInstrument ? row.delivery_date : null,
      delivery_status: status,
    };
  });
  const counts = Object.fromEntries(
    DELIVERY_STATUS_ORDER.map((status) => [status, students.filter((row) => row.delivery_status === status).length]),
  ) as Record<DeliveryStatus, number>;
  return {
    school: { id: school.id, name: school.name, delivery_weekday: school.delivery_weekday },
    next_delivery_date: deliveryDateFor(school.delivery_weekday, at),
    counts,
    students,
  };
}

export interface ManifestRow {
  student_name: string;
  instrument_label: string;
  serial: string;
}

export async function deliveryManifest(db: Db, schoolId: string, date: string): Promise<ManifestRow[]> {
  const { rows } = await db.query<{
    student_name: string;
    instrument_type: InstrumentType;
    size: Size;
    serial: string;
  }>(
    `select s.name as student_name, i.instrument_type, i.size, c.serial
       from contracts c
       join students s on s.id = c.student_id
       join instruments i on i.serial = c.serial
      where s.school_id = $1 and c.delivery_date = $2 and c.status = any($3::text[])
      order by s.name`,
    [schoolId, date, OPEN_STATUSES],
  );
  return rows.map((row) => ({
    student_name: row.student_name,
    instrument_label: instrumentLabel(row.instrument_type, row.size),
    serial: row.serial,
  }));
}
