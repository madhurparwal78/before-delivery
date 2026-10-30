// Sessions, password hashing, and member auth.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { one, query } from './db.js';
import { ApiError, accessRemoved, FIELD_ERRORS } from './errors.js';
import type { Member, Role } from './types.js';
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return derived.length === hash.length && timingSafeEqual(Buffer.from(derived), Buffer.from(hash));
}

export async function createSession(memberId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await query('INSERT INTO sessions (token, member_id) VALUES ($1, $2)', [token, memberId]);
  return token;
}

export function setSessionCookie(res: Response, token: string, maxAgeSeconds: number): void {
  res.setHeader('Set-Cookie', `plumbline_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`);
}

export interface AuthedRequest extends Request {
  member?: Member;
}

export async function loadSession(req: Request, idleTimeoutSeconds: number): Promise<Member | null> {
  const cookie = headerCookie(req);
  if (!cookie) return null;
  const row = await one<{
    token: string;
    member_id: string;
    last_used: Date;
    id: string;
    email: string;
    name: string;
    role: Role;
    phone: string | null;
    brand_id: string | null;
    company_id: string | null;
    status: string;
    approval_hkd: string | null;
    approval_sgd: string | null;
    version: number;
  }>(
    `SELECT s.token, s.last_used, m.* FROM sessions s JOIN members m ON m.id = s.member_id WHERE s.token = $1`,
    [cookie],
  );
  if (!row) return null;
  const now = Date.now();
  if (now - row.last_used.getTime() > idleTimeoutSeconds * 1000) {
    await query('DELETE FROM sessions WHERE token = $1', [cookie]);
    return null;
  }
  if (row.status !== 'active') return row as unknown as Member; // still resolvable, callers answer access_removed
  await query('UPDATE sessions SET last_used = now() WHERE token = $1', [cookie]);
  return memberFromRow(row);
}

export function memberFromRow(row: {
  id: string;
  email: string;
  name: string;
  role: string;
  phone: string | null;
  brand_id: string | null;
  company_id: string | null;
  status: string;
  approval_hkd: string | null;
  approval_sgd: string | null;
  version: number;
}): Member {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as Role,
    phone: row.phone,
    brandId: row.brand_id,
    companyId: row.company_id,
    status: row.status as Member['status'],
    approvalHkd: row.approval_hkd === null ? null : parseInt(row.approval_hkd, 10),
    approvalSgd: row.approval_sgd === null ? null : parseInt(row.approval_sgd, 10),
    version: row.version,
  };
}

function headerCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'plumbline_session') return rest.join('=');
  }
  return null;
}

export async function endSession(req: Request): Promise<void> {
  const cookie = headerCookie(req);
  if (cookie) {
    await query('DELETE FROM sessions WHERE token = $1', [cookie]);
  }
}

/** Middleware: require a valid session. 401 session_ended / 403 access_removed. */
export function requireSession(idleTimeoutSeconds: number) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const member = await loadSession(req, idleTimeoutSeconds);
      if (!member) throw new ApiError(401, { error: 'session_ended' });
      if (member.status === 'removed') throw accessRemoved();
      req.member = member;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireRole(roles: Role[]) {
  return (req: AuthedRequest, _res: Response, next: NextFunction): void => {
    const member = req.member!;
    if (!roles.includes(member.role)) {
      next(new ApiError(403, { error: 'forbidden' }));
      return;
    }
    next();
  };
}

export async function memberById(id: string): Promise<Member | null> {
  const row = await one<Parameters<typeof memberFromRow>[0]>('SELECT * FROM members WHERE id = $1', [id]);
  return row ? memberFromRow(row) : null;
}

export function validatePassword(password: unknown, errors: Record<string, string>): void {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    errors.password = FIELD_ERRORS.range('Password', '12 and 128 characters');
    return;
  }
}
