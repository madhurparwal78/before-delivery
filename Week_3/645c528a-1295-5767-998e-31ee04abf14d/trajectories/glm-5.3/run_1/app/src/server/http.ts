import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, errors } from './errors.js';

export const MAX_BODY_BYTES = 65_536;

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  pathname: string;
  search: URLSearchParams;
  params: Record<string, string>;
  cookies: Record<string, string>;
  origin: string | null;
  host: string | null;
  body: unknown;
  rawBody: Buffer;
  ip: string;
  cookieOut: string | null;
  statusOut: number;
  headersOut: Record<string, string>;
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function sendError(ctx: Ctx, err: ApiError): void {
  ctx.statusOut = err.status;
  for (const [k, v] of Object.entries(err.headers ?? {})) ctx.headersOut[k] = v;
  sendJson(ctx, err.status, err.body());
}

export function sendJson(ctx: Ctx, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  ctx.statusOut = status;
  ctx.res.writeHead(status, { ...ctx.headersOut, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload).toString() });
  ctx.res.end(payload);
}

export function sendEmpty(ctx: Ctx, status = 204): void {
  ctx.statusOut = status;
  ctx.res.writeHead(status, ctx.headersOut);
  ctx.res.end();
}

export function setCookie(ctx: Ctx, name: string, value: string, attrs: Record<string, string>): void {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  for (const [k, v] of Object.entries(attrs)) parts.push(`${k}=${v}`);
  const existing = ctx.headersOut['Set-Cookie'];
  ctx.headersOut['Set-Cookie'] = existing ? `${existing}; ${parts.join('; ')}` : parts.join('; ');
}
