import type { Route, RouteContext } from '../router.ts';
import { route } from '../router.ts';
import { asRecord, str, trimmed, Validator } from '../validation.ts';
import { signIn, signOut } from '../session.ts';
import { DEFAULT_UNITS, type FilmUnit, type PressureUnit, type DistanceUnit } from '../../shared/units.ts';

function bodyOf(rc: RouteContext): Record<string, unknown> {
  return asRecord(rc.body);
}

export const sessionRoutes: Route[] = [
  route('GET', '/api/health', { noSession: true }, async () => ({
    status: 200,
    body: { status: 'ok' },
  })),

  route('GET', '/api/status', { noSession: true }, async (rc) => ({
    status: 200,
    body: {
      storage: rc.ctx.status.storage,
      billing: rc.ctx.status.billing,
      mail: rc.ctx.status.mail,
    },
  })),

  route('GET', '/api/house', {}, async () => ({
    status: 200,
    body: {
      name: 'Marrow & Lark Motor House',
      time_zone: 'Europe/Zurich',
      currency: 'CHF',
      vat_rate: '8.1',
      labour_rate: '145.00',
      clearance_mm: 500,
    },
  })),

  route('POST', '/api/session', { noSession: true }, async (rc) => {
    const record = bodyOf(rc);
    const email = trimmed(record['email']);
    const password = str(record['password']);
    const nextRaw = record['next'];
    const next = nextRaw === undefined || nextRaw === null ? undefined : str(nextRaw);
    const v = new Validator();
    v.check(email !== '' && password !== '', 'email', 'Enter your email and password.');
    v.check(email !== '' && password !== '', 'password', 'Enter your email and password.');
    v.throwIfInvalid();
    const result = await signIn(rc.ctx.db, email, password, next, rc.ctx.env.timers.sessionLifetimeSeconds);
    rc.res.setHeader(
      'Set-Cookie',
      `lacquer_session=${result.sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${rc.ctx.env.timers.sessionLifetimeSeconds}`,
    );
    return {
      status: 200,
      body: {
        user: { id: result.user.id, name: result.user.name, email: result.user.email, role: result.user.role },
        redirect: result.redirect,
      },
    };
  }),

  route('DELETE', '/api/session', {}, async (rc) => {
    await signOut(rc.ctx.db, rc.viewer.sessionId);
    return { status: 204 };
  }),

  route('GET', '/api/me', {}, async (rc) => {
    const rows = await rc.ctx.db.query<{ units_film: string; units_pressure: string; units_distance: string }>(
      'SELECT units_film, units_pressure, units_distance FROM users WHERE id = $1',
      [rc.viewer.id],
    );
    const row = rows[0];
    const units = row
      ? {
          film: row.units_film as FilmUnit,
          pressure: row.units_pressure as PressureUnit,
          distance: row.units_distance as DistanceUnit,
        }
      : DEFAULT_UNITS;
    return {
      status: 200,
      body: {
        user: { id: rc.viewer.id, name: rc.viewer.name, email: rc.viewer.email, role: rc.viewer.role },
        units,
      },
    };
  }),

  route('PUT', '/api/me/units', {}, async (rc) => {
    const record = bodyOf(rc);
    const film = str(record['film']);
    const pressure = str(record['pressure']);
    const distance = str(record['distance']);
    const v = new Validator();
    v.check(film === 'um' || film === 'mil', 'film', 'Choose one of the listed units.');
    v.check(pressure === 'bar' || pressure === 'psi', 'pressure', 'Choose one of the listed units.');
    v.check(distance === 'km' || distance === 'mi', 'distance', 'Choose one of the listed units.');
    v.throwIfInvalid();
    await rc.ctx.db.query(
      'UPDATE users SET units_film = $2, units_pressure = $3, units_distance = $4 WHERE id = $1',
      [rc.viewer.id, film, pressure, distance],
    );
    return { status: 200, body: { units: { film, pressure, distance } } };
  }),
];
