import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  CommitResultEntry,
  CorrectionDto,
  CorrectionValues,
  RankChange,
  RunGridEntry,
} from '../../shared/api';
import { query, queryOne, withTransaction } from '../db/pool';
import { isoUtc } from '../domain/clubTime';
import { formatTime, isRawTimeText, parseRawTime } from '../domain/decimal';
import { areResultsLocked } from '../domain/eventState';
import { computeRunTimes, MAX_CONES } from '../domain/indexedTime';
import { rankChangeFor } from '../domain/standings';
import { apiError } from '../http/errors';
import { json, memberRoute, type Route } from '../http/router';
import { withIdempotency } from '../http/idempotency';
import { buildStandings, type EventStandings } from './standingsService';
import {
  clubOf,
  isUuid,
  listRegistrations,
  listRuns,
  loadEvent,
  loadEventById,
  loadRegistration,
  requireRole,
  requireTableInForce,
  runDto,
  runsForRegistration,
  statusOf,
  type EventRecord,
  type RegistrationRecord,
  type RunRecord,
} from './support';

interface RunValues {
  status: 'committed' | 'corrected' | 'rerun_granted';
  outcome: 'time' | 'dnf' | 'rerun';
  rawTimeMs: number | null;
  cones: number | null;
  adjustedMs: number | null;
  indexedMs: number | null;
  factorTt: number | null;
}

function correctionValues(run: RunRecord): CorrectionValues {
  return {
    outcome: run.outcome === 'time' ? 'time' : 'dnf',
    rawTime: formatTime(run.raw_time_ms),
    cones: run.cones,
    adjustedTime: formatTime(run.adjusted_ms),
    indexedTime: formatTime(run.indexed_ms),
  };
}

function entryPayload(
  registration: RegistrationRecord,
  standings: EventStandings,
): CommitResultEntry {
  const entry = standings.byRegistration.get(registration.id);
  if (!entry) throw new Error('Standings lost the committed entry');
  return {
    registrationId: registration.id,
    carNumber: registration.car_number,
    classCode: registration.class_code,
    position: entry.ranked.position,
    classPosition: entry.ranked.classPosition,
    rawPosition: entry.ranked.rawPosition,
    bestAdjusted: formatTime(entry.ranked.bestAdjustedMs),
    bestIndexed: formatTime(entry.ranked.bestIndexedMs),
  };
}

async function standingsInTransaction(
  client: PoolClient,
  eventId: string,
): Promise<EventStandings> {
  const [registrations, runs] = await Promise.all([
    listRegistrations(eventId, client),
    listRuns(eventId, client),
  ]);
  return buildStandings(registrations, runs);
}

async function writeRunValues(
  client: PoolClient,
  runId: string,
  values: RunValues,
  actorId: string,
  now: Date,
): Promise<void> {
  await client.query(
    `UPDATE runs
        SET status = $2, outcome = $3, raw_time_ms = $4, cones = $5, adjusted_ms = $6,
            indexed_ms = $7, factor_tt = $8, committed_at = $9, committed_by = $10
      WHERE id = $1`,
    [
      runId,
      values.status,
      values.outcome,
      values.rawTimeMs,
      values.cones,
      values.adjustedMs,
      values.indexedMs,
      values.factorTt,
      values.outcome === 'rerun' ? null : now,
      values.outcome === 'rerun' ? null : actorId,
    ],
  );
}

async function recordRankChange(
  client: PoolClient,
  registrationId: string,
  runNumber: number,
  now: Date,
  change: RankChange,
): Promise<void> {
  await client.query(
    `UPDATE registrations
        SET last_change_run_number = $2, last_change_at = $3, last_change_indexed = $4,
            last_change_class = $5, last_change_raw = $6
      WHERE id = $1`,
    [registrationId, runNumber, now, change.indexed, change.class, change.raw],
  );
}

function readCones(body: Record<string, unknown>, required: boolean): number | null {
  const raw = body.cones;
  if (raw === undefined || raw === null) {
    if (required) throw apiError.validation({ cones: 'Cones must be a whole number from 0 to 30.' });
    return null;
  }
  const value = typeof raw === 'number' ? raw : Number.NaN;
  if (!Number.isInteger(value) || value < 0 || value > MAX_CONES) {
    throw apiError.validation({ cones: `Cones must be a whole number from 0 to ${MAX_CONES}.` });
  }
  return value;
}

function readRawTime(body: Record<string, unknown>): number {
  const raw = body.rawTime;
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!isRawTimeText(text)) {
    throw apiError.validation({ rawTime: 'Run time must look like 45.123.' });
  }
  const parsed = parseRawTime(text);
  if (parsed === null) {
    throw apiError.validation({ rawTime: 'Run time must be between 10.000 and 999.999.' });
  }
  return parsed;
}

async function factorFor(
  clubId: string,
  event: EventRecord,
  classCode: string,
  client?: PoolClient,
): Promise<number> {
  const table = await requireTableInForce(clubId, event.event_date, client);
  const factor = table.factors[classCode];
  if (factor === undefined) throw apiError.notFound();
  const [whole, fraction] = factor.split('.') as [string, string];
  return Number.parseInt(whole, 10) * 10_000 + Number.parseInt(fraction, 10);
}

export const runRoutes: Route[] = [
  memberRoute('GET', '/api/events/:id/runs', async (ctx) => {
    clubOf(ctx.actor);
    const event = await loadEvent(ctx);
    requireRole(ctx.actor, 'timing');
    const heatParam = ctx.searchParams.get('heat');
    const heat = heatParam === null ? event.running_heat ?? 1 : Number(heatParam);
    if (!event.heats.some((candidate) => candidate.number === heat)) {
      throw apiError.validation({ heat: 'Pick one of the event heats.' });
    }
    const [registrations, runs] = await Promise.all([
      listRegistrations(event.id),
      listRuns(event.id),
    ]);
    const entries: RunGridEntry[] = registrations
      .filter((registration) => registration.run_heat === heat)
      .map((registration) => ({
        registrationId: registration.id,
        carNumber: registration.car_number,
        classCode: registration.class_code,
        driverName: registration.driver_name,
        runHeat: registration.run_heat,
        checkedIn: registration.checked_in,
        runs: runs
          .filter((run) => run.registration_id === registration.id)
          .sort((a, b) => a.run_number - b.run_number)
          .map(runDto),
      }));
    return json(200, { entries });
  }),

  memberRoute('POST', '/api/registrations/:id/runs/:runNumber', async (ctx) => {
    const club = clubOf(ctx.actor);
    const registration = await loadRegistration(club.id, ctx.params.id ?? '');
    if (!registration) throw apiError.notFound();
    requireRole(ctx.actor, 'timing');
    const event = await loadEventById(club.id, registration.event_id);
    if (!event) throw apiError.notFound();
    const runNumber = Number(ctx.params.runNumber);
    if (!Number.isInteger(runNumber) || runNumber < 1 || runNumber > event.runs_per_driver) {
      throw apiError.notFound();
    }

    return withIdempotency(ctx, async () => {
      if (statusOf(event, ctx.now) !== 'running') {
        throw apiError.conflict('event_not_running', 'The event is not running.');
      }
      if (registration.run_heat !== event.running_heat) {
        throw apiError.conflict(
          'heat_not_running',
          `Car ${registration.car_number} runs in heat ${registration.run_heat}, which is not running.`,
        );
      }
      if (!registration.checked_in) {
        throw apiError.conflict(
          'not_checked_in',
          `Car ${registration.car_number} is not checked in.`,
        );
      }

      const result = await withTransaction(async (client) => {
        const current = await client.query<RunRecord>(
          `SELECT id, registration_id, run_number, status, outcome, raw_time_ms, cones,
                  adjusted_ms, indexed_ms, factor_tt, committed_at, committed_by,
                  NULL::text AS committed_by_name
             FROM runs WHERE registration_id = $1 AND run_number = $2 FOR UPDATE`,
          [registration.id, runNumber],
        );
        const run = current.rows[0];
        if (!run) throw apiError.notFound();
        if (run.status !== 'pending' && run.status !== 'rerun_granted') {
          throw apiError.conflict(
            'run_already_committed',
            `Run ${runNumber} for car ${registration.car_number} is already recorded.`,
          );
        }

        const outcome = ctx.body.outcome;
        let values: RunValues;
        if (outcome === 'time') {
          const rawTimeMs = readRawTime(ctx.body);
          const cones = readCones(ctx.body, true) ?? 0;
          const factorTt = await factorFor(club.id, event, registration.class_code, client);
          const times = computeRunTimes(rawTimeMs, cones, factorTt);
          values = {
            status: 'committed',
            outcome: 'time',
            rawTimeMs,
            cones,
            adjustedMs: times.adjustedMs,
            indexedMs: times.indexedMs,
            factorTt,
          };
        } else if (outcome === 'dnf') {
          const factorTt = await factorFor(club.id, event, registration.class_code, client);
          values = {
            status: 'committed',
            outcome: 'dnf',
            rawTimeMs: null,
            cones: readCones(ctx.body, false),
            adjustedMs: null,
            indexedMs: null,
            factorTt,
          };
        } else if (outcome === 'rerun') {
          values = {
            status: 'rerun_granted',
            outcome: 'rerun',
            rawTimeMs: null,
            cones: null,
            adjustedMs: null,
            indexedMs: null,
            factorTt: null,
          };
        } else {
          throw apiError.validation({ outcome: 'Outcome must be time, dnf or rerun.' });
        }

        const before = await standingsInTransaction(client, event.id);
        await writeRunValues(client, run.id, values, ctx.actor.id, ctx.now);
        const after = await standingsInTransaction(client, event.id);
        const afterEntry = after.byRegistration.get(registration.id);
        if (!afterEntry) throw new Error('Standings lost the committed entry');
        const change = rankChangeFor(
          before.byRegistration.get(registration.id)?.ranked,
          afterEntry.ranked,
        );
        await recordRankChange(client, registration.id, runNumber, ctx.now, change);
        const stored = await client.query<RunRecord>(
          `SELECT n.id, n.registration_id, n.run_number, n.status, n.outcome, n.raw_time_ms,
                  n.cones, n.adjusted_ms, n.indexed_ms, n.factor_tt, n.committed_at,
                  n.committed_by, a.name AS committed_by_name
             FROM runs n LEFT JOIN users a ON a.id = n.committed_by WHERE n.id = $1`,
          [run.id],
        );
        const next = stored.rows[0];
        if (!next) throw new Error('Run update lost the row');
        return {
          run: runDto(next),
          entry: entryPayload(registration, after),
          rankChange: change,
        };
      });
      return json(201, result);
    });
  }),

  memberRoute('POST', '/api/runs/:id/corrections', async (ctx) => {
    const club = clubOf(ctx.actor);
    const runId = ctx.params.id ?? '';
    if (!isUuid(runId)) throw apiError.notFound();
    const owner = await queryOne<{ registration_id: string }>(
      `SELECT n.registration_id
         FROM runs n JOIN registrations r ON r.id = n.registration_id
         JOIN events e ON e.id = r.event_id
        WHERE n.id = $1 AND e.club_id = $2`,
      [runId, club.id],
    );
    if (!owner) throw apiError.notFound();
    requireRole(ctx.actor, 'timing');
    const registration = await loadRegistration(club.id, owner.registration_id);
    if (!registration) throw apiError.notFound();
    const event = await loadEventById(club.id, registration.event_id);
    if (!event) throw apiError.notFound();

    const status = statusOf(event, ctx.now);
    if (areResultsLocked(status)) {
      throw apiError.conflict('results_locked', 'Results are final. Times can no longer change.');
    }

    const result = await withTransaction(async (client) => {
      const current = await client.query<RunRecord>(
        `SELECT id, registration_id, run_number, status, outcome, raw_time_ms, cones,
                adjusted_ms, indexed_ms, factor_tt, committed_at, committed_by,
                NULL::text AS committed_by_name
           FROM runs WHERE id = $1 FOR UPDATE`,
        [runId],
      );
      const run = current.rows[0];
      if (!run) throw apiError.notFound();
      if (run.status !== 'committed' && run.status !== 'corrected') {
        throw apiError.conflict('run_not_committed', 'That run has no recorded result yet.');
      }

      const reason = typeof ctx.body.reason === 'string' ? ctx.body.reason.trim() : '';
      if (reason.length < 5 || reason.length > 500) {
        throw apiError.validation({ reason: 'Give a reason of at least 5 characters.' });
      }
      const outcome = ctx.body.outcome;
      if (outcome !== 'time' && outcome !== 'dnf') {
        throw apiError.validation({ outcome: 'Outcome must be time or dnf.' });
      }
      const factorTt =
        run.factor_tt ?? (await factorFor(club.id, event, registration.class_code, client));

      let values: RunValues;
      if (outcome === 'time') {
        const rawTimeMs = readRawTime(ctx.body);
        const cones = readCones(ctx.body, true) ?? 0;
        const times = computeRunTimes(rawTimeMs, cones, factorTt);
        values = {
          status: 'corrected',
          outcome: 'time',
          rawTimeMs,
          cones,
          adjustedMs: times.adjustedMs,
          indexedMs: times.indexedMs,
          factorTt,
        };
      } else {
        values = {
          status: 'corrected',
          outcome: 'dnf',
          rawTimeMs: null,
          cones: readCones(ctx.body, false),
          adjustedMs: null,
          indexedMs: null,
          factorTt,
        };
      }

      if (
        values.outcome === run.outcome &&
        values.rawTimeMs === run.raw_time_ms &&
        values.cones === run.cones
      ) {
        throw apiError.validation({
          values: 'The correction must change the time, cones or outcome.',
        });
      }

      const beforeValues = correctionValues(run);
      const before = await standingsInTransaction(client, event.id);
      await writeRunValues(client, run.id, values, ctx.actor.id, ctx.now);
      const after = await standingsInTransaction(client, event.id);
      const afterEntry = after.byRegistration.get(registration.id);
      if (!afterEntry) throw new Error('Standings lost the corrected entry');
      const change = rankChangeFor(before.byRegistration.get(registration.id)?.ranked, afterEntry.ranked);
      await recordRankChange(client, registration.id, run.run_number, ctx.now, change);

      const stored = await client.query<RunRecord>(
        `SELECT n.id, n.registration_id, n.run_number, n.status, n.outcome, n.raw_time_ms,
                n.cones, n.adjusted_ms, n.indexed_ms, n.factor_tt, n.committed_at,
                n.committed_by, a.name AS committed_by_name
           FROM runs n LEFT JOIN users a ON a.id = n.committed_by WHERE n.id = $1`,
        [run.id],
      );
      const next = stored.rows[0];
      if (!next) throw new Error('Run update lost the row');
      const afterValues = correctionValues(next);
      const correctionId = randomUUID();
      await client.query(
        `INSERT INTO corrections (id, run_id, actor_id, created_at, reason, before_values, after_values)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
        [
          correctionId,
          run.id,
          ctx.actor.id,
          ctx.now,
          reason,
          JSON.stringify(beforeValues),
          JSON.stringify(afterValues),
        ],
      );

      const correction: CorrectionDto = {
        id: correctionId,
        runId: run.id,
        registrationId: registration.id,
        carNumber: registration.car_number,
        classCode: registration.class_code,
        runNumber: run.run_number,
        actor: { id: ctx.actor.id, name: ctx.actor.name },
        at: isoUtc(ctx.now),
        reason,
        before: beforeValues,
        after: afterValues,
      };

      return {
        run: runDto(next),
        correction,
        entry: entryPayload(registration, after),
        rankChange: change,
      };
    });
    return json(201, result);
  }),

  memberRoute('GET', '/api/events/:id/corrections', async (ctx) => {
    clubOf(ctx.actor);
    const event = await loadEvent(ctx);
    const registrationFilter = ctx.searchParams.get('registrationId');
    const rows = await query<{
      id: string;
      run_id: string;
      registration_id: string;
      car_number: number;
      class_code: string;
      run_number: number;
      actor_id: string | null;
      actor_name: string | null;
      created_at: Date;
      reason: string;
      before_values: CorrectionValues;
      after_values: CorrectionValues;
    }>(
      `SELECT c.id, c.run_id, r.id AS registration_id, r.car_number, r.class_code,
              n.run_number, c.actor_id, u.name AS actor_name, c.created_at, c.reason,
              c.before_values, c.after_values
         FROM corrections c
         JOIN runs n ON n.id = c.run_id
         JOIN registrations r ON r.id = n.registration_id
         LEFT JOIN users u ON u.id = c.actor_id
        WHERE r.event_id = $1
          AND ($2::uuid IS NULL OR r.id = $2::uuid)
        ORDER BY c.created_at DESC, c.id DESC`,
      [event.id, registrationFilter && isUuid(registrationFilter) ? registrationFilter : null],
    );
    const corrections: CorrectionDto[] = rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      registrationId: row.registration_id,
      carNumber: row.car_number,
      classCode: row.class_code,
      runNumber: row.run_number,
      actor: { id: row.actor_id ?? '', name: row.actor_name ?? 'Unknown' },
      at: isoUtc(row.created_at),
      reason: row.reason,
      before: row.before_values,
      after: row.after_values,
    }));
    return json(200, { corrections });
  }),

  ...(['PUT', 'PATCH', 'DELETE'] as const).map((method) =>
    memberRoute(method, '/api/corrections/:id', async (ctx) => {
      const club = clubOf(ctx.actor);
      const id = ctx.params.id ?? '';
      if (!isUuid(id)) throw apiError.notFound();
      const found = await queryOne<{ id: string }>(
        `SELECT c.id FROM corrections c
           JOIN runs n ON n.id = c.run_id
           JOIN registrations r ON r.id = n.registration_id
           JOIN events e ON e.id = r.event_id
          WHERE c.id = $1 AND e.club_id = $2`,
        [id, club.id],
      );
      if (!found) throw apiError.notFound();
      throw apiError.auditImmutable();
    }),
  ),
];
