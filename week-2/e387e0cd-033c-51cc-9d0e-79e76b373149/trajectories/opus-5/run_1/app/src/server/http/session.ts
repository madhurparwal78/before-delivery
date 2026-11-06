import { randomBytes } from 'node:crypto';
import { IncomingHttpHeaders } from 'node:http';
import { config } from '../config';
import { query, queryOne } from '../db/pool';
import { MemberRecord, Role, SessionResolution, headerValue } from './runtime';

export const SESSION_COOKIE = 'lanternline_session';

export function readCookie(headers: IncomingHttpHeaders, name: string): string | null {
  const header = headerValue(headers, 'cookie');
  if (header === null) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

export function sessionCookie(id: string): string {
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config().timers.sessionSeconds}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

interface SessionJoin {
  session_id: string;
  expires_at: Date;
  ended_reason: string | null;
  member_id: string | null;
  workspace_slug: string;
  name: string | null;
  email: string | null;
  role: string | null;
}

export async function startSession(member: MemberRecord, now: Date): Promise<string> {
  const id = randomBytes(24).toString('hex');
  await query(
    `INSERT INTO sessions (id, member_id, workspace_slug, created_at, expires_at)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      id,
      member.id,
      member.workspaceSlug,
      now,
      new Date(now.getTime() + config().timers.sessionSeconds * 1000),
    ],
  );
  return id;
}

export async function endSession(id: string): Promise<void> {
  await query("UPDATE sessions SET ended_reason = 'signed_out' WHERE id = $1", [id]);
}

export async function resolveSession(
  headers: IncomingHttpHeaders,
  now: Date,
): Promise<SessionResolution> {
  const id = readCookie(headers, SESSION_COOKIE);
  if (id === null || id === '') return { kind: 'none' };
  const row = await queryOne<SessionJoin>(
    `SELECT s.id AS session_id, s.expires_at, s.ended_reason, m.id AS member_id,
            s.workspace_slug, m.name, m.email, m.role
     FROM sessions s LEFT JOIN members m ON m.id = s.member_id
     WHERE s.id = $1`,
    [id],
  );
  if (row === null) return { kind: 'none' };
  if (row.ended_reason === 'signed_out') return { kind: 'none' };
  if (row.ended_reason === 'access_removed' || row.member_id === null) {
    return { kind: 'ended', code: 'access_removed' };
  }
  if (row.expires_at.getTime() <= now.getTime()) return { kind: 'ended', code: 'session_ended' };
  return {
    kind: 'member',
    sessionId: row.session_id,
    member: {
      id: row.member_id,
      workspaceSlug: row.workspace_slug,
      name: row.name ?? '',
      email: row.email ?? '',
      role: (row.role ?? 'support_agent') as Role,
    },
  };
}
