import { createHash, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { pool, query, transaction, type Queryable } from '../db/pool.js';
import {
  insertComment,
  insertLibraryItem,
  insertPlan,
  thresholdOn,
  upsertEvent,
  upsertThreshold,
} from '../db/records.js';
import { clearAllRecords, readState, writeState } from '../db/schema.js';
import {
  createOneTimeToken,
  findUser,
  hashPassword,
  insertLink,
  type UserRow,
} from '../db/users.js';
import {
  activityExtension,
  checkChannels,
  checkSampleCount,
  contentTypeFor,
  isFileFailure,
  parseCsvActivity,
  parseJsonActivity,
  type ActivitySamples,
} from '../domain/activityFile.js';
import { expiryFrom } from '../domain/links.js';
import { normalisePlanEntry } from '../domain/plans.js';
import { normaliseSteps, validateSteps } from '../domain/steps.js';
import { normalisedPower, normalisedSpeed } from '../domain/stress.js';
import {
  instantToLocal,
  isValidDate,
  isValidTimeZone,
  minDate,
  parseActivityStart,
} from '../domain/time.js';
import type { PlanEntry, Role, Sport, Step, ThresholdKind } from '../domain/types.js';
import { MESSAGES, Validator } from '../domain/validation.js';
import { setTodayOverride } from '../services/clock.js';
import { insertCompleted } from '../services/completed.js';
import { createPlanned } from '../services/planned.js';
import { recomputeSeriesFrom, thresholdOfSport } from '../services/scoring.js';
import { uploadStorageUnavailable, ValidationError } from '../http/errors.js';
import {
  activityObjectKey,
  deleteActivityObject,
  headActivityObject,
  putActivityObject,
  StorageUnavailableError,
} from '../storage/s3.js';

export interface SeedThreshold {
  kind: ThresholdKind;
  value: number;
  effective_from: string;
}

export interface SeedUser {
  key: string;
  role: Role;
  name: string;
  email: string;
  password: string;
  tz?: string;
  coach_code?: string;
  series_start?: string;
  start_ctl?: number;
  start_atl?: number;
  thresholds?: SeedThreshold[];
}

export interface SeedLink {
  key: string;
  coach: string;
  athlete: string;
  status: 'requested' | 'accepted' | 'declined' | 'removed';
  expires_at?: string;
}

export interface SeedFile {
  key: string;
  name: string;
  content_base64: string;
}

export interface SeedLibrary {
  key: string;
  owner: string;
  name: string;
  sport: Sport;
  steps: Step[];
}

export interface SeedWorkout {
  key: string;
  athlete: string;
  kind: 'planned' | 'completed';
  date?: string;
  start_local?: string;
  sport?: Sport;
  title: string;
  steps?: Step[];
  duration_s?: number;
  manual?: { duration_s: number; avg_power_w?: number; avg_pace_s_per_km?: number };
  file?: string;
}

export interface SeedComment {
  key: string;
  workout: string;
  author: string;
  body: string;
}

export interface SeedPlan {
  key: string;
  owner: string;
  name: string;
  weeks: number;
  entries: PlanEntry[];
}

export interface SeedEvent {
  athlete: string;
  name: string;
  date: string;
}

export interface SeedBody {
  today?: string;
  users?: SeedUser[];
  links?: SeedLink[];
  files?: SeedFile[];
  library?: SeedLibrary[];
  workouts?: SeedWorkout[];
  comments?: SeedComment[];
  plans?: SeedPlan[];
  events?: SeedEvent[];
}

export interface SeedResult {
  today: string;
  ids: Record<string, string>;
  sign_in: Record<string, string>;
}

const DEMO_STATE_KEY = 'demo_loaded';
const INITIALISED_STATE_KEY = 'initialised';
const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function generateCoachCode(): string {
  let code = '';
  for (let index = 0; index < 6; index += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function validateSeed(body: SeedBody): void {
  const validator = new Validator();
  if (body.today !== undefined && !isValidDate(body.today)) validator.add('today', MESSAGES.date);
  const userKeys = new Set<string>();
  (body.users ?? []).forEach((user, index) => {
    const path = `users[${index}]`;
    if (typeof user.key !== 'string' || user.key === '') validator.add(`${path}.key`, 'Enter a key.');
    else userKeys.add(user.key);
    if (user.role !== 'athlete' && user.role !== 'coach') {
      validator.add(`${path}.role`, 'Choose athlete or coach.');
    }
    validator.title(`${path}.name`, user.name);
    if (typeof user.email !== 'string' || !user.email.includes('@')) {
      validator.add(`${path}.email`, 'Enter an email address.');
    }
    if (typeof user.password !== 'string' || user.password.length === 0) {
      validator.add(`${path}.password`, 'Enter a password.');
    }
    if (user.tz !== undefined && !isValidTimeZone(user.tz)) {
      validator.add(`${path}.tz`, 'Enter an IANA time zone.');
    }
    if (user.coach_code !== undefined && !/^[A-Z0-9]{6}$/.test(user.coach_code)) {
      validator.add(`${path}.coach_code`, 'Enter six uppercase letters or digits.');
    }
    if (user.series_start !== undefined) validator.date(`${path}.series_start`, user.series_start);
    (user.thresholds ?? []).forEach((threshold, thresholdIndex) => {
      const thresholdPath = `${path}.thresholds[${thresholdIndex}]`;
      if (threshold.kind !== 'ftp' && threshold.kind !== 'pace') {
        validator.add(`${thresholdPath}.kind`, MESSAGES.thresholdKind);
        return;
      }
      validator.thresholdValue(`${thresholdPath}.value`, threshold.kind, threshold.value);
      validator.date(`${thresholdPath}.effective_from`, threshold.effective_from);
    });
  });
  (body.links ?? []).forEach((link, index) => {
    const path = `links[${index}]`;
    if (!userKeys.has(link.coach)) validator.add(`${path}.coach`, 'Unknown user key.');
    if (!userKeys.has(link.athlete)) validator.add(`${path}.athlete`, 'Unknown user key.');
    if (!['requested', 'accepted', 'declined', 'removed'].includes(link.status)) {
      validator.add(`${path}.status`, 'Choose requested, accepted, declined or removed.');
    }
  });
  const csvFileKeys = new Set<string>();
  const fileKeys = new Set<string>();
  (body.files ?? []).forEach((file, index) => {
    const path = `files[${index}]`;
    const extension = typeof file.name === 'string' ? activityExtension(file.name) : null;
    if (extension === null) {
      validator.add(`${path}.name`, 'Upload a .csv or .json activity file.');
    } else {
      fileKeys.add(file.key);
      if (extension === 'csv') csvFileKeys.add(file.key);
    }
    if (typeof file.content_base64 !== 'string') {
      validator.add(`${path}.content_base64`, 'Enter base64 file bytes.');
    }
  });
  (body.library ?? []).forEach((item, index) => {
    const path = `library[${index}]`;
    if (!userKeys.has(item.owner)) validator.add(`${path}.owner`, 'Unknown user key.');
    validator.title(`${path}.name`, item.name);
    validator.sport(`${path}.sport`, item.sport);
    const message = validateSteps(item.steps);
    if (message) validator.add(`${path}.steps`, message);
  });
  const workoutKeys = new Set<string>();
  (body.workouts ?? []).forEach((workout, index) => {
    const path = `workouts[${index}]`;
    workoutKeys.add(workout.key);
    if (!userKeys.has(workout.athlete)) validator.add(`${path}.athlete`, 'Unknown user key.');
    validator.title(`${path}.title`, workout.title);
    if (workout.kind !== 'planned' && workout.kind !== 'completed') {
      validator.add(`${path}.kind`, 'Choose planned or completed.');
      return;
    }
    if (workout.start_local !== undefined) validator.startLocal(`${path}.start_local`, workout.start_local);
    const dateFromFile = workout.kind === 'completed' && workout.file !== undefined;
    if (workout.date !== undefined) validator.date(`${path}.date`, workout.date);
    else if (!dateFromFile) validator.add(`${path}.date`, MESSAGES.date);
    if (workout.kind === 'planned') {
      validator.sport(`${path}.sport`, workout.sport);
      if (workout.steps !== undefined) {
        const message = validateSteps(workout.steps);
        if (message) validator.add(`${path}.steps`, message);
      } else {
        validator.durationS(`${path}.duration_s`, workout.duration_s);
      }
      return;
    }
    if (workout.manual) {
      validator.durationS(`${path}.manual.duration_s`, workout.manual.duration_s);
      const sport = validator.sport(`${path}.sport`, workout.sport);
      if (sport === 'bike') {
        validator.avgPower(`${path}.manual.avg_power_w`, workout.manual.avg_power_w);
      }
      if (sport === 'run') {
        validator.avgPace(`${path}.manual.avg_pace_s_per_km`, workout.manual.avg_pace_s_per_km);
      }
      return;
    }
    if (workout.file === undefined || !fileKeys.has(workout.file)) {
      validator.add(`${path}.file`, 'Unknown file key.');
      return;
    }
    if (csvFileKeys.has(workout.file)) validator.sport(`${path}.sport`, workout.sport);
  });
  (body.comments ?? []).forEach((comment, index) => {
    const path = `comments[${index}]`;
    if (!workoutKeys.has(comment.workout)) validator.add(`${path}.workout`, 'Unknown workout key.');
    if (!userKeys.has(comment.author)) validator.add(`${path}.author`, 'Unknown user key.');
    validator.body(`${path}.body`, comment.body);
  });
  (body.plans ?? []).forEach((plan, index) => {
    const path = `plans[${index}]`;
    if (!userKeys.has(plan.owner)) validator.add(`${path}.owner`, 'Unknown user key.');
    validator.title(`${path}.name`, plan.name);
    const weeks =
      typeof plan.weeks === 'number' && Number.isInteger(plan.weeks) && plan.weeks >= 1 && plan.weeks <= 24
        ? plan.weeks
        : null;
    if (weeks === null) validator.add(`${path}.weeks`, MESSAGES.weeks);
    (plan.entries ?? []).forEach((entry, entryIndex) => {
      const entryPath = `${path}.entries[${entryIndex}]`;
      const maxDay = 7 * (weeks ?? 24);
      if (
        typeof entry.day !== 'number' ||
        !Number.isInteger(entry.day) ||
        entry.day < 1 ||
        entry.day > maxDay
      ) {
        validator.add(`${entryPath}.day`, `Enter a day from 1 to ${maxDay}.`);
      }
      validator.startLocal(`${entryPath}.start_local`, entry.start_local);
      validator.sport(`${entryPath}.sport`, entry.sport);
      validator.title(`${entryPath}.title`, entry.title);
      if (entry.steps !== undefined && entry.steps !== null) {
        const message = validateSteps(entry.steps);
        if (message) validator.add(`${entryPath}.steps`, message);
      } else {
        validator.durationS(`${entryPath}.duration_s`, entry.duration_s);
      }
    });
  });
  (body.events ?? []).forEach((event, index) => {
    const path = `events[${index}]`;
    if (!userKeys.has(event.athlete)) validator.add(`${path}.athlete`, 'Unknown user key.');
    validator.eventName(`${path}.name`, event.name);
    validator.date(`${path}.date`, event.date);
  });
  if (validator.failed) throw new ValidationError(validator.fields);
}

interface PreparedFile {
  samples: ActivitySamples;
  bytes: Buffer;
  name: string;
  extension: 'csv' | 'json';
  sha256: string;
}

/** Seeded files pass the same checks as uploads. */
function prepareFiles(body: SeedBody): Map<string, PreparedFile> {
  const validator = new Validator();
  const prepared = new Map<string, PreparedFile>();
  const sportByFile = new Map<string, Sport>();
  for (const workout of body.workouts ?? []) {
    if (workout.file && workout.sport) sportByFile.set(workout.file, workout.sport);
  }
  (body.files ?? []).forEach((file, index) => {
    const path = `files[${index}].content_base64`;
    const bytes = Buffer.from(file.content_base64, 'base64');
    const extension = activityExtension(file.name) as 'csv' | 'json';
    const text = bytes.toString('utf8');
    const samples =
      extension === 'csv'
        ? parseCsvActivity(text, sportByFile.get(file.key) ?? 'bike')
        : parseJsonActivity(text);
    if (isFileFailure(samples)) {
      validator.add(path, samples.message);
      return;
    }
    const failure =
      checkChannels(samples) ?? checkSampleCount(samples, config.activityMaxSamples);
    if (failure) {
      validator.add(path, failure.message);
      return;
    }
    if (bytes.length > config.activityMaxBytes) {
      validator.add(path, `This file is larger than ${config.activityMaxBytes} bytes.`);
      return;
    }
    prepared.set(file.key, {
      samples,
      bytes,
      name: file.name,
      extension,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  });
  if (validator.failed) throw new ValidationError(validator.fields);
  return prepared;
}

async function idsBySeedKey(table: string, keys: string[]): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const rows = await query<{ id: string; seed_key: string }>(
    pool,
    `select id, seed_key from ${table} where seed_key = any($1)`,
    [keys],
  );
  return new Map(rows.map((row) => [row.seed_key, row.id]));
}

async function upsertUser(
  client: Queryable,
  id: string,
  user: SeedUser,
  seedKey: string,
  seriesStart: string | null,
): Promise<UserRow> {
  const passwordHash = await hashPassword(user.password);
  const code = user.role === 'coach' ? (user.coach_code ?? generateCoachCode()) : null;
  await query(
    client,
    `insert into users (id, role, name, email, password_hash, tz, coach_code, series_start,
       start_ctl, start_atl, seed_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict (seed_key) do update set role = excluded.role, name = excluded.name,
       email = excluded.email, password_hash = excluded.password_hash, tz = excluded.tz,
       coach_code = excluded.coach_code, series_start = excluded.series_start,
       start_ctl = excluded.start_ctl, start_atl = excluded.start_atl`,
    [
      id,
      user.role,
      user.name,
      user.email,
      passwordHash,
      user.tz ?? config.appTz,
      code,
      seriesStart,
      user.start_ctl ?? 0,
      user.start_atl ?? 0,
      seedKey,
    ],
  );
  return (await findUser(client, id)) as UserRow;
}

/** Validates a whole seed body, stores its files, then writes every record once. */
export async function loadSeed(body: SeedBody, keyPrefix: string): Promise<SeedResult> {
  const today = body.today ?? config.appToday;
  validateSeed(body);
  const files = prepareFiles(body);
  const users = body.users ?? [];
  const workouts = body.workouts ?? [];

  const userIds = await idsBySeedKey('users', users.map((user) => `${keyPrefix}${user.key}`));
  const workoutIds = await idsBySeedKey(
    'workouts',
    workouts.map((workout) => `${keyPrefix}${workout.key}`),
  );
  const resolvedUserIds = new Map(
    users.map((user) => [user.key, userIds.get(`${keyPrefix}${user.key}`) ?? randomUUID()]),
  );
  const resolvedWorkoutIds = new Map(
    workouts.map((workout) => [
      workout.key,
      workoutIds.get(`${keyPrefix}${workout.key}`) ?? randomUUID(),
    ]),
  );

  const earliestWorkout = new Map<string, string>();
  for (const workout of workouts) {
    if (workout.date === undefined) continue;
    const current = earliestWorkout.get(workout.athlete);
    earliestWorkout.set(
      workout.athlete,
      current === undefined ? workout.date : minDate(current, workout.date),
    );
  }

  const storedKeys: string[] = [];
  for (const workout of workouts) {
    if (workout.kind !== 'completed' || workout.file === undefined) continue;
    const file = files.get(workout.file) as PreparedFile;
    const key = activityObjectKey(
      resolvedUserIds.get(workout.athlete) as string,
      resolvedWorkoutIds.get(workout.key) as string,
      file.extension,
    );
    try {
      await putActivityObject({
        key,
        body: file.bytes,
        contentType: contentTypeFor(file.extension),
        sha256: file.sha256,
        filename: file.name,
      });
      const head = await headActivityObject(key);
      if (head.size !== file.bytes.length || head.sha256 !== file.sha256) {
        throw new StorageUnavailableError('stored object does not match the seed file');
      }
      storedKeys.push(key);
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw uploadStorageUnavailable();
      throw error;
    }
  }

  const ids: Record<string, string> = {};
  const signIn: Record<string, string> = {};

  try {
    await transaction(async (client) => {
      const userRows = new Map<string, UserRow>();
      for (const user of users) {
        const id = resolvedUserIds.get(user.key) as string;
        const seriesStart =
          user.role === 'athlete'
            ? (user.series_start ?? earliestWorkout.get(user.key) ?? today)
            : null;
        const row = await upsertUser(client, id, user, `${keyPrefix}${user.key}`, seriesStart);
        userRows.set(user.key, row);
        ids[user.key] = row.id;
        for (const threshold of user.thresholds ?? []) {
          await upsertThreshold(client, row.id, threshold);
        }
      }

      for (const link of body.links ?? []) {
        const row = await insertLink(client, {
          coachId: (userRows.get(link.coach) as UserRow).id,
          athleteId: (userRows.get(link.athlete) as UserRow).id,
          status: link.status,
          expiresAt: link.expires_at
            ? new Date(link.expires_at)
            : expiryFrom(new Date(), config.linkRequestTtlHours),
          seedKey: `${keyPrefix}${link.key}`,
        });
        ids[link.key] = row.id;
      }

      for (const item of body.library ?? []) {
        const created = await insertLibraryItem(client, {
          ownerId: (userRows.get(item.owner) as UserRow).id,
          name: item.name,
          sport: item.sport,
          steps: normaliseSteps(item.steps),
          seedKey: `${keyPrefix}${item.key}`,
        });
        ids[item.key] = created.id;
      }

      for (const plan of body.plans ?? []) {
        const created = await insertPlan(client, {
          ownerId: (userRows.get(plan.owner) as UserRow).id,
          name: plan.name,
          weeks: plan.weeks,
          entries: plan.entries.map(normalisePlanEntry),
          seedKey: `${keyPrefix}${plan.key}`,
        });
        ids[plan.key] = created.id;
      }

      for (const [index, workout] of workouts.entries()) {
        const athlete = userRows.get(workout.athlete) as UserRow;
        const id = resolvedWorkoutIds.get(workout.key) as string;
        const seedKey = `${keyPrefix}${workout.key}`;
        if (workout.kind === 'planned') {
          const row = await createPlanned(client, {
            athlete,
            date: workout.date as string,
            startLocal: workout.start_local ?? null,
            sport: workout.sport as Sport,
            title: workout.title,
            steps: workout.steps ? normaliseSteps(workout.steps) : null,
            durationS: workout.duration_s ?? null,
            source: 'builder',
            id,
            seedKey,
          });
          ids[workout.key] = row.id;
          continue;
        }
        const completed = completedFromSeed(workout, athlete, files);
        const threshold = await thresholdOn(
          client,
          athlete.id,
          thresholdOfSport(completed.sport),
          completed.date,
        );
        if (threshold === null) {
          throw new ValidationError({
            [`workouts[${index}].threshold`]:
              completed.sport === 'bike' ? MESSAGES.noFtp : MESSAGES.noPace,
          });
        }
        const row = await insertCompleted(
          client,
          {
            id,
            athlete,
            sport: completed.sport,
            title: workout.title,
            date: completed.date,
            startLocal: completed.startLocal,
            startUtc: completed.startUtc,
            durationS: completed.durationS,
            normalised: completed.normalised,
            threshold,
            source: completed.source,
            file: completed.file,
            seedKey,
          },
          today,
        );
        ids[workout.key] = row.id;
      }

      for (const comment of body.comments ?? []) {
        ids[comment.key] = await insertComment(client, {
          workoutId: resolvedWorkoutIds.get(comment.workout) as string,
          authorId: (userRows.get(comment.author) as UserRow).id,
          body: comment.body,
          seedKey: `${keyPrefix}${comment.key}`,
        });
      }

      for (const event of body.events ?? []) {
        await upsertEvent(client, (userRows.get(event.athlete) as UserRow).id, {
          name: event.name,
          date: event.date,
        });
      }

      for (const user of users) {
        const row = userRows.get(user.key) as UserRow;
        if (row.role !== 'athlete') continue;
        await recomputeSeriesFrom(client, row, row.series_start ?? today, today);
      }

      for (const user of users) {
        const row = userRows.get(user.key) as UserRow;
        signIn[user.key] = `/auth/one-time/${await createOneTimeToken(client, row.id)}`;
      }
    });
  } catch (error) {
    for (const key of storedKeys) await deleteActivityObject(key).catch(() => undefined);
    throw error;
  }

  await setTodayOverride(body.today ?? null);
  await writeState(INITIALISED_STATE_KEY, 'true');
  return { today, ids, sign_in: signIn };
}

interface CompletedSeedFields {
  sport: Sport;
  date: string;
  startLocal: string | null;
  startUtc: Date | null;
  durationS: number;
  normalised: number;
  source: 'manual' | 'file';
  file: { name: string; size: number; sha256: string; contentType: string } | null;
}

function completedFromSeed(
  workout: SeedWorkout,
  athlete: UserRow,
  files: ReadonlyMap<string, PreparedFile>,
): CompletedSeedFields {
  if (workout.manual) {
    const sport = workout.sport as Sport;
    return {
      sport,
      date: workout.date as string,
      startLocal: workout.start_local ?? null,
      startUtc: null,
      durationS: workout.manual.duration_s,
      normalised:
        sport === 'bike'
          ? (workout.manual.avg_power_w as number)
          : 1000 / (workout.manual.avg_pace_s_per_km as number),
      source: 'manual',
      file: null,
    };
  }
  const file = files.get(workout.file as string) as PreparedFile;
  const sport = file.samples.sport;
  const samples =
    sport === 'bike' ? (file.samples.power as number[]) : (file.samples.speed as number[]);
  const startInstant = file.samples.start
    ? parseActivityStart(file.samples.start, athlete.tz)
    : null;
  const local = startInstant ? instantToLocal(startInstant, athlete.tz) : null;
  return {
    sport,
    date: local ? local.date : (workout.date as string),
    startLocal: local ? local.time : (workout.start_local ?? null),
    startUtc: startInstant,
    durationS: samples.length,
    normalised: sport === 'bike' ? normalisedPower(samples) : normalisedSpeed(samples),
    source: 'file',
    file: {
      name: file.name,
      size: file.bytes.length,
      sha256: file.sha256,
      contentType: contentTypeFor(file.extension),
    },
  };
}

export async function resetRecords(): Promise<void> {
  await clearAllRecords();
  await setTodayOverride(null);
  await writeState(DEMO_STATE_KEY, 'false');
  await writeState(INITIALISED_STATE_KEY, 'true');
}

export async function demoSetLoaded(): Promise<boolean> {
  return (await readState(DEMO_STATE_KEY)) === 'true';
}

export async function markDemoLoaded(): Promise<void> {
  await writeState(DEMO_STATE_KEY, 'true');
}

export async function databaseInitialised(): Promise<boolean> {
  return (await readState(INITIALISED_STATE_KEY)) === 'true';
}
