import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pool } from './db.js';
import { forbidden, unauthenticated } from './errors.js';
import { parseCookies } from './http.js';
import type { Role } from '../shared/types.js';

export const SESSION_COOKIE = 'tallyslate_session';
export const RENTER_KEY_HEADER = 'x-renter-key';

export type StaffRole = 'owner' | 'prep_tech';

export function newOpaqueKey(): string {
  return randomBytes(24).toString('base64url');
}

export async function signIn(passcode: string): Promise<{ id: string; role: StaffRole } | null> {
  const found = await pool.query<{ role: StaffRole }>(
    `SELECT role FROM staff_passcodes WHERE passcode = $1`,
    [passcode],
  );
  const role = found.rows[0]?.role;
  if (role === undefined) return null;
  const id = newOpaqueKey();
  await pool.query(`INSERT INTO staff_sessions (id, role) VALUES ($1, $2)`, [id, role]);
  return { id, role };
}

export async function signOut(req: IncomingMessage): Promise<void> {
  const id = parseCookies(req)[SESSION_COOKIE];
  if (id !== undefined) await pool.query(`DELETE FROM staff_sessions WHERE id = $1`, [id]);
}

export async function staffRole(req: IncomingMessage): Promise<StaffRole | null> {
  const id = parseCookies(req)[SESSION_COOKIE];
  if (id === undefined) return null;
  const found = await pool.query<{ role: StaffRole }>(
    `SELECT role FROM staff_sessions WHERE id = $1`,
    [id],
  );
  return found.rows[0]?.role ?? null;
}

export async function requireStaff(req: IncomingMessage): Promise<StaffRole> {
  const role = await staffRole(req);
  if (role === null) throw unauthenticated();
  return role;
}

export async function requireOwner(req: IncomingMessage): Promise<'owner'> {
  const role = await requireStaff(req);
  if (role !== 'owner') throw forbidden();
  return role;
}

export function renterKeyHeader(req: IncomingMessage): string | null {
  const value = req.headers[RENTER_KEY_HEADER];
  if (typeof value === 'string' && value !== '') return value;
  return null;
}

export function setSessionCookie(res: ServerResponse, id: string): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
  );
}

export function clearSessionCookie(res: ServerResponse): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export type BookingAccess = { role: Role };
