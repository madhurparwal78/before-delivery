import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { percent, tonnes, type Dec } from '../domain/decimal';
import { atCoverageFloor, derive, type Derived } from '../domain/derivation';
import { formatTimestamp } from '../domain/time';
import { config } from './config';
import { lockIdempotencyKey, lockProject, pool, withTransaction } from './db/pool';
import type { Queryable } from './db/queryable';
import type { ProjectRole } from './db/seed-data';
import { ApiError, ValidationError } from './http/errors';
import { validateIntervalRequest, type IntervalRequest } from './intervals';
import { figureJson } from './presenters';
import {
  loadReadings,
  loadRecordBounds,
  shapeOf,
  type Person,
  type Project,
  type RecordBounds,
} from './projects';
import type { FigureRecord } from './figures';
import {
  deleteObject,
  evidenceKeys,
  headObject,
  putObject,
  StorageUnavailable,
} from './services/storage';
import { MailUnavailable, sendMail } from './services/mail';

export interface IntactFigure {
  readonly id: string;
  readonly startMs: number;
  readonly endMs: number;
}

export async function loadIntactIntervals(
  executor: Queryable,
  slug: string,
): Promise<IntactFigure[]> {
  const result = await executor.query<{ id: string; start_ts: Date; end_ts: Date }>(
    `select id, start_ts, end_ts from figures
     where project_slug = $1 and status = 'sealed' order by seq`,
    [slug],
  );
  return result.rows.map((row) => ({
    id: row.id,
    startMs: row.start_ts.getTime(),
    endMs: row.end_ts.getTime(),
  }));
}

export type IntervalBlock =
  | { readonly reason: 'below_coverage_floor'; readonly coveragePct: Dec; readonly floorPct: Dec }
  | { readonly reason: 'overlaps_sealed'; readonly figureId: string }
  | { readonly reason: 'already_sealed'; readonly figureId: string };

export type SealBlock = IntervalBlock | { readonly reason: 'role' };

/**
 * The one place the interval preconditions are ordered: below the floor, then overlap,
 * then the same interval already sealed.
 */
export function intervalBlock(
  derived: Derived,
  project: Project,
  intact: readonly IntactFigure[],
): IntervalBlock | null {
  if (!atCoverageFloor(derived.coveragePct, project.floorPct)) {
    return {
      reason: 'below_coverage_floor',
      coveragePct: derived.coveragePct,
      floorPct: project.floorPct,
    };
  }
  const exact = intact.find(
    (figure) => figure.startMs === derived.startMs && figure.endMs === derived.endMs,
  );
  const overlapping = intact.find(
    (figure) =>
      figure.startMs < derived.endMs && derived.startMs < figure.endMs && figure !== exact,
  );
  if (overlapping !== undefined) {
    return { reason: 'overlaps_sealed', figureId: overlapping.id };
  }
  if (exact !== undefined) {
    return { reason: 'already_sealed', figureId: exact.id };
  }
  return null;
}

/** A preview adds the caller's role after the interval checks, as blocked_reason orders them. */
export function previewBlock(
  derived: Derived,
  project: Project,
  role: ProjectRole,
  intact: readonly IntactFigure[],
): SealBlock | null {
  const block = intervalBlock(derived, project, intact);
  if (block !== null) return block;
  return role === 'sealer' ? null : { reason: 'role' };
}

function blockToError(block: IntervalBlock): ApiError {
  switch (block.reason) {
    case 'below_coverage_floor':
      return new ApiError(409, 'below_coverage_floor', {
        coverage_pct: percent(block.coveragePct),
        floor_pct: percent(block.floorPct),
      });
    case 'overlaps_sealed':
      return new ApiError(409, 'interval_overlaps_sealed', { figure_id: block.figureId });
    case 'already_sealed':
      return new ApiError(409, 'already_sealed', { figure_id: block.figureId });
  }
}

function requestHash(
  startRaw: unknown,
  endRaw: unknown,
  sensorsRaw: unknown,
  fingerprintRaw: unknown,
): string {
  const sensors = Array.isArray(sensorsRaw)
    ? [...new Set(sensorsRaw.map((value) => JSON.stringify(value)))].sort()
    : sensorsRaw;
  return createHash('sha256')
    .update(
      JSON.stringify([startRaw ?? null, endRaw ?? null, sensors ?? null, fingerprintRaw ?? null]),
    )
    .digest('hex');
}

/**
 * Figure ids come from a counter committed on its own connection, so a refused attempt
 * leaves a gap and never reuses its id.
 */
async function allocateFigureId(project: Project): Promise<string> {
  const result = await pool.query<{ seq: number }>(
    `update figure_counters set next_seq = next_seq + 1 where project_slug = $1
     returning next_seq - 1 as seq`,
    [project.slug],
  );
  return `${project.code}-F${String(result.rows[0]!.seq).padStart(4, '0')}`;
}

export async function ledgerEntryIds(client: PoolClient, project: Project): Promise<() => string> {
  const result = await client.query<{ count: string }>(
    'select count(*) as count from ledger_entries where project_slug = $1',
    [project.slug],
  );
  let next = Number(result.rows[0]!.count) + 1;
  return () => {
    const id = `${project.code}-E${String(next).padStart(4, '0')}`;
    next += 1;
    return id;
  };
}

async function discardEvidence(figureId: string): Promise<void> {
  const keys = evidenceKeys(figureId);
  for (const key of [keys.readings, keys.derivation]) {
    try {
      await deleteObject(key);
    } catch {
      // The attempt is abandoned either way; nothing is committed in Postgres.
    }
  }
}

/** Writes both evidence objects and reads them back, as Services requires. */
async function confirmEvidence(
  figureId: string,
  derived: Derived,
  derivationBody: string,
): Promise<void> {
  const keys = evidenceKeys(figureId);
  await putObject(keys.readings, derived.readingsFile, 'text/csv', {
    sha256: derived.fingerprint,
  });
  await putObject(keys.derivation, Buffer.from(derivationBody, 'utf8'), 'application/json');
  const readings = await headObject(keys.readings);
  const derivation = await headObject(keys.derivation);
  if (
    readings === null ||
    derivation === null ||
    readings.size !== derived.readingsFile.length ||
    readings.metadata.sha256 !== derived.fingerprint
  ) {
    throw new StorageUnavailable('the object store did not confirm the evidence bundle');
  }
}

async function sendSealNotice(
  figure: FigureRecord,
  project: Project,
  leadEmail: string,
): Promise<void> {
  await sendMail({
    to: [leadEmail],
    subject: `Sealed ${figure.id}: ${tonnes(figure.net)} tCO2e at ${percent(
      figure.coveragePct,
    )}% coverage`,
    lines: [
      `Figure: ${figure.id}`,
      `Project: ${project.name}`,
      `Interval: ${formatTimestamp(figure.startMs)} to ${formatTimestamp(figure.endMs)}`,
      `Net: ${tonnes(figure.net)} tCO2e`,
      `Buffer: ${tonnes(figure.buffer)} tCO2e`,
      `Credited: ${tonnes(figure.credited)} tCO2e`,
      `Coverage: ${percent(figure.coveragePct)}%`,
      `Fingerprint: ${figure.fingerprint.slice(0, 12)}`,
    ],
  });
}

export async function insertFigure(client: PoolClient, figure: FigureRecord): Promise<void> {
  await client.query(
    `insert into figures (id, project_slug, start_ts, end_ts, sensor_ids, status, supersedes,
       superseded_by, coverage_pct, floor_pct, net_tco2e, co2_tco2e, ch4_tco2e, buffer_pct,
       buffer_tco2e, credited_tco2e, readings_count, fingerprint, sealed_at, sealed_by, checked_at,
       readings_key, derivation_key, sealed_revision_id)
     values ($1, $2, $3, $4, $5, 'sealed', $6, null, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
       $17, $18, $17, $19, $20, $21)`,
    [
      figure.id,
      figure.projectSlug,
      new Date(figure.startMs).toISOString(),
      new Date(figure.endMs).toISOString(),
      [...figure.sensorIds],
      figure.supersedes,
      percent(figure.coveragePct),
      percent(figure.floorPct),
      tonnes(figure.net),
      tonnes(figure.co2),
      tonnes(figure.ch4),
      percent(figure.bufferPct),
      tonnes(figure.buffer),
      tonnes(figure.credited),
      figure.readingsCount,
      figure.fingerprint,
      new Date(figure.sealedAtMs).toISOString(),
      figure.sealedBy,
      figure.readingsKey,
      figure.derivationKey,
      figure.sealedRevisionId,
    ],
  );
  for (const contribution of figure.contributions) {
    await client.query(
      `insert into figure_contributions (figure_id, sensor_id, kind, area_m2,
         qualifying_half_hours, half_hours, co2_tco2e, ch4_tco2e, net_tco2e)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        figure.id,
        contribution.sensorId,
        contribution.kind,
        contribution.areaM2.toString(),
        contribution.qualifyingHalfHours,
        contribution.halfHours,
        tonnes(contribution.co2),
        tonnes(contribution.ch4),
        tonnes(contribution.net),
      ],
    );
  }
}

export interface SealRequest {
  readonly person: Person;
  readonly project: Project;
  readonly idempotencyKey: unknown;
  readonly startRaw: unknown;
  readonly endRaw: unknown;
  readonly sensorsRaw: unknown;
  readonly fingerprintRaw: unknown;
}

export interface SealOutcome {
  readonly status: number;
  readonly bodyText: string;
  readonly replay: boolean;
}

function isValidKey(key: unknown): key is string {
  return typeof key === 'string' && /^[\x20-\x7e]{1,100}$/.test(key);
}

/** Collects the key, interval and fingerprint errors into one 422, keyed as the API states. */
function validateSealRequest(
  request: SealRequest,
  project: Project,
  bounds: RecordBounds,
): { interval: IntervalRequest; idempotencyKey: string; fingerprint: string } {
  const errors: Record<string, string> = {};
  if (!isValidKey(request.idempotencyKey)) {
    errors['Idempotency-Key'] = 'Give a key of 1 to 100 visible ASCII characters.';
  }
  let interval: IntervalRequest | null = null;
  try {
    interval = validateIntervalRequest(
      project,
      bounds,
      request.startRaw,
      request.endRaw,
      request.sensorsRaw,
    );
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    Object.assign(errors, error.fields);
  }
  if (
    typeof request.fingerprintRaw !== 'string' ||
    !/^[0-9a-f]{64}$/.test(request.fingerprintRaw)
  ) {
    errors.preview_fingerprint = 'Give the preview fingerprint as 64 lowercase hex characters.';
  }
  if (Object.keys(errors).length > 0 || interval === null) throw new ValidationError(errors);
  return {
    interval,
    idempotencyKey: request.idempotencyKey as string,
    fingerprint: request.fingerprintRaw as string,
  };
}

/** Seals an interval: the figure, its ledger entries, its evidence bundle and its notice, or nothing. */
export async function sealFigure(request: SealRequest): Promise<SealOutcome> {
  const hash = requestHash(
    request.startRaw,
    request.endRaw,
    request.sensorsRaw,
    request.fingerprintRaw,
  );
  let attemptedFigureId: string | null = null;
  try {
    return await withTransaction(async (client) => {
      const key = typeof request.idempotencyKey === 'string' ? request.idempotencyKey : '';
      if (key !== '') {
        await lockIdempotencyKey(client, request.person.id, key);
        const stored = await client.query<{
          request_hash: string;
          status_code: number;
          response_body: string;
        }>(
          `select request_hash, status_code, response_body from idempotency_records
           where person_id = $1 and key = $2 and expires_at > now()`,
          [request.person.id, key],
        );
        const record = stored.rows[0];
        if (record !== undefined) {
          if (record.request_hash !== hash) throw new ApiError(409, 'idempotency_key_conflict');
          return { status: record.status_code, bodyText: record.response_body, replay: true };
        }
      }
      const bounds = await loadRecordBounds(client, request.project.slug);
      const { interval, idempotencyKey, fingerprint } = validateSealRequest(
        request,
        request.project,
        bounds,
      );

      await lockProject(client, request.project.slug);

      const readings = await loadReadings(
        client,
        request.project.slug,
        interval.sensorIds,
        interval.startMs,
        interval.endMs,
      );
      const derived = derive({
        shape: shapeOf(request.project),
        startMs: interval.startMs,
        endMs: interval.endMs,
        sensorIds: interval.sensorIds,
        readings,
      });

      if (derived.fingerprint !== fingerprint) {
        throw new ApiError(409, 'readings_changed', { fingerprint: derived.fingerprint });
      }
      const intact = await loadIntactIntervals(client, request.project.slug);
      const block = intervalBlock(derived, request.project, intact);
      if (block !== null) throw blockToError(block);

      const figureId = await allocateFigureId(request.project);
      attemptedFigureId = figureId;
      const keys = evidenceKeys(figureId);
      const stamp = await client.query<{ now: Date; revision: string }>(
        `select date_trunc('second', clock_timestamp()) as now,
                coalesce((select max(id) from reading_revisions where project_slug = $1), 0)
                  as revision`,
        [request.project.slug],
      );
      const sealedAtMs = stamp.rows[0]!.now.getTime();
      const superseded = await client.query<{ id: string }>(
        `select id from figures
         where project_slug = $1 and status = 'broken' and superseded_by is null
           and start_ts = $2 and end_ts = $3
         order by seq desc limit 1`,
        [
          request.project.slug,
          new Date(interval.startMs).toISOString(),
          new Date(interval.endMs).toISOString(),
        ],
      );
      const supersedes = superseded.rows[0]?.id ?? null;

      const figure: FigureRecord = {
        id: figureId,
        projectSlug: request.project.slug,
        startMs: interval.startMs,
        endMs: interval.endMs,
        sensorIds: derived.sensorIds,
        status: 'sealed',
        supersedes,
        supersededBy: null,
        coveragePct: derived.coveragePct,
        floorPct: request.project.floorPct,
        net: derived.net,
        co2: derived.co2,
        ch4: derived.ch4,
        bufferPct: request.project.bufferPct,
        buffer: derived.bufferTco2e,
        credited: derived.creditedTco2e,
        readingsCount: derived.readingsCount,
        fingerprint: derived.fingerprint,
        sealedAtMs,
        sealedBy: request.person.id,
        checkedAtMs: sealedAtMs,
        readingsKey: keys.readings,
        derivationKey: keys.derivation,
        sealedRevisionId: stamp.rows[0]!.revision,
        contributions: derived.contributions,
      };
      const bodyText = JSON.stringify(figureJson(figure));

      await confirmEvidence(figureId, derived, bodyText);
      const lead = await client.query<{ email: string }>(
        'select email from people where id = $1',
        [request.project.leadPersonId],
      );
      await sendSealNotice(figure, request.project, lead.rows[0]!.email);

      await insertFigure(client, figure);
      if (supersedes !== null) {
        await client.query(
          "update figures set status = 'superseded', superseded_by = $2 where id = $1",
          [supersedes, figureId],
        );
      }
      const nextEntryId = await ledgerEntryIds(client, request.project);
      const recordedAt = new Date(sealedAtMs).toISOString();
      await client.query(
        `insert into ledger_entries (id, project_slug, figure_id, kind, tco2e, reverses, recorded_at)
         values ($1, $2, $3, 'issuance', $4, null, $5)`,
        [nextEntryId(), request.project.slug, figureId, tonnes(derived.net), recordedAt],
      );
      if (derived.bufferTco2e.units !== 0n) {
        await client.query(
          `insert into ledger_entries (id, project_slug, figure_id, kind, tco2e, reverses,
             recorded_at)
           values ($1, $2, $3, 'buffer', $4, null, $5)`,
          [nextEntryId(), request.project.slug, figureId, tonnes(derived.bufferTco2e), recordedAt],
        );
      }
      await client.query(
        `insert into idempotency_records (person_id, key, request_hash, status_code, response_body,
           figure_id, created_at, expires_at)
         values ($1, $2, $3, 201, $4, $5, now(), now() + make_interval(secs => $6))`,
        [request.person.id, idempotencyKey, hash, bodyText, figureId, config.idempotencyTtlSeconds],
      );
      attemptedFigureId = null;
      return { status: 201, bodyText, replay: false };
    });
  } catch (error) {
    if (attemptedFigureId !== null) await discardEvidence(attemptedFigureId);
    if (error instanceof StorageUnavailable) throw new ApiError(503, 'storage_unavailable');
    if (error instanceof MailUnavailable) throw new ApiError(503, 'mail_unavailable');
    throw error;
  }
}
