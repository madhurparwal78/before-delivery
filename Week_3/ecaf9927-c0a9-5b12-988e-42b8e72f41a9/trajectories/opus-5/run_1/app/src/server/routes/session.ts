import { newSessionToken, verifyPassword } from '../auth.js';
import { errors, FIELD_MESSAGES } from '../errors.js';
import { route, type Route } from '../http.js';
import {
  createSession,
  deleteSession,
  findMemberByEmail,
  getWorkspace,
  listMaterials,
  updatePreferences,
} from '../repo/workspace.js';
import { storageReachable } from '../storage.js';
import { Reader } from '../validate.js';
import { isReady } from '../readiness.js';

export const sessionRoutes: Route[] = [
  route(
    'GET',
    '/api/health',
    async () =>
      isReady() ? { status: 200, json: { status: 'ok' } } : { status: 503, json: { status: 'starting' } },
    true,
  ),

  route(
    'POST',
    '/api/session',
    async (ctx) => {
      const email = ctx.body.email;
      const password = ctx.body.password;
      const fields: Record<string, string> = {};
      if (typeof email !== 'string' || email.trim() === '') fields.email = FIELD_MESSAGES.email;
      if (typeof password !== 'string' || password === '') fields.password = FIELD_MESSAGES.password;
      if (Object.keys(fields).length > 0) throw errors.invalid(fields);
      const member = await findMemberByEmail(email as string);
      if (!member || !(await verifyPassword(password as string, member.password_hash))) {
        throw errors.badCredentials();
      }
      const token = newSessionToken();
      await createSession(token, member.id);
      return {
        status: 200,
        setSession: token,
        json: {
          member: {
            id: member.id,
            name: member.name,
            email: member.email,
            role: member.role,
            units: member.units,
            precision: member.precision,
          },
        },
      };
    },
    true,
  ),

  route('DELETE', '/api/session', async (ctx) => {
    if (ctx.token !== null) await deleteSession(ctx.token);
    return { status: 204, setSession: null };
  }),

  route('GET', '/api/me', async (ctx) => ({ status: 200, json: { member: ctx.member } })),

  route('PATCH', '/api/me', async (ctx) => {
    const reader = new Reader(ctx.member.units);
    const units = ctx.body.units === undefined ? null : reader.choice(ctx.body.units, ['mm', 'in'] as const, 'units');
    const precision = ctx.body.precision === undefined ? null : reader.precision(ctx.body.precision);
    reader.done();
    return { status: 200, json: { member: await updatePreferences(ctx.member.id, units, precision) } };
  }),

  route('GET', '/api/workspace', async () => ({ status: 200, json: await getWorkspace() })),

  route('GET', '/api/materials', async () => ({
    status: 200,
    json: { materials: await listMaterials() },
  })),

  route('GET', '/api/status', async () => ({
    status: 200,
    json: { storage: (await storageReachable()) ? 'ok' : 'unreachable' },
  })),
];
