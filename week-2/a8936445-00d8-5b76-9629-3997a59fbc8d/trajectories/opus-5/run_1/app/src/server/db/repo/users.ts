import { pool } from '../pool.js';
import type { UserRole } from '../../domain/constants.js';
import type { UserRecord } from '../../domain/types.js';

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tenant_id: string | null;
  password_hash: string;
}

function toUser(row: UserRow): UserRecord {
  return { id: row.id, email: row.email, name: row.name, role: row.role, tenantId: row.tenant_id };
}

export async function findUserByEmail(
  email: string,
): Promise<{ user: UserRecord; passwordHash: string } | null> {
  const result = await pool.query<UserRow>('SELECT * FROM users WHERE lower(email) = lower($1)', [
    email,
  ]);
  const row = result.rows[0];
  return row ? { user: toUser(row), passwordHash: row.password_hash } : null;
}

export async function findUserBySessionToken(token: string): Promise<UserRecord | null> {
  const result = await pool.query<UserRow>(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`,
    [token],
  );
  const row = result.rows[0];
  return row ? toUser(row) : null;
}

export async function createSession(token: string, userId: string): Promise<void> {
  await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]);
}

export async function deleteSession(token: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}
