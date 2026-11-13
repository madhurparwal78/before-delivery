import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { nowMs } from './clock.js';
import { one, query } from './db.js';
import { rates } from './env.js';
import { fail } from './errors.js';

const scryptAsync = promisify(scrypt);

export const SESSION_COOKIE = 'spoor_session';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, 32)) as Buffer;
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, digest] = stored.split(':');
  if (!salt || !digest) return false;
  const derived = (await scryptAsync(password, salt, 32)) as Buffer;
  const expected = Buffer.from(digest, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export type UserRow = {
  id: number;
  username: string;
  timeZone: string;
  currentSpaceId: number | null;
};

export type Membership = { spaceId: number; slug: string; name: string; role: Role };

export type Role = 'viewer' | 'editor' | 'admin';

export type Caller =
  | { kind: 'session'; user: UserRow; sessionId: string }
  | {
      kind: 'key';
      keyId: string;
      spaceId: number;
      actions: string[];
      pattern: string;
      name: string;
    };

export function userRowOf(row: Record<string, unknown>): UserRow {
  return {
    id: Number(row.id),
    username: String(row.username),
    timeZone: String(row.time_zone),
    currentSpaceId: row.current_space_id === null ? null : Number(row.current_space_id),
  };
}

export async function createSession(userId: number): Promise<string> {
  const id = randomUUID();
  await query(`insert into sessions (id, user_id, created_ms) values ($1, $2, $3)`, [
    id,
    userId,
    nowMs(),
  ]);
  return id;
}

export async function userOfSession(sessionId: string): Promise<UserRow | null> {
  const row = await one(
    `select u.* from sessions s join users u on u.id = s.user_id where s.id = $1`,
    [sessionId],
  );
  return row ? userRowOf(row) : null;
}

export async function membershipsOf(userId: number): Promise<Membership[]> {
  const rows = await query(
    `select s.id as space_id, s.slug, s.name, m.role
     from members m join spaces s on s.id = m.space_id
     where m.user_id = $1
     order by s.name asc`,
    [userId],
  );
  return rows.map((row) => ({
    spaceId: Number(row.space_id),
    slug: String(row.slug),
    name: String(row.name),
    role: String(row.role) as Role,
  }));
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function newKeyValue(): string {
  return `spk_${randomBytes(16).toString('hex')}`;
}

export type KeyRow = {
  id: string;
  spaceId: number;
  name: string;
  pattern: string;
  actions: string[];
  expiresMs: number | null;
  revoked: boolean;
};

export async function keyByValue(value: string): Promise<KeyRow | null> {
  const row = await one(`select * from api_keys where key_hash = $1`, [hashKey(value)]);
  if (!row) return null;
  return {
    id: String(row.id),
    spaceId: Number(row.space_id),
    name: String(row.name),
    pattern: String(row.stream_pattern),
    actions: row.actions as string[],
    expiresMs: row.expires_ms === null ? null : Number(row.expires_ms),
    revoked: Boolean(row.revoked),
  };
}

export function patternMatches(pattern: string, name: string): boolean {
  const expression = new RegExp(
    `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, (char) => (char === '*' ? '.*' : `\\${char}`))}$`,
  );
  return expression.test(name);
}

export function roleAllows(role: Role, needed: Role): boolean {
  const order: Role[] = ['viewer', 'editor', 'admin'];
  return order.indexOf(role) >= order.indexOf(needed);
}

type Window = { minute: number; count: number };

const windows = new Map<string, Window>();

export function secondsToNextMinute(): number {
  const ms = nowMs();
  const remaining = 60000 - (ms % 60000);
  return Math.max(1, Math.ceil(remaining / 1000));
}

/** Each limit counts per fixed server-clock minute. */
export function countRate(kind: 'upload' | 'login' | 'search', key: string): void {
  const limit = rates[kind];
  const minute = Math.floor(nowMs() / 60000);
  const mapKey = `${kind}:${key}`;
  const window = windows.get(mapKey);
  if (!window || window.minute !== minute) {
    windows.set(mapKey, { minute, count: 1 });
    if (limit < 1) throw fail.rateLimited(secondsToNextMinute());
    return;
  }
  window.count += 1;
  if (window.count > limit) throw fail.rateLimited(secondsToNextMinute());
}

export function resetRateWindows(): void {
  windows.clear();
}
