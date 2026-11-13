import type { Role, SessionUser } from '../../shared/api.js';
import { query } from '../db/pool.js';
import type { HeldCredential } from '../domain/qualification.js';

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  org_id: string | null;
  initials: string | null;
  phone: string | null;
  home_city: string | null;
  pay_rate_cents: number | null;
}

export interface InterpreterRecord {
  id: string;
  name: string;
  initials: string;
  email: string;
  phone: string;
  home_city: string;
  pay_rate_cents: number;
  credentials: HeldCredential[];
}

export function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    org_id: row.role === 'requester' ? row.org_id : null,
  };
}

interface InterpreterRow extends UserRow {
  credentials: HeldCredential[] | null;
}

const INTERPRETER_SELECT = `
  SELECT u.id, u.name, u.email, u.role, u.org_id, u.initials, u.phone, u.home_city, u.pay_rate_cents,
         COALESCE(
           (SELECT json_agg(json_build_object('code', c.code, 'expires_on', c.expires_on) ORDER BY c.code)
            FROM credentials c WHERE c.user_id = u.id),
           '[]'::json
         ) AS credentials
  FROM users u
  WHERE u.role = 'interpreter'
`;

function toInterpreter(row: InterpreterRow): InterpreterRecord {
  return {
    id: row.id,
    name: row.name,
    initials: row.initials ?? '',
    email: row.email,
    phone: row.phone ?? '',
    home_city: row.home_city ?? '',
    pay_rate_cents: row.pay_rate_cents ?? 0,
    credentials: row.credentials ?? [],
  };
}

export async function allInterpreters(): Promise<InterpreterRecord[]> {
  const rows = await query<InterpreterRow>(`${INTERPRETER_SELECT} ORDER BY u.name`);
  return rows.map(toInterpreter);
}

export async function findInterpreter(id: string): Promise<InterpreterRecord | null> {
  const rows = await query<InterpreterRow>(`${INTERPRETER_SELECT} AND u.id = $1`, [id]);
  const row = rows[0];
  return row ? toInterpreter(row) : null;
}
