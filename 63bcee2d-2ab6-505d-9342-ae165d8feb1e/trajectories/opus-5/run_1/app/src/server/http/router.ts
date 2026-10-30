/** The route table and the one place the error shape is written to the wire. */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, forbidden, notFound } from './errors.js';
import { Context, type Reply } from './context.js';

export type Handler = (context: Context) => Promise<Reply>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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

  patch(pattern: string, handler: Handler): void {
    this.add('PATCH', pattern, handler);
  }

  delete(pattern: string, handler: Handler): void {
    this.add('DELETE', pattern, handler);
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let index = 0; index < route.segments.length; index += 1) {
        const segment = route.segments[index] as string;
        const value = parts[index] as string;
        if (segment.startsWith(':')) {
          params[segment.slice(1)] = decodeURIComponent(value);
          continue;
        }
        if (segment !== value) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return null;
  }
}

function writeReply(response: ServerResponse, reply: Reply, cookies: readonly string[]): void {
  const headers: Record<string, string | string[]> = {
    'X-Content-Type-Options': 'nosniff',
    ...(reply.headers ?? {}),
  };
  if (cookies.length > 0) headers['Set-Cookie'] = [...cookies];
  if (reply.json !== undefined) {
    const payload = Buffer.from(JSON.stringify(reply.json), 'utf8');
    headers['Content-Type'] = 'application/json; charset=utf-8';
    headers['Content-Length'] = String(payload.byteLength);
    response.writeHead(reply.status, headers);
    response.end(payload);
    return;
  }
  if (reply.bytes) {
    headers['Content-Type'] = reply.contentType ?? 'application/octet-stream';
    headers['Content-Length'] = String(reply.bytes.byteLength);
    response.writeHead(reply.status, headers);
    response.end(reply.bytes);
    return;
  }
  response.writeHead(reply.status, headers);
  response.end();
}

/** Rejects a state-changing request whose Origin header names another origin. */
function originAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return true;
  const host = request.headers.host;
  if (typeof host !== 'string') return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function serveApi(
  router: Router,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const method = request.method ?? 'GET';
  const matched = router.match(method, url.pathname);
  const context = new Context(request, url, matched?.params ?? {});
  let reply: Reply;
  try {
    if (STATE_CHANGING.has(method) && !originAllowed(request)) throw forbidden();
    if (!matched) throw notFound();
    reply = await matched.handler(context);
  } catch (error) {
    if (error instanceof ApiError) {
      reply = { status: error.status, json: error.body(), headers: error.headers };
    } else {
      process.stderr.write(`${String(error instanceof Error ? error.stack : error)}\n`);
      reply = { status: 500, json: { error: 'internal' } };
    }
  }
  writeReply(response, reply, context.setCookies);
}
