import type { IncomingHttpHeaders } from 'node:http';
import type { Account } from '../db/accounts.js';
import type { Accounts } from '../db/accounts.js';
import type { BookingStore } from '../db/booking.js';
import type { Contest } from '../db/contest.js';
import type { IdempotencyKeys } from '../db/idempotency.js';
import { isWellFormedKey } from '../db/idempotency.js';
import type { Reads, Session } from '../db/reads.js';
import { buildCalendar } from '../domain/calendar.js';
import { buildCsv } from '../domain/csv.js';
import { matchesQuery, parseQuery } from '../domain/search.js';
import {
  FIELD_MESSAGES,
  conflict,
  forbidden,
  invalidFilter,
  invalidIdempotencyKey,
  noSessions,
  notFoundSession,
  notFoundSpeaker,
  unauthenticated,
  validationFailed,
} from '../http/errors.js';
import { FORMAT_LABELS, type ApiVersion } from './versions.js';
import * as shape from './shapes.js';
import type { Json } from './shapes.js';

export type AuthLevel = 'none' | 'optional' | 'bearer' | 'attendee' | 'organiser';

export interface Services {
  readonly accounts: Accounts;
  readonly reads: Reads;
  readonly booking: BookingStore;
  readonly contest: Contest;
  readonly idempotency: IdempotencyKeys;
}

export interface RequestContext {
  readonly version: ApiVersion;
  readonly prefix: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly body: Json | undefined;
  readonly account: Account | null;
  readonly token: string | null;
  readonly headers: IncomingHttpHeaders;
}

export interface ApiResponse {
  readonly status: number;
  readonly json?: Json;
  readonly text?: string;
  readonly contentType?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface RouteDefinition {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly v1: boolean;
  readonly v2: boolean;
  readonly auth: AuthLevel;
  /** Checked at precedence step 9, before anything the handler does. */
  readonly resource?: 'session' | 'speaker';
  readonly settles?: true;
  readonly handle: (services: Services, context: RequestContext) => Promise<ApiResponse>;
}

function requireAccount(context: RequestContext): Account {
  if (context.account === null) throw unauthenticated();
  return context.account;
}

function bodyObject(context: RequestContext): Readonly<Record<string, Json>> {
  const { body } = context;
  if (body === undefined || body === null || typeof body !== 'object' || Array.isArray(body)) return {};
  return body;
}

function wholeNumberField(
  value: Json | undefined,
  field: string,
  low: number,
  high: number,
  message: string,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < low || value > high) {
    throw validationFailed({ [field]: message });
  }
  return value;
}

const NAME_PATTERN = /^[^\r\n]{1,80}$/;

function validateSignup(body: Readonly<Record<string, Json>>): {
  name: string;
  email: string;
  password: string;
} {
  const fields: Record<string, string> = {};
  const rawName = body['name'];
  const rawEmail = body['email'];
  const rawPassword = body['password'];
  const name = typeof rawName === 'string' ? rawName : '';
  if (!NAME_PATTERN.test(name) || name.trim() === '') fields['name'] = FIELD_MESSAGES.name;
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  if (!isEmail(email)) fields['email'] = FIELD_MESSAGES.email;
  const password = typeof rawPassword === 'string' ? rawPassword : '';
  if (password.length < 8 || password.length > 200) fields['password'] = FIELD_MESSAGES.signupPassword;
  if (Object.keys(fields).length > 0) throw validationFailed(fields);
  return { name, email, password };
}

function isEmail(email: string): boolean {
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) return false;
  const domain = email.slice(at + 1);
  return domain.includes('.') && !/\s/.test(email);
}

interface SessionFilter {
  readonly day: '1' | '2' | 'all';
  readonly stage: string;
  readonly format: string;
  readonly search: string;
}

async function readFilter(services: Services, context: RequestContext): Promise<SessionFilter> {
  const day = context.query.get('day') ?? 'all';
  const stage = context.query.get('stage') ?? 'all';
  const format = context.query.get('format') ?? 'all';
  if (day !== '1' && day !== '2' && day !== 'all') throw invalidFilter();
  if (stage !== 'all' && !(await services.reads.stages()).some((candidate) => candidate.slug === stage)) {
    throw invalidFilter();
  }
  if (format !== 'all' && FORMAT_LABELS[format] === undefined) throw invalidFilter();
  const search = context.version === 'v2' ? context.query.get('q') ?? '' : '';
  if ([...search].length > 2048) throw validationFailed({ q: FIELD_MESSAGES.search });
  return { day, stage, format, search };
}

function applyFilter(sessions: readonly Session[], filter: SessionFilter): Session[] {
  const query = filter.search === '' ? null : parseQuery(filter.search);
  return sessions.filter((session) => {
    if (filter.day !== 'all' && String(session.day) !== filter.day) return false;
    if (filter.stage !== 'all' && session.stage !== filter.stage) return false;
    if (filter.format !== 'all' && session.format !== filter.format) return false;
    return query === null || matchesQuery(query, session.foldedFields);
  });
}

function cursorToken(createdKey: string, id: number, sessionId: string): string {
  return Buffer.from(JSON.stringify({ s: sessionId, t: createdKey, i: id }), 'utf8').toString('base64url');
}

function readCursor(raw: string, sessionId: string): { createdAt: string; id: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw validationFailed({ cursor: FIELD_MESSAGES.cursor });
  }
  if (parsed === null || typeof parsed !== 'object') throw validationFailed({ cursor: FIELD_MESSAGES.cursor });
  const value = parsed as { s?: unknown; t?: unknown; i?: unknown };
  if (typeof value.s !== 'string' || typeof value.t !== 'string' || typeof value.i !== 'number') {
    throw validationFailed({ cursor: FIELD_MESSAGES.cursor });
  }
  if (value.s !== sessionId) throw validationFailed({ cursor: FIELD_MESSAGES.cursor });
  return { createdAt: value.t, id: value.i };
}

function rosterLimit(context: RequestContext): number {
  const raw = context.query.get('limit');
  if (raw === null) return 50;
  if (!/^\d+$/.test(raw)) throw validationFailed({ limit: FIELD_MESSAGES.limit });
  const limit = Number(raw);
  if (limit < 1 || limit > 100) throw validationFailed({ limit: FIELD_MESSAGES.limit });
  return limit;
}

async function reservableSession(services: Services, id: string): Promise<void> {
  const found = await services.reads.sessionCapacity(id);
  if (found.capacity === null) throw conflict('not_reservable');
}

const ROUTES: readonly RouteDefinition[] = [
  {
    method: 'POST',
    path: '/auth/signup',
    v1: true,
    v2: true,
    auth: 'none',
    handle: async (services, context) => {
      const { name, email, password } = validateSignup(bodyObject(context));
      const created = await services.accounts.signup(name, email, password);
      return { status: 201, json: shape.authV1(created.token, created.account) };
    },
  },
  {
    method: 'POST',
    path: '/auth/login',
    v1: true,
    v2: true,
    auth: 'none',
    handle: async (services, context) => {
      const body = bodyObject(context);
      const rawEmail = body['email'];
      const rawPassword = body['password'];
      const fields: Record<string, string> = {};
      if (typeof rawEmail !== 'string' || rawEmail.trim() === '') fields['email'] = FIELD_MESSAGES.email;
      if (typeof rawPassword !== 'string' || rawPassword === '') fields['password'] = FIELD_MESSAGES.signinPassword;
      if (Object.keys(fields).length > 0) throw validationFailed(fields);
      const signedIn = await services.accounts.login(
        (rawEmail as string).trim().toLowerCase(),
        rawPassword as string,
      );
      return { status: 200, json: shape.authV1(signedIn.token, signedIn.account) };
    },
  },
  {
    method: 'POST',
    path: '/auth/logout',
    v1: true,
    v2: true,
    auth: 'bearer',
    handle: async (services, context) => {
      await services.accounts.logout(context.token as string);
      return { status: 200, json: shape.signedOut() };
    },
  },
  {
    method: 'GET',
    path: '/me',
    v1: true,
    v2: true,
    auth: 'bearer',
    handle: async (_services, context) => ({ status: 200, json: shape.accountV1(requireAccount(context)) }),
  },
  {
    method: 'GET',
    path: '/stages',
    v1: true,
    v2: true,
    auth: 'none',
    handle: async (services) => ({
      status: 200,
      json: (await services.reads.stages()).map(shape.stageV1),
    }),
  },
  {
    method: 'GET',
    path: '/sessions',
    v1: true,
    v2: true,
    auth: 'optional',
    settles: true,
    handle: async (services, context) => {
      const filter = await readFilter(services, context);
      const sessions = applyFilter(await services.reads.sessions(context.account?.id ?? null), filter);
      return {
        status: 200,
        json: sessions.map(context.version === 'v1' ? shape.sessionV1 : shape.sessionV2),
      };
    },
  },
  {
    method: 'GET',
    path: '/sessions/{id}',
    v1: true,
    v2: true,
    auth: 'optional',
    resource: 'session',
    settles: true,
    handle: async (services, context) => {
      const session = await services.reads.session(context.params['id'] as string, context.account?.id ?? null);
      if (session === null) throw notFoundSession();
      return { status: 200, json: context.version === 'v1' ? shape.sessionV1(session) : shape.sessionV2(session) };
    },
  },
  {
    method: 'POST',
    path: '/sessions/{id}/reservation',
    v1: true,
    v2: true,
    auth: 'attendee',
    resource: 'session',
    settles: true,
    handle: async (services, context) => {
      const account = requireAccount(context);
      const sessionId = context.params['id'] as string;
      const header = context.headers['idempotency-key'];
      if (Array.isArray(header)) throw invalidIdempotencyKey();
      const key = header ?? null;
      if (key !== null && !isWellFormedKey(key)) throw invalidIdempotencyKey();
      if (key === null) {
        const stored = await services.booking.reserve(account.id, sessionId, async () => undefined);
        return { status: 201, json: reservationCreated(context.version, stored) };
      }
      const claim = await services.idempotency.claim(account.id, key, context.version, sessionId);
      if (claim.kind === 'replay') return { status: claim.status, text: claim.body, contentType: JSON_TYPE };
      try {
        const stored = await services.booking.reserve(account.id, sessionId, async (tx, reservation, seats) => {
          const body = JSON.stringify(reservationCreated(context.version, { reservation, seats }));
          await services.idempotency.record(tx, account.id, key, 201, body);
        });
        return { status: 201, json: reservationCreated(context.version, stored) };
      } catch (error) {
        await services.idempotency.release(account.id, key);
        throw error;
      }
    },
  },
  {
    method: 'DELETE',
    path: '/sessions/{id}/reservation',
    v1: true,
    v2: true,
    auth: 'attendee',
    resource: 'session',
    settles: true,
    handle: async (services, context) => {
      const account = requireAccount(context);
      const seats = await services.booking.cancel(account.id, context.params['id'] as string);
      return {
        status: 200,
        json: context.version === 'v1' ? shape.cancelledV1(seats) : shape.cancelledV2(seats),
      };
    },
  },
  {
    method: 'POST',
    path: '/sessions/{id}/waitlist',
    v1: true,
    v2: true,
    auth: 'attendee',
    resource: 'session',
    settles: true,
    handle: async (services, context) => {
      const account = requireAccount(context);
      const entry = await services.booking.joinWaitlist(account.id, context.params['id'] as string);
      return { status: 201, json: shape.waitlistJoined(entry) };
    },
  },
  {
    method: 'DELETE',
    path: '/sessions/{id}/waitlist',
    v1: true,
    v2: true,
    auth: 'attendee',
    resource: 'session',
    settles: true,
    handle: async (services, context) => {
      const account = requireAccount(context);
      await services.booking.leaveWaitlist(account.id, context.params['id'] as string);
      return { status: 200, json: shape.waitlistLeft() };
    },
  },
  {
    method: 'POST',
    path: '/sessions/{id}/claim',
    v1: false,
    v2: true,
    auth: 'attendee',
    resource: 'session',
    settles: true,
    handle: async (services, context) => {
      const account = requireAccount(context);
      const stored = await services.booking.claim(account.id, context.params['id'] as string);
      return { status: 201, json: shape.reservationCreatedV2(stored.reservation, stored.seats) };
    },
  },
  {
    method: 'DELETE',
    path: '/sessions/{id}/hold',
    v1: false,
    v2: true,
    auth: 'attendee',
    resource: 'session',
    settles: true,
    handle: async (services, context) => {
      const account = requireAccount(context);
      await services.booking.release(account.id, context.params['id'] as string);
      return { status: 200, json: shape.releasedV2() };
    },
  },
  {
    method: 'PUT',
    path: '/sessions/{id}/save',
    v1: true,
    v2: true,
    auth: 'attendee',
    resource: 'session',
    handle: async (services, context) => {
      const account = requireAccount(context);
      await services.reads.setSaved(account.id, context.params['id'] as string, true);
      return { status: 200, json: shape.savedShape(true) };
    },
  },
  {
    method: 'DELETE',
    path: '/sessions/{id}/save',
    v1: true,
    v2: true,
    auth: 'attendee',
    resource: 'session',
    handle: async (services, context) => {
      const account = requireAccount(context);
      await services.reads.setSaved(account.id, context.params['id'] as string, false);
      return { status: 200, json: shape.savedShape(false) };
    },
  },
  {
    method: 'GET',
    path: '/me/agenda',
    v1: true,
    v2: true,
    auth: 'attendee',
    settles: true,
    handle: async (services, context) => {
      const account = requireAccount(context);
      const reserved = await services.reads.sessionsForAgenda(account.id, 'reserved');
      const waitlisted = await services.reads.sessionsForAgenda(account.id, 'waitlisted');
      const saved = await services.reads.sessionsForAgenda(account.id, 'saved');
      if (context.version === 'v1') {
        return { status: 200, json: shape.myAgendaV1(reserved, waitlisted, saved) };
      }
      const held = await services.reads.sessionsForAgenda(account.id, 'held');
      return { status: 200, json: shape.myAgendaV2(reserved, held, waitlisted, saved) };
    },
  },
  {
    method: 'GET',
    path: '/me/holds',
    v1: false,
    v2: true,
    auth: 'attendee',
    settles: true,
    handle: async (services, context) => {
      const account = requireAccount(context);
      return { status: 200, json: (await services.reads.holds(account.id)).map(shape.holdV2) };
    },
  },
  {
    method: 'GET',
    path: '/speakers',
    v1: true,
    v2: true,
    auth: 'none',
    handle: async (services, context) => ({
      status: 200,
      json: (await services.reads.speakers()).map(context.version === 'v1' ? shape.speakerV1 : shape.speakerV2),
    }),
  },
  {
    method: 'GET',
    path: '/agenda.ics',
    v1: true,
    v2: true,
    auth: 'none',
    settles: true,
    handle: async (services, context) => {
      const filter = await readFilter(services, context);
      const sessions = applyFilter(await services.reads.sessions(null), filter);
      if (sessions.length === 0) throw noSessions();
      const calendar = buildCalendar(
        sessions.map((session) => ({
          id: session.id,
          startInstant: session.start_instant,
          endInstant: session.end_instant,
          title: session.title,
          locationName: session.stage_name ?? session.location ?? '',
        })),
        new Date(),
      );
      return {
        status: 200,
        text: calendar,
        contentType: 'text/calendar; charset=utf-8',
        headers: { 'Content-Disposition': 'attachment; filename="keel-outpost-agenda.ics"' },
      };
    },
  },
  {
    method: 'GET',
    path: '/organiser/sessions',
    v1: true,
    v2: true,
    auth: 'organiser',
    settles: true,
    handle: async (services, context) => ({
      status: 200,
      json: (await services.reads.organiserRows()).map(
        context.version === 'v1' ? shape.organiserRowV1 : shape.organiserRowV2,
      ),
    }),
  },
  {
    method: 'GET',
    path: '/organiser/sessions/{id}/roster',
    v1: true,
    v2: true,
    auth: 'organiser',
    resource: 'session',
    settles: true,
    handle: async (services, context) => {
      const sessionId = context.params['id'] as string;
      const limit = rosterLimit(context);
      const rawCursor = context.query.get('cursor');
      const cursor = rawCursor === null ? null : readCursor(rawCursor, sessionId);
      await reservableSession(services, sessionId);
      const rows = await services.reads.roster(sessionId, limit + 1, cursor);
      const page = rows.slice(0, limit);
      const headers: Record<string, string> = {};
      const last = page[page.length - 1];
      if (rows.length > limit && last !== undefined) {
        const next = cursorToken(last.reserved_key, last.id, sessionId);
        headers['Link'] =
          `<${context.prefix}/organiser/sessions/${sessionId}/roster?limit=${limit}&cursor=${next}>; rel="next"`;
      }
      return { status: 200, json: page.map(shape.rosterRow), headers };
    },
  },
  {
    method: 'GET',
    path: '/organiser/sessions/{id}/roster.csv',
    v1: true,
    v2: true,
    auth: 'organiser',
    resource: 'session',
    settles: true,
    handle: async (services, context) => {
      const sessionId = context.params['id'] as string;
      await reservableSession(services, sessionId);
      const rows = await services.reads.roster(sessionId, Number.MAX_SAFE_INTEGER, null);
      const csv = buildCsv(
        ['name', 'email', 'reserved_at'],
        rows.map((row) => [row.name, row.email, row.reserved_at.toISOString()]),
      );
      return {
        status: 200,
        text: csv,
        contentType: 'text/csv; charset=utf-8',
        headers: { 'Content-Disposition': `attachment; filename="roster-${sessionId}.csv"` },
      };
    },
  },
  {
    method: 'PATCH',
    path: '/organiser/sessions/{id}',
    v1: true,
    v2: true,
    auth: 'organiser',
    resource: 'session',
    settles: true,
    handle: async (services, context) => {
      const sessionId = context.params['id'] as string;
      const capacity = wholeNumberField(
        bodyObject(context)['capacity'],
        'capacity',
        1,
        500,
        FIELD_MESSAGES.capacity,
      );
      await services.booking.setCapacity(sessionId, capacity);
      const row = await services.reads.organiserRow(sessionId);
      if (row === null) throw notFoundSession();
      return {
        status: 200,
        json: context.version === 'v1' ? shape.organiserRowV1(row) : shape.organiserRowV2(row),
      };
    },
  },
  {
    method: 'PUT',
    path: '/organiser/speakers/{slug}/bio',
    v1: false,
    v2: true,
    auth: 'organiser',
    resource: 'speaker',
    handle: async (services, context) => {
      const slug = context.params['slug'] as string;
      const raw = bodyObject(context)['bio'];
      if (typeof raw !== 'string' || [...raw].length > 2000) throw validationFailed({ bio: FIELD_MESSAGES.bio });
      await services.reads.saveSpeakerBio(slug, raw);
      const speaker = await services.reads.speaker(slug);
      if (speaker === null) throw notFoundSpeaker();
      return { status: 200, json: shape.speakerV2(speaker) };
    },
  },
  {
    method: 'GET',
    path: '/record',
    v1: true,
    v2: true,
    auth: 'optional',
    handle: async (services, context) => ({
      status: 200,
      json: shape.recordShape(await services.contest.state(context.account?.id ?? null)),
    }),
  },
  {
    method: 'POST',
    path: '/record/guesses',
    v1: true,
    v2: true,
    auth: 'attendee',
    handle: async (services, context) => {
      const account = requireAccount(context);
      const value = wholeNumberField(bodyObject(context)['value'], 'value', 1, 100_000_000, FIELD_MESSAGES.guess);
      return { status: 201, json: shape.guessCreated(await services.contest.submitGuess(account.id, value)) };
    },
  },
  {
    method: 'POST',
    path: '/organiser/record/reveal',
    v1: true,
    v2: true,
    auth: 'organiser',
    handle: async (services, context) => {
      const figure = wholeNumberField(
        bodyObject(context)['final_figure'],
        'final_figure',
        1,
        100_000_000,
        FIELD_MESSAGES.guess,
      );
      return { status: 200, json: shape.revealShape(await services.contest.reveal(figure)) };
    },
  },
];

const JSON_TYPE = 'application/json; charset=utf-8';

function reservationCreated(
  version: ApiVersion,
  stored: { readonly reservation: Parameters<typeof shape.reservationCreatedV1>[0]; readonly seats: Parameters<typeof shape.reservationCreatedV1>[1] },
): Json {
  return version === 'v1'
    ? shape.reservationCreatedV1(stored.reservation, stored.seats)
    : shape.reservationCreatedV2(stored.reservation, stored.seats);
}

export function routesFor(version: ApiVersion): readonly RouteDefinition[] {
  return ROUTES.filter((route) => (version === 'v1' ? route.v1 : route.v2));
}

export function checkRole(route: RouteDefinition, account: Account | null, token: string | null): void {
  if (route.auth === 'none' || route.auth === 'optional') return;
  if (token === null || account === null) throw unauthenticated();
  if (route.auth === 'attendee' && account.role !== 'attendee') throw forbidden();
  if (route.auth === 'organiser' && account.role !== 'organiser') throw forbidden();
}

export { ROUTES };
