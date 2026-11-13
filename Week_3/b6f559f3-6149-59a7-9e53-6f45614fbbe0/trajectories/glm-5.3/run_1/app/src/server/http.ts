// HTTP plumbing: body limits, JSON, cookies, error shape, cross-origin rule.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, unauthenticated } from './errors';

export const JSON_MAX = 1048576;
export const UPLOAD_MAX = 10485760;

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  cookies: Record<string, string>;
  body?: unknown;
}

export type Handler = (ctx: Ctx) => Promise<unknown>;

export class HttpError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.message ?? ''));
    this.status = status;
    this.body = body;
  }
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export async function readBody(
  req: IncomingMessage,
  limit: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  let overLimit = false;
  return new Promise((resolve, reject) => {
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        // Refuse, but keep draining so the response can still be sent.
        overLimit = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (overLimit) {
        reject(new HttpError(413, { error: 'too_large', message: `Request body is larger than ${limit} bytes.` }));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

export function sendJson(res: ServerResponse, status: number, data: unknown, headers?: Record<string, string>): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json',
    ...(headers ?? {}),
  });
  res.end(body);
}

export function setCookie(res: ServerResponse, name: string, value: string): void {
  const prev = res.getHeader('set-cookie');
  const list = Array.isArray(prev) ? [...prev] : prev ? [String(prev)] : [];
  list.push(`${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/`);
  res.setHeader('set-cookie', list);
}

export function clearCookie(res: ServerResponse, name: string): void {
  const prev = res.getHeader('set-cookie');
  const list = Array.isArray(prev) ? [...prev] : prev ? [String(prev)] : [];
  list.push(`${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.setHeader('set-cookie', list);
}

// The one published error order: cross-origin first, then the handler's own
// error. `res` errors use the one shape.
export async function runHandler(
  ctx: Ctx,
  handler: Handler,
): Promise<void> {
  const { res } = ctx;
  try {
    const result = await handler(ctx);
    if (result === undefined) {
      if (!res.writableEnded) res.writeHead(204);
      if (!res.writableEnded) res.end();
    } else if (Buffer.isBuffer(result)) {
      if (!res.headersSent) res.writeHead(200);
      res.end(result);
    } else {
      sendJson(res, 200, result);
    }
  } catch (e) {
    if (res.writableEnded) return;
    if (e instanceof ApiError) {
      sendJson(res, e.status, e.body());
    } else if (e instanceof HttpError) {
      sendJson(res, e.status, e.body);
    } else {
      sendJson(res, 500, { error: 'internal', message: 'Something went wrong.' });
    }
  }
}

export function requireSession(cookies: Record<string, string>): string {
  const token = cookies['hs_session'];
  if (!token) throw unauthenticated();
  return token;
}
