import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, apiError } from './errors';

export const JSON_LIMIT = 1_000_000;
export const IMAGE_LIMIT = 5_000_000;
export const OPENAPI_LIMIT = 1_000_000;

export interface Ctx {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly method: string;
  readonly url: URL;
  readonly params: Readonly<Record<string, string>>;
}

export function cookies(ctx: Ctx): Record<string, string> {
  const header = ctx.req.headers.cookie;
  const jar: Record<string, string> = {};
  if (!header) return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    jar[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}

export function setCookie(
  ctx: Ctx,
  name: string,
  value: string,
  options: { maxAgeSeconds?: number; httpOnly?: boolean } = {},
): void {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'SameSite=Lax',
    ...(options.httpOnly === false ? [] : ['HttpOnly']),
    ...(options.maxAgeSeconds === undefined ? [] : [`Max-Age=${options.maxAgeSeconds}`]),
  ];
  const existing = ctx.res.getHeader('Set-Cookie');
  const list = existing === undefined ? [] : Array.isArray(existing) ? existing.map(String) : [String(existing)];
  ctx.res.setHeader('Set-Cookie', [...list, parts.join('; ')]);
}

export function clearCookie(ctx: Ctx, name: string): void {
  ctx.res.setHeader('Set-Cookie', `${name}=; Path=/; SameSite=Lax; HttpOnly; Max-Age=0`);
}

export function sendJson(ctx: Ctx, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  ctx.res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
  });
  ctx.res.end(ctx.method === 'HEAD' ? undefined : payload);
}

export function sendNoContent(ctx: Ctx): void {
  ctx.res.writeHead(204, { 'Cache-Control': 'no-store' });
  ctx.res.end();
}

export function sendHtml(ctx: Ctx, status: number, html: string): void {
  const payload = Buffer.from(html, 'utf8');
  ctx.res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
  });
  ctx.res.end(ctx.method === 'HEAD' ? undefined : payload);
}

export function sendBytes(
  ctx: Ctx,
  status: number,
  bytes: Buffer,
  contentType: string,
  headers: Record<string, string> = {},
): void {
  ctx.res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': bytes.length,
    ...headers,
  });
  ctx.res.end(ctx.method === 'HEAD' ? undefined : bytes);
}

export function sendRedirect(ctx: Ctx, status: number, location: string): void {
  ctx.res.writeHead(status, { Location: location, 'Cache-Control': 'no-store', 'Content-Length': 0 });
  ctx.res.end();
}

export function sendError(ctx: Ctx, error: ApiError): void {
  sendJson(ctx, error.status, error.body());
}

export async function readBody(ctx: Ctx, limit: number): Promise<Buffer> {
  const declared = ctx.req.headers['content-length'];
  if (declared !== undefined && Number(declared) > limit) throw apiError('too_large');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of ctx.req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) {
      ctx.req.destroy();
      throw apiError('too_large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function mediaType(ctx: Ctx): string {
  const header = ctx.req.headers['content-type'] ?? '';
  return header.split(';')[0].trim().toLowerCase();
}

export async function readJsonBody(ctx: Ctx): Promise<Record<string, unknown>> {
  const body = await readBody(ctx, JSON_LIMIT);
  if (body.length === 0) return {};
  if (mediaType(ctx) !== 'application/json') throw apiError('unsupported_media_type');
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    throw apiError('unsupported_media_type');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw apiError('unsupported_media_type');
  }
  return parsed as Record<string, unknown>;
}

export function str(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' ? value : null;
}

/** A state-changing request from another origin is refused (DP-03). */
export function checkOrigin(ctx: Ctx): void {
  if (ctx.method === 'GET' || ctx.method === 'HEAD') return;
  const origin = ctx.req.headers.origin;
  if (origin === undefined || origin === 'null') return;
  const host = ctx.req.headers.host ?? '';
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw apiError('cross_origin');
  }
  if (originHost !== host) throw apiError('cross_origin');
}
