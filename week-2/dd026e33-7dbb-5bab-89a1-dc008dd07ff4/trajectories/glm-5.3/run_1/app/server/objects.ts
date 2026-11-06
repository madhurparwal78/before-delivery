import type { Tx } from './db.ts';
import type { Viewer, Actor } from './context.ts';
import { HOUSE_ACTOR } from './domain/project.ts';
import { startupState } from './domain/care.ts';
import { BAY_CLASS_LABELS, type BayClass } from './domain/bays.ts';
import { effectiveStatus } from './domain/jobs.ts';
import { zurichDateISO } from '../shared/dates.ts';
import type { Env } from './env.ts';

/**
 * API object builders — the single place that reads rows into the published
 * object shapes, applying the owner projection.
 */

export interface CarRow {
  id: string;
  owner_id: string;
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
  status: 'awaiting_intake' | 'stored' | 'released';
  bay_id: string | null;
  bay_code: string | null;
  bay_class: BayClass | null;
  intake_at: string | null;
  released_at: string | null;
  created_at: string;
  bay_subscription_id: string | null;
  bay_billing_charged_through: string | null;
  bay_billing_plan_price: string | null;
  bay_billing_cancel_requested: boolean;
  bay_billing_end_date: string | null;
  owner_name: string;
}

export interface ActorRow {
  id: string;
  name: string;
}

export function carName(row: { year: number; make: string; model: string }): string {
  return `${row.year} ${row.make} ${row.model}`;
}

export function projectActor(actor: ActorRow | null, viewer: Viewer): Actor | null {
  if (actor === null) return null;
  if (viewer.isOwner() && actor.id !== viewer.id) {
    return { ...HOUSE_ACTOR };
  }
  return { id: actor.id, name: actor.name };
}

export function bayBilling(row: CarRow): {
  status: 'none' | 'pending' | 'active' | 'ending';
  plan: string | null;
  monthly_price: string | null;
  charged_through_date: string | null;
  billing_end_date: string | null;
  cancel_requested: boolean;
} {
  if (row.bay_billing_end_date) {
    return {
      status: 'ending',
      plan: planForBayClass(row.bay_class),
      monthly_price: row.bay_billing_plan_price,
      charged_through_date: row.bay_billing_charged_through,
      billing_end_date: row.bay_billing_end_date,
      cancel_requested: true,
    };
  }
  if (row.status === 'released') {
    return {
      status: row.bay_subscription_id ? 'active' : 'none',
      plan: planForBayClass(row.bay_class),
      monthly_price: row.bay_billing_plan_price,
      charged_through_date: row.bay_billing_charged_through,
      billing_end_date: null,
      cancel_requested: row.bay_billing_cancel_requested,
    };
  }
  if (!row.bay_subscription_id) {
    return { status: 'none', plan: null, monthly_price: null, charged_through_date: null, billing_end_date: null, cancel_requested: false };
  }
  if (!row.bay_billing_charged_through) {
    return {
      status: 'pending',
      plan: planForBayClass(row.bay_class),
      monthly_price: null,
      charged_through_date: null,
      billing_end_date: null,
      cancel_requested: row.bay_billing_cancel_requested,
    };
  }
  return {
    status: 'active',
    plan: planForBayClass(row.bay_class),
    monthly_price: row.bay_billing_plan_price,
    charged_through_date: row.bay_billing_charged_through,
    billing_end_date: null,
    cancel_requested: row.bay_billing_cancel_requested,
  };
}

function planForBayClass(klass: BayClass | null): string | null {
  if (!klass) return null;
  return `${BAY_CLASS_LABELS[klass]} monthly`;
}

export function startup(
  row: CarRow,
  lastStartupAt: string | null,
  env: Env,
  nowMs: number,
): { scheduled: boolean; last_at: string | null; next_due: string | null; status: 'ok' | 'overdue' | 'not_scheduled' } {
  if (!row.startup_scheduled) {
    return { scheduled: false, last_at: lastStartupAt, next_due: null, status: 'not_scheduled' };
  }
  if (row.intake_at === null && lastStartupAt === null) {
    // scheduled, but the stay has not begun
    return { scheduled: true, last_at: null, next_due: null, status: 'ok' };
  }
  return startupState(true, lastStartupAt, row.intake_at, env.timers.startupOverdueSeconds, nowMs, (ms) => zurichDateISO(new Date(ms)));
}

export interface CarObject {
  id: string;
  name: string;
  year: number;
  make: string;
  model: string;
  registration: string;
  colour: string;
  owner: { id: string; name: string };
  length_mm: number;
  width_mm: number;
  odometer_km: number;
  tyre_spec_bar: string;
  status: string;
  bay: { id: string; code: string; class: string } | null;
  startup: { scheduled: boolean; last_at: string | null; next_due: string | null; status: string };
  bay_billing: ReturnType<typeof bayBilling>;
  open_release: boolean;
}

export function carObject(
  row: CarRow,
  lastStartupAt: string | null,
  openRelease: boolean,
  env: Env,
  nowMs: number,
): CarObject {
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
    bay: row.bay_id
      ? { id: row.bay_id, code: row.bay_code ?? '', class: row.bay_class ?? 'standard' }
      : null,
    startup: startup(row, lastStartupAt, env, nowMs),
    bay_billing: bayBilling(row),
    open_release: openRelease,
  };
}

export interface JobRow {
  id: string;
  number: string;
  car_id: string;
  car_name: string;
  car_year: number;
  car_make: string;
  car_model: string;
  owner_id: string;
  owner_name: string;
  title: string;
  status: string;
  version: number;
  sent_at: string | null;
  expires_at: string | null;
  approved_at: string | null;
  declined_at: string | null;
  finished_at: string | null;
  created_at: string;
  invoice_id: string | null;
}

export function jobStatus(row: JobRow, nowMs: number): string {
  return effectiveStatus(row.status as never, nowMs, row.expires_at ? Date.parse(row.expires_at) : null);
}

export interface StageRow {
  id: string;
  job_id: string;
  name: string;
  logged_at: string;
}

export async function loadActors(tx: Tx, ids: string[]): Promise<Map<string, ActorRow>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return new Map();
  const rows = await tx.query<{ id: string; name: string }>(
    `SELECT id, name FROM users WHERE id = ANY($1::text[])`,
    [unique],
  );
  return new Map(rows.rows.map((row) => [row.id, { id: row.id, name: row.name }]));
}
