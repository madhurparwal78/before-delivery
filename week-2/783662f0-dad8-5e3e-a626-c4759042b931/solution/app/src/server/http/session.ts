import type { Request, Response } from 'express';
import { one, query } from '../db/pool.js';
import { fail } from '../errors.js';
import { newId } from '../util.js';

const COOKIE = 'pw_session';

export interface SessionUser {
  readonly id: string;
  readonly handle: string;
  readonly displayName: string;
  readonly email: string;
  readonly sound: boolean;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1));
  }
  return null;
}

export async function startSession(res: Response, userId: string): Promise<void> {
  const id = newId();
  await query('INSERT INTO sessions (id, user_id) VALUES ($1, $2)', [id, userId]);
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
  );
}

export async function endSession(req: Request, res: Response): Promise<void> {
  const id = readCookie(req, COOKIE);
  if (id !== null) await query('DELETE FROM sessions WHERE id = $1', [id]);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

interface UserRow {
  id: string;
  handle: string;
  display_name: string;
  email: string;
  sound: boolean;
}

async function currentUser(req: Request): Promise<SessionUser | null> {
  const id = readCookie(req, COOKIE);
  if (id === null) return null;
  const row = await one<UserRow>(
    `SELECT u.id, u.handle, u.display_name, u.email, u.sound
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1`,
    [id],
  );
  if (row === null) return null;
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    email: row.email,
    sound: row.sound,
  };
}

export async function requireUser(req: Request): Promise<SessionUser> {
  const user = await currentUser(req);
  if (user === null) throw fail('unauthenticated');
  return user;
}
