import { createHash } from 'node:crypto';
import { formatTss } from '../shared/format.js';
import { speedOfPace } from '../shared/thresholds.js';
import type { FileInfo, Sport, Workout } from '../shared/types.js';
import { audienceOf, linkedCoachIds, newId, type User } from './access.js';
import { pool, transaction, type Queryable } from './db.js';
import { activityFormat, jsonStart, parseActivity, type ActivityFormat, type ParsedActivity } from './domain/activity.js';
import { normalisedMeasure } from './domain/stress.js';
import { parseStart, type SessionStart } from './domain/zones.js';
import { FieldErrors, StorageFailure, fileTooLarge, storageUnavailable, unsupportedType, validation } from './errors.js';
import { config } from './config.js';
import { publishChange, publishNotice } from './live.js';
import { lockAthlete, recomputeSeries } from './series.js';
import { deleteObject, getObject, headObject, putObject } from './storage.js';
import { insertCompleted, thresholdFor, type CompletedInput } from './workouts.js';
import { completedDateMessage, dateMessage, durationMessage, paceMessage, powerMessage, sportMessage, titleMessage } from './validation.js';

const CONTENT_TYPES: Record<ActivityFormat, string> = { csv: 'text/csv', json: 'application/json' };

/** Every stored original lives under this prefix. */
export const ORIGINALS_PREFIX = 'activities/';

/** The object key of a workout's original; its extension follows the stored content type. */
export function originalKey(athleteId: string, workoutId: string, contentType: string): string {
  const format: ActivityFormat = contentType === CONTENT_TYPES.csv ? 'csv' : 'json';
  return `${ORIGINALS_PREFIX}${athleteId}/${workoutId}.${format}`;
}

async function announce(actor: User, athlete: User, workout: Workout): Promise<void> {
  publishChange(await audienceOf(athlete.id), athlete.id, ['workouts', 'series']);
  const coaches = (await linkedCoachIds(athlete.id)).filter((id) => id !== actor.id);
  publishNotice(coaches, `${athlete.name} logged ${workout.title}: ${formatTss(workout.tss ?? 0)} TSS.`);
}

interface ManualFields {
  date?: unknown;
  sport?: unknown;
  title?: unknown;
  duration_s?: unknown;
  avg_power_w?: unknown;
  avg_pace_s_per_km?: unknown;
}

/** The validation messages of a hand-entered session. */
export function manualErrors(fields: ManualFields, athlete: User, today: string): FieldErrors {
  const errors = new FieldErrors();
  errors.add('date', dateMessage(fields.date) ?? completedDateMessage(fields.date as string, today, athlete.series_start));
  errors.add('sport', sportMessage(fields.sport));
  errors.add('title', titleMessage(fields.title));
  errors.add('duration_s', durationMessage(fields.duration_s));
  if (fields.sport === 'bike') errors.add('avg_power_w', powerMessage(fields.avg_power_w));
  if (fields.sport === 'run') errors.add('avg_pace_s_per_km', paceMessage(fields.avg_pace_s_per_km));
  return errors;
}

/** A validated hand entry as a completed workout: the average stands in for the normalised power or speed. */
export function manualWorkout(athlete: User, fields: ManualFields, id?: string): CompletedInput {
  const sport = fields.sport as Sport;
  return {
    ...(id !== undefined && { id }),
    athlete,
    date: fields.date as string,
    sport,
    title: (fields.title as string).trim(),
    durationS: fields.duration_s as number,
    measure: sport === 'bike' ? (fields.avg_power_w as number) : speedOfPace(fields.avg_pace_s_per_km as number),
    start: null,
    file: null
  };
}

/** A hand-entered session, scored on its averages. */
export async function createManual(actor: User, athlete: User, today: string, fields: ManualFields): Promise<Workout> {
  manualErrors(fields, athlete, today).throwIfAny();
  const input = manualWorkout(athlete, fields);
  const stored = await transaction(async (tx) => {
    await lockAthlete(tx, athlete.id);
    const created = await insertCompleted(tx, input);
    await recomputeSeries(tx, athlete, input.date, today);
    return created;
  });
  await announce(actor, athlete, stored.workout);
  return stored.workout;
}

interface PreparedFile {
  format: ActivityFormat;
  bytes: Buffer;
  parsed: ParsedActivity;
  date: string;
  start: SessionStart | null;
}

/** File checks 4 to 8: contents, rows, channels, sample count, then the threshold in force. */
export async function prepareFile(
  athlete: User,
  today: string,
  format: ActivityFormat,
  bytes: Buffer,
  sport: Sport | null,
  requestDate: string,
  q: Queryable = pool
): Promise<PreparedFile> {
  const parsed = parseActivity(format === 'csv' ? { format, sport: sport as Sport } : { format }, bytes);
  const start = parsed.start === null ? null : parseStart(parsed.start, athlete.tz);
  const date = start?.date ?? requestDate;
  if (start) {
    const message = completedDateMessage(date, today, athlete.series_start);
    if (message) throw validation({ date: message });
  }
  await thresholdFor(athlete, parsed.sport, date, q);
  return { format, bytes, parsed, date, start };
}

/** Stores the original and reads it back; the stored size and SHA-256 must equal the upload's. */
export async function storeOriginal(athleteId: string, workoutId: string, name: string, format: ActivityFormat, bytes: Buffer): Promise<FileInfo> {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const contentType = CONTENT_TYPES[format];
  const key = originalKey(athleteId, workoutId, contentType);
  try {
    await putObject(key, bytes, contentType, { sha256, filename: name });
    const stored = await headObject(key);
    if (stored.size !== bytes.length || stored.sha256 !== sha256) throw new StorageFailure('stored object does not match the upload');
  } catch (error) {
    await deleteObject(key).catch(() => undefined);
    if (error instanceof StorageFailure) throw storageUnavailable('upload');
    throw error;
  }
  return { name, size: bytes.length, sha256, content_type: contentType };
}

export async function discardOriginal(athleteId: string, workoutId: string, format: ActivityFormat): Promise<void> {
  await deleteObject(originalKey(athleteId, workoutId, CONTENT_TYPES[format])).catch(() => undefined);
}

/** The completed workout a prepared file becomes. */
export function fileWorkout(athlete: User, prepared: PreparedFile, title: string, file: FileInfo, id: string): CompletedInput {
  return {
    id,
    athlete,
    date: prepared.date,
    sport: prepared.parsed.sport,
    title,
    durationS: prepared.parsed.values.length,
    measure: normalisedMeasure(prepared.parsed.values),
    start: prepared.start,
    file: { name: file.name, size: file.size, sha256: file.sha256, contentType: file.content_type }
  };
}

/** Stores a prepared file's original and commits the workout with its series change. */
async function commitFile(athlete: User, today: string, prepared: PreparedFile, name: string, title: string): Promise<Workout> {
  const id = newId();
  const file = await storeOriginal(athlete.id, id, name, prepared.format, prepared.bytes);
  try {
    const stored = await transaction(async (tx) => {
      await lockAthlete(tx, athlete.id);
      const created = await insertCompleted(tx, fileWorkout(athlete, prepared, title, file, id));
      await recomputeSeries(tx, athlete, prepared.date, today);
      return created;
    });
    return stored.workout;
  } catch (error) {
    await discardOriginal(athlete.id, id, prepared.format);
    throw error;
  }
}

/** An uploaded activity file, checked in the published order. */
export async function createUpload(actor: User, athlete: User, today: string, form: FormData): Promise<Workout> {
  const part = form.get('file');
  const file = part instanceof File ? part : null;
  const name = file?.name ?? '';
  if ((file?.size ?? 0) > config.activityMaxBytes) throw fileTooLarge(config.activityMaxBytes);
  const format = activityFormat(name);
  if (format === null || file === null) throw unsupportedType();
  const bytes = Buffer.from(await file.arrayBuffer());

  const errors = new FieldErrors();
  const sportPart = form.get('sport');
  const datePart = form.get('date');
  const titlePart = form.get('title');
  const sport = sportPart === 'bike' || sportPart === 'run' ? sportPart : null;
  if (format === 'csv') errors.add('sport', sportMessage(sportPart));
  if (format === 'csv' || jsonStart(bytes) === null) errors.add('date', dateMessage(datePart) ?? completedDateMessage(datePart as string, today, athlete.series_start));
  const title = typeof titlePart === 'string' && titlePart !== '' ? titlePart : null;
  if (title !== null) errors.add('title', titleMessage(title));
  errors.throwIfAny();

  const prepared = await prepareFile(athlete, today, format, bytes, sport, typeof datePart === 'string' ? datePart : '');
  const workout = await commitFile(athlete, today, prepared, name, title?.trim() ?? (prepared.parsed.sport === 'bike' ? 'Ride' : 'Run'));
  await announce(actor, athlete, workout);
  return workout;
}

export async function downloadOriginal(workout: Workout & { file: FileInfo }): Promise<Buffer> {
  try {
    return await getObject(originalKey(workout.athlete_id, workout.id, workout.file.content_type));
  } catch (error) {
    if (error instanceof StorageFailure) throw storageUnavailable('original');
    throw error;
  }
}
