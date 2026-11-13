import { randomBytes } from 'node:crypto';
import type { Colour } from '../shared/types.ts';
import { database, type Db, type Row } from './db.ts';
import { sha256 } from './digest.ts';

export interface Actor {
  userId: string;
  displayName: string;
  initials: string;
  colour: Colour;
  email: string;
  tokenHash: string;
}

const SESSION_COOKIE = 'kinfold_session';

function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return null;
}

/** A new session: a random 256-bit token, stored only as its hash. */
export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)', [sha256(token), userId]);
  return token;
}

/** The person behind a session cookie, or null when the session is missing or ended. */
export async function authenticate(cookieHeader: string | undefined): Promise<Actor | null> {
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = sha256(token);
  const { rows } = await database().query<Row>(
    `SELECT u.id, u.display_name, u.initials, u.colour, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row['id'] as string,
    displayName: row['display_name'] as string,
    initials: row['initials'] as string,
    colour: row['colour'] as Colour,
    email: row['email'] as string,
    tokenHash,
  };
}

export async function sessionAlive(db: Db, tokenHash: string): Promise<boolean> {
  const { rowCount } = await db.query('SELECT 1 FROM sessions WHERE token_hash = $1', [tokenHash]);
  return (rowCount ?? 0) > 0;
}

export async function endSession(db: Db, tokenHash: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
}

/** Ends every session of the account except the one named; returns how many it ended. */
export async function endOtherSessions(db: Db, userId: string, keepHash: string): Promise<number> {
  const result = await db.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [userId, keepHash]);
  return result.rowCount ?? 0;
}

export const sessionCookie = (token: string): string => `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`;
export const expiredCookie = (): string => `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
