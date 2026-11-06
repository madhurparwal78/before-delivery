import crypto from 'node:crypto';
import { config } from './config.js';
import { peerAddress } from './headers.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { connectDb } from './db.js';
import { now } from './time.js';
import { resolveToken } from './apitokens.js';

export interface RequestCtx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  requestId: string;
  method: string;
  address: string;
  rawBody: Buffer | null;
  jsonBody: unknown;
  sessionCookie: string | null;
  caller: Awaited<ReturnType<typeof resolveCaller>>;
  draining: boolean;
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function sessionCookieHeader(token: string): string {
  return `clinchline_session=${token}; Path=/; HttpOnly; SameSite=Lax`;
}

export function parseSessionCookie(req: IncomingMessage): string | null {
  return parseCookies(req)['clinchline_session'] ?? null;
}

export async function resolveCaller(req: IncomingMessage): Promise<import('./context.js').Caller | null> {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return resolveToken(auth.slice(7).trim());
  }
  const cookies = parseCookies(req);
  const token = cookies['clinchline_session'];
  if (!token) return null;
  const rows = await connectDb().query(
    `select u.id, u.name, u.email, u.role from sessions s join users u on u.id = s.user_id where s.id = $1`,
    [token]
  );
  if (rows.rows.length === 0) return null;
  const r = rows.rows[0];
  return { type: 'session', id: r.id, role: r.role, name: r.name, email: r.email };
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function logRequest(ctx: { requestId: string; method: string; path: string; status: number; start: number }): void {
  const line = {
    ts: new Date().toISOString(),
    level: 'info',
    msg: 'request',
    request_id: ctx.requestId,
    instance: config.instanceLabel,
    method: ctx.method,
    path: ctx.path,
    status: ctx.status,
    duration_ms: Math.round(performance.now() - ctx.start)
  };
  process.stdout.write(JSON.stringify(line) + '\n');
}

export function redactPath(path: string): string {
  return path.replace(/\/api\/vet\/[^/?]+/, '/api/vet/[token]').replace(/\/vet\/[^/?]+/, '/vet/[token]');
}
