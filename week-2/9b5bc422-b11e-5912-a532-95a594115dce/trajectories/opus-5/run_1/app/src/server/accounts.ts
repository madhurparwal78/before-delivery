import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { promisify } from 'node:util';
import { SESSION_COOKIE } from './config.ts';
import { query } from './db.ts';
import { apiError } from './errors.ts';
import { readCookie } from './http.ts';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, salt, digest] = stored.split('$');
  if (!salt || !digest) return false;
  const derived = await scryptAsync(password, salt, 64);
  const expected = Buffer.from(digest, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export type Session = {
  token: string;
  accountId: string;
  email: string;
  deviceId: string;
  deviceName: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function sessionToken(request: IncomingMessage): string | null {
  return readCookie(request, SESSION_COOKIE);
}

export async function sessionFor(token: string): Promise<Session | null> {
  const result = await query<{
    token: string;
    account_id: string;
    email: string;
    device_id: string;
    name: string;
  }>(
    `select s.token, s.account_id, a.email, d.id as device_id, d.name
       from sessions s
       join accounts a on a.id = s.account_id
       join devices d on d.id = s.device_id
      where s.token = $1 and d.removed = false`,
    [token],
  );
  const row = result.rows[0];
  if (!row) return null;
  await query('update devices set last_seen_at = now() where id = $1', [row.device_id]);
  return {
    token: row.token,
    accountId: row.account_id,
    email: row.email,
    deviceId: row.device_id,
    deviceName: row.name,
  };
}

export async function requireSession(request: IncomingMessage): Promise<Session> {
  const token = sessionToken(request);
  if (!token) throw apiError.unauthenticated();
  const session = await sessionFor(token);
  if (!session) throw apiError.unauthenticated();
  return session;
}

async function addDevice(accountId: string): Promise<{ id: string; name: string }> {
  const next = await query<{ number: number }>(
    'select coalesce(max(number), 0) + 1 as number from devices where account_id = $1',
    [accountId],
  );
  const number = Number(next.rows[0].number);
  const id = randomUUID();
  const name = `Device ${number}`;
  await query('insert into devices (id, account_id, name, number) values ($1, $2, $3, $4)', [
    id,
    accountId,
    name,
    number,
  ]);
  return { id, name };
}

async function openSession(accountId: string, deviceId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await query('insert into sessions (token, account_id, device_id) values ($1, $2, $3)', [token, accountId, deviceId]);
  return token;
}

export type SignedIn = { token: string; session: Session };

export async function createAccount(email: string, password: string): Promise<SignedIn> {
  const normalised = email.trim().toLowerCase();
  const existing = await query('select 1 from accounts where email = $1', [normalised]);
  if (existing.rowCount) throw apiError.emailTaken();
  if (!EMAIL_PATTERN.test(normalised)) throw apiError.invalidEmail();
  if (password.length < 8) throw apiError.shortPassword();

  const accountId = randomUUID();
  await query('insert into accounts (id, email, password_hash) values ($1, $2, $3)', [
    accountId,
    normalised,
    await hashPassword(password),
  ]);
  const device = await addDevice(accountId);
  const token = await openSession(accountId, device.id);
  return {
    token,
    session: { token, accountId, email: normalised, deviceId: device.id, deviceName: device.name },
  };
}

export async function signIn(email: string, password: string): Promise<SignedIn> {
  const normalised = String(email ?? '').trim().toLowerCase();
  const result = await query<{ id: string; email: string; password_hash: string }>(
    'select id, email, password_hash from accounts where email = $1',
    [normalised],
  );
  const account = result.rows[0];
  if (!account || !(await passwordMatches(String(password ?? ''), account.password_hash))) {
    throw apiError.badCredentials();
  }
  const device = await addDevice(account.id);
  const token = await openSession(account.id, device.id);
  return {
    token,
    session: { token, accountId: account.id, email: account.email, deviceId: device.id, deviceName: device.name },
  };
}

export async function signOut(session: Session): Promise<void> {
  await query('delete from sessions where token = $1', [session.token]);
  await query('update devices set removed = true where id = $1', [session.deviceId]);
}

export type DeviceView = { id: string; name: string; current: boolean; lastSeenAt: string };

export async function listDevices(session: Session): Promise<DeviceView[]> {
  const result = await query<{ id: string; name: string; last_seen_at: Date }>(
    'select id, name, last_seen_at from devices where account_id = $1 and removed = false order by number',
    [session.accountId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    current: row.id === session.deviceId,
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
  }));
}

export async function removeDevice(session: Session, deviceId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(deviceId)) throw apiError.notFound();
  const result = await query<{ id: string }>(
    'select id from devices where id = $1 and account_id = $2 and removed = false',
    [deviceId, session.accountId],
  );
  if (!result.rowCount) throw apiError.notFound();
  if (deviceId === session.deviceId) throw apiError.currentDevice();
  await query('delete from sessions where device_id = $1', [deviceId]);
  await query('update devices set removed = true where id = $1', [deviceId]);
}

export function sessionBody(session: Session): Record<string, unknown> {
  return {
    user: { id: session.accountId, email: session.email },
    device: { id: session.deviceId, name: session.deviceName },
  };
}
