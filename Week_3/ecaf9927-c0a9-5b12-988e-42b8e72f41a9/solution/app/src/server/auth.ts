import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Member } from '../shared/api';
import { pool } from './db';
import { badCredentials, invalid } from './errors';
import { FIELD_MESSAGES } from '../shared/messages';
import { memberById, memberJson, type MemberRow } from './repo';
import { objectBody } from './validate';

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;
const KEY_LENGTH = 32;

export const SESSION_COOKIE = 'kerfline_session';
const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH);
  return `${salt.toString('base64')}:${key.toString('base64')}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [salt = '', key = ''] = stored.split(':');
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), KEY_LENGTH);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const digest = (token: string): string => createHash('sha256').update(token).digest('hex');

/** A fixed hash so an unknown email costs the same time as a wrong password. */
const DECOY = await hashPassword('decoy');

export async function signIn(input: unknown): Promise<{ member: Member; cookie: string }> {
  const body = objectBody(input);
  const fields: Record<string, string> = {};
  if (typeof body['email'] !== 'string' || body['email'].trim() === '') fields['email'] = FIELD_MESSAGES.email;
  if (typeof body['password'] !== 'string' || body['password'] === '') fields['password'] = FIELD_MESSAGES.password;
  if (Object.keys(fields).length > 0) throw invalid(fields);
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM members WHERE lower(email) = lower($1)', [(body['email'] as string).trim()]);
  const member = rows[0] ? await memberById(pool, rows[0].id) : undefined;
  const matches = await passwordMatches(body['password'] as string, member?.passwordHash ?? DECOY);
  if (!member || !matches) throw badCredentials();
  const token = randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO sessions (token_hash, member_id) VALUES ($1, $2)', [digest(token), member.id]);
  return {
    member: memberJson(member),
    cookie: `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`,
  };
}

export async function memberForToken(token: string | undefined): Promise<MemberRow | undefined> {
  if (!token) return undefined;
  const { rows } = await pool.query<{ member_id: string }>('SELECT member_id FROM sessions WHERE token_hash = $1', [digest(token)]);
  return rows[0] ? memberById(pool, rows[0].member_id) : undefined;
}

export async function signOut(token: string): Promise<string> {
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [digest(token)]);
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
