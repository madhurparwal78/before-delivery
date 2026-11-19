import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, fail, MESSAGES } from '../shared/errors.js';
import { JSON_MAX_BYTES } from '../shared/memos.js';
// The request pipeline applies the precedence ladder rungs 1 to 4 and hands
// the endpoint a parsed body.

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  cookies: Record<string, string>;
  body: unknown | undefined; // undefined when the request carried no body
  memoBody: Buffer | undefined; // set for memo uploads, which carry raw bytes
  ownOrigin: string;
}

export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buf.length;
    if (size > limit) throw fail(413, { error: 'payload_too_large' });
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export function hasBody(req: IncomingMessage): boolean {
  const te = req.headers['transfer-encoding'];
  if (te !== undefined) return true;
  const cl = req.headers['content-length'];
  return cl !== undefined && Number(cl) > 0;
}

export function crossOrigin(req: IncomingMessage, ownOrigin: string): boolean {
  const origin = req.headers['origin'];
  if (origin !== undefined) {
    if (origin === 'null') return true;
    return origin !== ownOrigin;
  }
  const site = req.headers['sec-fetch-site'];
  return site === 'cross-site';
}

export function ownOriginOf(req: IncomingMessage): string {
  // The app's own origin: the request's own scheme and its Host header.
  const host = req.headers['host'];
  const isTls = (req.socket as { encrypted?: boolean }).encrypted === true;
  return `${isTls ? 'https' : 'http'}://${host}`;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (header === undefined) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key !== '') out[key] = value;
  }
  return out;
}

export function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, err: ApiError): void {
  sendJson(res, err.status, err.body);
}

// Content-Type check: parameters are ignored, so `application/json; charset=utf-8` passes.
export function isJsonType(contentType: string | undefined): boolean {
  if (contentType === undefined) return false;
  return contentType.trim().split(';')[0]?.trim().toLowerCase() === 'application/json';
}

export function bodyToObject(raw: unknown): Record<string, unknown> {
  if (raw === undefined) return {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw fail(400, { error: 'invalid_json' });
  }
  return raw as Record<string, unknown>;
}

export function cookieHeader(name: string, value: string, clear: boolean): string {
  const parts = clear
    ? [`${name}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0']
    : [`${name}=${value}`, 'HttpOnly', 'SameSite=Lax', 'Path=/'];
  return parts.join('; ');
}
