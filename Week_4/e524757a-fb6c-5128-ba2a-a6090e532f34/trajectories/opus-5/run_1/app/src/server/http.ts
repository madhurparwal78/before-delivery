import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError } from '../shared/errors.js';
import { JSON_BODY_LIMIT } from './config.js';

export type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  params: Record<string, string>;
};

export type Handler = (ctx: Ctx) => Promise<void> | void;

type Route = { method: string; segments: string[]; handler: Handler };

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method, segments: pattern.split('/').filter(Boolean), handler });
  }

  get(pattern: string, handler: Handler): void {
    this.add('GET', pattern, handler);
  }

  post(pattern: string, handler: Handler): void {
    this.add('POST', pattern, handler);
  }

  put(pattern: string, handler: Handler): void {
    this.add('PUT', pattern, handler);
  }

  delete(pattern: string, handler: Handler): void {
    this.add('DELETE', pattern, handler);
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean);
    let pathExists = false;
    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < parts.length; i += 1) {
        const segment = route.segments[i];
        if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(parts[i]);
        else if (segment !== parts[i]) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      pathExists = true;
      if (route.method === method || (route.method === 'GET' && method === 'HEAD')) return { handler: route.handler, params };
    }
    if (pathExists) throw new ApiError('not_found');
    return null;
  }
}

export function sendJson(ctx: Ctx, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  ctx.res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  ctx.res.end(ctx.method === 'HEAD' ? undefined : text);
}

export function sendHtml(ctx: Ctx, status: number, html: string): void {
  ctx.res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  ctx.res.end(ctx.method === 'HEAD' ? undefined : html);
}

export function redirect(ctx: Ctx, location: string): void {
  ctx.res.writeHead(302, { location, 'cache-control': 'no-store' });
  ctx.res.end();
}

export function sendNoContent(ctx: Ctx): void {
  ctx.res.writeHead(204, { 'cache-control': 'no-store' });
  ctx.res.end();
}

export function cookies(ctx: Ctx): Record<string, string> {
  const header = ctx.req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function setSessionCookie(ctx: Ctx, id: string): void {
  ctx.res.setHeader('set-cookie', `hushfoot=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
}

export function clearSessionCookie(ctx: Ctx): void {
  ctx.res.setHeader('set-cookie', 'hushfoot=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

export async function readRawBody(ctx: Ctx, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of ctx.req) {
    length += (chunk as Buffer).byteLength;
    if (length > limit) {
      ctx.req.destroy();
      throw new ApiError('too_large');
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJson(ctx: Ctx): Promise<Record<string, unknown>> {
  const raw = await readRawBody(ctx, JSON_BODY_LIMIT);
  if (raw.byteLength === 0) return {};
  try {
    const parsed = JSON.parse(raw.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ApiError('bad_request');
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('bad_request');
  }
}

export type MultipartPart = { name: string; filename?: string; contentType?: string; data: Buffer };

export function parseMultipart(body: Buffer, contentType: string): MultipartPart[] {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) throw new ApiError('bad_request');
  const boundary = `--${match[1] ?? match[2]}`.trim();
  const parts: MultipartPart[] = [];
  let index = body.indexOf(boundary);
  if (index === -1) throw new ApiError('bad_request');
  index += boundary.length;
  while (index < body.byteLength) {
    if (body[index] === 0x2d && body[index + 1] === 0x2d) break;
    while (body[index] === 0x0d || body[index] === 0x0a) index += 1;
    const headerEnd = body.indexOf('\r\n\r\n', index, 'utf8');
    if (headerEnd === -1) break;
    const headerText = body.subarray(index, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    let bodyEnd = body.indexOf(boundary, bodyStart);
    if (bodyEnd === -1) bodyEnd = body.byteLength;
    let dataEnd = bodyEnd;
    if (body[dataEnd - 1] === 0x0a) dataEnd -= 1;
    if (body[dataEnd - 1] === 0x0d) dataEnd -= 1;
    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    const filenameMatch = /filename="([^"]*)"/i.exec(headerText);
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
    parts.push({
      name: nameMatch ? nameMatch[1] : '',
      filename: filenameMatch ? filenameMatch[1] : undefined,
      contentType: typeMatch ? typeMatch[1].trim() : undefined,
      data: body.subarray(bodyStart, dataEnd),
    });
    index = bodyEnd + boundary.length;
  }
  return parts;
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function checkOrigin(ctx: Ctx): void {
  if (!STATE_CHANGING.has(ctx.method)) return;
  const origin = ctx.req.headers.origin;
  if (!origin) return;
  const host = ctx.req.headers.host;
  try {
    if (new URL(origin).host !== host) throw new ApiError('bad_origin');
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('bad_origin');
  }
}
