import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { one, query } from './db.js';

export interface PersonRow {
  id: string;
  world_id: string;
  email: string;
  password_hash: string;
  display_name: string;
  time_zone: string;
  site_role: string;
  confirmed: boolean;
  suspended: boolean;
  avatar_asset_id: string | null;
  hide_above: string | null;
}

export const SESSION_COOKIE = 'hearthtile_session';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function passwordMatches(password: string, stored: string): boolean {
  const [salt, digest] = stored.split(':');
  if (salt === undefined || digest === undefined) return false;
  const expected = Buffer.from(digest, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function createAuthToken(personId: string): Promise<string> {
  const token = randomUUID().replace(/-/g, '') + randomBytes(8).toString('hex');
  await query('insert into auth_tokens (token, person_id) values ($1, $2)', [token, personId]);
  return token;
}

export async function dropAuthToken(token: string): Promise<void> {
  await query('delete from auth_tokens where token = $1', [token]);
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export async function personForToken(token: string | null): Promise<PersonRow | null> {
  if (token === null) return null;
  return one<PersonRow>(
    `select p.* from auth_tokens t join people p on p.id = t.person_id where t.token = $1`,
    [token]
  );
}
