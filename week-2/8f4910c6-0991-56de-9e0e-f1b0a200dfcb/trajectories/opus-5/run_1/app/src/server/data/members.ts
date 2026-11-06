import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { query, queryOne } from '../db.js';
import { newId, newToken } from '../ids.js';
import { accessRemoved, sessionEnded, unauthenticated } from '../http/errors.js';
import type { Member, OfficeId, Role } from '../../shared/types.js';
import { config } from '../config.js';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export type MemberRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  office_id: OfficeId;
  talent_id: string | null;
  password_hash: string | null;
};

export const STAFF_ROLES: Role[] = ['agency_director', 'booker', 'accounts_lead', 'scout'];

export function memberView(row: MemberRow): Member {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    office: row.office_id,
    talentId: row.talent_id,
  };
}

export const ROLE_HOMES: Record<Role, string> = {
  agency_director: '/workspace/overview',
  booker: '/workspace/board',
  accounts_lead: '/workspace/licences',
  scout: '/workspace/applications',
  talent: '/workspace/me',
};

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const derived = await scrypt(password, Buffer.from(salt, 'base64url'), 32);
  const expected = Buffer.from(hash, 'base64url');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export async function findMemberByEmail(email: string): Promise<MemberRow | null> {
  return queryOne<MemberRow>('SELECT * FROM members WHERE lower(email) = lower($1)', [email]);
}

export async function findMemberById(id: string): Promise<MemberRow | null> {
  return queryOne<MemberRow>('SELECT * FROM members WHERE id = $1', [id]);
}

export async function listMembers(): Promise<MemberRow[]> {
  return query<MemberRow>('SELECT * FROM members ORDER BY name');
}

export async function createSession(memberId: string, nowMs: number): Promise<string> {
  const token = newToken();
  await query(
    'INSERT INTO sessions (id, member_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
    [token, memberId, new Date(nowMs), new Date(nowMs + config.sessionTtlSeconds * 1000)],
  );
  return token;
}

export async function endSession(token: string, nowMs: number): Promise<void> {
  await query(
    `UPDATE sessions SET revoked_at = $2, revoked_reason = 'signed_out' WHERE id = $1 AND revoked_at IS NULL`,
    [token, new Date(nowMs)],
  );
}

export async function revokeMemberSessions(memberId: string, nowMs: number): Promise<void> {
  await query(
    `UPDATE sessions SET revoked_at = $2, revoked_reason = 'access_removed'
     WHERE member_id = $1 AND revoked_at IS NULL`,
    [memberId, new Date(nowMs)],
  );
}

type SessionRow = {
  id: string;
  member_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
};

/** Steps 3 of the error precedence: who is calling, or why their session ended. */
export async function authenticate(token: string | null, nowMs: number): Promise<MemberRow> {
  if (!token) throw unauthenticated();
  const session = await queryOne<SessionRow>('SELECT * FROM sessions WHERE id = $1', [token]);
  if (!session) throw sessionEnded();
  if (session.revoked_reason === 'access_removed') throw accessRemoved();
  if (session.revoked_at) throw sessionEnded();
  if (session.expires_at.getTime() <= nowMs) throw sessionEnded();
  const member = await findMemberById(session.member_id);
  if (!member) throw accessRemoved();
  return member;
}

export async function createMember(input: {
  name: string;
  email: string;
  role: Role;
  office: OfficeId;
  talentId: string | null;
  passwordHash: string | null;
}): Promise<MemberRow> {
  const id = newId('mem');
  const rows = await query<MemberRow>(
    `INSERT INTO members (id, name, email, role, office_id, talent_id, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [id, input.name, input.email, input.role, input.office, input.talentId, input.passwordHash],
  );
  return rows[0];
}
