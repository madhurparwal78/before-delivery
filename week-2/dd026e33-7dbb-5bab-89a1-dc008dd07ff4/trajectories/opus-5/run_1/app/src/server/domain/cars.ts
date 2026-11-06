import { BAY_PLAN } from '../../shared/bays';
import type {
  Bay,
  BayBilling,
  BayClass,
  Car,
  CarStatus,
  Entry,
  Item,
  Movement,
  Photo,
  Report,
} from '../../shared/types';
import type { CareFlag, ItemKind } from '../../shared/types';
import { query, type QueryValue, type Tx } from '../db';
import { startupOf } from './startup';

export interface CarRow {
  id: string;
  owner_id: string;
  owner_name: string;
  year: number;
  make: string;
  model: string;
  registration: string;
  colour: string;
  length_mm: number;
  width_mm: number;
  odometer_km: number;
  tyre_spec_bar: string;
  startup_scheduled: boolean;
  status: CarStatus;
  bay_id: string | null;
  bay_code: string | null;
  bay_class: BayClass | null;
  stay_seq: number;
  intake_at: Date | null;
  released_at: Date | null;
  last_startup_at: Date | null;
  open_release: boolean;
  sub_plan: string | null;
  charged_through_date: string | null;
  billing_end_date: string | null;
  cancel_requested: boolean | null;
  sub_cancelled: boolean | null;
}

export const CAR_SELECT = `
  select c.*, u.name as owner_name,
    b.code as bay_code, b.class as bay_class,
    s.plan as sub_plan, s.charged_through_date, s.billing_end_date,
    s.cancel_requested, s.cancelled as sub_cancelled,
    (select max(e.at) from care_entries e where e.car_id = c.id and e.started) as last_startup_at,
    exists(select 1 from releases r where r.car_id = c.id
           and r.status in ('requested','booked','staged')) as open_release
  from cars c
  join users u on u.id = c.owner_id
  left join bays b on b.id = c.bay_id
  left join subscriptions s on s.car_id = c.id`;

/** Cars come in the published card order: by bay code, then cars without a bay by name. */
export const CAR_ORDER = `order by (b.code is null), b.code, c.year, c.make, c.model`;

export function carName(row: {
  year: number;
  make: string;
  model: string;
}): string {
  return `${row.year} ${row.make} ${row.model}`;
}

function bayBillingOf(row: CarRow): BayBilling {
  if (row.sub_plan === null) {
    return {
      status: 'none',
      plan: null,
      monthly_price: null,
      charged_through_date: null,
      billing_end_date: null,
      cancel_requested: false,
    };
  }
  const price =
    Object.values(BAY_PLAN).find((entry) => entry.plan === row.sub_plan)?.price ?? null;
  const status =
    row.billing_end_date !== null ? 'ending' : row.charged_through_date !== null ? 'active' : 'pending';
  return {
    status,
    plan: row.sub_plan,
    monthly_price: price,
    charged_through_date: row.charged_through_date,
    billing_end_date: row.billing_end_date,
    cancel_requested: row.cancel_requested === true,
  };
}

export function toCar(row: CarRow, now: Date): Car {
  return {
    id: row.id,
    name: carName(row),
    year: row.year,
    make: row.make,
    model: row.model,
    registration: row.registration,
    colour: row.colour,
    owner: { id: row.owner_id, name: row.owner_name },
    length_mm: row.length_mm,
    width_mm: row.width_mm,
    odometer_km: row.odometer_km,
    tyre_spec_bar: row.tyre_spec_bar,
    status: row.status,
    bay:
      row.bay_id === null || row.bay_code === null || row.bay_class === null
        ? null
        : { id: row.bay_id, code: row.bay_code, class: row.bay_class },
    startup: startupOf(
      {
        scheduled: row.startup_scheduled,
        lastStartupAt: row.last_startup_at,
        intakeAt: row.intake_at,
      },
      now,
    ),
    bay_billing: bayBillingOf(row),
    open_release: row.open_release,
  };
}

export async function loadCarRow(
  carId: string,
  ownerId: string | null,
): Promise<CarRow | null> {
  const values: QueryValue[] = [carId];
  let where = 'where c.id = $1';
  if (ownerId !== null) {
    values.push(ownerId);
    where += ' and c.owner_id = $2';
  }
  const rows = await query<CarRow>(`${CAR_SELECT} ${where}`, values);
  return rows[0] ?? null;
}

export async function loadCarRowIn(
  tx: Tx,
  carId: string,
  ownerId: string | null,
): Promise<CarRow | null> {
  const values: QueryValue[] = [carId];
  let where = 'where c.id = $1';
  if (ownerId !== null) {
    values.push(ownerId);
    where += ' and c.owner_id = $2';
  }
  return tx.queryOne<CarRow>(`${CAR_SELECT} ${where}`, values);
}

export interface BayRow {
  id: string;
  code: string;
  class: BayClass;
  length_mm: number;
  width_mm: number;
  row_index: number;
  column_index: number;
  car_id: string | null;
  car_year: number | null;
  car_make: string | null;
  car_model: string | null;
}

export const BAY_SELECT = `
  select b.*, c.id as car_id, c.year as car_year, c.make as car_make, c.model as car_model
  from bays b
  left join cars c on c.bay_id = b.id
  order by b.row_index, b.column_index`;

export function toBay(row: BayRow): Bay {
  return {
    id: row.id,
    code: row.code,
    class: row.class,
    length_mm: row.length_mm,
    width_mm: row.width_mm,
    row: row.row_index,
    column: row.column_index,
    car:
      row.car_id === null || row.car_year === null || row.car_make === null || row.car_model === null
        ? null
        : {
            id: row.car_id,
            name: carName({ year: row.car_year, make: row.car_make, model: row.car_model }),
          },
  };
}

export interface ItemRow {
  id: string;
  kind: ItemKind;
  label: string;
  count_in: string;
}

export const ITEM_SELECT = `
  select i.id, i.kind, i.label,
    coalesce(sum(case when m.direction = 'in' then m.count else -m.count end), 0)::text as count_in
  from belongings i
  left join movements m on m.item_id = i.id
  where i.car_id = $1
  group by i.id, i.kind, i.label, i.created_at
  order by i.created_at, i.id`;

export const ITEM_BY_ID_SELECT = `
  select i.id, i.kind, i.label,
    coalesce(sum(case when m.direction = 'in' then m.count else -m.count end), 0)::text as count_in
  from belongings i
  left join movements m on m.item_id = i.id
  where i.id = $1
  group by i.id, i.kind, i.label, i.created_at`;

export function toItem(row: ItemRow): Item {
  return { id: row.id, kind: row.kind, label: row.label, count_in: Number(row.count_in) };
}

export interface MovementRow {
  id: string;
  direction: 'in' | 'out';
  count: number;
  at: Date;
  by_id: string;
  by_name: string;
}

export function toMovement(row: MovementRow): Movement {
  return {
    id: row.id,
    direction: row.direction,
    count: row.count,
    at: row.at.toISOString(),
    by: { id: row.by_id, name: row.by_name },
  };
}

export interface ReportRow {
  id: string;
  car_id: string;
  sha256: string;
  size_bytes: number;
  uploaded_at: Date;
  uploaded_by: string;
  uploaded_by_name: string;
  object_key: string;
}

export function toReport(row: ReportRow): Report {
  return {
    id: row.id,
    car_id: row.car_id,
    sha256: row.sha256,
    size_bytes: row.size_bytes,
    uploaded_at: row.uploaded_at.toISOString(),
    uploaded_by: { id: row.uploaded_by, name: row.uploaded_by_name },
  };
}

export interface PhotoRow {
  id: string;
  car_id: string;
  kind: 'intake' | 'stage';
  job_id: string | null;
  content_type: string;
  size_bytes: number;
  created_at: Date;
  object_key: string;
}

export function toPhoto(row: PhotoRow): Photo {
  return {
    id: row.id,
    car_id: row.car_id,
    kind: row.kind,
    job_id: row.job_id,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    attached: true,
    created_at: row.created_at.toISOString(),
  };
}

export interface EntryRow {
  id: string;
  at: Date;
  by_user: string;
  by_name: string;
  started: boolean;
  battery_v: string | null;
  tyre_fl: string | null;
  tyre_fr: string | null;
  tyre_rl: string | null;
  tyre_rr: string | null;
  note: string;
  flags: CareFlag[];
}

export const ENTRY_SELECT = `
  select e.id, e.at, e.by_user, u.name as by_name, e.started, e.battery_v,
    e.tyre_fl, e.tyre_fr, e.tyre_rl, e.tyre_rr, e.note, e.flags
  from care_entries e join users u on u.id = e.by_user`;

export function toEntry(row: EntryRow): Entry {
  const tyres =
    row.tyre_fl === null || row.tyre_fr === null || row.tyre_rl === null || row.tyre_rr === null
      ? null
      : { fl: row.tyre_fl, fr: row.tyre_fr, rl: row.tyre_rl, rr: row.tyre_rr };
  return {
    id: row.id,
    at: row.at.toISOString(),
    by: { id: row.by_user, name: row.by_name },
    started: row.started,
    battery_v: row.battery_v,
    tyres_bar: tyres,
    note: row.note,
    flags: row.flags,
  };
}
