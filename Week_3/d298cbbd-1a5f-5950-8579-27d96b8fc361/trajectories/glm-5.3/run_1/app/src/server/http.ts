import type { IncomingMessage, ServerResponse } from 'node:http';

// A minimal same-origin JSON request/response layer.

export interface RequestBody {
  raw: Buffer;
  json: unknown;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  body: RequestBody | null;
  cookies: Record<string, string>;
  session: SessionInfo | null;
}

export interface SessionInfo {
  token: string;
  typistId: string;
}

export class ApiError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    super(typeof payload.error === 'string' ? payload.error : String(status));
    this.status = status;
    this.payload = payload;
  }
}

export function json(res: ServerResponse, status: number, payload: unknown, extraHeaders?: Record<string, string>): void {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

export function empty(res: ServerResponse, status: number, extraHeaders?: Record<string, string>): void {
  res.writeHead(status, { 'content-length': '0', ...extraHeaders });
  res.end();
}

export function readCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name !== '') out[name] = decodeURIComponent(value);
  }
  return out;
}

export function cookieHeader(name: string, value: string, maxAgeSeconds: number | null): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeSeconds !== null) parts.push(`Max-Age=${maxAgeSeconds}`);
  return parts.join('; ');
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomUuid(): string {
  return crypto.randomUUID();
}
