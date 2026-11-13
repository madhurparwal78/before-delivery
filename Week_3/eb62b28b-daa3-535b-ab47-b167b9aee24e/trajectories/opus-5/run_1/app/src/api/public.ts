import { findMember } from '../data';
import { newId, query, queryOne } from '../db';
import { ApiError, conflict, invalid, notFound } from '../http/errors';
import { Route, defineRoute, jsonBody, person } from '../http/kernel';
import {
  endOtherSessions,
  endSession,
  hashPassword,
  homeRoute,
  passwordMatches,
  sessionCookie,
  clearedCookie,
  startSession,
  Role,
} from '../http/sessions';
import {
  CATEGORIES,
  MARKERS,
  STATES,
  markerMatchesSearch,
  stateName,
  stateServed,
} from '../shared/catalog';
import { copy } from '../shared/copy';
import { CADENCE_MONTHS, Cadence, perMonthCents, plusPriceCents } from '../shared/money';
import { PRACTICE_ZONE, instantToIso, localDate, parseDateOnly } from '../shared/time';
import { FieldErrors, readAccountInput, validPassword } from './validate';
import { memberView } from './views';
import { membershipOf } from '../services/memberships';

const CADENCES: Cadence[] = ['sixMonths', 'yearly'];

function practiceToday(): { year: number; month: number; day: number } {
  const parsed = parseDateOnly(localDate(new Date(), PRACTICE_ZONE));
  if (!parsed) throw new Error('Bad practice date');
  return parsed;
}

export const publicRoutes: Route[] = [
  defineRoute({
    method: 'GET',
    path: '/api/health',
    access: 'public',
    handler: async () => ({ status: 200, json: { status: 'ok' } }),
  }),
  defineRoute({
    method: 'GET',
    path: '/api/plans',
    access: 'public',
    handler: async () => ({
      status: 200,
      json: {
        plans: [
          { id: 'free', name: 'Free', prices: [] },
          {
            id: 'plus',
            name: 'Plus',
            prices: CADENCES.map((cadence) => ({
              cadence,
              months: CADENCE_MONTHS[cadence],
              amountCents: plusPriceCents(cadence),
              perMonthCents: perMonthCents(cadence),
            })),
          },
        ],
      },
    }),
  }),
  defineRoute({
    method: 'GET',
    path: '/api/states',
    access: 'public',
    handler: async () => ({
      status: 200,
      json: {
        states: STATES.map((entry) => ({
          state: entry.state,
          name: entry.name,
          served: stateServed(entry.state),
        })),
      },
    }),
  }),
  defineRoute({
    method: 'GET',
    path: '/api/states/:code',
    access: 'public',
    resolve: async (ctx) => {
      const code = (ctx.params.code ?? '').toLowerCase();
      const entry = STATES.find((state) => state.state === code);
      if (!entry) throw notFound();
      return entry;
    },
    handler: async (_ctx, entry) => ({
      status: 200,
      json: {
        state: entry.state,
        name: entry.name,
        served: stateServed(entry.state),
        message: stateServed(entry.state)
          ? copy.stateServed(entry.name)
          : copy.stateNotServed(entry.name),
      },
    }),
  }),
  defineRoute({
    method: 'GET',
    path: '/api/markers',
    access: 'public',
    handler: async (ctx) => {
      const search = ctx.query.get('q') ?? '';
      const categories = CATEGORIES.map((category) => ({
        id: category.id,
        name: category.name,
        markers: MARKERS.filter(
          (marker) => marker.category === category.id && markerMatchesSearch(marker, search),
        ).map((marker) => ({
          id: marker.id,
          name: marker.name,
          unit: marker.unit,
          decimals: marker.decimals,
        })),
      })).filter((category) => category.markers.length > 0);
      return { status: 200, json: { categories } };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/accounts',
    access: 'public',
    handler: async (ctx) => {
      const body = jsonBody<Record<string, unknown>>(ctx);
      const errors = new FieldErrors();
      const input = readAccountInput(body, practiceToday(), errors);
      errors.throwIfAny();
      if (!input) throw invalid({ name: copy.fieldName });
      const taken = await queryOne<{ id: string }>(
        'select id from members where lower(email) = lower($1)',
        [input.email],
      );
      const takenStaff = await queryOne<{ id: string }>(
        'select id from staff where lower(email) = lower($1) and removed_at is null',
        [input.email],
      );
      if (taken || takenStaff) throw conflict('email_taken', copy.emailTaken);
      const id = newId();
      await query(
        `insert into members (id, name, email, password_hash, date_of_birth, sex, state, time_zone)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          input.name,
          input.email,
          hashPassword(input.password),
          input.dateOfBirth,
          input.sex,
          input.state,
          input.timeZone,
        ],
      );
      const membership = await membershipOf(id);
      const member = await findMember(id);
      if (!member) throw new Error('Member vanished after create');
      const session = await startSession({
        kind: 'member',
        id,
        name: input.name,
        role: 'member',
      });
      return {
        status: 201,
        json: { member: memberView(member, membership) },
        headers: { 'Set-Cookie': sessionCookie(session.id) },
      };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/session',
    access: 'public',
    handler: async (ctx) => {
      const body = jsonBody<{ email?: unknown; password?: unknown }>(ctx);
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const signInFailed = new ApiError(401, 'sign_in_failed', copy.signInFailed);
      const staff = await queryOne<{
        id: string;
        name: string;
        role: Role;
        password_hash: string;
      }>(
        'select id, name, role, password_hash from staff where lower(email) = lower($1) and removed_at is null',
        [email],
      );
      if (staff) {
        if (!passwordMatches(password, staff.password_hash)) throw signInFailed;
        const session = await startSession({
          kind: 'staff',
          id: staff.id,
          name: staff.name,
          role: staff.role,
        });
        return {
          status: 200,
          json: {
            user: { id: staff.id, name: staff.name, role: staff.role },
            home: homeRoute[staff.role],
          },
          headers: { 'Set-Cookie': sessionCookie(session.id) },
        };
      }
      const member = await queryOne<{
        id: string;
        name: string | null;
        password_hash: string | null;
        account_state: string;
      }>(
        'select id, name, password_hash, account_state from members where lower(email) = lower($1)',
        [email],
      );
      if (!member || member.account_state === 'erased' || member.account_state === 'erasing') {
        throw signInFailed;
      }
      if (!passwordMatches(password, member.password_hash)) throw signInFailed;
      const session = await startSession({
        kind: 'member',
        id: member.id,
        name: member.name ?? '',
        role: 'member',
      });
      return {
        status: 200,
        json: {
          user: { id: member.id, name: member.name, role: 'member' },
          home: homeRoute.member,
        },
        headers: { 'Set-Cookie': sessionCookie(session.id) },
      };
    },
  }),
  defineRoute({
    method: 'GET',
    path: '/api/session',
    access: 'any',
    handler: async (ctx) => {
      const session = ctx.session;
      if (!session) throw new Error('Session missing after the auth rung');
      return {
        status: 200,
        json: {
          user: {
            id: session.person.id,
            name: session.person.name,
            role: session.person.role,
          },
          home: homeRoute[session.person.role],
          expiresAt: instantToIso(session.expiresAt),
        },
      };
    },
  }),
  defineRoute({
    method: 'DELETE',
    path: '/api/session',
    access: 'any',
    handler: async (ctx) => {
      if (ctx.session) await endSession(ctx.session.id);
      return { status: 204, headers: { 'Set-Cookie': clearedCookie() } };
    },
  }),
  defineRoute({
    method: 'POST',
    path: '/api/me/password',
    access: 'any',
    handler: async (ctx) => {
      const body = jsonBody<{ currentPassword?: unknown; newPassword?: unknown }>(ctx);
      const who = person(ctx);
      const errors = new FieldErrors();
      const newPassword = validPassword(body.newPassword);
      if (!newPassword) errors.add('newPassword', copy.fieldPassword);
      const table = who.kind === 'staff' ? 'staff' : 'members';
      const stored = await queryOne<{ password_hash: string | null }>(
        `select password_hash from ${table} where id = $1`,
        [who.id],
      );
      const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
      if (!passwordMatches(current, stored?.password_hash ?? null)) {
        errors.add('currentPassword', copy.fieldCurrentPassword);
      }
      errors.throwIfAny();
      await query(`update ${table} set password_hash = $2 where id = $1`, [
        who.id,
        hashPassword(newPassword as string),
      ]);
      if (ctx.session) await endOtherSessions(who, ctx.session.id);
      return { status: 204 };
    },
  }),
];
