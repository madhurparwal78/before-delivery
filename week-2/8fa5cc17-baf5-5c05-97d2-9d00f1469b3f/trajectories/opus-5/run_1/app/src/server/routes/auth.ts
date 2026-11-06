import { query, queryOne, isDatabaseReady } from '../db/pool';
import {
  HttpError,
  Reply,
  RequestContext,
  errorReply,
  json,
  noContent,
  route,
  Route,
  validationError,
  statusOnly,
  notFound,
} from '../http/core';
import {
  checkLockout,
  clearFailures,
  createSession,
  endSessions,
  liveSessions,
  recordFailure,
  rotateSession,
  sessionCookieHeader,
  sessionExists,
} from '../auth/sessions';
import { hashPassword, verifyPassword, PASSWORD_MAX_CHARS, PASSWORD_MIN_CHARS } from '../auth/password';
import { normaliseEmail } from '../../shared/rules';
import { loadSettings } from '../domain/commit';

type OwnerRow = { id: string; email: string; display_name: string; password_hash: string };

async function loadOwner(): Promise<OwnerRow | null> {
  return queryOne<OwnerRow>('select id, email, display_name, password_hash from owner_account limit 1');
}

function stringField(body: unknown, name: string): string | null {
  if (body === null || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : null;
}

export const authRoutes: Route[] = [
  route('GET', '/api/health', async (): Promise<Reply> => {
    if (!isDatabaseReady()) throw statusOnly(503, 'starting');
    return json({ status: 'ok' });
  }),

  route('POST', '/api/auth/sign-in', async (context: RequestContext): Promise<Reply> => {
    const email = stringField(context.json, 'email');
    const password = stringField(context.json, 'password');
    const errors: Record<string, string> = {};
    if (email === null || email.trim() === '') errors['email'] = 'Enter your email.';
    if (password === null || password === '') errors['password'] = 'Enter your password.';
    if (Object.keys(errors).length > 0) throw validationError(errors);
    const identity = normaliseEmail(email as string);
    const lock = await checkLockout(identity, context.peerAddress);
    if (lock.locked) {
      throw new HttpError(429, { error: 'locked' }, { 'Retry-After': String(lock.retryAfterSeconds) });
    }
    const owner = await loadOwner();
    const matches =
      owner !== null &&
      normaliseEmail(owner.email) === identity &&
      verifyPassword(password as string, owner.password_hash);
    if (!matches) {
      await recordFailure(identity, context.peerAddress);
      const after = await checkLockout(identity, context.peerAddress);
      if (after.locked) {
        throw new HttpError(429, { error: 'locked' }, { 'Retry-After': String(after.retryAfterSeconds) });
      }
      throw errorReply(401, 'invalid_credentials');
    }
    await clearFailures(identity);
    const session = await createSession(
      typeof context.headers['user-agent'] === 'string' ? context.headers['user-agent'] : undefined,
    );
    return json(
      {
        user: { email: (owner as OwnerRow).email, display_name: (owner as OwnerRow).display_name },
        csrf_token: session.csrfToken,
      },
      200,
      { 'Set-Cookie': sessionCookieHeader(session.secret) },
    );
  }),

  route('POST', '/api/auth/sign-out', async (context: RequestContext): Promise<Reply> => {
    await endSessions([(context.session as { id: string }).id]);
    return noContent({ 'Set-Cookie': `quire_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` });
  }),

  route('GET', '/api/session', async (context: RequestContext): Promise<Reply> => {
    const owner = await loadOwner();
    const settings = await loadSettings();
    const session = context.session as { id: string; csrfToken: string };
    return json({
      user: { email: owner?.email ?? '', display_name: owner?.display_name ?? '' },
      csrf_token: session.csrfToken,
      session_id: session.id,
      home_time_zone: settings.homeTimeZone,
      theme: settings.theme,
    });
  }),

  route('POST', '/api/account/password', async (context: RequestContext): Promise<Reply> => {
    const current = stringField(context.json, 'current_password');
    const next = stringField(context.json, 'new_password');
    const owner = await loadOwner();
    if (owner === null) throw notFound();
    if (current === null || !verifyPassword(current, owner.password_hash)) {
      throw validationError({ current_password: "That isn't your current password." });
    }
    if (next === null || Array.from(next).length < PASSWORD_MIN_CHARS) {
      throw validationError({ new_password: 'Use at least 12 characters.' });
    }
    if (Array.from(next).length > PASSWORD_MAX_CHARS) {
      throw validationError({ new_password: 'Use at most 200 characters.' });
    }
    await query('update owner_account set password_hash = $1 where id = $2', [hashPassword(next), owner.id]);
    const session = context.session as { id: string };
    const others = await query<{ id: string }>(
      'select id from device_session where ended_at is null and id <> $1',
      [session.id],
    );
    await endSessions(others.map((row) => row.id));
    const rotated = await rotateSession(session.id);
    return json({ csrf_token: rotated.csrfToken }, 200, {
      'Set-Cookie': sessionCookieHeader(rotated.secret),
    });
  }),

  route('GET', '/api/sessions', async (context: RequestContext): Promise<Reply> => {
    const session = context.session as { id: string };
    return json({ sessions: await liveSessions(session.id) });
  }),

  route('DELETE', '/api/sessions/:id', async (context: RequestContext): Promise<Reply> => {
    const id = context.params['id'];
    const session = context.session as { id: string };
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) throw notFound();
    if (id === session.id) throw errorReply(409, 'current_session');
    if (!(await sessionExists(id))) throw notFound();
    await endSessions([id]);
    return noContent();
  }),
];
