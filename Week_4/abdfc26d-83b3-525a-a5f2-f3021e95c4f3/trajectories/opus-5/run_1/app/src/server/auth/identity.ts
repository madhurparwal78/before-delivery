import { query, type Queryable } from '../db/pool.js';
import { REALM_ROLES } from './keycloakAdmin.js';

export type AppRole = 'creator' | 'collector' | 'founder-operator';

export interface Principal {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly email: string;
  readonly roles: readonly AppRole[];
}

export function isAppRole(value: string): value is AppRole {
  return REALM_ROLES.includes(value);
}

export function hasRole(principal: Principal, role: AppRole): boolean {
  return principal.roles.includes(role);
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  email: string;
  roles: string[];
}

function toPrincipal(row: UserRow): Principal {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    roles: row.roles.filter(isAppRole),
  };
}

export async function upsertUser(
  client: Queryable,
  user: {
    id: string;
    username: string;
    displayName: string;
    email: string;
    roles: readonly string[];
  },
): Promise<Principal> {
  const result = await client.query<UserRow>(
    `INSERT INTO app_users (id, username, display_name, email, roles)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE
       SET username = EXCLUDED.username,
           display_name = EXCLUDED.display_name,
           email = EXCLUDED.email,
           roles = EXCLUDED.roles
     RETURNING id, username, display_name, email, roles`,
    [user.id, user.username, user.displayName, user.email, [...user.roles]],
  );
  const row = result.rows[0];
  if (!row) throw new Error('User upsert returned no row');
  return toPrincipal(row);
}

export async function findUserById(id: string): Promise<Principal | null> {
  const result = await query<UserRow>(
    'SELECT id, username, display_name, email, roles FROM app_users WHERE id = $1',
    [id],
  );
  const row = result.rows[0];
  return row ? toPrincipal(row) : null;
}
