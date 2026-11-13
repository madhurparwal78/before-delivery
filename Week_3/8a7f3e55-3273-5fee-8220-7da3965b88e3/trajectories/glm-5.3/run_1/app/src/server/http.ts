// The HTTP layer: origin enforcement, body limits, session auth, routing, error shape.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db.js';
import { ApiError } from './errors.js';
import type { SessionUser } from './bookings.js';
import { randomToken } from './passwords.js';

export interface RequestBody {
  json?: unknown;
  raw?: Buffer;
}

export interface AppContext {
  db: Db;
  config: ReturnType<typeof import('./config.js').loadConfig>;
}

export interface RouteRequest {
  req: http.IncomingMessage;
  method: string;
  pathname: string;
  query: URLSearchParams;
  body: RequestBody;
  cookies: Record<string, string>;
  user: SessionUser | null;
  sessionId: string | null;
  rawBody: Buffer | null;
  params: Record<string, string>;
}

export type Handler = (ctx: RouteRequest, app: AppContext) => Promise<HandlerResult>;

export interface HandlerResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string | string[]>;
  // Multipart data, set by the upload route.
  file?: { bytes: Buffer; filename: string };
}

export function jsonResult(status: number, body: unknown): HandlerResult {
  return { status, body };
}

const JSON_LIMIT = 65_536;
const MULTIPART_LIMIT = 10_100_000;
const SESSION_COOKIE = 'relayline_session';
const SESSION_TTL_MS = 12 * 3600 * 1000;

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = randomToken(32);
  await db.query('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [
    token,
    userId,
    new Date(Date.now() + SESSION_TTL_MS),
  ]);
  return token;
}

export async function sessionUser(db: Db, token: string | undefined): Promise<{ user: SessionUser; sessionId: string } | null> {
  if (!token) return null;
  const res = await db.query<{
    token: string; id: string; name: string; email: string; role: string; org_id: string | null; expires_at: Date;
  }>(
    `SELECT s.token, u.id, u.name, u.email, u.role, u.org_id, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1`,
    [token],
  );
  if (res.rowCount === 0) return null;
  const row = res.rows[0];
  if (row.expires_at.getTime() < Date.now()) {
    await db.query('DELETE FROM sessions WHERE token = $1', [token]);
    return null;
  }
  return {
    user: { id: row.id, name: row.name, email: row.email, role: row.role, org_id: row.org_id },
    sessionId: row.token,
  };
}

export async function endSession(db: Db, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.query('DELETE FROM sessions WHERE token = $1', [token]);
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function sessionTokenOf(cookies: Record<string, string>): string | undefined {
  return cookies[SESSION_COOKIE];
}

export function isJsonRequest(req: http.IncomingMessage): boolean {
  const type = req.headers['content-type'] ?? '';
  return type.toLowerCase().startsWith('application/json');
}

export function isMultipartRequest(req: http.IncomingMessage): boolean {
  const type = req.headers['content-type'] ?? '';
  return type.toLowerCase().startsWith('multipart/form-data');
}

/** Read the body up to the request-specific limit. `null` means the limit was exceeded. */
export function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? '0');
    if (declared > limit) {
      resolve(null);
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        resolve(null);
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function originAllowed(req: http.IncomingMessage, port: number): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const host = req.headers.host ?? `localhost:${port}`;
  try {
    const originUrl = new URL(origin);
    return originUrl.host === host;
  } catch {
    return false;
  }
}

export const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.html': 'text/html; charset=utf-8',
};

/** Only the built front end, its bundled fonts and /api are served; never source, config
 * files, dotfiles, lockfiles, env files or source maps. */
export function staticPathOf(pathname: string): string | null {
  if (pathname === '/' || pathname === '/bookings' || pathname === '/billing' || pathname === '') {
    return path.join(distDir, 'index.html');
  }
  if (pathname.startsWith('/assets/')) {
    const rest = pathname.slice('/assets/'.length);
    if (rest.includes('..') || rest.includes('/')) return null;
    return path.join(distDir, 'assets', rest);
  }
  if (pathname.startsWith('/fonts/')) {
    const rest = pathname.slice('/fonts/'.length);
    if (rest.includes('..') || rest.includes('/')) return null;
    return path.join(distDir, 'fonts', rest);
  }
  return null;
}

export async function serveStatic(pathname: string): Promise<HandlerResult> {
  const file = staticPathOf(pathname);
  if (file === null) {
    return { status: 404, body: { error: 'not_found', message: 'Nothing is served at this address.' } };
  }
  try {
    const bytes = await readFile(file);
    const ext = path.extname(file);
    return {
      status: 200,
      body: bytes,
      headers: { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store' },
    };
  } catch {
    return { status: 404, body: { error: 'not_found', message: 'Nothing is served at this address.' } };
  }
}

export function errorBody(err: ApiError): Record<string, unknown> {
  return err.body() as unknown as Record<string, unknown>;
}
