import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { add, compare, dec, fromString, neg, toFixed, tonnes, type Dec } from '../domain/decimal';
import { derive } from '../domain/derivation';
import { formatTimestamp, isHalfHour, parseTimestamp } from '../domain/time';
import { lockProject, withTransaction } from './db/pool';
import { ValidationError } from './http/errors';
import { loadReadings, scaled4, shapeOf, type Person, type Project } from './projects';
import { ledgerEntryIds } from './seal';

const MAX_BATCH_READINGS = 5000;
const FC_LIMIT = fromString('100');
const FCH4_LOWER = fromString('-1000');
const FCH4_UPPER = fromString('5000');

interface IncomingReading {
  readonly sensorId: string;
  readonly intervalStartMs: number;
  readonly fc: string;
  readonly fch4: string;
  readonly qc: number;
}

/** Turns a JSON number into an exact decimal, so the four-decimal limit is checked exactly. */
function decFromJsonNumber(value: unknown): Dec | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(String(value));
  if (match === null) return null;
  const sign = match[1] === '-' ? -1n : 1n;
  const digits = `${match[2]}${match[3] ?? ''}`;
  const scale = (match[3] ?? '').length - (match[4] === undefined ? 0 : Number(match[4]));
  if (scale < 0) return dec(sign * BigInt(digits) * 10n ** BigInt(-scale), 0);
  return dec(sign * BigInt(digits), scale);
}

function validateBatch(project: Project, readingsRaw: unknown): IncomingReading[] {
  if (
    !Array.isArray(readingsRaw) ||
    readingsRaw.length === 0 ||
    readingsRaw.length > MAX_BATCH_READINGS
  ) {
    throw new ValidationError({ readings: `Give 1 to ${MAX_BATCH_READINGS} readings.` });
  }
  const errors: Record<string, string> = {};
  const known = new Set(project.sensors.map((sensor) => sensor.id));
  const seen = new Set<string>();
  const readings: IncomingReading[] = [];
  readingsRaw.forEach((entry, index) => {
    const field = (name: string): unknown =>
      entry !== null && typeof entry === 'object' && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)[name]
        : undefined;
    const sensorId = field('sensor_id');
    const fc = decFromJsonNumber(field('fc'));
    const fch4 = decFromJsonNumber(field('fch4'));
    const qc = field('qc');
    const startMs = parseTimestamp(field('interval_start'));

    if (typeof sensorId !== 'string' || !known.has(sensorId)) {
      errors[`readings[${index}].sensor_id`] = 'Give a sensor id of this project.';
    }
    if (startMs === null || !isHalfHour(startMs)) {
      errors[`readings[${index}].interval_start`] =
        'Give interval_start as an exact half-hour, YYYY-MM-DDTHH:MM:SSZ.';
    }
    if (fc === null || fc.scale > 4 || compare(fc, neg(FC_LIMIT)) < 0 || compare(fc, FC_LIMIT) > 0) {
      errors[`readings[${index}].fc`] = 'Give fc from -100 to 100 with at most four decimals.';
    }
    if (
      fch4 === null ||
      fch4.scale > 4 ||
      compare(fch4, FCH4_LOWER) < 0 ||
      compare(fch4, FCH4_UPPER) > 0
    ) {
      errors[`readings[${index}].fch4`] = 'Give fch4 from -1000 to 5000 with at most four decimals.';
    }
    if (qc !== 0 && qc !== 1 && qc !== 2 && qc !== 3) {
      errors[`readings[${index}].qc`] = 'Give qc as 0, 1, 2 or 3.';
    }
    if (typeof sensorId === 'string' && startMs !== null) {
      const key = `${sensorId}\u0000${startMs}`;
      if (seen.has(key)) {
        errors[`readings[${index}]`] = 'This sensor and interval appear twice in the batch.';
      }
      seen.add(key);
      if (fc !== null && fch4 !== null) {
        readings.push({
          sensorId,
          intervalStartMs: startMs,
          fc: toFixed(fc, 4),
          fch4: toFixed(fch4, 4),
          qc: qc as number,
        });
      }
    }
  });
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return readings;
}

export interface IngestResult {
  readonly batchId: string;
  readonly inserted: number;
  readonly revised: number;
  readonly unchanged: number;
  readonly brokenFigures: string[];
}

interface SealedRow {
  id: string;
  start_ts: Date;
  end_ts: Date;
  sensor_ids: string[];
  fingerprint: string;
  sealed_by: string;
}

/** Breaks every sealed figure whose fingerprint moved, in the batch's own commit. */
async function breakFigures(
  client: PoolClient,
  project: Project,
  changed: readonly IncomingReading[],
): Promise<string[]> {
  if (changed.length === 0) return [];
  const sealed = await client.query<SealedRow>(
    `select id, start_ts, end_ts, sensor_ids, fingerprint, sealed_by from figures
     where project_slug = $1 and status = 'sealed' order by seq`,
    [project.slug],
  );
  const broken: string[] = [];
  for (const figure of sealed.rows) {
    const startMs = figure.start_ts.getTime();
    const endMs = figure.end_ts.getTime();
    const inScope = changed.filter(
      (reading) =>
        figure.sensor_ids.includes(reading.sensorId) &&
        reading.intervalStartMs >= startMs &&
        reading.intervalStartMs < endMs,
    );
    if (inScope.length === 0) continue;
    const readings = await loadReadings(client, project.slug, figure.sensor_ids, startMs, endMs);
    const derived = derive({
      shape: shapeOf(project),
      startMs,
      endMs,
      sensorIds: figure.sensor_ids,
      readings,
    });
    if (derived.fingerprint === figure.fingerprint) continue;

    await client.query("update figures set status = 'broken' where id = $1", [figure.id]);
    const entries = await client.query<{ id: string; tco2e: string }>(
      `select id, tco2e from ledger_entries
       where figure_id = $1 and kind in ('issuance', 'buffer') order by seq`,
      [figure.id],
    );
    const nextEntryId = await ledgerEntryIds(client, project);
    let reversed: Dec = dec(0n, 3);
    for (const entry of entries.rows) {
      const amount = neg(fromString(entry.tco2e));
      reversed = add(reversed, amount);
      await client.query(
        `insert into ledger_entries (id, project_slug, figure_id, kind, tco2e, reverses,
           recorded_at)
         values ($1, $2, $3, 'reversal', $4, $5, date_trunc('second', clock_timestamp()))`,
        [nextEntryId(), project.slug, figure.id, tonnes(amount), entry.id],
      );
    }
    const recipientIds = [...new Set([project.leadPersonId, figure.sealed_by])];
    const people = await client.query<{ id: string; email: string }>(
      'select id, email from people where id = any($1)',
      [recipientIds],
    );
    const emailOf = new Map(people.rows.map((row) => [row.id, row.email]));
    await client.query(
      `insert into alert_queue (figure_id, moved, reversed_tco2e, recipients, created_at)
       values ($1, $2, $3, $4, date_trunc('second', clock_timestamp()))`,
      [
        figure.id,
        inScope.length,
        tonnes(reversed),
        recipientIds.map((id) => emailOf.get(id)!),
      ],
    );
    broken.push(figure.id);
  }
  return broken.sort();
}

interface StoredReading {
  sensor_id: string;
  interval_start: Date;
  fc: string;
  fch4: string;
  qc: number;
}

/** Ingests one batch: each reading is inserted, revised or left unchanged, all or nothing. */
export async function ingestReadings(
  person: Person,
  project: Project,
  readingsRaw: unknown,
): Promise<IngestResult> {
  const readings = validateBatch(project, readingsRaw);
  const batchId = `batch-${randomBytes(9).toString('hex')}`;
  return withTransaction(async (client) => {
    await lockProject(client, project.slug);
    await client.query(
      `insert into ingest_batches (id, project_slug, person_id, created_at)
       values ($1, $2, $3, date_trunc('second', clock_timestamp()))`,
      [batchId, project.slug, person.id],
    );

    const existing = await client.query<StoredReading>(
      `select sensor_id, interval_start, fc, fch4, qc from readings
       where project_slug = $1 and (sensor_id, interval_start) in (
         select sensor_id, interval_start::timestamptz
         from unnest($2::text[], $3::text[]) as given(sensor_id, interval_start))`,
      [
        project.slug,
        readings.map((reading) => reading.sensorId),
        readings.map((reading) => formatTimestamp(reading.intervalStartMs)),
      ],
    );
    const stored = new Map(
      existing.rows.map((row) => [`${row.sensor_id}\u0000${row.interval_start.getTime()}`, row]),
    );

    const inserts: IncomingReading[] = [];
    const revisions: { reading: IncomingReading; before: StoredReading }[] = [];
    let unchanged = 0;
    for (const reading of readings) {
      const before = stored.get(`${reading.sensorId}\u0000${reading.intervalStartMs}`);
      if (before === undefined) {
        inserts.push(reading);
      } else if (
        scaled4(before.fc) === scaled4(reading.fc) &&
        scaled4(before.fch4) === scaled4(reading.fch4) &&
        before.qc === reading.qc
      ) {
        unchanged += 1;
      } else {
        revisions.push({ reading, before });
      }
    }

    if (inserts.length > 0) {
      await client.query(
        `insert into readings (project_slug, sensor_id, interval_start, fc, fch4, qc)
         select $1, sensor_id, interval_start::timestamptz, fc::numeric, fch4::numeric, qc::smallint
         from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::int[])
           as given(sensor_id, interval_start, fc, fch4, qc)`,
        [
          project.slug,
          inserts.map((reading) => reading.sensorId),
          inserts.map((reading) => formatTimestamp(reading.intervalStartMs)),
          inserts.map((reading) => reading.fc),
          inserts.map((reading) => reading.fch4),
          inserts.map((reading) => reading.qc),
        ],
      );
    }
    for (const { reading } of revisions) {
      await client.query(
        `update readings set fc = $4, fch4 = $5, qc = $6
         where project_slug = $1 and sensor_id = $2 and interval_start = $3`,
        [
          project.slug,
          reading.sensorId,
          formatTimestamp(reading.intervalStartMs),
          reading.fc,
          reading.fch4,
          reading.qc,
        ],
      );
    }

    const movedReadings = [
      ...inserts.map((reading) => ({ reading, before: null as StoredReading | null })),
      ...revisions,
    ];
    if (movedReadings.length > 0) {
      await client.query(
        `insert into reading_revisions (project_slug, sensor_id, interval_start,
           old_fc, old_fch4, old_qc, new_fc, new_fch4, new_qc, batch_id, revised_at)
         select $1, sensor_id, interval_start::timestamptz, old_fc::numeric, old_fch4::numeric,
                old_qc::smallint, new_fc::numeric, new_fch4::numeric, new_qc::smallint, $2,
                date_trunc('second', clock_timestamp())
         from unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::int[], $8::text[],
                     $9::text[], $10::int[])
           as given(sensor_id, interval_start, old_fc, old_fch4, old_qc, new_fc, new_fch4, new_qc)`,
        [
          project.slug,
          batchId,
          movedReadings.map((moved) => moved.reading.sensorId),
          movedReadings.map((moved) => formatTimestamp(moved.reading.intervalStartMs)),
          movedReadings.map((moved) => moved.before?.fc ?? null),
          movedReadings.map((moved) => moved.before?.fch4 ?? null),
          movedReadings.map((moved) => moved.before?.qc ?? null),
          movedReadings.map((moved) => moved.reading.fc),
          movedReadings.map((moved) => moved.reading.fch4),
          movedReadings.map((moved) => moved.reading.qc),
        ],
      );
    }

    const brokenFigures = await breakFigures(
      client,
      project,
      movedReadings.map((moved) => moved.reading),
    );
    return {
      batchId,
      inserted: inserts.length,
      revised: revisions.length,
      unchanged,
      brokenFigures,
    };
  });
}
