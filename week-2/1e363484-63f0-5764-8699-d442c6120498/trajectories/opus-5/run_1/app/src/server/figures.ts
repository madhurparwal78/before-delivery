import { fromString, type Dec } from '../domain/decimal';
import { derive, type Contribution, type SensorKind } from '../domain/derivation';
import type { Queryable } from './db/queryable';
import { loadProject, loadReadings, shapeOf, type Project } from './projects';

export type FigureStatus = 'sealed' | 'broken' | 'superseded';

export interface FigureRecord {
  readonly id: string;
  readonly projectSlug: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly sensorIds: readonly string[];
  readonly status: FigureStatus;
  readonly supersedes: string | null;
  readonly supersededBy: string | null;
  readonly coveragePct: Dec;
  readonly floorPct: Dec;
  readonly net: Dec;
  readonly co2: Dec;
  readonly ch4: Dec;
  readonly bufferPct: Dec;
  readonly buffer: Dec;
  readonly credited: Dec;
  readonly readingsCount: number;
  readonly fingerprint: string;
  readonly sealedAtMs: number;
  readonly sealedBy: string;
  readonly checkedAtMs: number;
  readonly readingsKey: string;
  readonly derivationKey: string;
  readonly sealedRevisionId: string;
  readonly contributions: readonly Contribution[];
}

interface FigureRow {
  id: string;
  project_slug: string;
  start_ts: Date;
  end_ts: Date;
  sensor_ids: string[];
  status: FigureStatus;
  supersedes: string | null;
  superseded_by: string | null;
  coverage_pct: string;
  floor_pct: string;
  net_tco2e: string;
  co2_tco2e: string;
  ch4_tco2e: string;
  buffer_pct: string;
  buffer_tco2e: string;
  credited_tco2e: string;
  readings_count: number;
  fingerprint: string;
  sealed_at: Date;
  sealed_by: string;
  checked_at: Date;
  readings_key: string;
  derivation_key: string;
  sealed_revision_id: string;
}

interface ContributionRow {
  figure_id: string;
  sensor_id: string;
  kind: SensorKind;
  area_m2: string;
  qualifying_half_hours: number;
  half_hours: number;
  co2_tco2e: string;
  ch4_tco2e: string;
  net_tco2e: string;
}

const FIGURE_COLUMNS = `id, project_slug, start_ts, end_ts, sensor_ids, status, supersedes,
  superseded_by, coverage_pct, floor_pct, net_tco2e, co2_tco2e, ch4_tco2e, buffer_pct,
  buffer_tco2e, credited_tco2e, readings_count, fingerprint, sealed_at, sealed_by, checked_at,
  readings_key, derivation_key, sealed_revision_id`;

function toRecord(row: FigureRow, contributions: ContributionRow[]): FigureRecord {
  return {
    id: row.id,
    projectSlug: row.project_slug,
    startMs: row.start_ts.getTime(),
    endMs: row.end_ts.getTime(),
    sensorIds: row.sensor_ids,
    status: row.status,
    supersedes: row.supersedes,
    supersededBy: row.superseded_by,
    coveragePct: fromString(row.coverage_pct),
    floorPct: fromString(row.floor_pct),
    net: fromString(row.net_tco2e),
    co2: fromString(row.co2_tco2e),
    ch4: fromString(row.ch4_tco2e),
    bufferPct: fromString(row.buffer_pct),
    buffer: fromString(row.buffer_tco2e),
    credited: fromString(row.credited_tco2e),
    readingsCount: row.readings_count,
    fingerprint: row.fingerprint,
    sealedAtMs: row.sealed_at.getTime(),
    sealedBy: row.sealed_by,
    checkedAtMs: row.checked_at.getTime(),
    readingsKey: row.readings_key,
    derivationKey: row.derivation_key,
    sealedRevisionId: row.sealed_revision_id,
    contributions: contributions
      .filter((contribution) => contribution.figure_id === row.id)
      .map((contribution) => ({
        sensorId: contribution.sensor_id,
        kind: contribution.kind,
        areaM2: BigInt(contribution.area_m2),
        qualifyingHalfHours: contribution.qualifying_half_hours,
        halfHours: contribution.half_hours,
        co2: fromString(contribution.co2_tco2e),
        ch4: fromString(contribution.ch4_tco2e),
        net: fromString(contribution.net_tco2e),
      })),
  };
}

async function contributionsFor(
  executor: Queryable,
  figureIds: readonly string[],
): Promise<ContributionRow[]> {
  if (figureIds.length === 0) return [];
  const result = await executor.query<ContributionRow>(
    `select figure_id, sensor_id, kind, area_m2, qualifying_half_hours, half_hours,
            co2_tco2e, ch4_tco2e, net_tco2e
     from figure_contributions where figure_id = any($1) order by sensor_id`,
    [[...figureIds]],
  );
  return result.rows;
}

export async function loadFigure(executor: Queryable, id: string): Promise<FigureRecord | null> {
  const result = await executor.query<FigureRow>(
    `select ${FIGURE_COLUMNS} from figures where id = $1`,
    [id],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return toRecord(row, await contributionsFor(executor, [row.id]));
}

export async function loadProjectFigures(
  executor: Queryable,
  slug: string,
): Promise<FigureRecord[]> {
  const result = await executor.query<FigureRow>(
    `select ${FIGURE_COLUMNS} from figures where project_slug = $1 order by seq desc`,
    [slug],
  );
  const contributions = await contributionsFor(
    executor,
    result.rows.map((row) => row.id),
  );
  return result.rows.map((row) => toRecord(row, contributions));
}

export interface Summary {
  readonly sealedNet: Dec;
  readonly buffer: Dec;
  readonly intactCount: number;
  readonly brokenCount: number;
  readonly supersededCount: number;
}

/** The balance, buffer and counts, always read from the committed ledger and figure rows. */
export async function loadSummary(executor: Queryable, slug: string): Promise<Summary> {
  const balance = await executor.query<{ balance: string; buffer: string }>(
    `select coalesce(sum(entry.tco2e), 0) as balance,
            coalesce(sum(case when entry.kind = 'buffer'
                              or reversed.kind = 'buffer' then entry.tco2e else 0 end), 0) as buffer
     from ledger_entries entry
     left join ledger_entries reversed on reversed.id = entry.reverses
     where entry.project_slug = $1`,
    [slug],
  );
  const counts = await executor.query<{ status: FigureStatus; count: string }>(
    'select status, count(*) as count from figures where project_slug = $1 group by status',
    [slug],
  );
  const byStatus = new Map(counts.rows.map((row) => [row.status, Number(row.count)]));
  return {
    sealedNet: fromString(balance.rows[0]!.balance),
    buffer: fromString(balance.rows[0]!.buffer),
    intactCount: byStatus.get('sealed') ?? 0,
    brokenCount: byStatus.get('broken') ?? 0,
    supersededCount: byStatus.get('superseded') ?? 0,
  };
}

export interface LedgerEntry {
  readonly id: string;
  readonly figureId: string;
  readonly kind: 'issuance' | 'buffer' | 'reversal';
  readonly tco2e: Dec;
  readonly reverses: string | null;
  readonly recordedAtMs: number;
}

export async function loadLedger(executor: Queryable, slug: string): Promise<LedgerEntry[]> {
  const result = await executor.query<{
    id: string;
    figure_id: string;
    kind: LedgerEntry['kind'];
    tco2e: string;
    reverses: string | null;
    recorded_at: Date;
  }>(
    `select id, figure_id, kind, tco2e, reverses, recorded_at from ledger_entries
     where project_slug = $1 order by seq`,
    [slug],
  );
  return result.rows.map((row) => ({
    id: row.id,
    figureId: row.figure_id,
    kind: row.kind,
    tco2e: fromString(row.tco2e),
    reverses: row.reverses,
    recordedAtMs: row.recorded_at.getTime(),
  }));
}

export interface MovedReading {
  readonly sensorId: string;
  readonly intervalStartMs: number;
  readonly old: { fc: string; fch4: string; qc: number } | null;
  readonly next: { fc: string; fch4: string; qc: number };
  readonly revisedAtMs: number;
  readonly batchId: string;
}

/** Every revision or insertion inside the figure's scope after it was sealed. */
export async function loadMovedReadings(
  executor: Queryable,
  figure: FigureRecord,
): Promise<MovedReading[]> {
  const result = await executor.query<{
    sensor_id: string;
    interval_start: Date;
    old_fc: string | null;
    old_fch4: string | null;
    old_qc: number | null;
    new_fc: string;
    new_fch4: string;
    new_qc: number;
    revised_at: Date;
    batch_id: string;
  }>(
    `select sensor_id, interval_start, old_fc, old_fch4, old_qc, new_fc, new_fch4, new_qc,
            revised_at, batch_id
     from reading_revisions
     where project_slug = $1 and sensor_id = any($2)
       and interval_start >= $3 and interval_start < $4 and id > $5
     order by revised_at, sensor_id, interval_start`,
    [
      figure.projectSlug,
      [...figure.sensorIds],
      new Date(figure.startMs).toISOString(),
      new Date(figure.endMs).toISOString(),
      figure.sealedRevisionId,
    ],
  );
  return result.rows.map((row) => ({
    sensorId: row.sensor_id,
    intervalStartMs: row.interval_start.getTime(),
    old:
      row.old_fc === null || row.old_fch4 === null || row.old_qc === null
        ? null
        : { fc: row.old_fc, fch4: row.old_fch4, qc: row.old_qc },
    next: { fc: row.new_fc, fch4: row.new_fch4, qc: row.new_qc },
    revisedAtMs: row.revised_at.getTime(),
    batchId: row.batch_id,
  }));
}

export interface Rederivation {
  readonly fingerprint: string;
  readonly coveragePct: Dec;
  readonly net: Dec;
  readonly matches: boolean;
  readonly checkedAtMs: number;
}

/** Re-derives a figure from current readings and records the check time. */
export async function rederiveFigure(
  executor: Queryable,
  figure: FigureRecord,
  project?: Project,
): Promise<Rederivation> {
  const owner = project ?? (await loadProject(executor, figure.projectSlug))!;
  const readings = await loadReadings(
    executor,
    figure.projectSlug,
    figure.sensorIds,
    figure.startMs,
    figure.endMs,
  );
  const derived = derive({
    shape: shapeOf(owner),
    startMs: figure.startMs,
    endMs: figure.endMs,
    sensorIds: figure.sensorIds,
    readings,
  });
  const checked = await executor.query<{ checked_at: Date }>(
    "update figures set checked_at = date_trunc('second', now()) where id = $1 returning checked_at",
    [figure.id],
  );
  return {
    fingerprint: derived.fingerprint,
    coveragePct: derived.coveragePct,
    net: derived.net,
    matches: derived.fingerprint === figure.fingerprint,
    checkedAtMs: checked.rows[0]!.checked_at.getTime(),
  };
}
