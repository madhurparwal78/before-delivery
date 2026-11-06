import { hashPassword, verifyPassword } from '../crypto';
import { queryOne, withTransaction } from '../db';
import { HttpError, errors } from '../http/errors';
import type { AuthedCtx, Ctx, Reply, Route } from '../http/router';
import { accountEvents, writeAccountEvent } from '../domain/audit';
import { clearFailures, lockState, recordFailure } from '../domain/lockout';
import {
  clearedSessionCookieHeader,
  createSession,
  endAllSessions,
  sessionCookieHeader,
  type SessionUser,
} from '../domain/sessions';
import type { SessionBody } from '../../shared/types';

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
}

/** A hash to verify against when the email has no account, so timing matches. */
let decoyHash: string | null = null;

export async function prepareDecoyHash(): Promise<void> {
  decoyHash = await hashPassword('decoy-password-for-even-timing');
}

async function findUser(email: string): Promise<UserRow | null> {
  return queryOne<UserRow>('select id, email, display_name, password_hash from users where email = $1', [
    email.trim().toLowerCase(),
  ]);
}

function sessionBody(user: SessionUser, csrfToken: string): SessionBody {
  return { user: { id: user.id, email: user.email, displayName: user.displayName }, csrfToken };
}

function readCredentials(json: unknown): { email: string; password: string } {
  const body = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
  const email = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';
  return { email, password };
}

async function signIn(ctx: Ctx): Promise<Reply> {
  const { email, password } = readCredentials(ctx.json);
  const normalized = email.trim().toLowerCase();
  const lock = await lockState(normalized, ctx.ip);
  if (lock.locked) {
    throw errors.rateLimited('signin_locked', 'Too many sign-in attempts.', lock.retryAfterSeconds);
  }
  const user = await findUser(normalized);
  const stored = user?.password_hash ?? decoyHash;
  const matches = stored ? await verifyPassword(password, stored) : false;
  if (!user || !matches) {
    const outcome = await recordFailure(normalized, ctx.ip);
    if (user) {
      await writeAccountEvent(undefined, user.id, user.email, 'signin.failed', { ip: ctx.ip });
      if (outcome.lockStarted) {
        await writeAccountEvent(undefined, user.id, user.email, 'signin.locked', { ip: ctx.ip });
      }
    }
    throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect.');
  }
  await clearFailures(normalized, ctx.ip);
  const created = await createSession(user.id, ctx.cookieValue);
  const sessionUser: SessionUser = { id: user.id, email: user.email, displayName: user.display_name };
  return {
    status: 200,
    body: sessionBody(sessionUser, created.csrfToken),
    setCookie: sessionCookieHeader(created.cookieValue),
  };
}

async function changePassword(ctx: AuthedCtx): Promise<Reply> {
  const body = typeof ctx.json === 'object' && ctx.json !== null ? (ctx.json as Record<string, unknown>) : {};
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  const email = ctx.session.user.email;

  const lock = await lockState(email, ctx.ip);
  if (lock.locked) {
    throw errors.rateLimited('signin_locked', 'Too many sign-in attempts.', lock.retryAfterSeconds);
  }
  const user = await findUser(email);
  if (!user) throw errors.unauthenticated();
  const correct = await verifyPassword(currentPassword, user.password_hash);
  if (!correct) {
    const outcome = await recordFailure(email, ctx.ip);
    await writeAccountEvent(undefined, user.id, user.email, 'signin.failed', { ip: ctx.ip });
    if (outcome.lockStarted) {
      await writeAccountEvent(undefined, user.id, user.email, 'signin.locked', { ip: ctx.ip });
    }
    throw errors.validation({ currentPassword: 'incorrect' });
  }
  if (newPassword.length < 12 || newPassword.length > 128) throw errors.validation({ newPassword: 'length' });
  if (newPassword === currentPassword) throw errors.validation({ newPassword: 'unchanged' });

  await clearFailures(email, ctx.ip);
  const passwordHash = await hashPassword(newPassword);
  const created = await withTransaction(async (client) => {
    await client.query('update users set password_hash = $2 where id = $1', [user.id, passwordHash]);
    await endAllSessions(user.id, client);
    await writeAccountEvent(client, user.id, user.email, 'password.changed', {});
    return createSession(user.id, undefined, client);
  });
  return {
    status: 200,
    body: sessionBody(ctx.session.user, created.csrfToken),
    setCookie: sessionCookieHeader(created.cookieValue),
  };
}

export const authRoutes: Route[] = [
  {
    method: 'GET',
    pattern: '/api/session',
    auth: true,
    handler: async (ctx) => ({ status: 200, body: sessionBody(ctx.session.user, ctx.session.csrfToken) }),
  },
  { method: 'POST', pattern: '/api/session', auth: false, body: 'json', csrf: 'never', handler: signIn },
  {
    method: 'DELETE',
    pattern: '/api/session',
    auth: true,
    handler: async (ctx) => {
      await endAllSessions(ctx.session.user.id);
      return { status: 204, setCookie: clearedSessionCookieHeader() };
    },
  },
  {
    method: 'POST',
    pattern: '/api/session/password',
    auth: true,
    body: 'json',
    handler: changePassword,
  },
  {
    method: 'GET',
    pattern: '/api/account/audit',
    auth: true,
    handler: async (ctx) => ({ status: 200, body: { events: await accountEvents(ctx.session.user.id) } }),
  },
];
