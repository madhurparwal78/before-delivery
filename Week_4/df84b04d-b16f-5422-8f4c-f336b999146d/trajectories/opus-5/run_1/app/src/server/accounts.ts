import { randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { fixed } from '../shared/copy.js';
import { config } from './config.js';
import { pool, query } from './db.js';
import { ApiError, invalid, mailUnavailable } from './errors.js';
import { sendConfirmationCode, sendSignUpAttemptNotice } from './mail.js';
import type { Viewer } from './scope.js';

const scryptAsync = promisify(scrypt);
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, 32)) as Buffer;
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [, salt, hash] = stored.split('$');
  if (salt === undefined || hash === undefined) return false;
  const derived = (await scryptAsync(password, salt, 32)) as Buffer;
  const expected = Buffer.from(hash, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  confirmed: boolean;
  hide_completed: boolean;
}

export async function userByEmail(email: string): Promise<UserRow | null> {
  const rows = await query<UserRow>(
    `select id, email, name, password_hash, confirmed, hide_completed from users where email = $1`,
    [email]
  );
  return rows[0] ?? null;
}

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
}

function checkSignUp(input: SignUpInput): { name: string; email: string; password: string } {
  const errors: Record<string, string> = {};
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (name === '' || name.length > 80) errors['name'] = fixed.nameRequired;
  if (!EMAIL.test(email)) errors['email'] = fixed.emailInvalid;
  if (password.length < 10) errors['password'] = fixed.passwordShort;
  if (Object.keys(errors).length > 0) throw invalid(errors);
  return { name, email, password };
}

async function writeCode(userId: string): Promise<string> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await pool.query(
    `insert into confirmation_codes (user_id, code, expires_at)
     values ($1, $2, now() + make_interval(secs => $3))
     on conflict (user_id) do update set code = excluded.code, expires_at = excluded.expires_at`,
    [userId, code, config.confirmCodeSeconds]
  );
  return code;
}

/**
 * Signing up answers the same way for a new and for a taken address, and only
 * after Mailpit has accepted exactly one message.
 */
export async function signUp(input: SignUpInput): Promise<void> {
  const { name, email, password } = checkSignUp(input);
  const existing = await userByEmail(email);
  if (existing !== null && existing.confirmed) {
    const accepted = await sendSignUpAttemptNotice(email);
    if (!accepted) throw mailUnavailable();
    return;
  }
  let userId: string;
  if (existing === null) {
    userId = randomUUID();
    await pool.query(
      `insert into users (id, email, name, password_hash, confirmed) values ($1, $2, $3, $4, false)`,
      [userId, email, name, await hashPassword(password)]
    );
  } else {
    userId = existing.id;
    await pool.query(`update users set name = $2, password_hash = $3 where id = $1`, [
      userId,
      name,
      await hashPassword(password)
    ]);
  }
  const code = await writeCode(userId);
  const accepted = await sendConfirmationCode(email, code);
  if (!accepted) throw mailUnavailable();
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
}

export async function confirmSignUp(email: string, code: string): Promise<PublicUser> {
  const user = await userByEmail(String(email ?? '').trim().toLowerCase());
  if (user === null) throw invalid({ code: fixed.codeWrong });
  const rows = await query<{ code: string; expired: boolean }>(
    `select code, (expires_at <= now()) as expired from confirmation_codes where user_id = $1`,
    [user.id]
  );
  const pending = rows[0];
  if (pending === undefined) throw invalid({ code: fixed.codeWrong });
  if (pending.code !== String(code ?? '').trim()) throw invalid({ code: fixed.codeWrong });
  if (pending.expired) throw invalid({ code: fixed.codeExpired });
  await pool.query(`update users set confirmed = true where id = $1`, [user.id]);
  await pool.query(`delete from confirmation_codes where user_id = $1`, [user.id]);
  return { id: user.id, email: user.email, name: user.name };
}

export async function signIn(email: string, password: string): Promise<PublicUser> {
  const user = await userByEmail(String(email ?? '').trim().toLowerCase());
  if (user === null || !user.confirmed) throw new ApiError(401, { error: 'invalid_credentials' });
  if (!(await passwordMatches(String(password ?? ''), user.password_hash))) {
    throw new ApiError(401, { error: 'invalid_credentials' });
  }
  return { id: user.id, email: user.email, name: user.name };
}

export async function openSession(userId: string): Promise<string> {
  const id = randomBytes(24).toString('hex');
  await pool.query(`insert into sessions (id, user_id) values ($1, $2)`, [id, userId]);
  return id;
}

export async function closeSession(id: string): Promise<void> {
  await pool.query(`delete from sessions where id = $1`, [id]);
}

export async function viewerBySession(sessionId: string): Promise<Viewer | null> {
  const rows = await query<{ id: string; email: string; name: string; hide_completed: boolean }>(
    `select u.id, u.email, u.name, u.hide_completed
       from sessions s join users u on u.id = s.user_id
      where s.id = $1 and u.confirmed = true`,
    [sessionId]
  );
  const row = rows[0];
  if (row === undefined) return null;
  return { userId: row.id, email: row.email, name: row.name, hideCompleted: row.hide_completed };
}

export async function setHideCompleted(userId: string, hideCompleted: boolean): Promise<void> {
  await pool.query(`update users set hide_completed = $2 where id = $1`, [userId, hideCompleted]);
}
