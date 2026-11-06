import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, fail } from './errors.js';
import { JSON_BODY_LIMIT, MULTIPART_BODY_LIMIT, config } from './env.js';
import { resolveSession, SESSION_COOKIE, type Account } from './auth.js';

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  account: Account | null;
  rawBody: Buffer | null;
};

export function cookieValue(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at === -1) continue;
    if (part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
  }
  return null;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(text);
}

export function sendEmpty(res: ServerResponse, status: number): void {
  res.writeHead(status, { 'cache-control': 'no-store' });
  res.end();
}

export function sendBytes(
  res: ServerResponse,
  status: number,
  body: Buffer,
  contentType: string,
  cache: string,
): void {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': body.length,
    'cache-control': cache,
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function checkOrigin(req: IncomingMessage): void {
  if (!STATE_CHANGING.has(req.method ?? 'GET')) return;
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'null') return;
  const host = req.headers.host;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    fail('cross_origin');
  }
  if (host !== undefined && originHost === host) return;
  if (originHost === new URL(config.publicUrl).host) return;
  fail('cross_origin');
}

function bodyLimitFor(req: IncomingMessage): number {
  const type = req.headers['content-type'] ?? '';
  return type.startsWith('multipart/form-data') ? MULTIPART_BODY_LIMIT : JSON_BODY_LIMIT;
}

export async function readBody(req: IncomingMessage): Promise<Buffer> {
  const limit = bodyLimitFor(req);
  const declared = req.headers['content-length'];
  if (declared !== undefined && Number(declared) > limit) fail('too_large');
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const part = chunk as Buffer;
    total += part.length;
    if (total > limit) fail('too_large');
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

export function parseJsonBody(raw: Buffer): Record<string, unknown> {
  if (raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new ApiError('validation', { fields: { body: 'Send a JSON object.' } });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ApiError('validation', { fields: { body: 'Send a JSON object.' } });
  }
  return parsed as Record<string, unknown>;
}

export type MultipartPart = {
  name: string;
  filename: string | null;
  contentType: string | null;
  data: Buffer;
};

export function parseMultipart(raw: Buffer, contentType: string): MultipartPart[] {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) throw new ApiError('validation', { fields: { file: 'Send a multipart body.' } });
  const boundary = Buffer.from(`--${match[1] ?? match[2]}`);
  const parts: MultipartPart[] = [];
  let at = raw.indexOf(boundary);
  while (at !== -1) {
    let start = at + boundary.length;
    if (raw.toString('ascii', start, start + 2) === '--') break;
    if (raw.toString('ascii', start, start + 2) === '\r\n') start += 2;
    const headerEnd = raw.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const headerText = raw.toString('utf8', start, headerEnd);
    const next = raw.indexOf(boundary, headerEnd);
    if (next === -1) break;
    const data = raw.subarray(headerEnd + 4, next - 2);
    const disposition = /content-disposition:([^\r\n]*)/i.exec(headerText)?.[1] ?? '';
    const name = /name="([^"]*)"/i.exec(disposition)?.[1] ?? '';
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1] ?? null;
    const partType = /content-type:\s*([^\r\n]*)/i.exec(headerText)?.[1]?.trim() ?? null;
    parts.push({ name, filename, contentType: partType, data });
    at = next;
  }
  return parts;
}

export function requirePart(parts: MultipartPart[], name: string): MultipartPart {
  const part = parts.find((p) => p.name === name);
  if (!part) throw new ApiError('validation', { fields: { [name]: 'This part is required.' } });
  return part;
}

export type Route = {
  method: string;
  pattern: string[];
  handler: (ctx: Ctx) => Promise<void>;
  anonymous?: boolean;
};

export function route(
  method: string,
  path: string,
  handler: (ctx: Ctx) => Promise<void>,
  anonymous = false,
): Route {
  return { method, pattern: path.split('/').filter((p) => p !== ''), handler, anonymous };
}

export function matchRoute(
  routes: Route[],
  method: string,
  segments: string[],
): { route: Route; params: Record<string, string> } | null {
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    if (candidate.pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < segments.length; i++) {
      const token = candidate.pattern[i];
      if (token.startsWith(':')) params[token.slice(1)] = decodeURIComponent(segments[i]);
      else if (token !== segments[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route: candidate, params };
  }
  return null;
}

export async function resolveAccount(req: IncomingMessage, touch: boolean): Promise<Account | null> {
  return resolveSession(cookieValue(req, SESSION_COOKIE), touch);
}

export function requireAccount(ctx: Ctx): Account {
  if (ctx.account === null) fail('unauthenticated');
  return ctx.account;
}

export function body(ctx: Ctx): Record<string, unknown> {
  return parseJsonBody(ctx.rawBody ?? Buffer.alloc(0));
}
