import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { ApiError } from './errors';
import { limits } from './config';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  nonce: string;
  method: string;
}

export type Handler = (ctx: Ctx) => Promise<void>;

interface Route {
  method: string;
  keys: string[];
  pattern: RegExp;
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, template: string, handler: Handler): void {
    const keys: string[] = [];
    const pattern = template
      .split('/')
      .map((segment) => {
        if (segment.startsWith(':')) {
          keys.push(segment.slice(1));
          return '([^/]+)';
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    this.routes.push({ method, keys, pattern: new RegExp(`^${pattern}$`), handler });
  }

  find(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = route.pattern.exec(pathname);
      if (!match) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((key, index) => {
        params[key] = decodeURIComponent(match[index + 1] ?? '');
      });
      return { handler: route.handler, params };
    }
    return null;
  }

}

export function makeNonce(): string {
  return randomBytes(16).toString('base64');
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const jar: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name !== '') jar[name] = decodeURIComponent(value);
  }
  return jar;
}

export interface CookieOptions {
  path: string;
  maxAgeSeconds?: number;
}

export function serialiseCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path}`, 'HttpOnly', 'SameSite=Strict'];
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`);
  return parts.join('; ');
}

export function appendCookie(res: ServerResponse, cookie: string): void {
  const existing = res.getHeader('Set-Cookie');
  if (existing === undefined) res.setHeader('Set-Cookie', [cookie]);
  else if (Array.isArray(existing)) res.setHeader('Set-Cookie', [...existing, cookie]);
  else res.setHeader('Set-Cookie', [String(existing), cookie]);
}

export async function readRawBody(ctx: Ctx, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    ctx.req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        ctx.req.destroy();
        reject(new ApiError(413, 'too_large'));
        return;
      }
      chunks.push(chunk);
    });
    ctx.req.on('end', () => resolve(Buffer.concat(chunks)));
    ctx.req.on('error', () => reject(new ApiError(413, 'too_large')));
  });
}

export function contentTypeEssence(req: IncomingMessage): string {
  const header = req.headers['content-type'];
  if (header === undefined) return '';
  return (String(header).split(';')[0] ?? '').trim().toLowerCase();
}

export function sendJson(
  ctx: Ctx,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  sendJsonText(ctx, status, JSON.stringify(body), headers);
}

/** Sends a stored response byte for byte, for idempotent replays. */
export function sendJsonText(
  ctx: Ctx,
  status: number,
  text: string,
  headers: Record<string, string> = {},
): void {
  const payload = Buffer.from(text, 'utf8');
  ctx.res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    ...headers,
  });
  ctx.res.end(payload);
}

export function sendEmpty(ctx: Ctx, status: number): void {
  ctx.res.writeHead(status, { 'Cache-Control': 'no-store' });
  ctx.res.end();
}

export interface Stream {
  send(event: string, data: unknown): void;
  comment(text: string): void;
  close(): void;
  onClose(listener: () => void): void;
  readonly open: boolean;
}

export function startStream(ctx: Ctx): Stream {
  ctx.res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  let open = true;
  const listeners: Array<() => void> = [];
  const finish = (): void => {
    if (!open) return;
    open = false;
    for (const listener of listeners) listener();
  };
  ctx.req.on('close', finish);
  ctx.res.on('close', finish);
  return {
    get open() {
      return open;
    },
    send(event: string, data: unknown): void {
      if (!open) return;
      ctx.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    comment(text: string): void {
      if (!open) return;
      ctx.res.write(`: ${text}\n\n`);
    },
    close(): void {
      if (!open) return;
      open = false;
      for (const listener of listeners) listener();
      ctx.res.end();
    },
    onClose(listener: () => void): void {
      if (!open) listener();
      else listeners.push(listener);
    },
  };
}
