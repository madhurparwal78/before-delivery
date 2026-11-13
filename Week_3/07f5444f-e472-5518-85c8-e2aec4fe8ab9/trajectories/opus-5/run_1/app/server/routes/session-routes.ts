import type { ServiceStatus, User } from '../../shared/api.js';
import { bootState, databaseAnswers } from '../boot.js';
import { pool } from '../db/pool.js';
import type { Person, RequestContext } from '../http/context.js';
import { ApiError } from '../http/errors.js';
import { sendJson, sendNoContent } from '../http/http-io.js';
import {
  SESSION_COOKIE,
  clearedSessionCookie,
  endSession,
  readCookie,
  sessionCookie,
  signIn,
  startSession,
} from '../http/session.js';
import { bodyObject, isString } from '../http/validate.js';
import { mailIsUp } from '../services/mail.js';
import { storageIsUp } from '../services/storage.js';

export function userView(person: Person): User {
  return { id: person.id, name: person.name, email: person.email, role: person.role, chair: person.chair };
}

export async function health(context: RequestContext): Promise<void> {
  if (bootState.schemaReady && (await databaseAnswers())) {
    sendJson(context.response, 200, { status: 'ok' });
    return;
  }
  sendJson(context.response, 503, { status: 'starting' });
}

export async function serviceStatus(context: RequestContext): Promise<void> {
  const [storage, mail] = await Promise.all([storageIsUp(), mailIsUp()]);
  const body: ServiceStatus = { storage: storage ? 'up' : 'down', mail: mail ? 'up' : 'down' };
  sendJson(context.response, 200, body);
}

export async function createSession(context: RequestContext): Promise<void> {
  const body = bodyObject(context.jsonBody);
  const errors: Record<string, string> = {};
  if (!isString(body.email) || body.email === '') errors.email = 'Enter your email.';
  if (!isString(body.passcode) || body.passcode === '') errors.passcode = 'Enter your passcode.';
  if (Object.keys(errors).length > 0) throw new ApiError(422, 'validation', 'Check the highlighted fields.', { errors });

  const person = await signIn(pool, String(body.email), String(body.passcode));
  if (!person) throw new ApiError(401, 'invalid_credentials', "That email and passcode don't match.");
  const sessionId = await startSession(pool, person.id);
  sendJson(context.response, 200, { user: userView(person) }, { 'set-cookie': sessionCookie(sessionId) });
}

export async function readSessionUser(context: RequestContext): Promise<void> {
  const person = context.person;
  if (!person) throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  sendJson(context.response, 200, { user: userView(person) });
}

export async function deleteSession(context: RequestContext): Promise<void> {
  const sessionId = readCookie(context.request.headers.cookie, SESSION_COOKIE);
  if (sessionId) await endSession(pool, sessionId);
  sendNoContent(context.response, { 'set-cookie': clearedSessionCookie() });
}
