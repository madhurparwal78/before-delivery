import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, ERROR_TEXT, type ErrorFields } from '../shared/errors.js';

// ---------------------------------------------------------------------------
// A minimal HTTP router: one place for the error shape, body limits, origin
// checks and the published error order.
// ---------------------------------------------------------------------------

export type Handler = (request: RequestContext) => Promise<unknown>;

export interface RequestContext {
  request: IncomingMessage;
  response: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  rawBody: Buffer | null;
  username: string | null;
  cookies: Record<string, string>;
}

export interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler): void {
    const paramNames: string[] = [];
    const source = path
      .split('/')
      .map((segment) => {
        if (segment.startsWith(':')) {
          paramNames.push(segment.slice(1));
          return '([^/]+)';
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    this.routes.push({ method, pattern: new RegExp(`^${source}/?$`), paramNames, handler });
  }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const found = route.pattern.exec(path);
      if (!found) continue;
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, index) => {
        params[name] = decodeURIComponent(found[index + 1]);
      });
      return { route, params };
    }
    return null;
  }
}

export const JSON_LIMIT = 1000000;

export async function readBody(request: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as never);
    total += buffer.length;
    if (total > limit) {
      throw new ApiError('too_large', `The body is over ${limit} bytes.`);
    }
    chunks.push(buffer);
  }
  return chunks.length ? Buffer.concat(chunks) : null;
}

export function originMismatch(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return false;
  const host = request.headers.host;
  if (!host) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true;
  }
  return originHost !== host;
}

export function writeError(response: ServerResponse, error: ApiError): void {
  if (response.headersSent) return;
  const body: { error: string; message: string; fields?: ErrorFields; lines?: string[] } = {
    error: error.code,
    message: error.message,
  };
  if (error.fields) body.fields = error.fields;
  if (error.lines) body.lines = error.lines;
  response.writeHead(error.status(), { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

export function sendJson(response: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(payload));
}

export function parseCookies(request: IncomingMessage): Record<string, string> {
  const header = request.headers.cookie;
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key) cookies[key] = rest.join('=');
  }
  return cookies;
}

export { ERROR_TEXT };
