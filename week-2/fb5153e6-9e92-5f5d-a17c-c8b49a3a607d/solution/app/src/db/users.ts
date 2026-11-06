import { randomBytes } from 'node:crypto';
import { query, queryOne } from './pool.js';
import type { Role, Session } from '../domain/session.js';
import { verifyPassword } from '../domain/session.js';

interface UserRow {
  id: number;
  email: string;
  name: string;
  role: Role;
  password_hash: string;
}

export interface UserRecord {
  readonly id: number;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
}

export async function authenticate(email: string, password: string): Promise<UserRecord | null> {
  const row = await queryOne<UserRow>(`SELECT * FROM users WHERE lower(email) = lower($1)`, [
    email,
  ]);
  if (row === null) return null;
  if (!(await verifyPassword(password, row.password_hash))) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export async function authorUser(): Promise<UserRecord> {
  const row = await queryOne<UserRow>(`SELECT * FROM users WHERE role = 'author' ORDER BY id LIMIT 1`);
  if (row === null) throw new Error('The author user is missing');
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export async function createSession(userId: number): Promise<string> {
  const id = randomBytes(24).toString('base64url');
  await query(`INSERT INTO sessions (id, user_id) VALUES ($1, $2)`, [id, userId]);
  return id;
}

export async function loadSession(id: string): Promise<Session | null> {
  const row = await queryOne<{ id: string; user_id: number; email: string; role: Role }>(
    `SELECT s.id, s.user_id, u.email, u.role
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
    [id],
  );
  return row === null
    ? null
    : { id: row.id, userId: row.user_id, email: row.email, role: row.role };
}

export async function destroySession(id: string): Promise<void> {
  await query(`DELETE FROM sessions WHERE id = $1`, [id]);
}

export async function sessionSecret(): Promise<string> {
  const existing = await queryOne<{ value: string }>(
    `SELECT value FROM app_secrets WHERE name = 'session'`,
  );
  if (existing !== null) return existing.value;
  const created = randomBytes(32).toString('base64url');
  const row = await queryOne<{ value: string }>(
    `INSERT INTO app_secrets (name, value) VALUES ('session', $1)
     ON CONFLICT (name) DO UPDATE SET value = app_secrets.value
     RETURNING value`,
    [created],
  );
  return row?.value ?? created;
}
