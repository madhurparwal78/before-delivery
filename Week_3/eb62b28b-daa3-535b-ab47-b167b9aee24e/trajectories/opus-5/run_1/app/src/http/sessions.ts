import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from '../config';
import { newId, query, queryOne } from '../db';

export const SESSION_COOKIE = 'ocotillo_session';

export type Role = 'owner' | 'specialist' | 'coordinator' | 'billingLead' | 'member';

export interface Person {
  kind: 'staff' | 'member';
  id: string;
  name: string;
  role: Role;
}

export interface SessionRecord {
  id: string;
  person: Person;
  expiresAt: Date;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function passwordMatches(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [scheme, salt, derived] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !derived) return false;
  const candidate = scryptSync(password, salt, 32);
  const expected = Buffer.from(derived, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export async function startSession(person: Person): Promise<SessionRecord> {
  const id = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + config.sessionSeconds * 1000);
  await query(
    'insert into sessions (id, person_kind, person_id, expires_at) values ($1, $2, $3, $4)',
    [id, person.kind, person.id, expiresAt],
  );
  return { id, person, expiresAt };
}

export async function readSession(id: string): Promise<SessionRecord | null> {
  const row = await queryOne<{
    id: string;
    person_kind: 'staff' | 'member';
    person_id: string;
    expires_at: Date;
    ended_at: Date | null;
  }>('select * from sessions where id = $1', [id]);
  if (!row || row.ended_at !== null || row.expires_at.getTime() <= Date.now()) return null;
  if (row.person_kind === 'staff') {
    const staff = await queryOne<{ id: string; name: string; role: Role; removed_at: Date | null }>(
      'select id, name, role, removed_at from staff where id = $1',
      [row.person_id],
    );
    if (!staff || staff.removed_at !== null) return null;
    return {
      id: row.id,
      person: { kind: 'staff', id: staff.id, name: staff.name, role: staff.role },
      expiresAt: row.expires_at,
    };
  }
  const member = await queryOne<{ id: string; name: string | null; account_state: string }>(
    'select id, name, account_state from members where id = $1',
    [row.person_id],
  );
  if (!member || member.account_state === 'erased' || member.account_state === 'erasing') {
    return null;
  }
  return {
    id: row.id,
    person: { kind: 'member', id: member.id, name: member.name ?? '', role: 'member' },
    expiresAt: row.expires_at,
  };
}

export async function endSession(id: string): Promise<void> {
  await query('update sessions set ended_at = now() where id = $1 and ended_at is null', [id]);
}

export async function endOtherSessions(person: Person, keepSessionId: string): Promise<void> {
  await query(
    `update sessions set ended_at = now()
     where person_kind = $1 and person_id = $2 and id <> $3 and ended_at is null`,
    [person.kind, person.id, keepSessionId],
  );
}

export async function endAllSessions(kind: 'staff' | 'member', personId: string): Promise<void> {
  await query(
    `update sessions set ended_at = now()
     where person_kind = $1 and person_id = $2 and ended_at is null`,
    [kind, personId],
  );
}

export function sessionCookie(id: string): string {
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax`;
}

export function clearedCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax`;
}

export function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

export const homeRoute: Record<Role, string> = {
  member: '/me',
  owner: '/staff/members',
  specialist: '/staff/results',
  coordinator: '/staff/calendar',
  billingLead: '/staff/receipts',
};

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export { newId };
