import { SESSION_COOKIE } from '../config';
import { HOUSE_NAME, ROLE_HOME } from '../../shared/roles';
import { honouredNext } from '../../shared/returnaddress';
import { CLEARANCE_MM } from '../../shared/bays';
import { LABOUR_RATE_LABEL, VAT_RATE_LABEL } from '../../shared/money';
import {
  DISTANCE_UNITS,
  FILM_UNITS,
  PRESSURE_UNITS,
  type DistanceUnit,
  type FilmUnit,
  type PressureUnit,
} from '../../shared/units';
import { query } from '../db';
import { VALIDATION_MESSAGES, fail, type FieldErrors } from '../http/errors';
import { readCookie, type Route } from '../http/pipeline';
import { serviceStatus } from '../providers/status';
import { signIn, signOut } from '../domain/session';

/** The cookie outlives the session so the server, not the browser, reports the expiry. */
function cookieHeader(sessionId: string): Record<string, string> {
  return {
    'set-cookie': `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax`,
  };
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const sessionRoutes: readonly Route[] = [
  {
    method: 'GET',
    pattern: '/api/health',
    body: 'none',
    session: 'public',
    async handle() {
      return { kind: 'json', status: 200, body: { status: 'ok' } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/status',
    body: 'none',
    session: 'public',
    async handle() {
      return { kind: 'json', status: 200, body: await serviceStatus() };
    },
  },
  {
    method: 'POST',
    pattern: '/api/session',
    body: 'json',
    session: 'public',
    async handle(ctx) {
      const email = textOf(ctx.body.email);
      const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
      if (email === '' || password === '') {
        throw fail.validation({
          email: VALIDATION_MESSAGES.credentials,
          password: VALIDATION_MESSAGES.credentials,
        });
      }
      const session = await signIn(email, password);
      if (session === null) throw fail.invalidCredentials();
      const next = typeof ctx.body.next === 'string' ? ctx.body.next : null;
      const redirect = honouredNext(next) ?? ROLE_HOME[session.user.role];
      return {
        kind: 'json',
        status: 200,
        body: { user: session.user, redirect },
        headers: cookieHeader(session.sessionId),
      };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/session',
    body: 'none',
    session: 'required',
    async handle(ctx) {
      const sessionId = readCookie(ctx.request, SESSION_COOKIE);
      if (sessionId !== null) await signOut(sessionId);
      return {
        kind: 'empty',
        status: 204,
        headers: { 'set-cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` },
      };
    },
  },
  {
    method: 'GET',
    pattern: '/api/me',
    body: 'none',
    session: 'required',
    async handle(ctx) {
      return { kind: 'json', status: 200, body: { user: ctx.user(), units: ctx.units() } };
    },
  },
  {
    method: 'PUT',
    pattern: '/api/me/units',
    body: 'json',
    session: 'required',
    async handle(ctx) {
      const errors: FieldErrors = {};
      const film = textOf(ctx.body.film) as FilmUnit;
      const pressure = textOf(ctx.body.pressure) as PressureUnit;
      const distance = textOf(ctx.body.distance) as DistanceUnit;
      if (!FILM_UNITS.includes(film)) errors.film = VALIDATION_MESSAGES.units;
      if (!PRESSURE_UNITS.includes(pressure)) errors.pressure = VALIDATION_MESSAGES.units;
      if (!DISTANCE_UNITS.includes(distance)) errors.distance = VALIDATION_MESSAGES.units;
      if (Object.keys(errors).length > 0) throw fail.validation(errors);
      await query(
        'update users set units_film=$2, units_pressure=$3, units_distance=$4 where id=$1',
        [ctx.user().id, film, pressure, distance],
      );
      return { kind: 'json', status: 200, body: { units: { film, pressure, distance } } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/house',
    body: 'none',
    session: 'required',
    async handle() {
      return {
        kind: 'json',
        status: 200,
        body: {
          name: HOUSE_NAME,
          time_zone: 'Europe/Zurich',
          currency: 'CHF',
          vat_rate: VAT_RATE_LABEL,
          labour_rate: LABOUR_RATE_LABEL,
          clearance_mm: CLEARANCE_MM,
        },
      };
    },
  },
];
