import type { IncomingMessage, ServerResponse } from 'node:http';
import { JSON_BODY_LIMIT } from './config.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`api_${status}`);
  }
}

export const unauthenticated = () => new ApiError(401, { error: 'unauthenticated' });
export const notFound = () => new ApiError(404, { error: 'not_found' });
export const bodyTooLarge = () => new ApiError(413, { error: 'body_too_large' });
export const forbidden = (code = 'forbidden') => new ApiError(403, { error: code });
export const conflict = (body: unknown) => new ApiError(409, body);
export const storageUnavailable = () => new ApiError(503, { error: 'storage_unavailable' });
export const invalid = (errors: Record<string, string>) => new ApiError(422, { errors });

export interface Person {
  id: string;
  name: string;
  email: string;
  verified: boolean;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  url: URL;
  params: Record<string, string>;
  raw: Buffer;
  rawTruncated: boolean;
  person: Person | null;
  teams: string[];
  setCookie: (value: string) => void;
}

export const HARD_BODY_CEILING = 8 * 1024 * 1024;

export async function readBody(req: IncomingMessage): Promise<{ raw: Buffer; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > HARD_BODY_CEILING) {
      truncated = true;
      req.destroy();
      break;
    }
    chunks.push(buf);
  }
  return { raw: Buffer.concat(chunks), truncated };
}

export function requireAuth(ctx: Ctx): Person {
  if (!ctx.person) throw unauthenticated();
  return ctx.person;
}

export function checkBodyLimit(ctx: Ctx, limit = JSON_BODY_LIMIT): void {
  if (ctx.rawTruncated || ctx.raw.length > limit) throw bodyTooLarge();
}

export function jsonBody(ctx: Ctx, limit = JSON_BODY_LIMIT): Record<string, unknown> {
  checkBodyLimit(ctx, limit);
  if (ctx.raw.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(ctx.raw.toString('utf8'));
  } catch {
    throw invalid({ body: 'Send a JSON body' });
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalid({ body: 'Send a JSON body' });
  }
  return parsed as Record<string, unknown>;
}

export function found<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw notFound();
  return value;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

export function sendNoContent(res: ServerResponse): void {
  res.writeHead(204);
  res.end();
}

export type Handler = (ctx: Ctx) => Promise<void>;

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

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    const segments = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method || route.parts.length !== segments.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.parts.length; i += 1) {
        const part = route.parts[i];
        if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(segments[i]);
        else if (part !== segments[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: route.handler, params };
    }
    return null;
  }
}

export interface MultipartFile {
  field: string;
  filename: string;
  contentType: string;
  data: Buffer;
}

export function parseMultipart(raw: Buffer, contentType: string): MultipartFile[] {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) return [];
  const boundary = `--${match[1] ?? match[2]}`;
  const parts: MultipartFile[] = [];
  let index = raw.indexOf(boundary);
  while (index !== -1) {
    const start = index + boundary.length;
    if (raw.slice(start, start + 2).toString() === '--') break;
    const headerEnd = raw.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const headerText = raw.slice(start, headerEnd).toString('utf8');
    const next = raw.indexOf(boundary, headerEnd);
    if (next === -1) break;
    const data = raw.slice(headerEnd + 4, next - 2);
    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    const fileMatch = /filename="([^"]*)"/i.exec(headerText);
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
    parts.push({
      field: nameMatch ? nameMatch[1] : '',
      filename: fileMatch ? fileMatch[1] : '',
      contentType: typeMatch ? typeMatch[1].trim() : 'application/octet-stream',
      data,
    });
    index = next;
  }
  return parts;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const piece of header.split(';')) {
    const eq = piece.indexOf('=');
    if (eq === -1) continue;
    out[piece.slice(0, eq).trim()] = decodeURIComponent(piece.slice(eq + 1).trim());
  }
  return out;
}
