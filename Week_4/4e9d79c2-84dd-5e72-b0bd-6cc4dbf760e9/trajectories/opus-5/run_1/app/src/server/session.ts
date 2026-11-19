import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { makeId, one, query } from './db.js';
import { Ctx, Desk, SESSION_COOKIE } from './http.js';
import { notSignedIn, sessionEnded } from './errors.js';
import { foldEmail } from '../domain/text.js';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'), 64);
  const kept = Buffer.from(keyHex, 'hex');
  return key.length === kept.length && timingSafeEqual(key, kept);
}

type SessionRow = { id: string; desk_id: string; expires_at: string; ended_at: string | null };
type DeskRow = { id: string; name: string; email: string };

export type SessionReading =
  | { kind: 'none' }
  | { kind: 'ended' }
  | { kind: 'live'; desk: Desk; sessionId: string };

export async function readSession(ctx: Ctx): Promise<SessionReading> {
  const token = ctx.cookie(SESSION_COOKIE);
  if (!token) return { kind: 'none' };
  const session = await one<SessionRow>('select id, desk_id, expires_at, ended_at from sessions where id = $1', [
    token,
  ]);
  if (!session) return { kind: 'ended' };
  if (session.ended_at !== null || Number(session.expires_at) <= Date.now()) return { kind: 'ended' };
  const desk = await one<DeskRow>('select id, name, email from desks where id = $1', [session.desk_id]);
  if (!desk) return { kind: 'ended' };
  return { kind: 'live', desk: { id: desk.id, name: desk.name, email: desk.email }, sessionId: session.id };
}

export async function attachSession(ctx: Ctx): Promise<SessionReading> {
  const reading = await readSession(ctx);
  if (reading.kind === 'live') {
    ctx.desk = reading.desk;
    ctx.sessionId = reading.sessionId;
  }
  ctx.sessionWasEnded = reading.kind === 'ended';
  return reading;
}

export function requireDesk(ctx: Ctx): Desk {
  if (ctx.desk) return ctx.desk;
  throw ctx.sessionWasEnded ? sessionEnded() : notSignedIn();
}

export async function startSession(ctx: Ctx, deskId: string): Promise<string> {
  const id = randomBytes(24).toString('base64url');
  const now = Date.now();
  await query('insert into sessions (id, desk_id, created_at, expires_at) values ($1, $2, $3, $4)', [
    id,
    deskId,
    now,
    now + config.sessionSeconds * 1000,
  ]);
  ctx.setCookie(id);
  return id;
}

export async function endSession(sessionId: string): Promise<void> {
  await query('update sessions set ended_at = $2 where id = $1 and ended_at is null', [sessionId, Date.now()]);
}

export async function endOtherSessions(deskId: string, keepSessionId: string): Promise<void> {
  await query('update sessions set ended_at = $3 where desk_id = $1 and id <> $2 and ended_at is null', [
    deskId,
    keepSessionId,
    Date.now(),
  ]);
}

export async function findDeskByEmail(email: string): Promise<(DeskRow & { password_hash: string }) | null> {
  return one<DeskRow & { password_hash: string }>(
    'select id, name, email, password_hash from desks where email_folded = $1',
    [foldEmail(email)],
  );
}

export async function makeDesk(name: string, email: string, password: string): Promise<Desk> {
  const id = makeId('DK');
  await query(
    'insert into desks (id, name, email, email_folded, password_hash, created_at) values ($1, $2, $3, $4, $5, $6)',
    [id, name, email, foldEmail(email), await hashPassword(password), Date.now()],
  );
  return { id, name, email };
}
