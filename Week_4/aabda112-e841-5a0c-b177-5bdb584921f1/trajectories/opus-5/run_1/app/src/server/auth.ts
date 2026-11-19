import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { newId, one, query } from './db';
import { AppError } from './errors';

export type Role = 'front-desk' | 'nurse' | 'vet' | 'manager';

export type Actor = {
  id: string;
  clinicId: string;
  name: string;
  email: string;
  role: Role;
  status: string;
};

export const SESSION_COOKIE = 'rb_session';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [, salt, derived] = stored.split(':');
  if (!salt || !derived) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(derived, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export async function createSession(userId: string, response: Response): Promise<void> {
  const id = randomBytes(32).toString('hex');
  await query('insert into sessions (id, user_id) values ($1, $2)', [id, userId]);
  response.cookie(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 3600 * 1000,
  });
}

export async function destroySession(request: Request, response: Response): Promise<void> {
  const id = readCookie(request, SESSION_COOKIE);
  if (id) await query('delete from sessions where id = $1', [id]);
  response.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** The role is read from Postgres on every request, never from the cookie. */
export async function currentActor(request: Request): Promise<Actor | null> {
  const sessionId = readCookie(request, SESSION_COOKIE);
  if (!sessionId) return null;
  const row = await one<{
    id: string;
    clinic_id: string;
    name: string;
    email: string;
    role: Role;
    status: string;
  }>(
    `select u.id, u.clinic_id, u.name, u.email, u.role, u.status
       from sessions s join users u on u.id = s.user_id
      where s.id = $1`,
    [sessionId],
  );
  if (!row || row.status !== 'Active') return null;
  return {
    id: row.id,
    clinicId: row.clinic_id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
  };
}

export async function requireActor(request: Request): Promise<Actor> {
  const actor = await currentActor(request);
  if (!actor) throw new AppError('unauthenticated');
  return actor;
}

export type Capability =
  | 'read'
  | 'appointment.manage'
  | 'consult.manage'
  | 'ward.manage'
  | 'files.write'
  | 'invoice.read'
  | 'invoice.build'
  | 'invoice.money'
  | 'manage.clinic';

const CAPABILITIES: Record<Capability, Role[]> = {
  read: ['front-desk', 'nurse', 'vet', 'manager'],
  'appointment.manage': ['front-desk', 'vet', 'manager'],
  'consult.manage': ['vet', 'manager'],
  'ward.manage': ['nurse', 'vet', 'manager'],
  'files.write': ['vet', 'nurse', 'manager'],
  'invoice.read': ['front-desk', 'vet', 'manager'],
  'invoice.build': ['vet', 'manager'],
  'invoice.money': ['front-desk', 'manager'],
  'manage.clinic': ['manager'],
};

export function allows(role: Role, capability: Capability): boolean {
  return CAPABILITIES[capability].includes(role);
}

/** The one permission check path for every endpoint. */
export function requireCapability(actor: Actor, capability: Capability): void {
  if (!allows(actor.role, capability)) throw new AppError('forbidden');
}

export function isSafeLandingPath(next: unknown): next is string {
  if (typeof next !== 'string' || next.length === 0) return false;
  if (next[0] !== '/') return false;
  if (next[1] === '/' || next[1] === '\\') return false;
  if (next.includes('\\')) return false;
  if (/[\u0000-\u001f\u007f]/.test(next)) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(next.slice(1))) return false;
  return true;
}

export function landingFor(next: unknown): string {
  return isSafeLandingPath(next) ? next : '/today';
}

export const ROLE_LABELS: Record<Role, string> = {
  'front-desk': 'Front desk',
  nurse: 'Nurse',
  vet: 'Vet',
  manager: 'Manager',
};

export function isRole(value: unknown): value is Role {
  return value === 'front-desk' || value === 'nurse' || value === 'vet' || value === 'manager';
}

export async function createLoginToken(userId: string): Promise<string> {
  const token = randomBytes(24).toString('hex');
  await query('insert into login_tokens (token, user_id) values ($1, $2)', [token, userId]);
  return token;
}

export function newInviteToken(): string {
  return randomBytes(24).toString('hex');
}

export function newUserId(): string {
  return newId();
}
