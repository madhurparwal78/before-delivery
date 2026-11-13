import type { Sport, ThresholdKind } from '../shared/types.js';
import { randomInt } from 'node:crypto';
import { hashPassword, issueSignInLink, newId, requireUser, todayDate, type User } from './access.js';
import { config } from './config.js';
import { transaction, type Queryable, type Tx } from './db.js';
import { activityFormat } from './domain/activity.js';
import { ApiError, FieldErrors, StorageFailure, validation } from './errors.js';
import { insertComment } from './comments.js';
import { addLibraryItem, addPlan } from './planning.js';
import { discardOriginal, fileWorkout, manualErrors, manualWorkout, ORIGINALS_PREFIX, prepareFile, storeOriginal } from './sessions.js';
import { recomputeSeries } from './series.js';
import { deletePrefix } from './storage.js';
import { insertCompleted, insertPlanned } from './workouts.js';
import {
  cleanSteps, completedDateMessage, dateMessage, durationMessage, paceMessage, powerMessage, sportMessage, startLocalMessage, stepsMessage,
  thresholdValueMessage, titleMessage
} from './validation.js';

const SEED_LOCK = 724_002;

type Rec = Record<string, unknown>;
const records = (value: unknown): Rec[] => (Array.isArray(value) ? (value.filter((row) => typeof row === 'object' && row !== null) as Rec[]) : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

interface SeedResult {
  today: string;
  ids: Record<string, string>;
  sign_in: Record<string, string>;
}

/** Runs a record's own validation and reports its failures under the record's path in the request. */
async function at<T>(path: string, work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ApiError && error.status === 422 && 'errors' in error.body) {
      throw validation(Object.fromEntries(Object.entries(error.body.errors).map(([field, message]) => [`${path}.${field}`, message])));
    }
    throw error;
  }
}

async function idFor(tx: Queryable, key: string): Promise<string> {
  const found = await tx.query<{ id: string }>('SELECT id FROM seed_keys WHERE key = $1', [key]);
  if (found.rows[0]) return found.rows[0].id;
  const id = newId();
  await tx.query('INSERT INTO seed_keys (key, id) VALUES ($1, $2)', [key, id]);
  return id;
}

/** Empties the database and the object store. The database then stays empty until the next seed. */
export async function resetEverything(): Promise<void> {
  await transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [SEED_LOCK]);
    await wipe(tx);
    await tx.query("INSERT INTO meta (key, value) VALUES ('seeded', '1') ON CONFLICT (key) DO NOTHING");
  });
  await deletePrefix(ORIGINALS_PREFIX).catch((error: unknown) => {
    if (!(error instanceof StorageFailure)) throw error;
  });
}

async function wipe(tx: Tx): Promise<void> {
  await tx.query('TRUNCATE users, seed_keys CASCADE');
  await tx.query("DELETE FROM meta WHERE key IN ('today', 'demo')");
}

/** Loads the demo set once, on the first serve of a database that has never been seeded or reset. */
export async function loadDemoWhenFresh(demo: Rec): Promise<void> {
  await transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [SEED_LOCK]);
    if ((await tx.query("SELECT 1 FROM meta WHERE key = 'seeded'")).rowCount === 1) return;
    await writeSeed(tx, demo, []);
    await tx.query("INSERT INTO meta (key, value) VALUES ('demo', '1'), ('seeded', '1')");
  });
}

/** A grading seed: removes a still-present demo set first, then upserts every record by key. */
export async function applySeed(body: unknown): Promise<SeedResult> {
  const stored: { athleteId: string; id: string; format: 'csv' | 'json' }[] = [];
  try {
    return await transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [SEED_LOCK]);
      if ((await tx.query("SELECT 1 FROM meta WHERE key = 'demo'")).rowCount === 1) await wipe(tx);
      const result = await writeSeed(tx, body as Rec, stored);
      await tx.query("INSERT INTO meta (key, value) VALUES ('seeded', '1') ON CONFLICT (key) DO NOTHING");
      return result;
    });
  } catch (error) {
    await Promise.all(stored.map((object) => discardOriginal(object.athleteId, object.id, object.format)));
    throw error;
  }
}

async function writeSeed(tx: Tx, body: Rec, stored: { athleteId: string; id: string; format: 'csv' | 'json' }[]): Promise<SeedResult> {
  const ids: Record<string, string> = {};
  const people = new Map<string, User>();
  const person = (path: string, field: string, key: unknown): User => {
    const found = people.get(text(key));
    if (!found) throw validation({ [`${path}.${field}`]: 'No user in this request has that key.' });
    return found;
  };
  const known = (path: string, field: string, key: unknown): string => {
    const found = ids[text(key)];
    if (!found) throw validation({ [`${path}.${field}`]: 'No record in this request has that key.' });
    return found;
  };
  if (typeof body['today'] === 'string') {
    const message = dateMessage(body['today']);
    if (message) throw validation({ today: message });
    await tx.query("INSERT INTO meta (key, value) VALUES ('today', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [body['today']]);
  }
  const today = await todayDate(tx);
  const workoutRecords = records(body['workouts']);

  const userRecords = records(body['users']);
  for (const [index, rec] of userRecords.entries()) {
    await at(`users[${index}]`, async () => {
      const errors = new FieldErrors();
      const role = rec['role'] === 'coach' || rec['role'] === 'athlete' ? rec['role'] : null;
      errors.add('role', role ? null : 'Choose athlete or coach.');
      errors.add('name', titleMessage(rec['name']));
      errors.add('email', /^[^@\s]+@[^@\s]+$/.test(text(rec['email'])) ? null : 'Enter an email address.');
      errors.add('password', text(rec['password']) ? null : 'Enter a password.');
      errors.throwIfAny();
      const key = text(rec['key']);
      const id = await idFor(tx, key);
      const own = workoutRecords.filter((work) => work['athlete'] === key).map((work) => text(work['date'])).filter(Boolean).sort();
      const seriesStart = role === 'athlete' ? text(rec['series_start']) || own[0] || today : null;
      const code = role === 'coach' ? text(rec['coach_code']) || generateCoachCode() : null;
      await tx.query(
        `INSERT INTO users (id, role, name, email, password_hash, tz, coach_code, series_start, start_ctl, start_atl)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, name = EXCLUDED.name, email = EXCLUDED.email, password_hash = EXCLUDED.password_hash,
           tz = EXCLUDED.tz, coach_code = EXCLUDED.coach_code, series_start = EXCLUDED.series_start, start_ctl = EXCLUDED.start_ctl, start_atl = EXCLUDED.start_atl`,
        [id, role, text(rec['name']).trim(), text(rec['email']), await hashPassword(text(rec['password'])), text(rec['tz']) || config.appTz, code, seriesStart, Number(rec['start_ctl'] ?? 0), Number(rec['start_atl'] ?? 0)]
      );
      for (const [position, threshold] of records(rec['thresholds']).entries()) {
        await at(`thresholds[${position}]`, async () => {
          const e = new FieldErrors();
          const kind = threshold['kind'] === 'ftp' || threshold['kind'] === 'pace' ? (threshold['kind'] as ThresholdKind) : null;
          e.add('kind', kind ? null : 'Choose ftp or pace.');
          if (kind) e.add('value', thresholdValueMessage(kind, threshold['value']));
          e.add('effective_from', dateMessage(threshold['effective_from']));
          e.throwIfAny();
          await tx.query(
            'INSERT INTO thresholds (athlete_id, kind, effective_from, value) VALUES ($1, $2, $3, $4) ON CONFLICT (athlete_id, kind, effective_from) DO UPDATE SET value = EXCLUDED.value',
            [id, kind, threshold['effective_from'], threshold['value']]
          );
        });
      }
      ids[key] = id;
      people.set(key, await requireUser(id, tx));
    });
  }

  for (const [index, rec] of records(body['links']).entries()) {
    const id = await idFor(tx, text(rec['key']));
    const status = text(rec['status']);
    const path = `links[${index}]`;
    if (!['requested', 'accepted', 'declined', 'removed'].includes(status)) throw validation({ [`${path}.status`]: 'Choose requested, accepted, declined or removed.' });
    const coachId = person(path, 'coach', rec['coach']).id;
    const athleteId = person(path, 'athlete', rec['athlete']).id;
    await tx.query(
      `INSERT INTO links (id, coach_id, athlete_id, status, expires_at) VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now() + make_interval(secs => $6)))
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, expires_at = EXCLUDED.expires_at`,
      [id, coachId, athleteId, status, text(rec['expires_at']) || null, config.linkRequestTtlHours * 3600]
    );
    ids[text(rec['key'])] = id;
  }

  for (const [index, rec] of records(body['library']).entries()) {
    const owner = person(`library[${index}]`, 'owner', rec['owner']);
    const item = await at(`library[${index}]`, async () => addLibraryItem(owner, rec, await idFor(tx, text(rec['key'])), tx));
    ids[text(rec['key'])] = item.id;
  }

  for (const [index, rec] of records(body['plans']).entries()) {
    const owner = person(`plans[${index}]`, 'owner', rec['owner']);
    const plan = await at(`plans[${index}]`, async () => addPlan(owner, rec, await idFor(tx, text(rec['key'])), tx));
    ids[text(rec['key'])] = plan.id;
  }

  for (const [index, rec] of records(body['events']).entries()) {
    await at(`events[${index}]`, async () => {
      const e = new FieldErrors();
      e.add('name', titleMessage(rec['name']));
      e.add('date', dateMessage(rec['date']));
      e.throwIfAny();
      await tx.query(
        `INSERT INTO athlete_events (id, athlete_id, name, date) SELECT $1, $2, $3, $4
          WHERE NOT EXISTS (SELECT 1 FROM athlete_events WHERE athlete_id = $2 AND name = $3 AND date = $4)`,
        [newId(), person(`events[${index}]`, 'athlete', rec['athlete']).id, text(rec['name']).trim(), rec['date']]
      );
    });
  }

  const files = new Map(records(body['files']).map((rec) => [text(rec['key']), { name: text(rec['name']), bytes: Buffer.from(text(rec['content_base64']), 'base64') }]));
  for (const [index, rec] of workoutRecords.entries()) {
    const athlete = person(`workouts[${index}]`, 'athlete', rec['athlete']);
    const id = await idFor(tx, text(rec['key']));
    await at(`workouts[${index}]`, async () => {
      const errors = new FieldErrors();
      errors.add('date', dateMessage(rec['date']));
      errors.add('sport', sportMessage(rec['sport']));
      errors.add('title', titleMessage(rec['title']));
      if (rec['start_local'] !== undefined) errors.add('start_local', startLocalMessage(rec['start_local']));
      const manual = (rec['manual'] ?? null) as Rec | null;
      const fileKey = typeof rec['file'] === 'string' ? rec['file'] : null;
      if (rec['kind'] === 'planned') {
        if (rec['steps'] !== undefined) errors.add('steps', stepsMessage(rec['steps']));
        else errors.add('duration_s', durationMessage(rec['duration_s']));
      }
      errors.throwIfAny();
      const fields = { date: rec['date'], sport: rec['sport'], title: rec['title'], ...manual };
      const date = text(rec['date']);
      const sport = rec['sport'] as Sport;
      if (rec['kind'] === 'planned') {
        await insertPlanned(tx, {
          id,
          athlete,
          date,
          startLocal: typeof rec['start_local'] === 'string' ? rec['start_local'] : null,
          sport,
          title: text(rec['title']).trim(),
          shape: rec['steps'] !== undefined ? { steps: cleanSteps(rec['steps'] as unknown[]) } : { duration_s: rec['duration_s'] as number },
          source: 'builder'
        });
      } else if (fileKey !== null) {
        const file = files.get(fileKey);
        const format = file ? activityFormat(file.name) : null;
        if (!file || !format) throw validation({ file: 'Upload a .csv or .json activity file.' });
        const prepared = await prepareFile(athlete, today, format, file.bytes, sport, date, tx);
        const message = completedDateMessage(prepared.date, today, athlete.series_start);
        if (message) throw validation({ date: message });
        const info = await storeOriginal(athlete.id, id, file.name, format, file.bytes);
        stored.push({ athleteId: athlete.id, id, format });
        await insertCompleted(tx, fileWorkout(athlete, prepared, text(rec['title']).trim(), info, id));
      } else if (manual) {
        manualErrors(fields, athlete, today).throwIfAny();
        await insertCompleted(tx, manualWorkout(athlete, fields, id));
      } else {
        throw validation({ manual: 'Give a manual entry or a file.' });
      }
    });
    ids[text(rec['key'])] = id;
  }

  for (const [index, rec] of records(body['comments']).entries()) {
    const id = await idFor(tx, text(rec['key']));
    const path = `comments[${index}]`;
    await at(path, () => insertComment(person(path, 'author', rec['author']), known(path, 'workout', rec['workout']), { body: rec['body'] }, id, tx));
    ids[text(rec['key'])] = id;
  }

  const signIn: Record<string, string> = {};
  for (const rec of userRecords) {
    const athlete = person('users', 'key', rec['key']);
    await recomputeSeries(tx, athlete, athlete.series_start ?? today, today);
    signIn[text(rec['key'])] = await issueSignInLink(athlete.id, tx);
  }
  return { today, ids, sign_in: signIn };
}

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const generateCoachCode = (): string => Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
