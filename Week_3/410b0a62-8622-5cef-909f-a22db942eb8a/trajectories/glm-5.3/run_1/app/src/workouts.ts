import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { withTransaction } from './db.js';
import type { PoolClient } from 'pg';
import type { LocalDate } from './dates.js';
import { instantToWallClock, parseIsoDateTime, wallClockToInstant } from './dates.js';
import {
  scoreManualBike,
  scoreManualRun,
  scoreRide,
  scoreRun,
  stepsDuration,
  stepsPlannedTss,
  plannedIf,
  thresholdInForce,
  type Step,
  type ThresholdEntry,
  roundHalfAwayFromZero,
} from './domain.js';
import { ApiError, ValidationError, conflict, notFound } from './errors.js';
import { sha256Hex } from './config.js';
import { parseCsvFile, parseJsonFile, checkChannel, checkSampleCount } from './activity.js';
import type { ParsedMultipart } from './multipart.js';
import { storageKeyFor } from './keys.js';
import type { Store } from './store.js';
import type { Sport, UserRow, WorkoutRow } from './types.js';
import { workoutToJson } from './types.js';
import { FieldErrors, MESSAGES, parseDate, parseSport, parseTitle, parseStartLocal, parseSteps, parseDurationSeconds } from './validation.js';

export interface WorkoutRouteDeps {
  store: Store;
  config: { activityMaxBytes: number; activityMaxSamples: number };
  today: () => LocalDate;
  liveHub: {
    broadcast(event: { athlete_id: string; what: 'workouts' | 'series' | 'comments' | 'links' | 'thresholds' | 'events'; workout_id?: string }): void;
    notifyUser(userId: string, text: string): void;
  };
}

export class WorkoutService {
  constructor(private deps: WorkoutRouteDeps) {}

  async createPlanned(req: Request, res: Response, athlete: UserRow): Promise<void> {
    const { store, today } = this.deps;
    const body = req.body as Record<string, unknown>;
    const errors = new FieldErrors();
    const date = parseDate(body.date, 'date', errors);
    const sport = parseSport(body.sport, errors);
    const title = parseTitle(body.title, 'title', errors);
    const startLocal = parseStartLocal(body.start_local, errors);
    const hasSteps = body.steps !== undefined;
    const hasDuration = body.duration_s !== undefined;
    const hasLibrary = body.library_id !== undefined;
    const provided = [hasSteps, hasDuration, hasLibrary].filter(Boolean).length;
    if (provided === 0) errors.add('steps', MESSAGES.stepsEmpty);
    if (date && date < today()) errors.add('date', MESSAGES.datePlannedPast);
    if (athlete.series_start && date && date < athlete.series_start) errors.add('date', MESSAGES.dateBeforeStart);
    errors.throwIfAny();

    let steps: Step[] | null = null;
    let duration: number;
    let source: 'builder' | 'library' | 'plan' | 'copy' = 'builder';
    let titleValue = title;

    if (hasLibrary) {
      if (hasSteps || hasDuration) errors.add('steps', MESSAGES.stepsEmpty);
      errors.throwIfAny();
      const libRes = await store.db.query(
        `SELECT id, owner_id, name, sport, steps, duration_s FROM library_items WHERE id = $1`,
        [body.library_id]
      );
      if (libRes.rows.length === 0 || (libRes.rows[0] as { owner_id: string }).owner_id !== athlete.id) throw notFound();
      const row = libRes.rows[0] as { name: string; steps: Step[]; duration_s: number };
      steps = row.steps;
      duration = row.duration_s;
      source = 'library';
      titleValue = row.name;
    } else if (hasSteps) {
      const parsed = parseSteps(body.steps, errors, 'steps');
      errors.throwIfAny();
      steps = parsed;
      duration = stepsDuration(parsed!);
    } else {
      const d = parseDurationSeconds(body.duration_s, errors);
      errors.throwIfAny();
      duration = d!;
    }

    const workout = await withTransaction(async (client) => {
      const w = await store.insertWorkout(client, {
        athlete_id: athlete.id,
        kind: 'planned',
        sport: sport!,
        title: titleValue!,
        date: date!,
        start_local: startLocal,
        duration_s: duration,
        steps,
        planned_tss: steps ? stepsPlannedTss(steps) : null,
        planned_if: steps ? plannedIf(steps) : null,
        source,
      });
      await store.recomputeSeries(client, athlete.id, date!);
      return w;
    });
    this.deps.liveHub.broadcast({ athlete_id: athlete.id, what: 'workouts' });
    res.status(201).json({ workout: workoutToJson(workout) });
  }

  async patch(req: Request, res: Response, workout: WorkoutRow): Promise<void> {
    const { store, today } = this.deps;
    const athlete = await store.getUser(store.db, workout.athlete_id);
    const body = req.body as Record<string, unknown>;
    const errors = new FieldErrors();
    if (typeof body.version !== 'number' || !Number.isInteger(body.version)) {
      throw new ValidationError({ version: CONFLICT_MESSAGES_STALE });
    }
    if (body.version !== workout.version) throw conflict('stale', STALE_MESSAGE);
    const wantsDate = body.date !== undefined;
    const newDate = wantsDate ? parseDate(body.date, 'date', errors) : workout.date;
    const newStart = body.start_local !== undefined ? parseStartLocal(body.start_local, errors) : workout.start_local;
    const newTitle = body.title !== undefined ? parseTitle(body.title, 'title', errors) : workout.title;
    let newSteps = workout.steps;
    if (body.steps !== undefined) {
      newSteps = parseSteps(body.steps, errors, 'steps');
    }
    const paired = await this.itemFor(workout);
    if (workout.kind === 'completed' && wantsDate && newDate !== workout.date) {
      throw conflict('locked', LOCKED_MESSAGE);
    }
    if (workout.kind === 'planned' && paired.completed !== null && wantsDate && newDate !== workout.date) {
      throw conflict('locked', LOCKED_MESSAGE);
    }
    if (workout.kind === 'planned' && newDate && newDate < today()) errors.add('date', MESSAGES.datePlannedPast);
    if (athlete.series_start && newDate && newDate < athlete.series_start) errors.add('date', MESSAGES.dateBeforeStart);
    errors.throwIfAny();

    const updated = await withTransaction(async (client) => {
      const startUtc = newStart && newDate ? new Date(wallClockToInstant(athlete.tz, newDate, newStart) * 1000).toISOString() : null;
      const steps = newSteps;
      const plannedTss = steps ? stepsPlannedTss(steps) : null;
      const plannedIfVal = steps ? plannedIf(steps) : null;
      const duration = steps ? stepsDuration(steps) : workout.duration_s;
      await client.query(
        `UPDATE workouts SET date = $1, start_local = $2, start_utc = $3, title = $4, steps = $5,
          planned_tss = COALESCE($6, planned_tss), planned_if = COALESCE($7, planned_if), duration_s = $8, version = version + 1
         WHERE id = $9`,
        [
          newDate,
          newStart,
          startUtc,
          newTitle,
          steps ? JSON.stringify(steps) : workout.steps,
          plannedTss,
          plannedIfVal,
          duration,
          workout.id,
        ]
      );
      const from = newDate && newDate < workout.date ? newDate : workout.date;
      await store.recomputeSeries(client, workout.athlete_id, from);
      return store.getWorkout(client, workout.id);
    });
    this.deps.liveHub.broadcast({ athlete_id: workout.athlete_id, what: 'workouts' });
    res.json({ workout: workoutToJson(updated) });
  }

  async remove(res: Response, workout: WorkoutRow): Promise<void> {
    const { store } = this.deps;
    if (workout.file_sha256) {
      const isCsv = (workout.file_content_type ?? '').includes('csv');
      const key = storageKeyFor(workout.athlete_id, workout.id, isCsv);
      try {
        await store.storage().delete(key);
      } catch {
        res.status(503).json({ error: 'storage_unavailable', message: FILE_UNAVAILABLE });
        return;
      }
    }
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM workouts WHERE id = $1`, [workout.id]);
      await store.recomputeSeries(client, workout.athlete_id, workout.date);
    });
    this.deps.liveHub.broadcast({ athlete_id: workout.athlete_id, what: 'workouts' });
    res.status(204).end();
  }

  async original(res: Response, workout: WorkoutRow): Promise<void> {
    const { store } = this.deps;
    if (!workout.file_name || !workout.file_content_type) throw notFound();
    const isCsv = workout.file_content_type.includes('csv');
    const key = storageKeyFor(workout.athlete_id, workout.id, isCsv);
    let bytes: Buffer;
    try {
      bytes = await store.storage().get(key);
    } catch {
      res.status(503).json({ error: 'storage_unavailable', message: FILE_UNAVAILABLE });
      return;
    }
    res.setHeader('Content-Type', workout.file_content_type);
    res.setHeader('Content-Disposition', `attachment; filename="${workout.file_name}"`);
    res.setHeader('X-Content-SHA256', workout.file_sha256 ?? '');
    res.end(bytes);
  }

  async manual(req: Request, res: Response, athlete: UserRow): Promise<void> {
    const { store, today } = this.deps;
    const body = req.body as Record<string, unknown>;
    const errors = new FieldErrors();
    const date = parseDate(body.date, 'date', errors);
    const sport = parseSport(body.sport, errors);
    const title = parseTitle(body.title, 'title', errors);
    const duration = parseManualDuration(body.duration_s, errors);
    if (date) {
      if (date > today()) errors.add('date', MESSAGES.dateFuture);
      else if (athlete.series_start && date < athlete.series_start) errors.add('date', MESSAGES.dateBeforeStart);
    }
    let avgPower: number | null = null;
    let avgPace: number | null = null;
    if (sport === 'bike') avgPower = parseRange(body.avg_power_w, 1, 2000, 'avg_power_w', MESSAGES.avgPower, errors);
    if (sport === 'run') avgPace = parseRange(body.avg_pace_s_per_km, 120, 1200, 'avg_pace_s_per_km', MESSAGES.avgPace, errors);
    errors.throwIfAny();

    const entries = (await store.thresholds(store.db, athlete.id)) as unknown as ThresholdEntry[];
    const threshold = sport === 'bike' ? thresholdInForce(entries, 'ftp', date!) : thresholdInForce(entries, 'pace', date!);
    if (threshold === null) {
      const message = sport === 'bike' ? 'No FTP is set on or before this day.' : 'No threshold pace is set on or before this day.';
      throw new ValidationError({ threshold: message });
    }
    const score = sport === 'bike'
      ? scoreManualBike(duration!, avgPower!, threshold)
      : scoreManualRun(duration!, avgPace!, threshold);

    const workout = await withTransaction(async (client) => {
      const w = await store.insertWorkout(client, {
        athlete_id: athlete.id,
        kind: 'completed',
        sport: sport!,
        title: title!,
        date: date!,
        duration_s: duration!,
        tss: score.tss,
        if: score.if,
        np_w: sport === 'bike' ? avgPower : null,
        ns_mps: sport === 'run' ? 1000 / avgPace! : null,
        source: 'manual',
      });
      await store.recomputeSeries(client, athlete.id, date!);
      return w;
    });
    this.deps.liveHub.broadcast({ athlete_id: athlete.id, what: 'workouts' });
    await this.notifyCoachesOfSession(athlete, workout);
    res.status(201).json({ workout: workoutToJson(workout) });
  }

  async upload(res: Response, athlete: UserRow, parsed: ParsedMultipart): Promise<void> {
    const { store, config } = this.deps;
    const { file, fields } = parsed;
    if (file && file.data.length > config.activityMaxBytes) throw fileTooLarge(config.activityMaxBytes);
    if (!file) throw new ValidationError({ file: 'Choose an activity file.' });

    const isCsv = /\.csv$/i.test(file.name);
    const isJson = /\.json$/i.test(file.name);
    if (!isCsv && !isJson) throw new ApiError(415, 'unsupported_type', 'Upload a .csv or .json activity file.');

    // Request fields are checked before file contents.
    const errors = new FieldErrors();
    const sport = parseSport(fields.sport, errors);
    const date = parseDate(fields.date, 'date', errors);
    const title = fields.title !== undefined && fields.title !== ''
      ? parseTitle(fields.title, 'title', errors)!
      : (sport === 'run' ? 'Run' : 'Ride');
    errors.throwIfAny();

    let samples: { t: number; power: number | null; speed: number | null }[];
    let effectiveDate = date!;
    let startTime: string | null = null;
    if (isCsv) {
      samples = (await parseCsvFile(file.data)).samples;
    } else {
      const parsed = parseJsonFile(file.data);
      if (parsed.sport !== 'bike' && parsed.sport !== 'run') throw new ValidationError({ sport: MESSAGES.sport });
      if (parsed.start !== undefined && parsed.start !== null) {
        const parsedStart = parseIsoDateTime(String(parsed.start));
        if (parsedStart === null) throw new ValidationError({ file: 'The file is not valid activity JSON.' });
        const local = instantToWallClock(athlete.tz, parsedStart.epochSeconds);
        effectiveDate = local.date;
        startTime = local.hhmm;
      }
      samples = parsed.samples;
    }
    checkChannel(sport!, samples);
    checkSampleCount(samples.length, config.activityMaxSamples);

    const entries = (await store.thresholds(store.db, athlete.id)) as unknown as ThresholdEntry[];
    const threshold = sport === 'bike' ? thresholdInForce(entries, 'ftp', effectiveDate) : thresholdInForce(entries, 'pace', effectiveDate);
    if (threshold === null) {
      const message = sport === 'bike' ? 'No FTP is set on or before this day.' : 'No threshold pace is set on or before this day.';
      throw new ValidationError({ threshold: message });
    }
    if (effectiveDate > this.deps.today()) throw new ValidationError({ date: MESSAGES.dateFuture });
    if (athlete.series_start && effectiveDate < athlete.series_start) {
      throw new ValidationError({ date: MESSAGES.dateBeforeStart });
    }

    const durationS = samples.length;
    const npW = sport === 'bike' ? normalisedPower(samples) : null;
    const nsMps = sport === 'run' ? normalisedSpeed(samples) : null;
    const intensity = sport === 'bike' ? npW! / threshold : nsMps! / (1000 / threshold);
    const tss = sport === 'bike'
      ? (durationS * npW! * intensity) / (threshold * 3600) * 100
      : (durationS / 3600) * intensity ** 2 * 100;

    const sha = sha256Hex(file.data);
    const contentType = isCsv ? 'text/csv' : 'application/json';
    const workoutId = randomUUID();
    const key = storageKeyFor(athlete.id, workoutId, isCsv);
    const storage = store.storage();
    try {
      await storage.put({ key, size: file.data.length, sha256: sha, contentType, filename: file.name }, file.data);
      const stat = await storage.stat(key);
      if (!stat || stat.size !== file.data.length || stat.sha256 !== sha) {
        await storage.delete(key).catch(() => undefined);
        res.status(503).json({ error: 'storage_unavailable', message: UPLOAD_UNAVAILABLE });
        return;
      }
    } catch {
      res.status(503).json({ error: 'storage_unavailable', message: UPLOAD_UNAVAILABLE });
      return;
    }

    let workout: WorkoutRow;
    try {
      workout = await withTransaction(async (client) => {
        const w = await insertWithId(client, workoutId, {
          athlete_id: athlete.id,
          kind: 'completed',
          sport: sport!,
          title,
          date: effectiveDate,
          start_local: startTime,
          duration_s: durationS,
          tss,
          if: intensity,
          np_w: npW,
          ns_mps: nsMps,
          source: 'file',
          file_name: file.name,
          file_size: file.data.length,
          file_sha256: sha,
          file_content_type: contentType,
        });
        await store.recomputeSeries(client, athlete.id, effectiveDate);
        return w;
      });
    } catch (err) {
      await storage.delete(key).catch(() => undefined);
      throw err;
    }
    this.deps.liveHub.broadcast({ athlete_id: athlete.id, what: 'workouts' });
    await this.notifyCoachesOfSession(athlete, workout);
    res.status(201).json({ workout: workoutToJson(workout) });
  }

  private async notifyCoachesOfSession(athlete: UserRow, workout: WorkoutRow): Promise<void> {
    const coaches = await this.deps.store.db.query(
      `SELECT coach_id FROM links WHERE athlete_id = $1 AND status = 'accepted'`,
      [athlete.id]
    );
    const text = `${athlete.name} logged ${workout.title}: ${roundHalfAwayFromZero(workout.tss ?? 0, 1)} TSS.`;
    for (const row of coaches.rows as { coach_id: string }[]) {
      this.deps.liveHub.notifyUser(row.coach_id, text);
    }
  }

  async itemFor(workout: WorkoutRow) {
    const { store } = this.deps;
    const day = await store.weekItems(store.db, workout.athlete_id, [workout.date]);
    const items = day.get(workout.date) ?? [];
    const found = items.find((i) => i.planned?.id === workout.id || i.completed?.id === workout.id);
    return found ?? { planned: null, completed: null, compliance: 'planned' as const, ratio: null };
  }
}

function normalisedPower(samples: readonly { power: number | null }[]): number {
  return scoreRide(samples.map((s) => s.power ?? 0), 1).np_w;
}

function normalisedSpeed(samples: readonly { speed: number | null }[]): number {
  return scoreRun(samples.map((s) => s.speed ?? 0), 1000).ns_mps;
}

function parseManualDuration(value: unknown, errors: FieldErrors): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 60 || value > 86400) {
    errors.add('duration_s', MESSAGES.duration);
    return null;
  }
  return value;
}

function parseRange(value: unknown, min: number, max: number, field: string, message: string, errors: FieldErrors): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    errors.add(field, message);
    return null;
  }
  return value;
}

function fileTooLarge(max: number): ApiError {
  return new ApiError(413, 'file_too_large', `This file is larger than ${max} bytes.`);
}

async function insertWithId(
  client: PoolClient,
  id: string,
  w: {
    athlete_id: string;
    kind: 'planned' | 'completed';
    sport: Sport;
    title: string;
    date: LocalDate;
    start_local?: string | null;
    duration_s: number;
    tss?: number | null;
    if?: number | null;
    np_w?: number | null;
    ns_mps?: number | null;
    source: 'builder' | 'library' | 'plan' | 'copy' | 'manual' | 'file';
    file_name?: string | null;
    file_size?: number | null;
    file_sha256?: string | null;
    file_content_type?: string | null;
  }
): Promise<WorkoutRow> {
  let startUtc: string | null = null;
  if (w.start_local) {
    const tzRow = await client.query<{ tz: string }>(`SELECT tz FROM users WHERE id = $1`, [w.athlete_id]);
    const tz = tzRow.rows[0]!.tz;
    startUtc = new Date(wallClockToInstant(tz, w.date, w.start_local) * 1000).toISOString();
  }
  await client.query(
    `INSERT INTO workouts (id, athlete_id, kind, sport, title, date, start_local, start_utc, duration_s,
      tss, if, np_w, ns_mps, source, version, file_name, file_size, file_sha256, file_content_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1,$15,$16,$17,$18)`,
    [
      id, w.athlete_id, w.kind, w.sport, w.title, w.date, w.start_local ?? null, startUtc, w.duration_s,
      w.tss ?? null, w.if ?? null, w.np_w ?? null, w.ns_mps ?? null, w.source,
      w.file_name ?? null, w.file_size ?? null, w.file_sha256 ?? null, w.file_content_type ?? null,
    ]
  );
  return getWorkoutById(client, id);
}

async function getWorkoutById(client: PoolClient, id: string): Promise<WorkoutRow> {
  const res = await client.query<WorkoutDbShape>(
    `SELECT w.id, w.athlete_id, w.kind, w.sport, w.title, to_char(w.date,'YYYY-MM-DD') as date,
       w.start_local, w.start_utc::text as start_utc, w.duration_s, w.steps, w.planned_tss, w.planned_if,
       w.tss, w.if, w.np_w, w.ns_mps, w.source, w.version, w.file_name, w.file_size, w.file_sha256, w.file_content_type, w.created_at
     FROM workouts w WHERE w.id = $1`,
    [id]
  );
  const raw = res.rows[0] as WorkoutDbShape | undefined;
  if (!raw) throw notFound();
  return {
    id: raw.id,
    athlete_id: raw.athlete_id,
    kind: raw.kind,
    sport: raw.sport,
    title: raw.title,
    date: raw.date,
    start_local: raw.start_local,
    start_utc: raw.start_utc,
    duration_s: raw.duration_s,
    steps: Array.isArray(raw.steps) ? (raw.steps as Step[]) : null,
    planned_tss: raw.planned_tss,
    planned_if: raw.planned_if,
    tss: raw.tss,
    if: raw.if,
    np_w: raw.np_w,
    ns_mps: raw.ns_mps,
    source: raw.source,
    version: raw.version,
    file_name: raw.file_name,
    file_size: raw.file_size,
    file_sha256: raw.file_sha256,
    file_content_type: raw.file_content_type,
    created_at: raw.created_at,
  };
}

interface WorkoutDbShape {
  id: string;
  athlete_id: string;
  kind: 'planned' | 'completed';
  sport: 'bike' | 'run';
  title: string;
  date: string;
  start_local: string | null;
  start_utc: string | null;
  duration_s: number;
  steps: unknown;
  planned_tss: number | null;
  planned_if: number | null;
  tss: number | null;
  if: number | null;
  np_w: number | null;
  ns_mps: number | null;
  source: 'builder' | 'library' | 'plan' | 'copy' | 'manual' | 'file';
  version: number;
  file_name: string | null;
  file_size: number | null;
  file_sha256: string | null;
  file_content_type: string | null;
  created_at: Date;
}

const STALE_MESSAGE = 'This workout changed since you opened it. Reload to see the latest.';
const LOCKED_MESSAGE = 'Completed sessions stay on their day.';
const CONFLICT_MESSAGES_STALE = 'This workout changed since you opened it. Reload to see the latest.';
const FILE_UNAVAILABLE = 'Original files are unavailable right now; try again in a few minutes.';
const UPLOAD_UNAVAILABLE = 'Activity storage is unavailable. Your file was not saved; try again in a few minutes.';
