import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { Database } from './db';
import { unauthenticated } from './errors';
import type { RequestContext } from './http';

const SCRYPT_COST = 16384;
const SESSION_COOKIE = 'cairn_session';

export interface AccountRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  time_zone: string;
  operator: boolean;
}

export interface DeviceRow {
  id: string;
  name: string;
  approved: boolean;
  created_at: Date;
}

export interface Caller {
  account: AccountRow;
  device: DeviceRow;
}

function derive(password: string, salt: Buffer, length: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, length, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await derive(password, salt, 32, { N: SCRYPT_COST, r: 8, p: 1 });
  return `scrypt$${SCRYPT_COST}$8$1$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const expected = Buffer.from(parts[5] ?? '', 'base64');
  const derived = await derive(password, salt, expected.length, {
    N: Number(parts[1]),
    r: Number(parts[2]),
    p: Number(parts[3]),
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function createSession(db: Database, accountId: string, deviceId: string): Promise<string> {
  const token = newToken();
  await db.query('insert into sessions (token_hash, account_id, device_id) values ($1, $2, $3)', [
    hashToken(token),
    accountId,
    deviceId,
  ]);
  return token;
}

export async function currentCaller(db: Database, ctx: RequestContext): Promise<Caller | null> {
  const token = ctx.cookies[SESSION_COOKIE];
  if (!token) return null;
  const row = await db.one<{
    account_id: string;
    email: string;
    display_name: string;
    password_hash: string;
    time_zone: string;
    operator: boolean;
    device_id: string;
    device_name: string;
    approved: boolean;
    device_created_at: Date;
  }>(
    `select a.id as account_id, a.email, a.display_name, a.password_hash, a.time_zone, a.operator,
            d.id as device_id, d.name as device_name, d.approved, d.created_at as device_created_at
       from sessions s
       join accounts a on a.id = s.account_id
       join devices d on d.id = s.device_id
      where s.token_hash = $1`,
    [hashToken(token)],
  );
  if (!row) return null;
  return {
    account: {
      id: row.account_id,
      email: row.email,
      display_name: row.display_name,
      password_hash: row.password_hash,
      time_zone: row.time_zone,
      operator: row.operator,
    },
    device: { id: row.device_id, name: row.device_name, approved: row.approved, created_at: row.device_created_at },
  };
}

export async function requireCaller(db: Database, ctx: RequestContext): Promise<Caller> {
  const caller = await currentCaller(db, ctx);
  if (!caller) throw unauthenticated();
  return caller;
}

export async function deleteSession(db: Database, ctx: RequestContext): Promise<void> {
  const token = ctx.cookies[SESSION_COOKIE];
  if (token) await db.query('delete from sessions where token_hash = $1', [hashToken(token)]);
}

export function newId(): string {
  return randomUUID();
}
