import type { Request, Response } from 'express';
import { db } from './db.js';
import { newToken } from './store.js';

export const SESSION_COOKIE = 'keelson_session';

export interface SessionInfo {
  email: string;
  name: string;
}

// ---------------------------------------------------------------- sessions

export async function createSession(email: string): Promise<string> {
  const token = newToken();
  const ttl = Number(process.env.KEELSON_SESSION_TTL_SECONDS ?? '43200');
  await db.query('INSERT INTO sessions (token, person_email, expires_at) VALUES ($1,$2,$3)', [
    token, email, new Date(Date.now() + ttl * 1000),
  ]);
  return token;
}

export async function readSession(req: Request): Promise<SessionInfo | null> {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token || typeof token !== 'string') return null;
  const r = await db.query<{ email: string; name: string }>(
    `SELECT p.email, p.name FROM sessions s JOIN people p ON p.email = s.person_email
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  );
  return r.rows[0] ? { email: r.rows[0].email, name: r.rows[0].name } : null;
}

export async function destroySession(req: Request): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (token) await db.query('DELETE FROM sessions WHERE token = $1', [token]);
}

// ------------------------------------------------------------ request keys

export async function findRequestKey(email: string, method: string, path: string, key: string) {
  const r = await db.query<{ body_hash: string; status: number | null; response_body: string | null }>(
    `SELECT body_hash, status, response_body FROM request_keys
     WHERE person_email = $1 AND method = $2 AND path = $3 AND key = $4 AND expires_at > now()`,
    [email, method, path, key],
  );
  return r.rows[0] ?? null;
}

export async function storeRequestKey(email: string, method: string, path: string, key: string, bodyHash: string, status: number, body: string): Promise<void> {
  const ttl = Number(process.env.KEELSON_REQUEST_KEY_TTL_SECONDS ?? '86400');
  await db.query(
    `INSERT INTO request_keys (person_email, method, path, key, body_hash, status, response_body, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (person_email, method, path, key)
     DO UPDATE SET body_hash = EXCLUDED.body_hash, status = EXCLUDED.status, response_body = EXCLUDED.response_body, expires_at = EXCLUDED.expires_at`,
    [email, method, path, key, bodyHash, status, body, new Date(Date.now() + ttl * 1000)],
  );
}

export function bodyHash(obj: unknown): string {
  return JSON.stringify(canonicalize(obj));
}

function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => val !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return entries.map(([k, val]) => [k, canonicalize(val)]);
  }
  return v;
}

export function isValidRequestKey(key: unknown): key is string {
  return typeof key === 'string' && key.length >= 1 && key.length <= 200 && /^[\x20-\x7e]+$/.test(key);
}

// --------------------------------------------------------------- boundary

// The origin check: state-changing browser calls come only from our own origin.
export function originAllowed(req: Request): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers.host;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function originFailure(res: Response): void {
  res.status(403).json({ error: 'cross_origin', message: 'Calls from another origin are refused.' });
}

// Body limit per route family.
export const BUNDLE_BODY_LIMIT = 1_000_000;
export const DEFAULT_BODY_LIMIT = 64_000;

export function contentTypeOk(req: Request): boolean {
  const ct = req.headers['content-type'];
  if (!ct) return req.method === 'GET' || req.method === 'HEAD';
  return /^application\/json/i.test(ct);
}
