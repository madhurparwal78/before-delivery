import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { db, one } from './db';
import { newToken } from './ids';
import type { Role, SessionUser } from '../shared/types';

export const SESSION_COOKIE = 'galley_session';
export const READER_COOKIE = 'galley_reader';

/** The signed-in person behind a request. The role is read from the database on every request. */
export interface Principal {
  user: SessionUser;
  teamId: string;
  teamName: string;
  role: Role;
}

const KEY_LENGTH = 64;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString('base64')}$${(await derive(password, salt)).toString('base64')}`;
}

const DECOY = hashPassword('galley-decoy-password');

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [saltText, keyText] = (stored ?? (await DECOY)).split('$');
  const expected = Buffer.from(keyText ?? '', 'base64');
  const actual = await derive(password, Buffer.from(saltText ?? '', 'base64'));
  return stored !== null && expected.length === actual.length && timingSafeEqual(expected, actual);
}

const digest = (token: string): string => createHash('sha256').update(token).digest('hex');

export async function createSession(userId: string): Promise<string> {
  const token = newToken();
  await db.query('insert into sessions (token_hash, user_id) values ($1, $2)', [digest(token), userId]);
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await db.query('delete from sessions where token_hash = $1', [digest(token)]);
}

export async function principalForToken(token: string): Promise<Principal | null> {
  const row = await one<{ id: string; email: string; name: string; role: Role; teamId: string; teamName: string }>(
    db,
    `select u.id, u.email, u.name, u.role, u.team_id, t.name as team_name
       from sessions s join users u on u.id = s.user_id join teams t on t.id = u.team_id
      where s.token_hash = $1`,
    [digest(token)],
  );
  return row
    ? { user: { id: row.id, email: row.email, name: row.name }, teamId: row.teamId, teamName: row.teamName, role: row.role }
    : null;
}
