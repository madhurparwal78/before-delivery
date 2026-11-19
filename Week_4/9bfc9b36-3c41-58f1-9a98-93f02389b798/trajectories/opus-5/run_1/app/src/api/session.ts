import type { IncomingMessage } from 'node:http';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { config, SESSION_COOKIE } from '../config';
import { query, queryOne } from '../db/pool';
import { refuse } from '../http/errors';
import { signIn as passwordGrant, refreshAccessToken, verifyAccessToken } from '../services/keycloak';
import { accountView, type AccountRow } from '../domain/model';
import { Check, normaliseEmail } from '../domain/validate';
import { jsonBody, reply, type Caller, type Ctx, type Reply, type Role } from './types';

/**
 * The one request path that decides who the caller is. Role, ownership and
 * cutting authority always come from the stored account, never from a claim
 * inside the token, and a deleted account stops being a caller at once.
 */

const COOKIE_KEY = createHmac('sha256', config.authClientSecret).update('boltrope-session-v1').digest();

function signCookie(sessionId: string): string {
  const signature = createHmac('sha256', COOKIE_KEY).update(sessionId).digest('base64url').slice(0, 22);
  return `${sessionId}.${signature}`;
}

function readCookieValue(value: string): string | null {
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const sessionId = value.slice(0, dot);
  const given = value.slice(dot + 1);
  const expected = createHmac('sha256', COOKIE_KEY).update(sessionId).digest('base64url').slice(0, 22);
  if (given.length !== expected.length) return null;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected)) ? sessionId : null;
}

function cookieHeader(value: string | null): string {
  if (value === null) {
    return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
  }
  return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/`;
}

function cookiesOf(request: IncomingMessage): Map<string, string> {
  const header = request.headers['cookie'];
  const jar = new Map<string, string>();
  if (typeof header !== 'string') return jar;
  for (const part of header.split(';')) {
    const equals = part.indexOf('=');
    if (equals === -1) continue;
    jar.set(part.slice(0, equals).trim(), part.slice(equals + 1).trim());
  }
  return jar;
}

export interface ResolvedCaller {
  readonly account: Caller;
  readonly fromCookie: boolean;
}

async function callerOfSubject(subject: string): Promise<Caller | null> {
  const row = await queryOne<AccountRow>(
    'SELECT * FROM account WHERE keycloak_user_id = $1 AND deleted = false',
    [subject],
  );
  if (row === null) return null;
  return { id: row.id, email: row.email, display_name: row.display_name, role: row.role as Role };
}

export async function resolveCaller(request: IncomingMessage): Promise<ResolvedCaller | null> {
  const authorisation = request.headers['authorization'];
  if (typeof authorisation === 'string' && authorisation.toLowerCase().startsWith('bearer ')) {
    const subject = await verifyAccessToken(authorisation.slice(7).trim());
    if (subject === null) return null;
    const account = await callerOfSubject(subject.subject);
    return account === null ? null : { account, fromCookie: false };
  }
  const sessionCookie = cookiesOf(request).get(SESSION_COOKIE);
  if (sessionCookie === undefined) return null;
  const sessionId = readCookieValue(sessionCookie);
  if (sessionId === null) return null;
  const session = await queryOne<{ account_email: string }>(
    'SELECT account_email FROM app_session WHERE id = $1',
    [sessionId],
  );
  if (session === null) return null;
  const row = await queryOne<AccountRow>(
    'SELECT * FROM account WHERE email = $1 AND deleted = false',
    [session.account_email],
  );
  if (row === null) return null;
  return {
    account: { id: row.id, email: row.email, display_name: row.display_name, role: row.role as Role },
    fromCookie: true,
  };
}

export async function createSession(ctx: Ctx): Promise<Reply> {
  const body = jsonBody(ctx);
  const check = new Check(body);
  const rawEmail = typeof body['email'] === 'string' ? (body['email'] as string) : '';
  check.email('email');
  check.password('password');
  check.done();
  const email = normaliseEmail(rawEmail);
  const password = body['password'] as string;

  const account = await queryOne<AccountRow>(
    'SELECT * FROM account WHERE email = $1 AND deleted = false',
    [email],
  );
  if (account === null) throw refuse('bad_credentials');
  const tokens = await passwordGrant(email, password);
  if (tokens === null) throw refuse('bad_credentials');

  const sessionId = randomUUID();
  await query('INSERT INTO app_session (id, account_email, refresh_token) VALUES ($1,$2,$3)', [
    sessionId,
    email,
    tokens.refreshToken,
  ]);
  ctx.setCookie(cookieHeader(signCookie(sessionId)));
  return reply(200, {
    account: accountView(account),
    access_token: tokens.accessToken,
    expires_in: tokens.expiresIn,
  });
}

/** The browser calls this once when a write is refused as unauthenticated. */
export async function refreshSession(ctx: Ctx): Promise<Reply> {
  const sessionCookie = cookiesOf({ headers: ctx.headers } as IncomingMessage).get(SESSION_COOKIE);
  if (sessionCookie === undefined) throw refuse('unauthenticated');
  const sessionId = readCookieValue(sessionCookie);
  if (sessionId === null) throw refuse('unauthenticated');
  const session = await queryOne<{ account_email: string; refresh_token: string }>(
    'SELECT account_email, refresh_token FROM app_session WHERE id = $1',
    [sessionId],
  );
  if (session === null) throw refuse('unauthenticated');
  const account = await queryOne<AccountRow>(
    'SELECT * FROM account WHERE email = $1 AND deleted = false',
    [session.account_email],
  );
  if (account === null) throw refuse('unauthenticated');
  const tokens = await refreshAccessToken(session.refresh_token);
  if (tokens === null) {
    await query('DELETE FROM app_session WHERE id = $1', [sessionId]);
    throw refuse('unauthenticated');
  }
  await query('UPDATE app_session SET refresh_token = $2 WHERE id = $1', [sessionId, tokens.refreshToken]);
  return reply(200, {
    account: accountView(account),
    access_token: tokens.accessToken,
    expires_in: tokens.expiresIn,
  });
}

export async function endSession(ctx: Ctx): Promise<Reply> {
  const sessionCookie = cookiesOf({ headers: ctx.headers } as IncomingMessage).get(SESSION_COOKIE);
  if (sessionCookie !== undefined) {
    const sessionId = readCookieValue(sessionCookie);
    if (sessionId !== null) await query('DELETE FROM app_session WHERE id = $1', [sessionId]);
  }
  ctx.setCookie(cookieHeader(null));
  return { status: 204 };
}
