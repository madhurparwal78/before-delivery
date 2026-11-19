import { randomBytes } from 'node:crypto';
import { query } from './db';
import { sha256 } from './crypto';
import type { Principal } from './http';

export interface SessionRow {
  token_hash: string;
  principal_id: string;
}

export async function createSession(principalId: string): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await query('INSERT INTO sessions (token_hash, principal_id, created_at) VALUES ($1,$2,$3)', [
    sha256(token),
    principalId,
    new Date(),
  ]);
  return token;
}

export async function verifySession(token: string): Promise<Principal | null> {
  const rows = await query<{
    id: string;
    email: string;
    display_name: string;
    role: string;
    organisation_id: string | null;
  }>(
    `SELECT p.id, p.email, p.display_name, p.role, p.organisation_id
       FROM sessions s JOIN principals p ON p.id = s.principal_id
      WHERE s.token_hash = $1`,
    [sha256(token)],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    organisationId: row.organisation_id,
  };
}

export async function endSession(token: string): Promise<void> {
  await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}

export function cookieHeader(name: string, token: string): string {
  return `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearCookieHeader(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
