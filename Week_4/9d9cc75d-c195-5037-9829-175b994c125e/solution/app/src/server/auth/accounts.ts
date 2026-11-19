import type { App, AuthUser } from '../http/app.ts';
import { invalid } from '../http/errors.ts';
import { newId } from '../db/ids.ts';
import { hashPassword } from './password.ts';

const USERNAME_MESSAGE = 'Username must be 3 to 24 letters, digits or _.';
const PASSWORD_MESSAGE = 'Password must be at least 8 characters.';
export const TAKEN_MESSAGE = 'That username is taken.';

const USERNAME = /^[A-Za-z0-9_]{3,24}$/;

function validUsername(value: unknown): value is string {
  return typeof value === 'string' && USERNAME.test(value);
}

/** Usernames are stored in lower case. */
export function normalizeUsername(value: string): string {
  return value.toLowerCase();
}

export async function findUser(app: App, username: string): Promise<AuthUser | null> {
  return app.db.row<AuthUser>(`SELECT id, username FROM users WHERE username = $1`, [normalizeUsername(username)]);
}

/** Validates (422) and inserts a user; returns null when the username is already taken. */
export async function createUser(app: App, username: unknown, password: unknown): Promise<AuthUser | null> {
  const errors: Record<string, string> = {};
  if (!validUsername(username)) errors.username = USERNAME_MESSAGE;
  if (typeof password !== 'string' || password.length < 8) errors.password = PASSWORD_MESSAGE;
  if (!validUsername(username)) throw invalid(errors);
  if (await findUser(app, username)) return null;
  if (Object.keys(errors).length > 0) throw invalid(errors);
  const user = { id: newId(), username: normalizeUsername(username) };
  const hash = await hashPassword(String(password));
  const inserted = await app.db.exec(
    `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING`,
    [user.id, user.username, hash],
  );
  return inserted === 1 ? user : null;
}
