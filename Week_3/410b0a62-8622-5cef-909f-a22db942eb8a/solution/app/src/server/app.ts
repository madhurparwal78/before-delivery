import { timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { addDays, isoWeekOf, mondayOfWeek } from '../shared/dates.js';
import type { Workout } from '../shared/types.js';
import {
  createSession, endSession, openableAthlete, passwordMatches, redeemSignInLink, SESSION_COOKIE, todayDate, userByEmail, userOfRequest, type User
} from './access.js';
import { addComment, listComments } from './comments.js';
import { config, JSON_BODY_LIMIT, SEED_BODY_LIMIT, UPLOAD_ENVELOPE_BYTES } from './config.js';
import { databaseReady, pool } from './db.js';
import { ApiError, FieldErrors, fileTooLarge, internalError, invalidCredentials, notFound, payloadTooLarge, respond, serviceStarting, StorageFailure, unauthenticated, validation } from './errors.js';
import { ensureSeriesCurrent, readSeries } from './series.js';
import { openStream, parseCursor } from './live.js';
import { answerRequest, listLinks, removeLink, requestLink } from './links.js';
import {
  addLibraryItem, addPlan, applyPlan, copyWeek, createPlanned, deleteWorkout, listLibrary, listPlans, patchWorkout, planOwnedBy, removeLibraryItem, saveThreshold
} from './planning.js';
import { applySeed, resetEverything } from './seed.js';
import { createManual, createUpload, downloadOriginal } from './sessions.js';
import { checkBucket } from './storage.js';
import { athleteRows, itemOf, weekSummaries } from './weeks.js';
import { loadThresholds, loadWorkout } from './workouts.js';
import { dateMessage, MESSAGES, weekMessage } from './validation.js';
import { handlePage, notFoundPage } from './pages.js';

type Env = { Variables: { user: User } };
type Ctx = Context<Env>;
type Body = Record<string, unknown>;

export const app = new Hono<Env>();

async function readBody(c: Context, limit: number): Promise<Uint8Array> {
  if (Number(c.req.header('content-length') ?? 0) > limit) throw payloadTooLarge();
  const stream = c.req.raw.body;
  if (!stream) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  let total = 0;
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    total += part.value.length;
    if (total > limit) throw payloadTooLarge();
    chunks.push(part.value);
  }
  return Buffer.concat(chunks);
}

async function readJson(c: Context, limit = JSON_BODY_LIMIT): Promise<Body> {
  const bytes = await readBody(c, limit);
  if (bytes.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Body;
  } catch {
    // reported below, with the not-an-object case
  }
  throw validation({ body: 'Send the request as a JSON object.' });
}

app.onError((error, c) => {
  if (error instanceof ApiError) return respond(c, error);
  console.error(error);
  return respond(c, internalError());
});

// A NUL byte in a URL can never name anything (and PostgreSQL text cannot hold it): refuse it before any lookup.
app.use('/api/*', async (c, next) => {
  if (/%00/i.test(c.req.url)) throw notFound();
  await next();
});

// ------------------------------------------------------------------ public

app.use('*', async (c, next) => {
  if (!databaseReady()) {
    if (c.req.path === '/api/health') return c.json({ status: 'starting' }, 503);
    if (c.req.path.startsWith('/api/')) return respond(c, serviceStarting());
  }
  await next();
});

app.get('/api/health', async (c) => {
  try {
    await checkBucket();
    return c.json({ status: 'ok' });
  } catch (error) {
    if (error instanceof StorageFailure) return c.json({ status: 'unavailable' });
    throw error;
  }
});

function requireGradingKey(c: Context): void {
  const given = Buffer.from(c.req.header('x-grading-key') ?? '');
  const expected = Buffer.from(config.gradingKey ?? '');
  if (config.gradingKey === null || given.length !== expected.length || !timingSafeEqual(given, expected)) throw notFound();
}

app.post('/api/grading/seed', async (c) => {
  requireGradingKey(c);
  return c.json(await applySeed(await readJson(c, SEED_BODY_LIMIT)));
});

app.post('/api/grading/reset', async (c) => {
  requireGradingKey(c);
  await resetEverything();
  return c.json({ status: 'reset' });
});

function startSession(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, { httpOnly: true, sameSite: 'Lax', path: '/' });
}

app.post('/api/auth/sign-in', async (c) => {
  const body = await readJson(c);
  const user = typeof body['email'] === 'string' ? await userByEmail(body['email'].trim().toLowerCase()) : null;
  if (!user || typeof body['password'] !== 'string' || !(await passwordMatches(body['password'], user.password_hash))) throw invalidCredentials();
  startSession(c, await createSession(user.id));
  return c.json({ user: await meOf(user) });
});

app.get('/auth/one-time/:token', async (c) => {
  const userId = await redeemSignInLink(c.req.param('token'));
  if (userId === null) return notFoundPage(c);
  startSession(c, await createSession(userId));
  return c.redirect('/', 303);
});

// ------------------------------------------------------------------ authenticated

app.use('/api/*', async (c, next) => {
  const user = await userOfRequest(c);
  if (!user) throw unauthenticated();
  c.set('user', user);
  await next();
});

async function meOf(user: User) {
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    tz: user.tz,
    coach_code: user.role === 'coach' ? user.coach_code : null,
    today: await todayDate()
  };
}

app.post('/api/auth/sign-out', async (c) => {
  await endSession(getCookie(c, SESSION_COOKIE) ?? '');
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.body(null, 204);
});

app.get('/api/me', async (c) => c.json(await meOf(c.get('user'))));

app.get('/api/athletes', async (c) => c.json({ athletes: await athleteRows(c.get('user'), await todayDate()) }));

async function athleteOf(c: Ctx): Promise<User> {
  const athlete = await openableAthlete(c.get('user'), c.req.param('id') ?? '');
  if (!athlete) throw notFound();
  return athlete;
}

app.get('/api/athletes/:id', async (c) => {
  const athlete = await athleteOf(c);
  const events = await pool.query<{ name: string; date: string }>('SELECT name, date FROM athlete_events WHERE athlete_id = $1 ORDER BY date, id', [athlete.id]);
  return c.json({
    id: athlete.id,
    name: athlete.name,
    tz: athlete.tz,
    series_start: athlete.series_start,
    thresholds: await loadThresholds(athlete.id),
    events: events.rows
  });
});

app.post('/api/athletes/:id/thresholds', async (c) => {
  const athlete = await athleteOf(c);
  const { status, result } = await saveThreshold(athlete, await todayDate(), await readJson(c));
  return c.json(result, status);
});

const clampWeeks = (raw: string | undefined): number => {
  const value = raw === undefined || raw === '' ? 4 : Number(raw);
  return Number.isInteger(value) ? Math.min(Math.max(value, 0), 12) : 4;
};

app.get('/api/athletes/:id/weeks', async (c) => {
  const athlete = await athleteOf(c);
  const today = await todayDate();
  const week = c.req.query('week') ?? isoWeekOf(today);
  if (weekMessage(week)) throw validation({ week: MESSAGES.week });
  const monday = mondayOfWeek(week);
  const before = clampWeeks(c.req.query('before'));
  const after = clampWeeks(c.req.query('after'));
  const ids = Array.from({ length: before + after + 1 }, (_, index) => isoWeekOf(addDays(monday, (index - before) * 7)));
  return c.json({ today, weeks: await weekSummaries(athlete, today, ids) });
});

app.get('/api/athletes/:id/series', async (c) => {
  const athlete = await athleteOf(c);
  const today = await todayDate();
  const from = c.req.query('from') ?? athlete.series_start ?? today;
  const to = c.req.query('to') ?? today;
  const errors = new FieldErrors();
  errors.add('from', dateMessage(from));
  errors.add('to', dateMessage(to));
  errors.throwIfAny();
  await ensureSeriesCurrent(athlete, today);
  return c.json({ days: await readSeries(pool, athlete.id, from, to) });
});

app.post('/api/athletes/:id/workouts', async (c) => {
  const athlete = await athleteOf(c);
  const workout = await createPlanned(c.get('user'), athlete, await todayDate(), await readJson(c));
  return c.json({ workout }, 201);
});

app.post('/api/athletes/:id/manual', async (c) => {
  const athlete = await athleteOf(c);
  const workout = await createManual(c.get('user'), athlete, await todayDate(), await readJson(c));
  return c.json({ workout }, 201);
});

app.post('/api/athletes/:id/uploads', async (c) => {
  const athlete = await athleteOf(c);
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > config.activityMaxBytes + UPLOAD_ENVELOPE_BYTES) throw fileTooLarge(config.activityMaxBytes);
  const form = await c.req.formData().catch(() => new FormData());
  const workout = await createUpload(c.get('user'), athlete, await todayDate(), form);
  return c.json({ workout }, 201);
});

app.post('/api/athletes/:id/copy-week', async (c) => {
  const source = await athleteOf(c);
  if (c.get('user').role !== 'coach') throw notFound();
  const body = await readJson(c);
  const target = await openableAthlete(c.get('user'), String(body['to_athlete_id'] ?? ''));
  if (!target) throw notFound();
  return c.json(await copyWeek(source, target, await todayDate(), body), 201);
});

// ------------------------------------------------------------------ workouts

async function workoutOf(c: Ctx): Promise<{ workout: Workout; athlete: User }> {
  const stored = await loadWorkout(c.req.param('id') ?? '');
  const athlete = stored ? await openableAthlete(c.get('user'), stored.workout.athlete_id) : null;
  if (!stored || !athlete) throw notFound();
  return { workout: stored.workout, athlete };
}

app.get('/api/workouts/:id', async (c) => {
  const { workout } = await workoutOf(c);
  const today = await todayDate();
  return c.json({ workout, item: await itemOf(workout.id, workout.athlete_id, workout.date, today), comments: await listComments(workout.id) });
});

app.patch('/api/workouts/:id', async (c) => {
  const { workout, athlete } = await workoutOf(c);
  return c.json({ workout: await patchWorkout(athlete, await todayDate(), workout.id, await readJson(c)) });
});

app.delete('/api/workouts/:id', async (c) => {
  const { workout, athlete } = await workoutOf(c);
  await deleteWorkout(athlete, await todayDate(), workout.id);
  return c.body(null, 204);
});

app.get('/api/workouts/:id/original', async (c) => {
  const { workout } = await workoutOf(c);
  if (!workout.file) throw notFound();
  const bytes = await downloadOriginal({ ...workout, file: workout.file });
  const { file } = workout;
  const safeName = file.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': file.content_type,
      'content-disposition': `attachment; filename="${safeName}"`,
      'X-Content-SHA256': file.sha256
    }
  });
});

app.get('/api/workouts/:id/comments', async (c) => c.json({ comments: await listComments((await workoutOf(c)).workout.id) }));

app.post('/api/workouts/:id/comments', async (c) => {
  const { workout } = await workoutOf(c);
  return c.json({ comment: await addComment(c.get('user'), workout, await readJson(c)) }, 201);
});

// ------------------------------------------------------------------ library and plans

app.get('/api/library', async (c) => c.json({ library: await listLibrary(c.get('user').id) }));
app.post('/api/library', async (c) => c.json({ item: await addLibraryItem(c.get('user'), await readJson(c)) }, 201));
app.delete('/api/library/:id', async (c) => {
  if (!(await removeLibraryItem(c.get('user').id, c.req.param('id')))) throw notFound();
  return c.body(null, 204);
});

function requireCoach(c: Ctx): User {
  const user = c.get('user');
  if (user.role !== 'coach') throw notFound();
  return user;
}

app.get('/api/plans', async (c) => c.json({ plans: await listPlans(requireCoach(c).id) }));
app.post('/api/plans', async (c) => c.json({ plan: await addPlan(requireCoach(c), await readJson(c)) }, 201));
app.post('/api/plans/:id/apply', async (c) => {
  const coach = requireCoach(c);
  const plan = await planOwnedBy(coach.id, c.req.param('id'));
  if (!plan) throw notFound();
  const body = await readJson(c);
  const athlete = await openableAthlete(coach, String(body['athlete_id'] ?? ''));
  if (!athlete) throw notFound();
  return c.json(await applyPlan(plan, athlete, await todayDate(), body), 201);
});

// ------------------------------------------------------------------ links

app.post('/api/links', async (c) => {
  const user = c.get('user');
  if (user.role !== 'athlete') throw notFound();
  return c.json({ link: await requestLink(user, await readJson(c)) }, 201);
});
app.get('/api/links', async (c) => c.json({ links: await listLinks(c.get('user')) }));
app.post('/api/links/:id/accept', async (c) => c.json({ link: await answerRequest(requireCoach(c), c.req.param('id'), 'accepted') }));
app.post('/api/links/:id/decline', async (c) => c.json({ link: await answerRequest(requireCoach(c), c.req.param('id'), 'declined') }));
app.delete('/api/links/:id', async (c) => {
  await removeLink(c.get('user'), c.req.param('id'));
  return c.body(null, 204);
});

app.get('/api/live', (c) =>
  // A reconnect resumes from the browser's Last-Event-ID; a first connect from the cursor its page shell carried.
  openStream(c.get('user').id, c.req.raw.signal, parseCursor(c.req.header('last-event-id')) ?? parseCursor(c.req.query('after')))
);

app.all('/api/*', () => {
  throw notFound();
});

// ------------------------------------------------------------------ pages

app.get('*', handlePage);
