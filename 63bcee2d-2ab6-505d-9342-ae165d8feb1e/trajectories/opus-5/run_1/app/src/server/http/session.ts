/** Sessions, passwords and the signed-in member. */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Role } from '../../shared/domain.js';
import { STUDIO_ORGANISATION } from '../../shared/domain.js';
import { config } from '../config.js';
import { newId } from '../db/ids.js';
import { firstRow, pool, type Queryable } from '../db/pool.js';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keyLength: number,
) => Promise<Buffer>;

export const SESSION_COOKIE = 'plumbline_session';
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function passwordMatches(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, salt, digest] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !digest) return false;
  const expected = Buffer.from(digest, 'base64url');
  const derived = await scrypt(password, Buffer.from(salt, 'base64url'), expected.byteLength);
  return derived.byteLength === expected.byteLength && timingSafeEqual(derived, expected);
}

export interface ApprovalLimits {
  HKD: number | null;
  SGD: number | null;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  brandId: string | null;
  companyId: string | null;
  organisation: string;
  status: string;
  version: number;
  approvalLimits: ApprovalLimits | null;
}

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  brand_id: string | null;
  company_id: string | null;
  brand_name: string | null;
  company_name: string | null;
  password_hash: string | null;
  approval_limit_hkd_cents: number | null;
  approval_limit_sgd_cents: number | null;
  status: string;
  version: number;
}

export const MEMBER_SELECT = `
  SELECT m.id, m.name, m.email, m.phone, m.role, m.brand_id, m.company_id,
         b.name AS brand_name, c.name AS company_name, m.password_hash,
         m.approval_limit_hkd_cents, m.approval_limit_sgd_cents, m.status, m.version
    FROM members m
    LEFT JOIN brands b ON b.id = m.brand_id
    LEFT JOIN companies c ON c.id = m.company_id`;

export function toMember(row: MemberRow): Member {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    brandId: row.brand_id,
    companyId: row.company_id,
    organisation: organisationOf(row),
    status: row.status,
    version: row.version,
    approvalLimits:
      row.role === 'project_lead'
        ? { HKD: row.approval_limit_hkd_cents, SGD: row.approval_limit_sgd_cents }
        : null,
  };
}

function organisationOf(row: MemberRow): string {
  if (row.role === 'client_approver') return row.brand_name ?? '';
  if (row.role === 'contractor') return row.company_name ?? '';
  return STUDIO_ORGANISATION;
}

export async function memberByEmail(email: string): Promise<MemberRow | null> {
  return firstRow<MemberRow>(pool, `${MEMBER_SELECT} WHERE lower(m.email) = lower($1)`, [email]);
}

export async function startSession(memberId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO sessions (id, token, member_id) VALUES ($1, $2, $3)', [
    newId(),
    token,
    memberId,
  ]);
  return token;
}

export async function endSession(token: string): Promise<void> {
  await pool.query('UPDATE sessions SET ended_at = now() WHERE token = $1 AND ended_at IS NULL', [
    token,
  ]);
}

/** The member of a live session, after touching its idle clock. */
export async function memberOfSession(token: string): Promise<MemberRow | null> {
  const row = await firstRow<MemberRow>(
    pool,
    `${MEMBER_SELECT}
       JOIN sessions s ON s.member_id = m.id
      WHERE s.token = $1
        AND s.ended_at IS NULL
        AND s.last_seen_at > now() - ($2 || ' seconds')::interval`,
    [token, String(config.sessionIdleTimeoutSeconds)],
  );
  if (!row) return null;
  await pool.query('UPDATE sessions SET last_seen_at = now() WHERE token = $1', [token]);
  return row;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionIdleTimeoutSeconds}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}
