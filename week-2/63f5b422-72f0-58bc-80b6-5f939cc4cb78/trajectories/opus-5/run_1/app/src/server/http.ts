import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_JSON_BODY, MAX_UPLOAD_BODY } from './config.js';
import { ApiError } from './errors.js';

export interface RequestContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  method: string;
  params: Record<string, string>;
}

export type Handler = (ctx: RequestContext) => Promise<void> | void;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | undefined {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method || route.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.parts.length; i += 1) {
        const expected = route.parts[i]!;
        const actual = parts[i]!;
        if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual);
        else if (expected !== actual) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: route.handler, params };
    }
    return undefined;
  }
}

export function sendJson(ctx: RequestContext, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  ctx.response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'x-content-type-options': 'nosniff',
  });
  ctx.response.end(text);
}

export function sendHtml(ctx: RequestContext, status: number, html: string): void {
  ctx.response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'x-content-type-options': 'nosniff',
  });
  ctx.response.end(html);
}

export function sendBytes(
  ctx: RequestContext,
  status: number,
  body: Buffer,
  contentType: string,
): void {
  ctx.response.writeHead(status, {
    'content-type': contentType,
    'content-length': body.length,
    'x-content-type-options': 'nosniff',
  });
  ctx.response.end(body);
}

export function sendNoContent(ctx: RequestContext, headers: Record<string, string> = {}): void {
  ctx.response.writeHead(204, { 'x-content-type-options': 'nosniff', ...headers });
  ctx.response.end();
}

export function redirect(ctx: RequestContext, location: string): void {
  ctx.response.writeHead(302, {
    location,
    'x-content-type-options': 'nosniff',
  });
  ctx.response.end();
}

async function readBody(ctx: RequestContext, limit: number, code: string): Promise<Buffer> {
  const declared = Number(ctx.request.headers['content-length'] ?? '0');
  if (declared > limit) throw new ApiError(413, code, 'That request is too large.');
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of ctx.request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) throw new ApiError(413, code, 'That request is too large.');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJson(ctx: RequestContext): Promise<Record<string, unknown>> {
  const body = await readBody(ctx, MAX_JSON_BODY, 'body_too_large');
  if (body.length === 0) return {};
  try {
    const parsed = JSON.parse(body.toString('utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new ApiError(422, 'invalid', 'Some values are not valid.', {
        body: 'Expected a JSON object.',
      });
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(422, 'invalid', 'Some values are not valid.', {
      body: 'Expected valid JSON.',
    });
  }
}

export interface UploadPart {
  fileName: string;
  bytes: Buffer;
}

export async function readUpload(ctx: RequestContext): Promise<UploadPart> {
  const type = String(ctx.request.headers['content-type'] ?? '');
  const body = await readBody(ctx, MAX_UPLOAD_BODY, 'image_too_large');
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type);
  if (!boundaryMatch) {
    throw new ApiError(422, 'invalid', 'Some values are not valid.', {
      file: 'Expected a multipart upload with one file part.',
    });
  }
  const boundary = `--${boundaryMatch[1] ?? boundaryMatch[2]!}`;
  const separator = Buffer.from(`\r\n${boundary}`);
  const start = body.indexOf(Buffer.from(boundary));
  if (start === -1) {
    throw new ApiError(422, 'invalid', 'Some values are not valid.', { file: 'Expected a file.' });
  }
  let cursor = start + boundary.length;
  for (;;) {
    if (body.subarray(cursor, cursor + 2).toString('latin1') === '--') break;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (headerEnd === -1) break;
    const headers = body.subarray(cursor, headerEnd).toString('utf8');
    let end = body.indexOf(separator, headerEnd + 4);
    if (end === -1) end = body.length;
    const content = body.subarray(headerEnd + 4, end);
    if (/name="file"/i.test(headers)) {
      const nameMatch = /filename="([^"]*)"/i.exec(headers);
      return { fileName: nameMatch?.[1] ?? 'upload', bytes: content };
    }
    cursor = end + separator.length;
  }
  throw new ApiError(422, 'invalid', 'Some values are not valid.', { file: 'Expected a file.' });
}

export function checkOrigin(ctx: RequestContext): void {
  if (ctx.method === 'GET' || ctx.method === 'HEAD') return;
  const origin = ctx.request.headers.origin;
  if (origin === undefined) return;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw new ApiError(403, 'cross_origin', 'That request came from another origin.');
  }
  if (host !== ctx.request.headers.host) {
    throw new ApiError(403, 'cross_origin', 'That request came from another origin.');
  }
}
