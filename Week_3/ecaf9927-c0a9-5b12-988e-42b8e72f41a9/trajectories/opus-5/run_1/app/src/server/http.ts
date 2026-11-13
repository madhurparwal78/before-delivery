import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Member } from '../shared/api.js';
import { SESSION_COOKIE } from './auth.js';
import { ApiError, errors } from './errors.js';
import { findMemberBySession } from './repo/workspace.js';

export const MAX_BODY_BYTES = 1_000_000;

export type Reply = {
  status: number;
  json?: unknown;
  raw?: { body: Buffer; contentType: string };
  setSession?: string | null;
  headers?: Record<string, string>;
};

export type Ctx = {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  body: Record<string, unknown>;
  hasBody: boolean;
  header: (name: string) => string | undefined;
  member: Member;
  token: string | null;
};

export type Route = {
  method: string;
  segments: string[];
  anonymous?: boolean;
  handle: (ctx: Ctx) => Promise<Reply>;
};

export function route(
  method: string,
  pattern: string,
  handle: (ctx: Ctx) => Promise<Reply>,
  anonymous = false,
): Route {
  return { method, segments: pattern.split('/').filter(Boolean), anonymous, handle };
}

function matchRoute(routes: Route[], method: string, segments: string[]): { route: Route; params: Record<string, string> } | 'path-unknown' | 'method-unknown' {
  let pathMatched = false;
  for (const candidate of routes) {
    if (candidate.segments.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < segments.length; i += 1) {
      const expected = candidate.segments[i] as string;
      const actual = segments[i] as string;
      if (expected.startsWith(':')) params[expected.slice(1)] = decodeURIComponent(actual);
      else if (expected !== actual) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    pathMatched = true;
    if (candidate.method === method) return { route: candidate, params };
  }
  return pathMatched ? 'method-unknown' : 'path-unknown';
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const entries: Record<string, string> = {};
  for (const piece of header.split(';')) {
    const index = piece.indexOf('=');
    if (index < 0) continue;
    entries[piece.slice(0, index).trim()] = decodeURIComponent(piece.slice(index + 1).trim());
  }
  return entries;
}

async function readBody(request: IncomingMessage): Promise<Buffer | 'too-large'> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const piece = chunk as Buffer;
    total += piece.length;
    if (total > MAX_BODY_BYTES) return 'too-large';
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}

function sameHost(origin: string, host: string | undefined): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.host === host;
  } catch {
    return false;
  }
}

const STATIC_FILES: Record<string, { file: string; contentType: string }> = {
  '/': { file: 'static/index.html', contentType: 'text/html; charset=utf-8' },
  '/styles.css': { file: 'static/styles.css', contentType: 'text/css; charset=utf-8' },
  '/app.js': { file: 'dist/public/app.js', contentType: 'text/javascript; charset=utf-8' },
};

const FONT_FILES = new Set([
  'space-grotesk-latin-500-normal.woff2',
  'space-grotesk-latin-600-normal.woff2',
  'ibm-plex-sans-latin-400-normal.woff2',
  'ibm-plex-sans-latin-500-normal.woff2',
  'ibm-plex-sans-latin-600-normal.woff2',
  'ibm-plex-mono-latin-400-normal.woff2',
  'ibm-plex-mono-latin-500-normal.woff2',
]);

async function serveStatic(root: string, path: string): Promise<Reply | null> {
  const entry = STATIC_FILES[path];
  if (entry) {
    return {
      status: 200,
      raw: { body: await readFile(join(root, entry.file)), contentType: entry.contentType },
    };
  }
  const fontMatch = /^\/fonts\/([a-z0-9-]+\.woff2)$/.exec(path);
  if (fontMatch && FONT_FILES.has(fontMatch[1] as string)) {
    return {
      status: 200,
      raw: {
        body: await readFile(join(root, 'static/fonts', fontMatch[1] as string)),
        contentType: 'font/woff2',
      },
      headers: { 'cache-control': 'public, max-age=604800' },
    };
  }
  return null;
}

function send(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    ...reply.headers,
  };
  if (reply.setSession !== undefined) {
    headers['set-cookie'] =
      reply.setSession === null
        ? `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
        : `${SESSION_COOKIE}=${reply.setSession}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
  }
  if (reply.raw) {
    headers['content-type'] = reply.raw.contentType;
    response.writeHead(reply.status, headers);
    response.end(reply.raw.body);
    return;
  }
  const payload = reply.json === undefined ? '' : JSON.stringify(reply.json);
  if (payload !== '') headers['content-type'] = 'application/json';
  response.writeHead(reply.status, headers);
  response.end(payload);
}

export function createHandler(
  routes: Route[],
  root: string,
): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? '/', 'http://placeholder');
        const method = request.method ?? 'GET';
        const header = (name: string): string | undefined => {
          const value = request.headers[name.toLowerCase()];
          return Array.isArray(value) ? value[0] : value;
        };

        const origin = header('origin');
        if (
          (method === 'POST' || method === 'PATCH' || method === 'DELETE') &&
          origin !== undefined &&
          !sameHost(origin, header('host'))
        ) {
          throw errors.crossOrigin();
        }

        const raw = await readBody(request);
        if (raw === 'too-large') throw errors.payloadTooLarge();
        const contentType = header('content-type') ?? '';
        if (raw.length > 0 && !contentType.toLowerCase().startsWith('application/json')) {
          throw errors.unsupportedMediaType();
        }

        const segments = url.pathname.split('/').filter(Boolean);
        if (segments[0] !== 'api') {
          const file = method === 'GET' ? await serveStatic(root, url.pathname) : null;
          send(response, file ?? { status: 404, json: errors.notFound().body });
          return;
        }

        const matched = matchRoute(routes, method, segments);
        if (typeof matched === 'string') throw errors.notFound();

        let body: Record<string, unknown> = {};
        if (raw.length > 0) {
          const parsed: unknown = JSON.parse(raw.toString('utf8'));
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw errors.unsupportedMediaType();
          }
          body = parsed as Record<string, unknown>;
        }

        const token = parseCookies(header('cookie'))[SESSION_COOKIE] ?? null;
        const member = token === null ? null : await findMemberBySession(token);
        if (!matched.route.anonymous && member === null) throw errors.unauthenticated();

        const reply = await matched.route.handle({
          method,
          path: url.pathname,
          query: url.searchParams,
          params: matched.params,
          body,
          hasBody: raw.length > 0,
          header,
          member: member as Member,
          token,
        });
        send(response, reply);
      } catch (error) {
        if (error instanceof ApiError) {
          send(response, { status: error.status, json: error.body });
          return;
        }
        if (error instanceof SyntaxError) {
          send(response, { status: 415, json: errors.unsupportedMediaType().body });
          return;
        }
        process.stderr.write(`${String(error)}\n`);
        send(response, { status: 500, json: { error: { code: 'server_error', message: 'Something went wrong.' } } });
      }
    })();
  };
}
