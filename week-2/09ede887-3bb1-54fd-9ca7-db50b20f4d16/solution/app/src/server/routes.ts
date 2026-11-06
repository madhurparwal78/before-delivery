import type { IncomingHttpHeaders } from 'node:http';
import { login, logout, signup, type AccountRecord } from './accounts';
import { agendaFilter, listSessions, listSpeakers, listStages, readSession, readSpeaker, sessionExists, sessionsWhere } from './agenda';
import { cancel, claim, joinWaitlist, leaveWaitlist, release, settleEndedHolds, changeCapacity } from './booking';
import { figureFrom, guessFrom, readContest, revealResult, submitGuess } from './contest';
import { contractDigests } from './contract';
import { db } from './db';
import { ApiError, type Version } from './errors';
import { calendarFile } from './ics';
import { idempotencyKey, reserveOnce } from './idempotency';
import { bioFrom, capacityFrom, organiserRows, rosterCsv, rosterPage, rosterRequest, saveBio, type OrganiserRecord } from './organiser';
import * as views from './views';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// public: no token read; optional: a valid token fills caller fields; account: any signed-in
// account; attendee / organiser: that stored role only.
type Access = 'public' | 'optional' | 'account' | 'attendee' | 'organiser';

export interface RequestContext {
  version: Version;
  prefix: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  headers: IncomingHttpHeaders;
  account: AccountRecord | null;
  token: string | null;
}

export type Reply =
  | { status: number; json: unknown; headers?: Record<string, string> }
  | { status: number; raw: string; contentType: string; headers?: Record<string, string> };

export interface Route {
  method: Method;
  path: string;
  versions: readonly Version[];
  access: Access;
  handle: (ctx: RequestContext) => Promise<Reply>;
}

const BOTH = ['v1', 'v2'] as const;
const V2_ONLY = ['v2'] as const;

function ok(json: unknown, status = 200): Reply {
  return { status, json };
}

function caller(ctx: RequestContext): string {
  if (ctx.account === null) throw new ApiError('unauthenticated');
  return ctx.account.id;
}

function param(ctx: RequestContext, name: string): string {
  return ctx.params[name] ?? '';
}

async function requireSession(ctx: RequestContext): Promise<string> {
  const id = param(ctx, 'id');
  if (!(await sessionExists(db, id))) throw new ApiError('not_found');
  return id;
}

async function sessionReply(ctx: RequestContext, id: string): Promise<Reply> {
  const row = await readSession(db, ctx.account?.id ?? null, id);
  if (row === null) throw new ApiError('not_found');
  return ok(ctx.version === 'v1' ? views.v1.session(row) : views.v2.session(row));
}

async function myAgenda(ctx: RequestContext): Promise<Reply> {
  await settleEndedHolds();
  const id = caller(ctx);
  const group = (where: string) => sessionsWhere(db, id, where, []);
  const reserved = await group('EXISTS (SELECT 1 FROM reservations WHERE session_id = s.id AND account_id = $1)');
  const waitlisted = await group('EXISTS (SELECT 1 FROM waitlist_entries WHERE session_id = s.id AND account_id = $1)');
  const saved = await group('EXISTS (SELECT 1 FROM saved_sessions WHERE session_id = s.id AND account_id = $1)');
  if (ctx.version === 'v1') return ok(views.v1.myAgenda({ reserved, waitlisted, saved }));
  const held = await group('EXISTS (SELECT 1 FROM live_holds WHERE session_id = s.id AND account_id = $1)');
  return ok(views.v2.myAgenda({ reserved, held, waitlisted, saved }));
}

async function reservableRow(id: string): Promise<OrganiserRecord> {
  const [row] = await organiserRows(db, id);
  if (row === undefined) throw new ApiError('not_reservable');
  return row;
}

export const ROUTES: readonly Route[] = [
  {
    method: 'POST', path: '/auth/signup', versions: BOTH, access: 'public',
    handle: async (ctx) => {
      const { token, account } = await signup(ctx.body);
      return ok(views.auth(token, account), 201);
    },
  },
  {
    method: 'POST', path: '/auth/login', versions: BOTH, access: 'public',
    handle: async (ctx) => {
      const { token, account } = await login(ctx.body);
      return ok(views.auth(token, account));
    },
  },
  {
    method: 'POST', path: '/auth/logout', versions: BOTH, access: 'account',
    handle: async (ctx) => {
      await logout(ctx.token ?? '');
      return ok({ signed_out: true });
    },
  },
  {
    method: 'GET', path: '/me', versions: BOTH, access: 'account',
    handle: async (ctx) => {
      if (ctx.account === null) throw new ApiError('unauthenticated');
      return ok(views.account(ctx.account));
    },
  },
  {
    method: 'GET', path: '/stages', versions: BOTH, access: 'public',
    handle: async () => ok((await listStages(db)).map(views.stage)),
  },
  {
    method: 'GET', path: '/sessions', versions: BOTH, access: 'optional',
    handle: async (ctx) => {
      await settleEndedHolds();
      const filter = await agendaFilter(db, ctx.query, ctx.version === 'v2');
      const rows = await listSessions(db, ctx.account?.id ?? null, filter);
      return ok(ctx.version === 'v1' ? rows.map(views.v1.session) : rows.map(views.v2.session));
    },
  },
  {
    method: 'GET', path: '/sessions/{id}', versions: BOTH, access: 'optional',
    handle: async (ctx) => {
      await settleEndedHolds();
      return sessionReply(ctx, param(ctx, 'id'));
    },
  },
  {
    method: 'POST', path: '/sessions/{id}/reservation', versions: BOTH, access: 'attendee',
    handle: async (ctx) => {
      const id = await requireSession(ctx);
      const key = idempotencyKey(ctx.headers['idempotency-key']);
      await settleEndedHolds();
      const body = await reserveOnce(caller(ctx), id, ctx.version, key, (created, seats) =>
        ctx.version === 'v1' ? views.v1.reservationCreated(created, seats) : views.v2.reservationCreated(created, seats),
      );
      return { status: 201, raw: body, contentType: 'application/json; charset=utf-8' };
    },
  },
  {
    method: 'DELETE', path: '/sessions/{id}/reservation', versions: BOTH, access: 'attendee',
    handle: async (ctx) => {
      const id = await requireSession(ctx);
      await settleEndedHolds();
      const seats = await cancel(caller(ctx), id);
      return ok(ctx.version === 'v1' ? views.v1.cancelled(seats) : views.v2.cancelled(seats));
    },
  },
  {
    method: 'POST', path: '/sessions/{id}/waitlist', versions: BOTH, access: 'attendee',
    handle: async (ctx) => {
      const id = await requireSession(ctx);
      await settleEndedHolds();
      const joined = await joinWaitlist(caller(ctx), id);
      return ok({ waitlist: views.waitlist({ session_id: id, ...joined }) }, 201);
    },
  },
  {
    method: 'DELETE', path: '/sessions/{id}/waitlist', versions: BOTH, access: 'attendee',
    handle: async (ctx) => {
      const id = await requireSession(ctx);
      await settleEndedHolds();
      await leaveWaitlist(caller(ctx), id);
      return ok({ waitlisted: false });
    },
  },
  {
    method: 'POST', path: '/sessions/{id}/claim', versions: V2_ONLY, access: 'attendee',
    handle: async (ctx) => {
      const id = await requireSession(ctx);
      await settleEndedHolds();
      const { created, seats } = await claim(caller(ctx), id);
      return ok(views.v2.reservationCreated(created, seats), 201);
    },
  },
  {
    method: 'DELETE', path: '/sessions/{id}/hold', versions: V2_ONLY, access: 'attendee',
    handle: async (ctx) => {
      const id = await requireSession(ctx);
      await settleEndedHolds();
      await release(caller(ctx), id);
      return ok({ held: false });
    },
  },
  {
    method: 'PUT', path: '/sessions/{id}/save', versions: BOTH, access: 'attendee',
    handle: async (ctx) => {
      const id = await requireSession(ctx);
      await db.query(
        'INSERT INTO saved_sessions (account_id, session_id) VALUES ($1, $2) ON CONFLICT (account_id, session_id) DO NOTHING',
        [caller(ctx), id],
      );
      return ok({ saved: true });
    },
  },
  {
    method: 'DELETE', path: '/sessions/{id}/save', versions: BOTH, access: 'attendee',
    handle: async (ctx) => {
      const id = await requireSession(ctx);
      await db.query('DELETE FROM saved_sessions WHERE account_id = $1 AND session_id = $2', [caller(ctx), id]);
      return ok({ saved: false });
    },
  },
  { method: 'GET', path: '/me/agenda', versions: BOTH, access: 'attendee', handle: myAgenda },
  {
    method: 'GET', path: '/me/holds', versions: V2_ONLY, access: 'attendee',
    handle: async (ctx) => {
      await settleEndedHolds();
      const holds = await db.query<{ session_id: string; held_until: string; seconds_remaining: number }>(
        `SELECT session_id, iso(held_until) AS held_until,
                GREATEST(0, floor(extract(epoch FROM held_until - clock_timestamp())))::int AS seconds_remaining
           FROM live_holds WHERE account_id = $1 ORDER BY held_until, session_id`,
        [caller(ctx)],
      );
      return ok(holds.rows.map(views.v2.hold));
    },
  },
  {
    method: 'GET', path: '/speakers', versions: BOTH, access: 'public',
    handle: async (ctx) => {
      const speakers = await listSpeakers(db);
      return ok(ctx.version === 'v1' ? speakers.map(views.v1.speaker) : speakers.map(views.v2.speaker));
    },
  },
  {
    method: 'GET', path: '/agenda.ics', versions: BOTH, access: 'public',
    handle: async (ctx) => {
      const filter = await agendaFilter(db, ctx.query, ctx.version === 'v2');
      const rows = await listSessions(db, null, filter);
      if (rows.length === 0) throw new ApiError('no_sessions');
      const events = rows.map((row) => ({
        id: row.id,
        title: row.title,
        where: row.stage_name ?? row.location ?? '',
        start: new Date(row.start_instant),
        end: new Date(row.end_instant),
      }));
      return {
        status: 200,
        raw: calendarFile(events, new Date()),
        contentType: 'text/calendar; charset=utf-8',
        headers: { 'Content-Disposition': 'attachment; filename="keel-outpost-agenda.ics"' },
      };
    },
  },
  {
    method: 'GET', path: '/organiser/sessions', versions: BOTH, access: 'organiser',
    handle: async (ctx) => {
      await settleEndedHolds();
      const rows = await organiserRows(db);
      return ok(ctx.version === 'v1' ? rows.map(views.v1.organiserRow) : rows.map(views.v2.organiserRow));
    },
  },
  {
    method: 'GET', path: '/organiser/sessions/{id}/roster', versions: BOTH, access: 'organiser',
    handle: async (ctx) => {
      const id = await requireSession(ctx);
      const request = rosterRequest(id, ctx.query);
      await reservableRow(id);
      await settleEndedHolds();
      const page = await rosterPage(db, id, request);
      const headers: Record<string, string> = {};
      if (page.nextCursor !== null) {
        headers.Link = `<${ctx.prefix}/organiser/sessions/${id}/roster?limit=${request.limit}&cursor=${page.nextCursor}>; rel="next"`;
      }
      return { status: 200, json: page.rows.map(views.rosterRow), headers };
    },
  },
  {
    method: 'GET', path: '/organiser/sessions/{id}/roster.csv', versions: BOTH, access: 'organiser',
    handle: async (ctx) => {
      const id = await requireSession(ctx);
      await reservableRow(id);
      await settleEndedHolds();
      return {
        status: 200,
        raw: await rosterCsv(db, id),
        contentType: 'text/csv; charset=utf-8',
        headers: { 'Content-Disposition': `attachment; filename="roster-${id}.csv"` },
      };
    },
  },
  {
    method: 'PATCH', path: '/organiser/sessions/{id}', versions: BOTH, access: 'organiser',
    handle: async (ctx) => {
      const id = await requireSession(ctx);
      const capacity = capacityFrom(ctx.body);
      await settleEndedHolds();
      await changeCapacity(id, capacity);
      const row = await reservableRow(id);
      return ok(ctx.version === 'v1' ? views.v1.organiserRow(row) : views.v2.organiserRow(row));
    },
  },
  {
    method: 'PUT', path: '/organiser/speakers/{slug}/bio', versions: V2_ONLY, access: 'organiser',
    handle: async (ctx) => {
      const speaker = await readSpeaker(db, param(ctx, 'slug'));
      if (speaker === null) throw new ApiError('not_found');
      const bio = bioFrom(ctx.body);
      await saveBio(db, speaker.slug, bio);
      return ok(views.v2.speaker({ ...speaker, bio }));
    },
  },
  {
    method: 'GET', path: '/record', versions: BOTH, access: 'optional',
    handle: async (ctx) => ok(views.record(await readContest(db, ctx.account?.id ?? null))),
  },
  {
    method: 'POST', path: '/record/guesses', versions: BOTH, access: 'attendee',
    handle: async (ctx) => {
      const value = guessFrom(ctx.body);
      return ok({ guess: views.guess(await submitGuess(caller(ctx), value)) }, 201);
    },
  },
  {
    method: 'POST', path: '/organiser/record/reveal', versions: BOTH, access: 'organiser',
    handle: async (ctx) => ok(views.reveal(await revealResult(figureFrom(ctx.body)))),
  },
];

export const CONTRACT = contractDigests(ROUTES);
