import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { promisify } from 'node:util';

import { ERROR_MESSAGES, FIELD_MESSAGES } from '../shared/copy';
import { now } from './clock';
import { RATE_WINDOW_MS, config } from './config';
import { type Db, newId } from './db';
import { AppError, unauthenticated, validation } from './errors';

const scrypt = promisify(scryptCb);

export const SESSION_COOKIE = 'cupfold_session';

const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 32)) as Buffer;
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
};

const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const [scheme, salt, digest] = stored.split('$');
  if (scheme !== 'scrypt' || salt === undefined || digest === undefined) return false;
  const expected = Buffer.from(digest, 'base64url');
  const derived = (await scrypt(password, Buffer.from(salt, 'base64url'), expected.length)) as Buffer;
  return expected.length === derived.length && timingSafeEqual(expected, derived);
};

export const normalizeUsername = (raw: unknown): string => (typeof raw === 'string' ? raw.trim().toLowerCase() : '');

const USERNAME_SHAPE = /^[a-z0-9_]{3,24}$/;

export const validateCredentials = (usernameRaw: unknown, passwordRaw: unknown): { username: string; password: string } => {
  const username = normalizeUsername(usernameRaw);
  const password = typeof passwordRaw === 'string' ? passwordRaw : '';
  const fields: Record<string, string> = {};
  if (!USERNAME_SHAPE.test(username)) fields.username = FIELD_MESSAGES.username;
  if (password.length < 8) fields.password = FIELD_MESSAGES.password;
  if (Object.keys(fields).length > 0) throw validation(fields);
  return { username, password };
};

export const countRate = async (db: Db, bucket: string, limit: number): Promise<boolean> => {
  const cutoff = new Date(now() - RATE_WINDOW_MS);
  const { rows } = await db.query<{ count: string }>(
    'select count(*)::text as count from rate_events where bucket = $1 and at > $2',
    [bucket, cutoff],
  );
  return Number(rows[0]?.count ?? '0') >= limit;
};

export const noteRate = async (db: Db, bucket: string): Promise<void> => {
  await db.query('insert into rate_events (bucket, at) values ($1, $2)', [bucket, new Date(now())]);
};

export const guardLoginRate = async (db: Db, username: string): Promise<void> => {
  if (await countRate(db, `signin:${username}`, config.loginRate)) {
    throw new AppError('rate_limited', ERROR_MESSAGES.rateLimitedSignin);
  }
  await noteRate(db, `signin:${username}`);
};

export const guardMatchWriteRate = async (db: Db, userId: string): Promise<void> => {
  if (await countRate(db, `match:${userId}`, config.reportRate)) {
    throw new AppError('rate_limited', ERROR_MESSAGES.rateLimitedReports);
  }
  await noteRate(db, `match:${userId}`);
};

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
}

export const createUser = async (db: Db, username: string, password: string): Promise<UserRow> => {
  const existing = await db.query('select id from users where username = $1', [username]);
  if (existing.rows.length > 0) throw new AppError('username_taken', ERROR_MESSAGES.usernameTaken);
  const id = newId();
  const passwordHash = await hashPassword(password);
  await db.query('insert into users (id, username, password_hash, created_at) values ($1, $2, $3, $4)', [
    id,
    username,
    passwordHash,
    new Date(now()),
  ]);
  return { id, username, password_hash: passwordHash };
};

export const findUser = async (db: Db, username: string): Promise<UserRow | null> => {
  const { rows } = await db.query<UserRow>('select id, username, password_hash from users where username = $1', [
    username,
  ]);
  return rows[0] ?? null;
};

export const signInUser = async (db: Db, username: string, password: string): Promise<UserRow> => {
  const user = await findUser(db, username);
  if (user === null || !(await verifyPassword(password, user.password_hash))) {
    throw new AppError('bad_credentials', ERROR_MESSAGES.badCredentials);
  }
  return user;
};

export const startSession = async (db: Db, res: ServerResponse, userId: string): Promise<void> => {
  const id = newId() + newId();
  await db.query('insert into sessions (id, user_id, created_at) values ($1, $2, $3)', [id, userId, new Date(now())]);
  res.setHeader('set-cookie', `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Lax; Path=/`);
};

export const clearSession = async (db: Db, res: ServerResponse, sessionId: string | null): Promise<void> => {
  if (sessionId !== null) await db.query('delete from sessions where id = $1', [sessionId]);
  res.setHeader('set-cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
};

export const sessionUser = async (db: Db, sessionId: string): Promise<{ id: string; username: string } | null> => {
  const { rows } = await db.query<{ id: string; username: string }>(
    'select users.id, users.username from sessions join users on users.id = sessions.user_id where sessions.id = $1',
    [sessionId],
  );
  return rows[0] ?? null;
};

export const requireUser = (ctx: { userId: string | null; username: string | null }): { id: string; username: string } => {
  if (ctx.userId === null || ctx.username === null) throw unauthenticated();
  return { id: ctx.userId, username: ctx.username };
};
