// The owner's session lives in PostgreSQL, so every instance on the same database honours it,
// and signing out ends it everywhere at once.

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { one, query } from '../db/pool.js';
import { fail } from './errors.js';
import { cookies } from './request.js';

const COOKIE = 'ob_owner';

export async function startSession(response: ServerResponse): Promise<void> {
  const id = randomUUID();
  await query('INSERT INTO owner_session (id) VALUES ($1)', [id]);
  response.setHeader('Set-Cookie', `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax`);
}

export async function endAllSessions(response: ServerResponse): Promise<void> {
  await query('DELETE FROM owner_session');
  response.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

async function signedIn(request: IncomingMessage): Promise<boolean> {
  const id = cookies(request)[COOKIE];
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return false;
  return (await one('SELECT 1 AS found FROM owner_session WHERE id = $1', [id])) !== null;
}

export async function requireOwner(request: IncomingMessage): Promise<void> {
  if (!(await signedIn(request))) fail(401, 'not_signed_in', 'Sign in to do that.');
}
