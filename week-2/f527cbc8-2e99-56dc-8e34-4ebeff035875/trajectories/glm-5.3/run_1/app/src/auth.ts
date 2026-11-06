import { connectDb, type Row } from './db.js';
import { AppError } from './errors.js';
import type { Role, Caller } from './context.js';
import { Handled } from './errors.js';

export interface Session {
  id: string;
  userId: string;
}

export async function loadSession(token: string): Promise<Row | null> {
  const rows = await connectDb().query(
    `select s.id as session_id, u.id, u.name, u.email, u.role, u.barn_id
     from sessions s join users u on u.id = s.user_id where s.id = $1`,
    [token]
  );
  return rows.rows[0] ?? null;
}

export async function resolveSession(token: string): Promise<Caller | null> {
  const row = await loadSession(token);
  if (!row) return null;
  return {
    type: 'session',
    id: row.id,
    role: row.role as Role,
    name: row.name,
    email: row.email
  };
}

export function currentRole(c: Caller): 'farrier' | 'apprentice' | 'owner' | 'barn_manager' {
  if (c.type === 'token') return 'farrier';
  return c.role as Role;
}
