import type { IncomingMessage, ServerResponse } from 'node:http';
import { EVIDENCE_REQUEST_LIMIT, JSON_BODY_LIMIT, SESSION_COOKIE } from '../config';
import { ApiProblem, problem } from './problem';
import { nowSeconds } from '../domain/time';

export interface Desk {
  id: string;
  name: string;
  email: string;
}

export interface Reply {
  status: number;
  headers?: Record<string, string>;
  json?: unknown;
  html?: string;
  bytes?: Buffer;
  contentType?: string;
  cookie?: { value: string } | { clear: true };
}

export interface Ctx {
  method: string;
  url: URL;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  body: Buffer;
  desk: Desk | null;
  sessionId: string | null;
  now: number;
  json(): Record<string, unknown>;
  text(): string;
  requireDesk(): Desk;
}

export type Handler = (ctx: Ctx) => Promise<Reply> | Reply;

export interface Route {
  method: string;
  pattern: string;
  handler: Handler;
  kind?: 'api' | 'page';
  auth?: 'required' | 'optional';
  limit?: 'json' | 'evidence';
  rate?: 'request' | 'file';
}

interface Compiled extends Route {
  segments: string[];
}

export interface RouterServices {
  findSession(id: string): Promise<{ desk: Desk; ended: boolean } | null>;
  checkRate(kind: 'request' | 'file', deskId: string, now: number): Promise<void>;
  renderNotFound(ctx: Ctx): Promise<Reply>;
  staticReply(path: string): Reply | null;
}

function compile(route: Route): Compiled {
  return { ...route, segments: route.pattern.split('/').filter((part) => part !== '') };
}

function match(compiled: Compiled, segments: string[]): Record<string, string> | null {
  if (compiled.segments.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < segments.length; index += 1) {
    const pattern = compiled.segments[index] as string;
    const given = segments[index] as string;
    if (pattern.startsWith('<') && pattern.endsWith('>')) {
      params[pattern.slice(1, -1)] = decodeURIComponent(given);
    } else if (pattern !== given) {
      return null;
    }
  }
  return params;
}

function readCookies(header: string | undefined): Record<string, string> {
  const found: Record<string, string> = {};
  if (!header) return found;
  for (const piece of header.split(';')) {
    const at = piece.indexOf('=');
    if (at === -1) continue;
    found[piece.slice(0, at).trim()] = piece.slice(at + 1).trim();
  }
  return found;
}

function sessionCookie(value: string | null): string {
  const attributes = `Path=/; HttpOnly; SameSite=Lax`;
  if (value === null) return `${SESSION_COOKIE}=; ${attributes}; Max-Age=0`;
  return `${SESSION_COOKIE}=${value}; ${attributes}`;
}

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer | 'too-large'> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let stopped = false;
    request.on('data', (chunk: Buffer) => {
      if (stopped) return;
      total += chunk.length;
      if (total > limit) {
        stopped = true;
        resolve('too-large');
        request.resume();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (!stopped) resolve(Buffer.concat(chunks));
    });
    request.on('error', (problemFound) => {
      if (!stopped) reject(problemFound);
    });
  });
}

function send(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = { ...(reply.headers ?? {}) };
  let payload: Buffer;
  if (reply.json !== undefined) {
    payload = Buffer.from(JSON.stringify(reply.json));
    headers['Content-Type'] = 'application/json; charset=utf-8';
  } else if (reply.html !== undefined) {
    payload = Buffer.from(reply.html, 'utf8');
    headers['Content-Type'] = 'text/html; charset=utf-8';
  } else if (reply.bytes !== undefined) {
    payload = reply.bytes;
    if (reply.contentType) headers['Content-Type'] = reply.contentType;
  } else {
    payload = Buffer.alloc(0);
  }
  if (reply.cookie) {
    headers['Set-Cookie'] = 'clear' in reply.cookie ? sessionCookie(null) : sessionCookie(reply.cookie.value);
  }
  if (!headers['Cache-Control']) headers['Cache-Control'] = 'no-store';
  headers['Content-Length'] = String(payload.length);
  headers['X-Content-Type-Options'] = 'nosniff';
  response.writeHead(reply.status, headers);
  if (payload.length > 0) response.end(payload);
  else response.end();
}

export function makeRouter(routes: Route[], services: RouterServices) {
  const compiled = routes.map(compile);

  return async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://desk.local');
    const path = url.pathname;
    const method = (request.method ?? 'GET').toUpperCase();
    const isApi = path.startsWith('/api/');

    try {
      const asset = services.staticReply(path);
      if (asset && (method === 'GET' || method === 'HEAD')) {
        send(response, asset);
        return;
      }

      const segments = path.split('/').filter((part) => part !== '');
      const samePath = compiled
        .map((route) => ({ route, params: match(route, segments) }))
        .filter((found): found is { route: Compiled; params: Record<string, string> } => found.params !== null);

      const found = samePath.find((candidate) => candidate.route.method === method);
      if (!found) {
        const bare: Ctx = {
          method,
          url,
          path,
          params: {},
          query: url.searchParams,
          headers: request.headers,
          body: Buffer.alloc(0),
          desk: null,
          sessionId: null,
          now: nowSeconds(),
          json: () => ({}),
          text: () => '',
          requireDesk: () => {
            throw problem.notSignedIn();
          },
        };
        request.resume();
        if (samePath.length > 0) {
          const allow = [...new Set(samePath.map((candidate) => candidate.route.method))];
          if (!allow.includes('HEAD') && allow.includes('GET')) allow.push('HEAD');
          throw problem.methodNotAllowed(allow.sort());
        }
        if (isApi) throw problem.notFound();
        send(response, await services.renderNotFound(bare));
        return;
      }

      const route = found.route;
      const limit = route.limit === 'evidence' ? EVIDENCE_REQUEST_LIMIT : JSON_BODY_LIMIT;
      const body = route.method === 'GET' || route.method === 'HEAD' ? Buffer.alloc(0) : await readBody(request, limit);
      if (body === 'too-large') {
        throw problem.tooLarge(
          route.limit === 'evidence'
            ? 'That request is over 10,000,000 bytes.'
            : 'That body is over 1,000,000 bytes.',
        );
      }

      const now = nowSeconds();
      const cookies = readCookies(request.headers.cookie);
      const sessionId = cookies[SESSION_COOKIE] ?? null;
      const session = sessionId ? await services.findSession(sessionId) : null;

      if (route.rate && session && !session.ended) {
        await services.checkRate(route.rate, session.desk.id, now);
      }

      const ctx: Ctx = {
        method,
        url,
        path,
        params: found.params,
        query: url.searchParams,
        headers: request.headers,
        body,
        desk: session && !session.ended ? session.desk : null,
        sessionId,
        now,
        json: () => readJson(request.headers['content-type'], body),
        text: () => body.toString('utf8'),
        requireDesk: () => {
          if (session === null) throw problem.notSignedIn();
          if (session.ended) throw problem.sessionEnded();
          return session.desk;
        },
      };

      if (route.auth === 'required') {
        if (route.kind === 'page') {
          if (!ctx.desk) {
            send(response, {
              status: 302,
              headers: { Location: `/sign-in?next=${encodeURIComponent(path + url.search)}` },
            });
            return;
          }
        } else {
          ctx.requireDesk();
        }
      }

      send(response, await route.handler(ctx));
    } catch (thrown) {
      if (thrown instanceof ApiProblem) {
        if (isApi || path.startsWith('/assets/')) {
          send(response, { status: thrown.status, json: thrown.body(), headers: thrown.headers });
        } else {
          send(response, {
            status: thrown.status,
            headers: thrown.headers,
            html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${thrown.status}</title></head><body>${thrown.message}</body></html>`,
          });
        }
        return;
      }
      process.stderr.write(`${String(thrown instanceof Error ? thrown.stack : thrown)}\n`);
      send(response, {
        status: 500,
        json: { error: { code: 'conflict', message: 'Something went wrong.' } },
      });
    }
  };
}

function readJson(contentType: string | undefined, body: Buffer): Record<string, unknown> {
  const kind = (contentType ?? '').split(';')[0]?.trim().toLowerCase();
  if (body.length === 0 && (kind === undefined || kind === '' || kind === 'application/json')) return {};
  if (kind !== 'application/json') throw problem.unsupportedMediaType();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    throw problem.malformedJson();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw problem.malformedJson();
  return parsed as Record<string, unknown>;
}
