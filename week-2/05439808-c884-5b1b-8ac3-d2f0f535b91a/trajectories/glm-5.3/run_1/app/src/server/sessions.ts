// Sessions, cookies and CSRF. Sessions live in PostgreSQL; the cookie is HttpOnly and
// SameSite=Lax, Secure when APP_PUBLIC_URL is https.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { errors } from './errors.ts';
import { getApp } from './runtime.ts';
import { leagueFor } from '../domain/catalog.ts';

export interface SessionRow {
  token: string;
  accountId: number | null;
  csrfToken: string;
}

export interface AccountRow {
  id: number;
  email: string;
  displayName: string;
  timeZone: string;
  verified: boolean;
  role: 'islander' | 'operator';
  villageId: number | null;
  clanId: number | null;
  trophies: number;
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) cookies[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return cookies;
}

export function sessionCookie(token: string): string {
  const secure = getApp().env.appPublicUrl.startsWith('https');
  return `saltreach_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export async function createSession(client: PoolClient, accountId: number | null, now: number): Promise<SessionRow> {
  const token = newToken();
  const csrfToken = newToken();
  await client.query(
    'INSERT INTO sessions (token, account_id, csrf_token, created_at, expires_at) VALUES ($1, $2, $3, $4, $5)',
    [token, accountId, csrfToken, now, now + getApp().env.sessionSeconds * 1000]
  );
  return { token, accountId, csrfToken };
}

export async function loadSession(token: string | undefined): Promise<SessionRow | null> {
  if (!token) return null;
  const result = await querySession(token);
  return result;
}

async function querySession(token: string): Promise<SessionRow | null> {
  const { pool, clock } = getApp();
  const result = await pool.query(
    'SELECT token, account_id, csrf_token FROM sessions WHERE token = $1 AND ended_at IS NULL AND expires_at > $2',
    [token, clock.now()]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { token: row.token, accountId: row.account_id === null ? null : Number(row.account_id), csrfToken: row.csrf_token };
}

export async function loadAccount(accountId: number): Promise<AccountRow | null> {
  const { pool } = getApp();
  const result = await pool.query(
    `SELECT a.id, a.email, a.display_name, a.time_zone, a.verified, a.role, v.id AS village_id, m.clan_id, v.trophies
     FROM accounts a
     LEFT JOIN villages v ON v.account_id = a.id
     LEFT JOIN clan_members m ON m.account_id = a.id
     WHERE a.id = $1`,
    [accountId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    email: row.email,
    displayName: row.display_name,
    timeZone: row.time_zone,
    verified: row.verified,
    role: row.role,
    villageId: row.village_id === null || row.village_id === undefined ? null : Number(row.village_id),
    clanId: row.clan_id === null || row.clan_id === undefined ? null : Number(row.clan_id),
    trophies: row.trophies === null || row.trophies === undefined ? 0 : Number(row.trophies),
  };
}

export function accountJson(account: AccountRow): Record<string, unknown> {
  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    timeZone: account.timeZone,
    verified: account.verified,
    role: account.role,
    villageId: account.villageId,
    trophies: account.trophies,
    league: leagueFor(account.trophies),
    clanId: account.clanId,
  };
}

export function csrfMatches(session: SessionRow, header: string | undefined): boolean {
  if (!header) return false;
  const a = createHash('sha256').update(header).digest();
  const b = createHash('sha256').update(session.csrfToken).digest();
  return timingSafeEqual(a, b);
}

export async function endAllSessionsOfAccount(client: PoolClient, accountId: number, now: number): Promise<void> {
  await client.query('UPDATE sessions SET ended_at = $2 WHERE account_id = $1 AND ended_at IS NULL', [accountId, now]);
}

export async function requireAccount(session: SessionRow | null): Promise<AccountRow> {
  if (!session || session.accountId === null) throw errors.unauthenticated();
  const account = await loadAccount(session.accountId);
  if (!account) throw errors.unauthenticated();
  return account;
}
