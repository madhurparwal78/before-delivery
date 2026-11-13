import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError } from './errors.js';

export const MAX_BODY_BYTES = 65536;

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  params: Record<string, string>;
  body: unknown;
  rawBodyPresent: boolean;
  cookies: Record<string, string>;
  origin: string;
}

export interface Reply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export type Handler = (ctx: Ctx) => Promise<Reply | void> | Reply | void;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method, parts: pattern.split('/').filter((part) => part.length > 0), handler });
  }

  get(pattern: string, handler: Handler): void {
    this.add('GET', pattern, handler);
  }
  post(pattern: string, handler: Handler): void {
    this.add('POST', pattern, handler);
  }
  patch(pattern: string, handler: Handler): void {
    this.add('PATCH', pattern, handler);
  }
  delete(pattern: string, handler: Handler): void {
    this.add('DELETE', pattern, handler);
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter((part) => part.length > 0);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let index = 0; index < route.parts.length; index += 1) {
        const expected = route.parts[index] as string;
        const actual = parts[index] as string;
        if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual);
        else if (expected !== actual) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return null;
  }

  hasPath(pathname: string): boolean {
    const parts = pathname.split('/').filter((part) => part.length > 0);
    return this.routes.some((route) => {
      if (route.parts.length !== parts.length) return false;
      return route.parts.every((expected, index) => expected.startsWith(':') || expected === parts[index]);
    });
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

export async function readBody(req: IncomingMessage): Promise<Buffer> {
  const declared = req.headers['content-length'];
  if (declared && Number.parseInt(declared, 10) > MAX_BODY_BYTES) {
    throw new ApiError(413, 'payload_too_large', 'That request is too large.');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      throw new ApiError(413, 'payload_too_large', 'That request is too large.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function parseJsonBody(raw: Buffer, contentType: string | undefined): unknown {
  if (raw.length === 0) return undefined;
  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') {
    throw new ApiError(415, 'unsupported_media_type', 'Send application/json.');
  }
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new ApiError(400, 'malformed_json', 'That request body is not valid JSON.');
  }
}

export function checkSameOrigin(ctx: Ctx): void {
  if (ctx.method === 'GET' || ctx.method === 'HEAD') return;
  const origin = ctx.req.headers.origin;
  if (!origin) return;
  const host = ctx.req.headers.host ?? '';
  let originHost = '';
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = '';
  }
  if (originHost !== host) {
    throw new ApiError(403, 'cross_origin', 'That request came from another origin.');
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body ?? null);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

export function objectBody(ctx: Ctx): Record<string, unknown> {
  if (ctx.body === undefined || ctx.body === null) return {};
  if (typeof ctx.body !== 'object' || Array.isArray(ctx.body)) {
    throw new ApiError(400, 'malformed_json', 'That request body is not valid JSON.');
  }
  return ctx.body as Record<string, unknown>;
}
