/** HTTP kernel: request context, error ladder, origin check, body limits. */
import { IncomingMessage, ServerResponse } from 'node:http';

export const JSON_BODY_LIMIT = 65536;
export const RECEIPT_LIMIT = 5242880;

export class Ctx {
  readonly req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  body?: Buffer;
  json?: unknown;
  /** signed-in parent */
  userId: string | null = null;
  role: 'planning' | 'other' | null = null;
  householdId: string | null = null;
  /** idempotency replay, if any */
  replay: { status: number; body: Buffer; headers: Record<string, string> } | null = null;
  replayed = false;
  params: Record<string, string> = {};

  constructor(req: IncomingMessage, res: ServerResponse, url: URL) {
    this.req = req;
    this.res = res;
    this.url = url;
  }

  query(name: string): string | null {
    return this.url.searchParams.get(name);
  }

  header(name: string): string | null {
    const v = this.req.headers[name.toLowerCase()];
    if (Array.isArray(v)) return v[0] ?? null;
    return v ?? null;
  }

  bearerToken(): string | null {
    const h = this.header('authorization');
    if (!h) return null;
    const m = /^Bearer (\S+)$/.exec(h);
    return m ? m[1] : null;
  }

  method(): string {
    return this.req.method ?? 'GET';
  }
}

export function isStateChanging(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

export type Json = Record<string, unknown>;

export function sendJson(ctx: Ctx, status: number, body: unknown, headers?: Record<string, string>): void {
  const buf = Buffer.from(JSON.stringify(body), 'utf8');
  ctx.res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(buf.length),
    'cache-control': 'no-store',
    ...headers,
  });
  ctx.res.end(buf);
}

export function sendProblem(ctx: Ctx, status: number, body: Record<string, unknown>, headers?: Record<string, string>): void {
  const buf = Buffer.from(JSON.stringify(body), 'utf8');
  ctx.res.writeHead(status, {
    'content-type': 'application/problem+json',
    'content-length': String(buf.length),
    'cache-control': 'no-store',
    ...headers,
  });
  ctx.res.end(buf);
}

export function sendBytes(ctx: Ctx, status: number, contentType: string, buf: Buffer, headers?: Record<string, string>): void {
  ctx.res.writeHead(status, {
    'content-type': contentType,
    'content-length': String(buf.length),
    'cache-control': 'no-store',
    ...headers,
  });
  ctx.res.end(buf);
}

export function sendNoContent(ctx: Ctx): void {
  ctx.res.writeHead(204, { 'cache-control': 'no-store' });
  ctx.res.end();
}

/** Read a body up to a limit, or throw the payload problem. */
export async function readBody(ctx: Ctx, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of ctx.req) {
    const b = chunk as Buffer;
    total += b.length;
    if (total > limit) {
      throwPayloadTooLarge();
    }
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

function throwPayloadTooLarge(): never {
  const err = new Error('payload');
  (err as { __problem?: unknown }).__problem = true;
  throw Object.assign(err, { problemStatus: 413 });
}
