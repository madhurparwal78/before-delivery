import type { IncomingMessage, ServerResponse } from 'node:http';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body.error ?? 'error'));
  }
}

export const notFound = () => new ApiError(404, { error: 'not_found' });
export const unauthenticated = () => new ApiError(401, { error: 'unauthenticated' });
export const fieldErrors = (errors: Record<string, string>) => new ApiError(422, { errors });
export const parseRefusal = (message: string) => new ApiError(422, { error: 'parse', message });

export interface Reply {
  status: number;
  json?: unknown;
  body?: Buffer;
  headers?: Record<string, string>;
}

export const ok = (json: unknown, status = 200): Reply => ({ status, json });

export interface Ctx {
  req: IncomingMessage;
  params: Record<string, string>;
  query: URLSearchParams;
  readBody(limit: number): Promise<Buffer>;
  json(limit?: number): Promise<Record<string, unknown>>;
  cookies: Record<string, string>;
}

type Handler = (ctx: Ctx) => Promise<Reply>;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

export const JSON_LIMIT = 1_000_000;

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
  }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    const segments = path.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method || route.parts.length !== segments.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < segments.length; i++) {
        const part = route.parts[i]!;
        const segment = segments[i]!;
        if (part.startsWith(':')) {
          params[part.slice(1)] = decodeURIComponent(segment);
        } else if (part !== segment) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const piece of (header ?? '').split(';')) {
    const at = piece.indexOf('=');
    if (at < 0) continue;
    cookies[piece.slice(0, at).trim()] = decodeURIComponent(piece.slice(at + 1).trim());
  }
  return cookies;
}

export function makeBodyReader(req: IncomingMessage): (limit: number) => Promise<Buffer> {
  let cached: Promise<Buffer> | null = null;
  return (limit: number) => {
    cached ??= new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let over = false;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) over = true;
        if (!over) chunks.push(chunk);
      });
      req.on('end', () => (over ? reject(new ApiError(413, { error: 'too_large' })) : resolve(Buffer.concat(chunks))));
      req.on('error', reject);
    });
    return cached;
  };
}

export function str(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value : '';
}

export function send(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store', ...reply.headers };
  if (reply.json !== undefined) {
    const data = Buffer.from(JSON.stringify(reply.json));
    res.writeHead(reply.status, { ...headers, 'Content-Type': 'application/json', 'Content-Length': String(data.length) });
    res.end(data);
    return;
  }
  if (reply.body) {
    res.writeHead(reply.status, { ...headers, 'Content-Length': String(reply.body.length) });
    res.end(reply.body);
    return;
  }
  res.writeHead(reply.status, headers);
  res.end();
}
