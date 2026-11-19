import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, StorageDown } from './errors.ts';

export type Json = Record<string, unknown>;

export type Body = { kind: 'ok'; value: unknown } | { kind: 'big' } | { kind: 'bad' } | { kind: 'none' };

/** Reads at most `limit` bytes (inclusive) and classifies the body; nothing here throws. */
export async function readBody(req: IncomingMessage, limit: number): Promise<Body> {
  if (req.method === 'GET' || req.method === 'HEAD') return { kind: 'none' };
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size <= limit) chunks.push(chunk as Buffer);
  }
  if (size > limit) return { kind: 'big' };
  if (size === 0) return { kind: 'none' };
  try {
    return { kind: 'ok', value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { kind: 'bad' };
  }
}

export const asObject = (value: unknown): Json => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {});

/** 413 and the non-JSON 422 come after the 401, 404 and 403 rules, so handlers call this at that point. */
export function usable(body: Body, limit: number): Json {
  if (body.kind === 'big') throw new HttpError(413, { error: `Request body exceeds ${limit} bytes` });
  if (body.kind === 'bad') throw new HttpError(422, { errors: { body: 'Body must be JSON' } });
  return body.kind === 'ok' ? asObject(body.value) : {};
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string | string[]>;
  raw?: { type: string; data: Buffer };
}

export const reply = (status: number, body?: unknown, headers?: Reply['headers']): Reply => ({ status, body, headers });

export function send(res: ServerResponse, out: Reply): void {
  if (res.headersSent) return;
  if (out.raw) {
    res.writeHead(out.status, { 'content-type': out.raw.type, 'content-length': out.raw.data.length, ...out.headers });
    res.end(out.raw.data);
    return;
  }
  if (out.body === undefined) {
    res.writeHead(out.status, out.headers);
    res.end();
    return;
  }
  const data = Buffer.from(JSON.stringify(out.body));
  res.writeHead(out.status, { 'content-type': 'application/json; charset=utf-8', 'content-length': data.length, ...out.headers });
  res.end(data);
}

export function errorReply(error: unknown): Reply {
  if (error instanceof HttpError) return reply(error.status, error.body);
  if (error instanceof StorageDown) return reply(503, { error: error.copy });
  console.error(error);
  return reply(500, { error: 'Internal error' });
}

interface Route {
  method: string;
  parts: string[];
  handler: (ctx: Ctx) => Promise<Reply>;
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Route['handler']): void {
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
  }

  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
    const given = pathname.split('/').filter(Boolean).map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const tail = route.parts.at(-1)?.startsWith('*') ?? false;
      if (tail ? given.length < route.parts.length : given.length !== route.parts.length) continue;
      const params: Record<string, string> = {};
      const fits = route.parts.every((part, i) => {
        if (part.startsWith('*')) {
          params[part.slice(1)] = given.slice(i).join('/');
          return true;
        }
        if (part.startsWith(':')) {
          params[part.slice(1)] = given[i];
          return true;
        }
        return part === given[i];
      });
      if (fits) return { route, params };
    }
    return null;
  }
}

export const mentions = (text: string): string[] => [...new Set([...text.matchAll(/(?:^|[^\w-])@([a-z][a-z0-9-]{1,31})(?![\w-])/g)].map((match) => match[1]))];
