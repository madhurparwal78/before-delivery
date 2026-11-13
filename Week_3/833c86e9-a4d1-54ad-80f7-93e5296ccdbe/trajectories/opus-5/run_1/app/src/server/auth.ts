import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { query, one } from './db';
import { Cur, Lang } from '../shared/types';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function newId(bytes = 18): string {
  return randomBytes(bytes).toString('base64url');
}

export interface SessionUser {
  username: string;
  role: 'guest' | 'manager' | 'operator';
  manages: string[];
}

export interface Context {
  visitorId: string | null;
  sessionId: string | null;
  user: SessionUser | null;
  lang: Lang;
  cur: Cur;
}

export function usernameValid(username: string): boolean {
  return /^[a-z0-9_]{3,24}$/.test(username);
}

export async function loadUser(username: string): Promise<SessionUser | null> {
  const row = await one<{ username: string; role: string }>('select username, role from users where username = $1', [
    username,
  ]);
  if (!row) return null;
  const manages = await query<{ property: string }>('select property from manages where username = $1 order by property', [
    username,
  ]);
  return { username: row.username, role: row.role as SessionUser['role'], manages: manages.map((m) => m.property) };
}

export async function createSession(username: string): Promise<string> {
  const id = newId(24);
  await query('insert into sessions (id, username) values ($1, $2)', [id, username]);
  return id;
}

export async function ensureVisitor(id: string | null): Promise<string> {
  if (id) {
    const row = await one('select id from visitors where id = $1', [id]);
    if (row) return id;
  }
  const fresh = newId(24);
  await query('insert into visitors (id) values ($1)', [fresh]);
  return fresh;
}

export async function storedPreferences(ctx: {
  sessionId: string | null;
  visitorId: string | null;
}): Promise<{ lang: Lang | null; cur: Cur | null }> {
  if (ctx.sessionId) {
    const row = await one<{ lang: string | null; cur: string | null }>('select lang, cur from sessions where id = $1', [
      ctx.sessionId,
    ]);
    if (row) return { lang: (row.lang as Lang) ?? null, cur: (row.cur as Cur) ?? null };
  }
  if (ctx.visitorId) {
    const row = await one<{ lang: string | null; cur: string | null }>('select lang, cur from visitors where id = $1', [
      ctx.visitorId,
    ]);
    if (row) return { lang: (row.lang as Lang) ?? null, cur: (row.cur as Cur) ?? null };
  }
  return { lang: null, cur: null };
}

export async function storePreferences(
  ctx: Context,
  prefs: { lang?: Lang; cur?: Cur },
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (prefs.lang) {
    params.push(prefs.lang);
    sets.push(`lang = $${params.length}`);
  }
  if (prefs.cur) {
    params.push(prefs.cur);
    sets.push(`cur = $${params.length}`);
  }
  if (sets.length === 0) return;
  if (ctx.sessionId && ctx.user) {
    params.push(ctx.user.username);
    await query(`update sessions set ${sets.join(', ')} where username = $${params.length}`, params);
  } else if (ctx.visitorId) {
    params.push(ctx.visitorId);
    await query(`update visitors set ${sets.join(', ')} where id = $${params.length}`, params);
  }
}
