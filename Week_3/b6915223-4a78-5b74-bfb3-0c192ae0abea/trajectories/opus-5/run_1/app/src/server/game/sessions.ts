import { randomBytes } from 'node:crypto';
import { one, pool, query } from '../db.ts';
import { SESSION_COOKIE } from '../config.ts';

export interface ManagerRecord {
  id: string;
  pb_user_id: string;
  email: string;
  team_name: string;
  role: 'manager' | 'operator';
}

export const createSession = async (managerId: string): Promise<string> => {
  const token = randomBytes(32).toString('base64url');
  await query(pool, 'insert into sessions (token, manager_id) values ($1, $2)', [token, managerId]);
  return token;
};

export const deleteSession = async (token: string): Promise<void> => {
  await query(pool, 'delete from sessions where token = $1', [token]);
};

export const readCookie = (header: string | undefined, name: string): string | null => {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
};

export const managerForToken = async (token: string): Promise<ManagerRecord | null> =>
  (await one<ManagerRecord>(
    pool,
    `select m.id, m.pb_user_id, m.email, m.team_name, m.role
       from sessions s join managers m on m.id = s.manager_id
      where s.token = $1`,
    [token],
  )) ?? null;

export const sessionManager = async (
  cookieHeader: string | undefined,
): Promise<ManagerRecord | null> => {
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  return token === null ? null : managerForToken(token);
};
