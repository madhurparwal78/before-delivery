import type { Role } from '../../shared/contract.js';
import type { Queryable } from './pool.js';

export interface UserRecord {
  id: number;
  name: string;
  email: string;
  role: Role;
  org_id: number | null;
  org_code: string | null;
  org_name: string | null;
  phone: string;
  initials: string;
}

const USER_SELECT = `
SELECT u.id, u.name, u.email, u.role, u.org_id, o.code AS org_code, o.name AS org_name, u.phone, u.initials
FROM users u
LEFT JOIN orgs o ON o.id = u.org_id`;

export async function findActiveUserByEmail(
  db: Queryable,
  email: string,
): Promise<(UserRecord & { password_hash: string }) | null> {
  const result = await db.query<UserRecord & { password_hash: string }>(
    `${USER_SELECT.replace('u.initials', 'u.initials, u.password_hash')} WHERE lower(u.email) = lower($1) AND u.active`,
    [email],
  );
  return result.rows[0] ?? null;
}

export async function languagesOf(db: Queryable, userId: number): Promise<string[]> {
  const result = await db.query<{ language_code: string }>(
    'SELECT language_code FROM user_languages WHERE user_id = $1',
    [userId],
  );
  return result.rows.map((row) => row.language_code);
}

export async function qualifiedInterpreters(
  db: Queryable,
  languageCode: string,
): Promise<Array<{ id: number; name: string; email: string }>> {
  const result = await db.query<{ id: number; name: string; email: string }>(
    `SELECT u.id, u.name, u.email
     FROM users u
     JOIN user_languages ul ON ul.user_id = u.id
     WHERE u.role = 'interpreter' AND u.active AND ul.language_code = $1
     ORDER BY u.id ASC`,
    [languageCode],
  );
  return result.rows;
}

export async function emailOf(db: Queryable, userId: number): Promise<string> {
  const result = await db.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId]);
  const email = result.rows[0]?.email;
  if (email === undefined) {
    throw new Error(`user ${userId} disappeared`);
  }
  return email;
}
