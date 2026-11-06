/**
 * The API router. It answers exactly the published paths and methods in each
 * version, applying the published error precedence to every request.
 */

import type { Pool } from '../db/pool.js';
import type { Config } from '../config.js';
import { ApiError, type ErrorCode } from './errors.js';
import { digest, v1Manifest, v2Manifest } from './contract.js';
import * as shape from './shapes.js';
import * as agenda from '../agenda.js';
import * as accounts from '../accounts.js';
import * as booking from '../booking.js';
import { Refused } from '../seats.js';
import { renderBio } from '../bio.js';

export type Version = 'v1' | 'v2';

export interface ApiRequest {
  method: string;
  /** The path relative to the version root, or null outside both versions. */
  relative: string | null;
  version: Version | null;
  /** The unversioned health and contract paths. */
  unversioned: 'health' | 'contract' | null;
  query: URLSearchParams;
  body: unknown;
  rawBody: Buffer | null;
  bodyOversize: boolean;
  bodyContentType: string | null;
  bodyMalformed: boolean;
  token: string | null;
  idempotencyKey: string | null;
  /** The matched path parameter: a session id or a speaker slug. */
  segments: string | null;
  /** The version prefix the request used, for Link headers. */
  prefixUsed: string;
}

export interface ApiResult {
  status: number;
  body: string;
  contentType: string;
  headers: Array<[string, string]>;
}

export interface RouterDeps {
  pool: Pool;
  config: Config;
  ready: boolean;
}

const JSON_TYPE = 'application/json; charset=utf-8';

function result(status: number, body: string, contentType = JSON_TYPE, headers: Array<[string, string]> = []): ApiResult {
  return { status, body, contentType, headers };
}

function errorBody(version: Version | null, e: ApiError): string {
  // v1 is also the shape for every answer outside /api/v2/.
  return version === 'v2' ? v2Error(e) : v1Error(e);
}

import { v1ErrorBody, v2ErrorBody } from './errors.js';
function v1Error(e: ApiError): string {
  return v1ErrorBody(e);
}
function v2Error(e: ApiError): string {
  return v2ErrorBody(e);
}

function apiError(version: Version | null, e: ApiError): ApiResult {
  const headers: Array<[string, string]> = [];
  if (e.retryAfter !== undefined) headers.push(['Retry-After', String(e.retryAfter)]);
  return result(e.status, errorBody(version, e), JSON_TYPE, headers);
}

function failed(version: Version | null, code: ErrorCode, status: number, options?: { fields?: Record<string, string>; extra?: Record<string, unknown> }): ApiResult {
  return apiError(version, new ApiError(code, status, '', options ?? {}));
}

/* ------------------------------------------------------------------ *
 * Route table                                                        *
 * ------------------------------------------------------------------ */

type Handler = (req: ApiRequest, deps: RouterDeps, caller: accounts.Account | null) => Promise<ApiResult>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  versions: Version[] | 'both';
}

const ROUTES: Route[] = [];

function route(method: string, path: string, versions: Version[] | 'both', handler: Handler): void {
  ROUTES.push({ method, segments: path.slice(1).split('/'), handler, versions });
}

/* ------------------------------------------------------------------ *
 * Helpers                                                            *
 * ------------------------------------------------------------------ */

function requireAuth(caller: accounts.Account | null, role: 'attendee' | 'organiser' | 'any'): ApiError | null {
  if (!caller) return new ApiError('unauthenticated', 401);
  if (role === 'attendee' && caller.role !== 'attendee') return new ApiError('forbidden', 403);
  if (role === 'organiser' && caller.role !== 'organiser') return new ApiError('forbidden', 403);
  return null;
}

/** Adapt a booking outcome to the reservation shape helper. */
function outcomeOf(o: booking.ReservationOutcome): { id: number; sessionId: string; createdAt: Date } {
  return { id: o.reservationId, sessionId: o.sessionId, createdAt: o.createdAt };
}

function isWholeNumber(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function codePoints(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** The known filter values. */
const STAGE_SLUGS = ['summit-stage', 'signal-stage', 'ai-builder-lab', 'the-arena'];
const FORMAT_SLUGS = ['demo-qa', 'fireside', 'game', 'keynote', 'panel', 'workshop'];

function sessionFilters(req: ApiRequest): { filters: agendaFilters; error: ApiResult | null } {
  const day = req.query.get('day');
  const stage = req.query.get('stage');
  const format = req.query.get('format');
  let dayFilter: number | 'all' = 'all';
  if (day !== null && day !== 'all') {
    if (day !== '1' && day !== '2') return { filters: emptyFilters(), error: failed(req.version, 'invalid_filter', 400) };
    dayFilter = Number(day);
  }
  let stageFilter: string = 'all';
  if (stage !== null && stage !== 'all') {
    if (!STAGE_SLUGS.includes(stage)) return { filters: emptyFilters(), error: failed(req.version, 'invalid_filter', 400) };
    stageFilter = stage;
  }
  let formatFilter: string = 'all';
  if (format !== null && format !== 'all') {
    if (!FORMAT_SLUGS.includes(format)) return { filters: emptyFilters(), error: failed(req.version, 'invalid_filter', 400) };
    formatFilter = format;
  }
  let q: string | null = null;
  if (req.version === 'v2') {
    const raw = req.query.get('q');
    if (raw !== null && raw !== '') {
      if (codePoints(raw) > 2048) {
        return {
          filters: emptyFilters(),
          error: failed(req.version, 'invalid', 422, { fields: { q: 'Use at most 2,048 characters.' } }),
        };
      }
      q = raw;
    }
  }
  return { filters: { day: dayFilter, stage: stageFilter, format: formatFilter, q }, error: null };
}

function emptyFilters(): agendaFilters {
  return { day: 'all', stage: 'all', format: 'all', q: null };
}

interface agendaFilters {
  day: number | 'all';
  stage: string;
  format: string;
  q: string | null;
}

/* ------------------------------------------------------------------ *
 * Endpoint handlers                                                  *
 * ------------------------------------------------------------------ */

route('POST', '/auth/signup', 'both', async (req, deps) => {
  const body = req.body as Record<string, unknown>;
  const fields: Record<string, string> = {};
  if (!accounts.validName(body?.name)) fields.name = 'Enter a name of 1 to 80 characters.';
  if (!accounts.validEmail(body?.email)) fields.email = 'Enter a valid email address.';
  if (!accounts.validSignupPassword(body?.password)) fields.password = 'Use at least 8 characters.';
  if (Object.keys(fields).length > 0) return failed(req.version, 'invalid', 422, { fields });
  try {
    await accounts.signup(deps.pool, {
      name: body?.name,
      email: (body?.email as string).toLowerCase(),
      password: body?.password,
    });
    // Signup signs the new attendee in at once.
    const signin = await accounts.signin(deps.pool, (body?.email as string).toLowerCase(), body?.password as string, deps.config.signinThrottleWindowSeconds);
    if (signin.kind !== 'ok') return failed(req.version, 'email_taken', 409);
    return result(201, shapeJson(req.version, [shape.v1Auth(signin.token, signin.account), shape.v2Auth(signin.token, signin.account)]));
  } catch (err) {
    if (err instanceof accounts.EmailTaken) return failed(req.version, 'email_taken', 409);
    throw err;
  }
});

route('POST', '/auth/login', 'both', async (req, deps) => {
  const body = req.body as Record<string, unknown>;
  const fields: Record<string, string> = {};
  if (typeof body?.email !== 'string' || body.email === '') fields.email = 'Enter your email.';
  if (typeof body?.password !== 'string' || body.password === '') fields.password = 'Enter your password.';
  if (Object.keys(fields).length > 0) return failed(req.version, 'invalid', 422, { fields });
  const signin = await accounts.signin(
    deps.pool,
    body.email as string,
    body.password as string,
    deps.config.signinThrottleWindowSeconds,
  );
  if (signin.kind === 'rate_limited') {
    return apiError(req.version, new ApiError('rate_limited', 429, '', { retryAfter: signin.retryAfter }));
  }
  if (signin.kind === 'invalid_credentials') return failed(req.version, 'invalid_credentials', 401);
  return result(200, shapeJson(req.version, [shape.v1Auth(signin.token, signin.account), shape.v2Auth(signin.token, signin.account)]));
});

route('POST', '/auth/logout', 'both', async (req, deps, caller) => {
  const authError = requireAuth(caller, 'any');
  if (authError) return apiError(req.version, authError);
  await accounts.signout(deps.pool, req.token!);
  return result(200, shapeJson(req.version, [shape.ordered([['signed_out', true]]), shape.ordered([['signed_out', true]])]));
});

route('GET', '/me', 'both', async (req, _deps, caller) => {
  const authError = requireAuth(caller, 'any');
  if (authError) return apiError(req.version, authError);
  return result(200, shapeJson(req.version, [shape.v1Account(caller!), shape.v2Account(caller!)]));
});

route('GET', '/stages', 'both', async (_req, deps) => {
  const stages = await agenda.listStages(deps.pool);
  const items = stages.map((s) => shape.ordered([['slug', s.slug], ['name', s.name], ['description', s.description]]));
  return result(200, `[${items.map((i) => i.body).join(',')}]`);
});

route('GET', '/sessions', 'both', async (req, deps, caller) => {
  const { filters, error } = sessionFilters(req);
  if (error) return error;
  const sessions = await agenda.listSessions(deps.pool, filters, { accountId: caller?.id ?? null }, deps.config.holdSeconds);
  const items = sessions.map((s) => (req.version === 'v2' ? shape.v2Session(s) : shape.v1Session(s)));
  return result(200, `[${items.map((i) => i.body).join(',')}]`);
});

route('GET', '/sessions/{id}', 'both', async (req, deps, caller) => {
  const id = req.segments!;
  const session = await agenda.getSessionData(deps.pool, id, { accountId: caller?.id ?? null }, deps.config.holdSeconds);
  if (!session) return failed(req.version, 'not_found', 404);
  return result(200, (req.version === 'v2' ? shape.v2Session(session) : shape.v1Session(session)).body);
});

route('POST', '/sessions/{id}/reservation', 'both', async (req, deps, caller) => {
  const authError = requireAuth(caller, 'attendee');
  if (authError) return apiError(req.version, authError);
  const id = req.segments!;
  const exists = await sessionExists(deps, id);
  if (!exists) return failed(req.version, 'not_found', 404);
  const version = req.version!;
  try {
    const outcome = await booking.reserve(
      { pool: deps.pool, holdSeconds: deps.config.holdSeconds, idempotencyKeyTtlSeconds: deps.config.idempotencyKeyTtlSeconds },
      id,
      caller!.id,
      req.idempotencyKey,
      version,
      (o) => ({
        status: 201,
        body: (version === 'v2'
          ? shape.v2ReservationCreated(outcomeOf(o), o.seats)
          : shape.v1ReservationCreated(outcomeOf(o), o.seats.left)).body,
      }),
    );
    return result(outcome.status, outcome.body);
  } catch (err) {
    return refusalResult(req.version, err);
  }
});

route('DELETE', '/sessions/{id}/reservation', 'both', async (req, deps, caller) => {
  const authError = requireAuth(caller, 'attendee');
  if (authError) return apiError(req.version, authError);
  const id = req.segments!;
  const exists = await sessionExists(deps, id);
  if (!exists) return failed(req.version, 'not_found', 404);
  try {
    const outcome = await booking.cancel(
      { pool: deps.pool, holdSeconds: deps.config.holdSeconds, idempotencyKeyTtlSeconds: deps.config.idempotencyKeyTtlSeconds },
      id,
      caller!.id,
    );
    return result(200, (req.version === 'v2' ? shape.v2Cancelled(outcome.seats) : shape.v1Cancelled(outcome.seats.left)).body);
  } catch (err) {
    return refusalResult(req.version, err);
  }
});

route('POST', '/sessions/{id}/waitlist', 'both', async (req, deps, caller) => {
  const authError = requireAuth(caller, 'attendee');
  if (authError) return apiError(req.version, authError);
  const id = req.segments!;
  const exists = await sessionExists(deps, id);
  if (!exists) return failed(req.version, 'not_found', 404);
  try {
    const outcome = await booking.joinWaitlist(
      { pool: deps.pool, holdSeconds: deps.config.holdSeconds, idempotencyKeyTtlSeconds: deps.config.idempotencyKeyTtlSeconds },
      id,
      caller!.id,
    );
    const joined = shape.ordered([
      ['session_id', id],
      ['position', outcome.position],
      ['created_at', outcome.createdAt.toISOString().replace(/\.\d{3}Z$/, 'Z')],
    ]);
    const wrapped = shape.ordered([['waitlist', joined]]);
    return result(201, wrapped.body);
  } catch (err) {
    return refusalResult(req.version, err);
  }
});

route('DELETE', '/sessions/{id}/waitlist', 'both', async (req, deps, caller) => {
  const authError = requireAuth(caller, 'attendee');
  if (authError) return apiError(req.version, authError);
  const id = req.segments!;
  const exists = await sessionExists(deps, id);
  if (!exists) return failed(req.version, 'not_found', 404);
  try {
    await booking.leaveWaitlist(
      { pool: deps.pool, holdSeconds: deps.config.holdSeconds, idempotencyKeyTtlSeconds: deps.config.idempotencyKeyTtlSeconds },
      id,
      caller!.id,
    );
    return result(200, shape.ordered([['waitlisted', false]]).body);
  } catch (err) {
    return refusalResult(req.version, err);
  }
});

route('POST', '/sessions/{id}/claim', ['v2'], async (req, deps, caller) => {
  const authError = requireAuth(caller, 'attendee');
  if (authError) return apiError(req.version, authError);
  const id = req.segments!;
  const exists = await sessionExists(deps, id);
  if (!exists) return failed(req.version, 'not_found', 404);
  try {
    const outcome = await booking.claim(
      { pool: deps.pool, holdSeconds: deps.config.holdSeconds, idempotencyKeyTtlSeconds: deps.config.idempotencyKeyTtlSeconds },
      id,
      caller!.id,
    );
    return result(201, shape.v2ReservationCreated(outcomeOf(outcome), outcome.seats).body);
  } catch (err) {
    return refusalResult(req.version, err);
  }
});

route('DELETE', '/sessions/{id}/hold', ['v2'], async (req, deps, caller) => {
  const authError = requireAuth(caller, 'attendee');
  if (authError) return apiError(req.version, authError);
  const id = req.segments!;
  const exists = await sessionExists(deps, id);
  if (!exists) return failed(req.version, 'not_found', 404);
  try {
    await booking.release(
      { pool: deps.pool, holdSeconds: deps.config.holdSeconds, idempotencyKeyTtlSeconds: deps.config.idempotencyKeyTtlSeconds },
      id,
      caller!.id,
    );
    return result(200, shape.ordered([['held', false]]).body);
  } catch (err) {
    return refusalResult(req.version, err);
  }
});

route('PUT', '/sessions/{id}/save', 'both', async (req, deps, caller) => {
  const authError = requireAuth(caller, 'attendee');
  if (authError) return apiError(req.version, authError);
  const id = req.segments!;
  const exists = await sessionExists(deps, id);
  if (!exists) return failed(req.version, 'not_found', 404);
  await agenda.saveSession(deps.pool, id, caller!.id);
  return result(200, shape.ordered([['saved', true]]).body);
});

route('DELETE', '/sessions/{id}/save', 'both', async (req, deps, caller) => {
  const authError = requireAuth(caller, 'attendee');
  if (authError) return apiError(req.version, authError);
  const id = req.segments!;
  const exists = await sessionExists(deps, id);
  if (!exists) return failed(req.version, 'not_found', 404);
  await agenda.unsaveSession(deps.pool, id, caller!.id);
  return result(200, shape.ordered([['saved', false]]).body);
});

route('GET', '/me/agenda', 'both', async (req, deps, caller) => {
  const authError = requireAuth(caller, 'attendee');
  if (authError) return apiError(req.version, authError);
  const mine = await agenda.myAgenda(deps.pool, caller!.id, deps.config.holdSeconds);
  const body = req.version === 'v2'
    ? shape.v2MyAgenda(mine)
    : shape.v1MyAgenda({ reserved: mine.reserved, waitlisted: mine.waitlisted, saved: mine.saved });
  return result(200, body.body);
});

route('GET', '/me/holds', ['v2'], async (req, deps, caller) => {
  const authError = requireAuth(caller, 'attendee');
  if (authError) return apiError(req.version, authError);
  const client = await deps.pool.connect();
  try {
    const res = await client.query(
      `SELECT h.session_id, h.held_until FROM holds h
        WHERE h.account_id = $1 AND h.ended_at IS NULL
        ORDER BY h.held_until, h.session_id`,
      [caller!.id],
    );
    const clock = await client.query('SELECT now() AS now');
    const now = new Date(clock.rows[0]!.now).getTime();
    const items = res.rows.map((r) =>
      shape.v2Hold({
        sessionId: r.session_id,
        heldUntil: new Date(r.held_until),
        secondsRemaining: Math.max(0, Math.floor((new Date(r.held_until).getTime() - now) / 1000)),
      }),
    );
    return result(200, `[${items.map((i) => i.body).join(',')}]`);
  } finally {
    client.release();
  }
});

route('GET', '/speakers', 'both', async (req, deps) => {
  const speakers = await agenda.listSpeakers(deps.pool);
  const items = speakers.map((s) => (req.version === 'v2' ? shape.v2Speaker(s) : shape.v1Speaker(s)));
  return result(200, `[${items.map((i) => i.body).join(',')}]`);
});

route('GET', '/agenda.ics', 'both', async (req, deps) => {
  const { filters, error } = sessionFilters(req);
  if (error) return error;
  const sessions = await agenda.listSessions(deps.pool, filters, { accountId: null }, deps.config.holdSeconds);
  if (sessions.length === 0) return failed(req.version, 'no_sessions', 404);
  const calendar = agenda.buildCalendar(sessions, new Date());
  return result(200, calendar, 'text/calendar; charset=utf-8', [
    ['Content-Disposition', 'attachment; filename="keel-outpost-agenda.ics"'],
  ]);
});

route('GET', '/organiser/sessions', 'both', async (req, deps, caller) => {
  const authError = requireAuth(caller, 'organiser');
  if (authError) return apiError(req.version, authError);
  const rows = await agenda.organiserSessions(deps.pool, deps.config.holdSeconds);
  const items = rows.map((r) => (req.version === 'v2' ? shape.v2OrganiserRow(r) : shape.v1OrganiserRow(r)));
  return result(200, `[${items.map((i) => i.body).join(',')}]`);
});

route('GET', '/organiser/sessions/{id}/roster', 'both', async (req, deps, caller) => {
  const authError = requireAuth(caller, 'organiser');
  if (authError) return apiError(req.version, authError);
  const id = req.segments!;
  const reservable = await isReservable(deps, id);
  if (reservable === 'missing') return failed(req.version, 'not_found', 404);
  if (reservable === 'not_reservable') return failed(req.version, 'not_reservable', 409);

  let limit = 50;
  const rawLimit = req.query.get('limit');
  if (rawLimit !== null) {
    const n = Number(rawLimit);
    if (!Number.isInteger(n) || n < 1 || n > 100 || rawLimit.trim() === '' || rawLimit.includes('.')) {
      return failed(req.version, 'invalid', 422, { fields: { limit: 'Enter a whole number from 1 to 100.' } });
    }
    limit = n;
  }
  const cursor = req.query.get('cursor');
  if (cursor !== null && !agenda.cursorIsReadable(cursor)) {
    return failed(req.version, 'invalid', 422, { fields: { cursor: 'Start again from the first page.' } });
  }
  if (cursor !== null && !cursorBelongsTo(cursor, id)) {
    return failed(req.version, 'invalid', 422, { fields: { cursor: 'Start again from the first page.' } });
  }
  const page = await agenda.rosterPage(deps.pool, id, limit, cursor, deps.config.holdSeconds);
  const items = page.rows.map((r) => (req.version === 'v2' ? shape.v2RosterRow(r) : shape.v1RosterRow(r)));
  const headers: Array<[string, string]> = [];
  if (page.nextCursor !== null) {
    const prefix = req.version === 'v2' ? '/api/v2' : req.prefixUsed!;
    headers.push([
      'Link',
      `<${prefix}/organiser/sessions/${id}/roster?limit=${limit}&cursor=${page.nextCursor}>; rel="next"`,
    ]);
  }
  return result(200, `[${items.map((i) => i.body).join(',')}]`, JSON_TYPE, headers);
});

route('GET', '/organiser/sessions/{id}/roster.csv', 'both', async (req, deps, caller) => {
  const authError = requireAuth(caller, 'organiser');
  if (authError) return apiError(req.version, authError);
  const id = req.segments!;
  const reservable = await isReservable(deps, id);
  if (reservable === 'missing') return failed(req.version, 'not_found', 404);
  if (reservable === 'not_reservable') return failed(req.version, 'not_reservable', 409);
  const page = await agenda.rosterPage(deps.pool, id, 100, null, deps.config.holdSeconds);
  const rows = page.rows;
  let csv = 'name,email,reserved_at\r\n';
  for (const row of rows) {
    csv += `${csvCell(row.name)},${csvCell(row.email)},${csvCell(isoStamp(row.reservedAt))}\r\n`;
  }
  return result(200, csv, 'text/csv; charset=utf-8', [
    ['Content-Disposition', `attachment; filename="roster-${id}.csv"`],
  ]);
});

route('PATCH', '/organiser/sessions/{id}', 'both', async (req, deps, caller) => {
  const authError = requireAuth(caller, 'organiser');
  if (authError) return apiError(req.version, authError);
  const id = req.segments!;
  const reservable = await isReservable(deps, id);
  if (reservable === 'missing') return failed(req.version, 'not_found', 404);
  if (reservable === 'not_reservable') return failed(req.version, 'not_reservable', 409);
  const body = req.body as Record<string, unknown> | null;
  if (!isWholeNumber(body?.capacity, 1, 500)) {
    return failed(req.version, 'invalid', 422, { fields: { capacity: 'Enter a whole number from 1 to 500.' } });
  }
  try {
    await booking.setCapacity(
      { pool: deps.pool, holdSeconds: deps.config.holdSeconds, idempotencyKeyTtlSeconds: deps.config.idempotencyKeyTtlSeconds },
      id,
      body.capacity,
    );
  } catch (err) {
    return refusalResult(req.version, err);
  }
  const rows = await agenda.organiserSessions(deps.pool, deps.config.holdSeconds);
  const row = rows.find((r) => r.id === id)!;
  return result(200, (req.version === 'v2' ? shape.v2OrganiserRow(row) : shape.v1OrganiserRow(row)).body);
});

route('PUT', '/organiser/speakers/{slug}/bio', ['v2'], async (req, deps, caller) => {
  const authError = requireAuth(caller, 'organiser');
  if (authError) return apiError(req.version, authError);
  const slug = req.segments!;
  const body = req.body as Record<string, unknown> | null;
  if (typeof body?.bio !== 'string' || codePoints(body.bio) > 2000) {
    return failed(req.version, 'invalid', 422, { fields: { bio: 'Use at most 2,000 characters.' } });
  }
  const speakers = await agenda.listSpeakers(deps.pool);
  const speaker = speakers.find((s) => s.slug === slug);
  if (!speaker) return failed(req.version, 'not_found', 404);
  const res = await deps.pool.query('UPDATE speakers SET bio = $2 WHERE slug = $1 RETURNING name, company', [slug, body.bio]);
  const row = res.rows[0]!;
  const updated: agenda.SpeakerData = {
    slug,
    name: row.name,
    company: row.company,
    sessions: speaker.sessions,
    bio: body.bio,
    bioHtml: renderBio(body.bio),
  };
  return result(200, shape.v2Speaker(updated).body);
});

route('GET', '/record', 'both', async (req, deps, caller) => {
  const contest = await agenda.readContest(deps.pool, deps.config.contestClosesAt, { accountId: caller?.id ?? null });
  return result(200, (req.version === 'v2' ? shape.v2Record(contest) : shape.v1Record(contest)).body);
});

route('POST', '/record/guesses', 'both', async (req, deps, caller) => {
  const authError = requireAuth(caller, 'attendee');
  if (authError) return apiError(req.version, authError);
  const body = req.body as Record<string, unknown> | null;
  if (!isWholeNumber(body?.value, 1, 100000000)) {
    return failed(req.version, 'invalid', 422, { fields: { value: 'Enter a whole number from 1 to 100,000,000.' } });
  }
  const client = await deps.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM contest WHERE id = 1 FOR UPDATE');
    const clock = await client.query('SELECT now() AS now');
    const now = new Date(clock.rows[0]!.now);
    const contest = await client.query('SELECT final_figure, revealed_at FROM contest WHERE id = 1');
    const revealed = contest.rows[0]!.revealed_at !== null;
    if (revealed || now >= deps.config.contestClosesAt) {
      await client.query('ROLLBACK');
      return failed(req.version, revealed ? 'already_revealed' : 'contest_closed', 409);
    }
    const existing = await client.query('SELECT id FROM guesses WHERE account_id = $1', [caller!.id]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return failed(req.version, 'already_guessed', 409);
    }
    const insert = await client.query(
      'INSERT INTO guesses (account_id, value, created_at) VALUES ($1, $2, $3) RETURNING created_at',
      [caller!.id, body!.value, now],
    );
    const createdAt = new Date(insert.rows[0]!.created_at);
    await client.query('COMMIT');
    const guess = shape.ordered([
      ['value', body!.value],
      ['created_at', createdAt.toISOString().replace(/\.\d{3}Z$/, 'Z')],
    ]);
    return result(201, shape.ordered([['guess', guess]]).body);
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* already rolled back or the connection is gone */
    }
    throw err;
  } finally {
    client.release();
  }
});

route('POST', '/organiser/record/reveal', 'both', async (req, deps, caller) => {
  const authError = requireAuth(caller, 'organiser');
  if (authError) return apiError(req.version, authError);
  const body = req.body as Record<string, unknown> | null;
  if (!isWholeNumber(body?.final_figure, 1, 100000000)) {
    return failed(req.version, 'invalid', 422, { fields: { final_figure: 'Enter a whole number from 1 to 100,000,000.' } });
  }
  const client = await deps.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM contest WHERE id = 1 FOR UPDATE');
    const contest = await client.query('SELECT final_figure, revealed_at FROM contest WHERE id = 1');
    if (contest.rows[0]!.revealed_at !== null) {
      await client.query('ROLLBACK');
      return failed(req.version, 'already_revealed', 409);
    }
    await client.query(
      'UPDATE contest SET final_figure = $1, revealed_at = now() WHERE id = 1',
      [body!.final_figure],
    );
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* already rolled back */
    }
    throw err;
  } finally {
    client.release();
  }
  const revealed = await agenda.readContest(deps.pool, deps.config.contestClosesAt, { accountId: null });
  return result(200, (req.version === 'v2' ? shape.v2Reveal(revealed) : shape.v1Reveal(revealed)).body);
});

/* ------------------------------------------------------------------ *
 * Utilities used by handlers                                         *
 * ------------------------------------------------------------------ */

function shapeJson(version: Version | null, pair: [shape.Ordered, shape.Ordered]): string {
  return (version === 'v2' ? pair[1] : pair[0]).body;
}

async function sessionExists(deps: RouterDeps, id: string): Promise<boolean> {
  const res = await deps.pool.query('SELECT 1 FROM sessions WHERE id = $1', [id]);
  return res.rows.length > 0;
}

async function isReservable(deps: RouterDeps, id: string): Promise<'ok' | 'not_reservable' | 'missing'> {
  const res = await deps.pool.query('SELECT capacity FROM sessions WHERE id = $1', [id]);
  const row = res.rows[0];
  if (!row) return 'missing';
  return row.capacity === null ? 'not_reservable' : 'ok';
}

/** Does a cursor belong to this session? */
function cursorBelongsTo(cursor: string, sessionId: string): boolean {
  const decoded = agenda.decodeCursor(cursor);
  return decoded !== null && decoded.sessionId === sessionId;
}

/** A CSV cell, neutralising anything a spreadsheet would run as a formula. */
function csvCell(text: string): string {
  let value = text;
  const first = value[0];
  if (first === '=' || first === '+' || first === '-' || first === '@' || first === '\t' || first === '\r') {
    value = `'` + value;
  }
  if (/[",\r\n]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function isoStamp(at: Date): string {
  return at.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Map a booking refusal to its API result, in the version's shape. */
function refusalResult(version: Version | null, err: unknown): ApiResult {
  if (err instanceof Refused) {
    // Only the reused key answers 422; every other booking refusal is 409.
    const status = err.code === 'idempotency_key_reused' ? 422 : 409;
    return apiError(version, new ApiError(err.code, status, '', { extra: err.extra }));
  }
  throw err;
}

/* ------------------------------------------------------------------ *
 * Entry point                                                        *
 * ------------------------------------------------------------------ */

/** Match a path against the route table. */
function matchRoute(method: string, segments: string[], version: Version): { route: Route; params: Record<string, string> } | 'method' | null {
  let sawPath = false;
  for (const r of ROUTES) {
    if (r.versions !== 'both' && !r.versions.includes(version)) continue;
    const params = matchSegments(r.segments, segments);
    if (params === null) continue;
    sawPath = true;
    if (r.method === method) return { route: r, params };
  }
  return sawPath ? 'method' : null;
}

function matchSegments(pattern: string[], actual: string[]): Record<string, string> | null {
  if (pattern.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]!;
    const a = actual[i]!;
    if (p.startsWith('{') && p.endsWith('}')) {
      params[p.slice(1, -1)] = a;
      continue;
    }
    if (p !== a) return null;
  }
  return params;
}

export interface HandleOutcome {
  status: number;
  body: string;
  contentType: string;
  headers: Array<[string, string]>;
}

/**
 * Handle an API request. Steps 1 and 2 (path and method) need no database, so
 * they keep their answers even while the database is not ready.
 */
export async function handleApi(req: ApiRequest, deps: RouterDeps): Promise<HandleOutcome> {
  const version = req.version;
  if (req.unversioned === 'health') {
    if (!deps.ready) return result(503, '{"status":"starting"}');
    return result(200, '{"status":"ok"}');
  }
  if (req.unversioned === 'contract') {
    return result(200, `{"v1":"${digest(v1Manifest())}","v2":"${digest(v2Manifest())}"}`);
  }
  if (version === null || req.relative === null) {
    return failed(version, 'not_found', 404);
  }
  if (req.relative.endsWith('/')) {
    return failed(version, 'not_found', 404);
  }
  const segments = req.relative.slice(1).split('/');
  const matchMethod = req.method === 'HEAD' ? 'GET' : req.method;
  const match = matchRoute(matchMethod, segments, version);
  if (match === 'method') {
    const allowed = allowHeader(segments, version);
    return result(
      405,
      errorBody(version, new ApiError('method_not_allowed', 405)),
      JSON_TYPE,
      [['Allow', allowed]],
    );
  }
  if (match === null) {
    return failed(version, 'not_found', 404);
  }
  if (!deps.ready) {
    return failed(version, 'unavailable', 503);
  }
  if (req.bodyOversize) {
    return failed(version, 'payload_too_large', 413);
  }
  if (req.rawBody !== null && req.rawBody.length > 0 && req.bodyContentType !== 'application/json') {
    return failed(version, 'unsupported_media_type', 415);
  }
  if (req.bodyMalformed) {
    return failed(version, 'invalid', 400);
  }
  // The caller's account, read from the stored token.
  let caller: accounts.Account | null = null;
  if (req.token !== null) {
    caller = await accounts.accountForToken(deps.pool, req.token);
  }
  const params = match.params;
  const withParams: ApiRequest = { ...req, segments: params.id ?? params.slug ?? null };
  const outcome = await match.route.handler(withParams, deps, caller);
  return outcome;
}

/** The Allow header for a known path: its published methods, plus HEAD where GET is listed. */
function allowHeader(segments: string[], version: Version): string {
  const methods = new Set<string>();
  for (const r of ROUTES) {
    if (r.versions !== 'both' && !r.versions.includes(version)) continue;
    if (matchSegments(r.segments, segments) !== null) {
      methods.add(r.method);
      if (r.method === 'GET') methods.add('HEAD');
    }
  }
  return [...methods].sort().join(', ');
}
