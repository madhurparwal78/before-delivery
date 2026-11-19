import { query } from './db';
import { invalidCredentials, notFound, forbidden, emailInvalid, weakPassword, alreadyRegistered, seedConflict } from './errors';
import { verifyPassword, hashPassword, randomToken, sha256 } from './crypto';
import type { Principal } from './http';
import { audienceOfRole, isRole, type Role } from '../shared/domain';
import type { Config } from './config';

export interface PrincipalRow {
  id: string;
  email: string;
  display_name: string;
  role: string;
  organisation_id: string | null;
}

export async function principalByEmail(email: string): Promise<PrincipalRow | null> {
  const rows = await query<PrincipalRow>(
    'SELECT id, email, display_name, role, organisation_id FROM principals WHERE lower(email) = lower($1)',
    [email],
  );
  return rows.length > 0 ? rows[0] : null;
}

export async function principalById(id: string): Promise<PrincipalRow | null> {
  const rows = await query<PrincipalRow>('SELECT id, email, display_name, role, organisation_id FROM principals WHERE id = $1', [id]);
  return rows.length > 0 ? rows[0] : null;
}

export function toPrincipal(row: PrincipalRow): Principal {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    organisationId: row.organisation_id,
  };
}

export async function checkCredentials(email: unknown, password: unknown): Promise<Principal> {
  if (typeof email !== 'string' || typeof password !== 'string') throw invalidCredentials();
  const row = await query<{ id: string; email: string; display_name: string; role: string; organisation_id: string | null; password_hash: string }>(
    'SELECT id, email, display_name, role, organisation_id, password_hash FROM principals WHERE lower(email) = lower($1)',
    [email],
  );
  if (row.length === 0 || !verifyPassword(password, row[0].password_hash)) throw invalidCredentials();
  return toPrincipal(row[0]);
}

export function validateEmail(email: unknown): string {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw emailInvalid();
  return email;
}

export function validatePassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < 12) throw weakPassword();
  return password;
}

export function roleLabel(role: Role): string {
  switch (role) {
    case 'agency':
      return 'Agency partner';
    case 'press':
      return 'Press contact';
    case 'owner':
      return 'Brand owner';
    case 'brand_reviewer':
      return 'Brand reviewer';
    case 'legal_reviewer':
      return 'Legal reviewer';
    case 'author':
      return 'Chapter author';
    case 'employee':
      return 'Employee';
  }
}

export { query, notFound, forbidden, hashPassword, randomToken, sha256, audienceOfRole, isRole, alreadyRegistered, seedConflict };
export type { Config };
