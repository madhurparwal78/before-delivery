import { COPY } from '../../domain/copy.js';
import {
  clearedCookie,
  createDesk,
  endOtherSessions,
  endSession,
  findDeskByEmail,
  hashPassword,
  passwordMatches,
  readSession,
  sessionCookie,
  startSession,
} from '../auth.js';
import type { RouteSpec } from '../http.js';
import { ApiError, readJsonBody, refuse, requireIdentity } from '../http.js';
import { query } from '../infra/db.js';
import { FieldCollector } from '../validate.js';

export const accessRoutes: RouteSpec[] = [
  {
    method: 'GET',
    pattern: '/api/health',
    auth: 'open',
    handler: async () => ({ status: 200, body: { status: 'ok' } }),
  },
  {
    method: 'POST',
    pattern: '/api/sign-up',
    auth: 'open',
    body: 'json',
    handler: async (context) => {
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const name = fields.text(body, 'name', COPY.typeName);
      const email = fields.email(body);
      const password = fields.password(body, 'password');
      fields.done();
      if (await findDeskByEmail(email)) {
        throw refuse.state('That mail address already has a desk.');
      }
      const desk = await createDesk(name, email, password);
      const token = await startSession(desk.id);
      return {
        status: 201,
        body: desk,
        headers: { 'set-cookie': sessionCookie(token) },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/sign-in',
    auth: 'open',
    body: 'json',
    handler: async (context) => {
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const email = fields.email(body);
      const password = typeof body['password'] === 'string' ? body['password'] : '';
      fields.done();
      const desk = await findDeskByEmail(email);
      if (!desk || !(await passwordMatches(password, desk.password_hash))) {
        throw new ApiError(401, 'wrongSignIn', COPY.wrongSignIn);
      }
      const token = await startSession(desk.id);
      return {
        status: 200,
        body: { id: desk.id, name: desk.name, email: desk.email },
        headers: { 'set-cookie': sessionCookie(token) },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/sign-out',
    auth: 'open',
    handler: async (context) => {
      const session = await readSession(context);
      if (session.kind === 'live') await endSession(session.token);
      return { status: 204, headers: { 'set-cookie': clearedCookie() } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/session',
    handler: async (context) => ({ status: 200, body: requireIdentity(context).desk }),
  },
  {
    method: 'POST',
    pattern: '/api/password',
    body: 'json',
    handler: async (context) => {
      const { token, desk } = requireIdentity(context);
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const current = typeof body['currentPassword'] === 'string' ? body['currentPassword'] : '';
      const next = fields.password(body, 'newPassword');
      fields.done();
      const held = await findDeskByEmail(desk.email);
      if (!held || !(await passwordMatches(current, held.password_hash))) {
        throw refuse.fields({ currentPassword: COPY.wrongCurrentPassword });
      }
      await query('update desks set password_hash = $1 where id = $2', [
        await hashPassword(next),
        desk.id,
      ]);
      await endOtherSessions(desk.id, token);
      return { status: 204 };
    },
  },
];
