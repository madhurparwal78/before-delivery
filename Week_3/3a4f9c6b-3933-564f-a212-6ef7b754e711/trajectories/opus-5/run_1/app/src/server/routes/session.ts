import type { SessionResponse } from '../../shared/types.js';
import { SESSION_COOKIE, createSession, endSession, verifyPassword } from '../auth.js';
import { config } from '../config.js';
import { errors } from '../errors.js';
import { caller } from '../http/access.js';
import type { Ctx, Reply, Route } from '../http/types.js';
import { findPersonByEmail, listMemberships } from '../repo.js';
import { requireString } from '../validate.js';

async function sessionBody(personId: string, email: string, name: string): Promise<SessionResponse> {
  return { user: { email, name }, memberships: await listMemberships(personId) };
}

async function signIn(ctx: Ctx): Promise<Reply> {
  const email = requireString(ctx.body, 'email').trim().toLowerCase();
  const password = requireString(ctx.body, 'password');
  const person = await findPersonByEmail(email);
  if (!person || !(await verifyPassword(password, person.password_hash))) {
    throw errors.invalidCredentials();
  }
  const token = await createSession(person.id);
  return {
    status: 200,
    json: await sessionBody(person.id, person.email, person.name),
    headers: {
      'set-cookie':
        `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${config.sessionTtlSeconds}`,
    },
  };
}

async function readSession(ctx: Ctx): Promise<Reply> {
  const person = caller(ctx);
  return { status: 200, json: await sessionBody(person.id, person.email, person.name) };
}

async function signOut(ctx: Ctx): Promise<Reply> {
  if (ctx.sessionToken) await endSession(ctx.sessionToken);
  return {
    status: 204,
    headers: { 'set-cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` },
  };
}

export const sessionRoutes: Route[] = [
  { method: 'POST', template: '/api/session', access: 'public', handler: signIn },
  { method: 'GET', template: '/api/session', access: 'session', handler: readSession },
  { method: 'DELETE', template: '/api/session', access: 'public', handler: signOut },
];
