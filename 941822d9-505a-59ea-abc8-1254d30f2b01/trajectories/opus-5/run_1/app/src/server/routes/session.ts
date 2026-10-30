import { pool } from '../db/pool.js';
import { ApiError, Validator } from '../http/errors.js';
import type { AuthUser, Reply, RequestContext } from '../http/context.js';
import { requireUser } from '../http/context.js';
import type { Route } from '../http/router.js';
import {
  createSession,
  destroySession,
  parseCookies,
  SESSION_COOKIE,
  userByEmail,
  userById,
} from '../http/session.js';
import { verifyPassword } from '../util/password.js';

const CREDENTIALS_MESSAGE = 'Email or password is incorrect.';
const DISPLAY_NAME_MESSAGE = 'Enter a display name of 1 to 80 characters.';

function organisationJson(user: AuthUser): Record<string, unknown> | null {
  if (user.organisationId === null || user.organisationName === null || user.organisationKind === null) {
    return null;
  }
  return { id: user.organisationId, name: user.organisationName, kind: user.organisationKind };
}

export function userJson(user: AuthUser): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    display_name: user.displayName,
    role: user.role,
    organisation: organisationJson(user),
  };
}

/** `/api/me` alone adds the licence number and date of birth, and only for learners. */
function meJson(user: AuthUser): Record<string, unknown> {
  if (user.role !== 'learner') return userJson(user);
  return {
    ...userJson(user),
    licence_number: user.licenceNumber,
    date_of_birth: user.dateOfBirth,
  };
}

async function signIn(ctx: RequestContext): Promise<Reply> {
  const validator = new Validator(ctx.body, ['email', 'password']);
  const emailRaw = ctx.body?.['email'];
  const passwordRaw = ctx.body?.['password'];
  const email = typeof emailRaw === 'string' ? emailRaw.trim() : '';
  const password = typeof passwordRaw === 'string' ? passwordRaw : '';
  validator.throwIfInvalid();

  const found = email === '' ? null : await userByEmail(email);
  if (found === null || !(await verifyPassword(password, found.passwordHash))) {
    throw new ApiError(422, { errors: { password: CREDENTIALS_MESSAGE } });
  }
  const token = await createSession(found.user.id);
  return { status: 200, json: { user: userJson(found.user) }, setSessionCookie: token };
}

async function signOut(ctx: RequestContext): Promise<Reply> {
  new Validator(ctx.body, []).throwIfInvalid();
  const token = parseCookies(ctx.request.headers.cookie)[SESSION_COOKIE];
  if (token !== undefined) await destroySession(token);
  return { status: 204, clearSessionCookie: true };
}

async function readMe(ctx: RequestContext): Promise<Reply> {
  new Validator(ctx.body, []).throwIfInvalid();
  return { status: 200, json: { user: meJson(requireUser(ctx)) } };
}

async function updateMe(ctx: RequestContext): Promise<Reply> {
  const user = requireUser(ctx);
  const validator = new Validator(ctx.body, ['display_name']);
  const raw = ctx.body?.['display_name'];
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (typeof raw !== 'string' || trimmed.length === 0 || trimmed.length > 80) {
    validator.add('display_name', DISPLAY_NAME_MESSAGE);
  }
  validator.throwIfInvalid();

  await pool.query('UPDATE users SET display_name = $2 WHERE id = $1', [user.id, trimmed]);
  const updated = await userById(user.id);
  if (updated === null) throw new Error('The signed-in user vanished');
  return { status: 200, json: { user: meJson(updated) } };
}

export const sessionRoutes: readonly Route[] = [
  { method: 'POST', path: '/api/session', auth: 'public', handler: signIn },
  { method: 'DELETE', path: '/api/session', auth: 'required', handler: signOut },
  { method: 'GET', path: '/api/me', auth: 'required', handler: readMe },
  { method: 'PATCH', path: '/api/me', auth: 'required', handler: updateMe },
];
