import { copy } from '../../shared/copy.js';
import { query } from '../db/pool.js';
import { ApiError } from '../http/errors.js';
import { EMAIL, asObject, failOn, text } from '../http/input.js';
import { authedUser, reply, route } from '../http/router.js';
import {
  DUMMY_HASH, SESSION_COOKIE, clearedCookie, createSession, hashPassword, hashToken, cookieOf, sessionCookie, verifyPassword,
} from '../http/session.js';

const MIN_PASSWORD = 10;
const UNIQUE_VIOLATION = '23505';

route('POST', '/api/auth/signup', { auth: false }, async ({ body }) => {
  const input = asObject(body);
  const email = text(input['email']);
  const password = typeof input['password'] === 'string' ? input['password'] : '';
  const displayName = text(input['display_name']);
  const fields: Record<string, string> = {};
  if (!EMAIL.test(email)) fields['email'] = copy.email;
  if ([...password].length < MIN_PASSWORD) fields['password'] = copy.password;
  if (displayName === '') fields['display_name'] = copy.name;
  failOn(fields);
  try {
    const rows = await query<{ id: string }>(
      'INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [email, displayName, await hashPassword(password)]);
    const id = rows[0].id;
    const token = await createSession(id);
    return reply(201, { user: { id, email, display_name: displayName } }, { 'Set-Cookie': sessionCookie(token) });
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) failOn({ email: copy.emailTaken });
    throw error;
  }
});

route('POST', '/api/auth/signin', { auth: false }, async ({ body }) => {
  const input = asObject(body);
  const email = text(input['email']);
  const password = typeof input['password'] === 'string' ? input['password'] : '';
  const rows = await query<{ id: string; email: string; display_name: string; password_hash: string }>(
    'SELECT id, email, display_name, password_hash FROM users WHERE lower(email) = lower($1)', [email]);
  const user = rows[0];
  const matches = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !matches) throw new ApiError(401, 'SIGN_IN_FAILED', copy.signInFailed);
  const token = await createSession(user.id);
  return reply(200, { user: { id: user.id, email: user.email, display_name: user.display_name } }, { 'Set-Cookie': sessionCookie(token) });
});

route('POST', '/api/auth/signout', { auth: false }, async ({ req }) => {
  const token = cookieOf(req, SESSION_COOKIE);
  if (token !== null) await query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  return reply(204, undefined, { 'Set-Cookie': clearedCookie });
});

route('GET', '/api/me', {}, async (ctx) => reply(200, { user: authedUser(ctx) }));
