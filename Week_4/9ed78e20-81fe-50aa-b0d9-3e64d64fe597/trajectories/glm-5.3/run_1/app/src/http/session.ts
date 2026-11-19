import type { DbClient } from '../platform/db.js';
import { errors } from '../platform/errors.js';
import { config } from '../config.js';
import { clientAddress } from './plumbing.js';
import type { IncomingMessage } from 'node:http';

export type StaffRole = 'editor' | 'approver' | 'recruiter' | 'administrator';

export type ActiveGrant = { role: StaffRole; expires_at: string };

export type Session = {
  email: string;
  name: string;
  grants: ActiveGrant[];
};

export type StaffRow = {
  email: string;
  name: string;
};

async function loadGrants(client: DbClient, email: string, now = new Date()): Promise<ActiveGrant[]> {
  const rows = await client.query<{ role: StaffRole; expires_at: Date }>(
    `SELECT role, expires_at FROM grants
     WHERE staff_email = $1 AND revoked_at IS NULL AND expires_at > $2`,
    [email, now.toISOString()],
  );
  return rows.rows.map((r) => ({ role: r.role, expires_at: new Date(r.expires_at).toISOString() }));
}

export async function staffByEmail(client: DbClient, email: string): Promise<StaffRow | null> {
  const rows = await client.query<{ email: string; name: string }>(
    `SELECT email, name FROM staff WHERE email = $1`,
    [email],
  );
  return rows.rows[0] ?? null;
}

export async function signIn(
  client: DbClient,
  email: string,
  password: string,
  passwordVerify: (password: string, stored: string) => Promise<boolean>,
): Promise<{ staff: StaffRow; grants: ActiveGrant[] } | 'invalid' | 'locked'> {
  const key = email.trim().toLowerCase();
  const now = new Date();
  const lock = await client.query<{ failures: number; locked_until: Date | null; lockout_seconds: number | null }>(
    `SELECT failures, locked_until, lockout_seconds FROM signin_lockouts WHERE email = $1 FOR UPDATE`,
    [key],
  );
  const row = lock.rows[0];
  if (row?.locked_until && new Date(row.locked_until).getTime() > now.getTime()) {
    const retry = Math.max(1, Math.ceil((new Date(row.locked_until).getTime() - now.getTime()) / 1000));
    throw errors.signinLocked(retry);
  }
  const staff = await staffByEmail(client, key);
  const passwordRow = staff
    ? (await client.query<{ password_hash: string }>(`SELECT password_hash FROM staff WHERE email = $1`, [key])).rows[0]
    : null;
  const verified =
    staff && passwordRow ? await passwordVerify(password, passwordRow.password_hash) : false;
  if (!staff || !verified) {
    const failures = (row?.failures ?? 0) + 1;
    const base = config.signinLockoutSeconds;
    if (failures >= 5) {
      const previous = row?.lockout_seconds ?? 0;
      const nextLock = previous > 0 ? Math.min(previous * 2, base * 8) : base;
      const lockedUntil = new Date(now.getTime() + nextLock * 1000);
      await client.query(
        `INSERT INTO signin_lockouts (email, failures, locked_until, lockout_seconds)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET failures = $2, locked_until = $3, lockout_seconds = $4`,
        [key, failures, lockedUntil.toISOString(), nextLock],
      );
    } else {
      await client.query(
        `INSERT INTO signin_lockouts (email, failures, locked_until, lockout_seconds)
         VALUES ($1, $2, NULL, $3)
         ON CONFLICT (email) DO UPDATE SET failures = $2, locked_until = NULL, lockout_seconds = $3`,
        [key, failures, row?.lockout_seconds ?? null],
      );
    }
    return 'invalid';
  }
  await client.query(`DELETE FROM signin_lockouts WHERE email = $1`, [key]);
  const grants = await loadGrants(client, key, now);
  return { staff, grants };
}

export async function createSession(
  client: DbClient,
  email: string,
  sessionId: string,
): Promise<void> {
  const expires = new Date(Date.now() + config.sessionTtlSeconds * 1000);
  await client.query(
    `INSERT INTO sessions (id, staff_email, expires_at) VALUES ($1, $2, $3)`,
    [sessionId, email, expires.toISOString()],
  );
}

export async function sessionFromCookie(
  client: DbClient,
  sessionId: string | undefined,
): Promise<Session | null> {
  if (!sessionId) return null;
  const rows = await client.query<{ staff_email: string; name: string }>(
    `SELECT s.staff_email, st.name FROM sessions s
     JOIN staff st ON st.email = s.staff_email
     WHERE s.id = $1 AND s.expires_at > now()`,
    [sessionId],
  );
  const row = rows.rows[0];
  if (!row) return null;
  const grants = await loadGrants(client, row.staff_email);
  return { email: row.staff_email, name: row.name, grants };
}

export async function deleteSession(client: DbClient, sessionId: string): Promise<void> {
  await client.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
}

export function hasRole(session: Session | null, role: StaffRole): boolean {
  if (!session) return false;
  return session.grants.some((g) => g.role === role);
}

export function activeApproverEmails(rows: { staff_email: string }[]): string[] {
  return [...new Set(rows.map((r) => r.staff_email))];
}

export { clientAddress };
