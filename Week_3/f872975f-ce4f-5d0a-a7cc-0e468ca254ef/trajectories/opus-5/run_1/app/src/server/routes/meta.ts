import { query } from '../db/pool';
import { ApiError } from '../errors';
import { Reply, RequestContext, jsonReply, requireUser } from '../http';
import { verifyPassword } from '../password';
import { SESSION_COOKIE, SessionUser, clearedSessionCookies, createSession, destroySession, readCookie, sessionCookies } from '../session';
import { servicesReport } from '../services/health';
import { Route, route } from './types';

const userShape = (user: SessionUser): Record<string, unknown> => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role
});

async function health(): Promise<Reply> {
  return jsonReply(200, { status: 'ok' });
}

async function services(): Promise<Reply> {
  return jsonReply(200, await servicesReport());
}

interface UserCredentials extends SessionUser {
  password_hash: string;
}

async function signIn(context: RequestContext): Promise<Reply> {
  const email = context.json.email;
  const password = context.json.password;
  if (typeof email !== 'string' || typeof password !== 'string') throw new ApiError('invalid_credentials');
  const found = await query<UserCredentials>(
    'SELECT id, name, email, role, password_hash FROM users WHERE lower(email) = lower($1)',
    [email.trim()]
  );
  const candidate = found[0];
  if (candidate === undefined || !(await verifyPassword(password, candidate.password_hash))) {
    throw new ApiError('invalid_credentials');
  }
  const sessionId = await createSession(candidate.id);
  return {
    status: 200,
    json: { user: userShape(candidate) },
    cookies: sessionCookies(sessionId)
  };
}

async function readSession(context: RequestContext): Promise<Reply> {
  return jsonReply(200, { user: userShape(requireUser(context)) });
}

async function signOut(context: RequestContext): Promise<Reply> {
  requireUser(context);
  const sessionId = readCookie(context.headers.cookie, SESSION_COOKIE);
  if (sessionId !== null) await destroySession(sessionId);
  return { status: 204, cookies: clearedSessionCookies() };
}

export const metaRoutes: Route[] = [
  route('GET', '/api/health', false, health),
  route('GET', '/api/services', false, services),
  route('POST', '/api/session', false, signIn),
  route('GET', '/api/session', true, readSession),
  route('DELETE', '/api/session', true, signOut)
];
