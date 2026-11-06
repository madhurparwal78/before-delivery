import { formatMoney, formatQty, parseMoney, parseQty, priceLine, totalsOf } from '../../shared/money';
import { deriveCoatStack, type CoatStack, type LoggedStageReadings } from '../../shared/coatstack';
import type { PanelId } from '../../shared/panels';
import { isPanelId } from '../../shared/panels';
import { jobActionAllowed, type JobAction } from '../../shared/jobstates';
import type { Job, JobStatus, Line, LineKind } from '../../shared/types';
import { query, type QueryValue, type Tx } from '../db';
import { carName } from './cars';
import { fail } from '../http/errors';

export interface JobRow {
  id: string;
  number: string;
  car_id: string;
  owner_id: string;
  owner_name: string;
  car_year: number;
  car_make: string;
  car_model: string;
  title: string;
  status: JobStatus;
  version: number;
  sent_at: Date | null;
  expires_at: Date | null;
  approved_at: Date | null;
  declined_at: Date | null;
  finished_at: Date | null;
  invoice_id: string | null;
}

export interface LineRow {
  id: string;
  kind: LineKind;
  description: string;
  quantity: string;
  unit_price: string;
}

export interface StageRow {
  id: string;
  name: string;
  stage_order: number;
  logged_at: Date;
  readings_count: string;
}

export const JOB_SELECT = `
  select j.*, u.name as owner_name, c.year as car_year, c.make as car_make, c.model as car_model
  from jobs j
  join users u on u.id = j.owner_id
  join cars c on c.id = j.car_id`;

/** Every read reports a sent estimate as expired from its expiry instant on. */
export function effectiveStatus(row: JobRow, now: Date): JobStatus {
  if (row.status === 'sent' && row.expires_at !== null && now.getTime() >= row.expires_at.getTime()) {
    return 'expired';
  }
  return row.status;
}

export function toLines(rows: readonly LineRow[]): Line[] {
  return rows.map((row) => {
    const quantity = parseQty(row.quantity) ?? 0n;
    const unitPrice = parseMoney(row.unit_price) ?? 0n;
    const priced = priceLine(quantity, unitPrice);
    return {
      id: row.id,
      kind: row.kind,
      description: row.description,
      quantity: formatQty(quantity),
      unit_price: formatMoney(unitPrice),
      net: formatMoney(priced.net),
      vat: formatMoney(priced.vat),
    };
  });
}

export function lineTotals(rows: readonly LineRow[]): {
  net_total: string;
  vat_total: string;
  rounding: string;
  total: string;
} {
  const priced = rows.map((row) =>
    priceLine(parseQty(row.quantity) ?? 0n, parseMoney(row.unit_price) ?? 0n),
  );
  const totals = totalsOf(priced);
  return {
    net_total: formatMoney(totals.netTotal),
    vat_total: formatMoney(totals.vatTotal),
    rounding: formatMoney(totals.rounding),
    total: formatMoney(totals.total),
  };
}

export function toJob(
  row: JobRow,
  lines: readonly LineRow[],
  stages: readonly StageRow[],
  now: Date,
): Job {
  const totals = lineTotals(lines);
  return {
    id: row.id,
    number: row.number,
    version: row.version,
    car: {
      id: row.car_id,
      name: carName({ year: row.car_year, make: row.car_make, model: row.car_model }),
    },
    owner: { id: row.owner_id, name: row.owner_name },
    title: row.title,
    status: effectiveStatus(row, now),
    lines: toLines(lines),
    net_total: totals.net_total,
    vat_total: totals.vat_total,
    rounding: totals.rounding,
    total: totals.total,
    currency: 'CHF',
    sent_at: row.sent_at?.toISOString() ?? null,
    expires_at: row.expires_at?.toISOString() ?? null,
    approved_at: row.approved_at?.toISOString() ?? null,
    declined_at: row.declined_at?.toISOString() ?? null,
    finished_at: row.finished_at?.toISOString() ?? null,
    stages: stages.map((stage, index) => ({
      id: stage.id,
      index,
      name: stage.name,
      logged_at: stage.logged_at.toISOString(),
      readings_count: Number(stage.readings_count),
    })),
    invoice_id: row.invoice_id,
  };
}

function ownerFilter(ownerId: string | null, parameterIndex: number): string {
  return ownerId === null ? '' : ` and j.owner_id = $${parameterIndex} and j.status <> 'draft'`;
}

export async function loadJobRow(jobId: string, ownerId: string | null): Promise<JobRow | null> {
  const values: QueryValue[] = [jobId];
  if (ownerId !== null) values.push(ownerId);
  const rows = await query<JobRow>(
    `${JOB_SELECT} where j.id = $1${ownerFilter(ownerId, 2)}`,
    values,
  );
  return rows[0] ?? null;
}

export async function loadLines(jobId: string): Promise<LineRow[]> {
  return query<LineRow>(
    'select id, kind, description, quantity, unit_price from job_lines where job_id = $1 order by position',
    [jobId],
  );
}

export async function loadStages(jobId: string): Promise<StageRow[]> {
  return query<StageRow>(
    `select s.id, s.name, s.stage_order, s.logged_at,
       (select count(*) from readings r where r.stage_id = s.id)::text as readings_count
     from job_stages s where s.job_id = $1 order by s.stage_order`,
    [jobId],
  );
}

export async function loadJob(jobId: string, ownerId: string | null, now: Date): Promise<Job | null> {
  const row = await loadJobRow(jobId, ownerId);
  if (row === null) return null;
  const [lines, stages] = await Promise.all([loadLines(jobId), loadStages(jobId)]);
  return toJob(row, lines, stages, now);
}

export async function loadJobIn(tx: Tx, jobId: string, now: Date): Promise<Job | null> {
  const row = await tx.queryOne<JobRow>(`${JOB_SELECT} where j.id = $1`, [jobId]);
  if (row === null) return null;
  const lines = await tx.query<LineRow>(
    'select id, kind, description, quantity, unit_price from job_lines where job_id = $1 order by position',
    [jobId],
  );
  const stages = await tx.query<StageRow>(
    `select s.id, s.name, s.stage_order, s.logged_at,
       (select count(*) from readings r where r.stage_id = s.id)::text as readings_count
     from job_stages s where s.job_id = $1 order by s.stage_order`,
    [jobId],
  );
  return toJob(row, lines, stages, now);
}

/** Refuses a move the job's state does not allow, with the single transition decision. */
export function requireJobAction(job: Job, action: JobAction): void {
  if (
    (action === 'approve' || action === 'decline') &&
    job.status === 'expired'
  ) {
    throw fail.conflict('estimate_expired');
  }
  if (
    !jobActionAllowed(
      { status: job.status, lineCount: job.lines.length, stageCount: job.stages.length },
      action,
    )
  ) {
    throw fail.conflict('invalid_transition');
  }
}

export async function bumpVersion(tx: Tx, jobId: string): Promise<void> {
  await tx.query('update jobs set version = version + 1 where id = $1', [jobId]);
}

interface ReadingRow {
  id: string;
  stage_id: string;
  panel: string;
  film_um: number;
  logged_at: Date;
}

/** The server derives every panel's film build, band and layers at every logged stage. */
export async function loadCoatStack(jobId: string): Promise<CoatStack> {
  const stages = await query<{ id: string; name: string; logged_at: Date }>(
    'select id, name, logged_at from job_stages where job_id = $1 order by stage_order',
    [jobId],
  );
  const readings = await query<ReadingRow>(
    'select id, stage_id, panel, film_um, logged_at from readings where job_id = $1 order by logged_at, id',
    [jobId],
  );
  const byStage = new Map<string, Map<PanelId, number>>();
  for (const reading of readings) {
    if (!isPanelId(reading.panel)) continue;
    const values = byStage.get(reading.stage_id) ?? new Map<PanelId, number>();
    values.set(reading.panel, reading.film_um);
    byStage.set(reading.stage_id, values);
  }
  const logged: LoggedStageReadings[] = stages.map((stage) => ({
    name: stage.name,
    logged_at: stage.logged_at.toISOString(),
    values: byStage.get(stage.id) ?? new Map<PanelId, number>(),
  }));
  return deriveCoatStack(jobId, logged);
}
