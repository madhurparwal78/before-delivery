import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { ApiError } from './errors.js';
import type { AppContext } from './app.js';
import { requireStore } from './app.js';
import type { AccountRecord } from './store.js';
import { LIMITS } from '../shared/constants.js';

export const SESSION_COOKIE = 'squallglass_session';

export interface RequestContext {
  app: AppContext;
  method: string;
  pathname: string;
  query: URLSearchParams;
  body: unknown;
  hasBody: boolean;
  params: Record<string, string>;
  account: AccountRecord | null;
  sessionToken: string | null;
  secure: boolean;
}

export interface ApiResponse {
  status: number;
  body?: unknown;
  setSession?: string;
  clearSession?: boolean;
}

export type Handler = (request: RequestContext) => Promise<ApiResponse>;

export interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  bodyLimit: number;
  authenticated: boolean;
}

export function route(
  method: string,
  pattern: string,
  handler: Handler,
  options: { authenticated?: boolean; commandBody?: boolean } = {},
): Route {
  return {
    method,
    segments: pattern.split('/').filter((segment) => segment !== ''),
    handler,
    bodyLimit: options.commandBody === true ? LIMITS.commandBodyBytes : LIMITS.otherBodyBytes,
    authenticated: options.authenticated === true,
  };
}

function matchSegments(route: Route, segments: string[]): Record<string, string> | null {
  if (route.segments.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < segments.length; index += 1) {
    const pattern = route.segments[index];
    if (pattern.startsWith(':')) params[pattern.slice(1)] = decodeURIComponent(segments[index]);
    else if (pattern !== segments[index]) return null;
  }
  return params;
}

interface BodyRead {
  text: string;
  tooLarge: boolean;
}

/** Reads the request body, rejecting byte excess before any parsing while draining the socket. */
function readBody(request: IncomingMessage, limit: number): Promise<BodyRead> {
  return new Promise((resolve, reject) => {
    let chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;
    request.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      total += chunk.length;
      if (total > limit) {
        tooLarge = true;
        chunks = [];
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      resolve(
        tooLarge
          ? { text: '', tooLarge: true }
          : { text: Buffer.concat(chunks).toString('utf8'), tooLarge: false },
      );
    });
    request.on('error', (error) => {
      if (!tooLarge) reject(error);
    });
  });
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (header === undefined) return {};
  const jar: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    jar[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return jar;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(response: ServerResponse, status: number, body: unknown, headers: string[]): void {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const base: Record<string, string | string[]> = {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
  if (payload !== '') base['content-type'] = 'application/json';
  if (headers.length > 0) base['set-cookie'] = headers;
  response.writeHead(status, base);
  response.end(payload);
}

function serveStatic(publicDir: string, pathname: string, response: ServerResponse): void {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolved = path.resolve(publicDir, relative);
  const target =
    resolved.startsWith(publicDir) && existsSync(resolved) && statSync(resolved).isFile()
      ? resolved
      : path.join(publicDir, 'index.html');
  const extension = path.extname(target);
  response.writeHead(200, {
    'content-type': MIME_TYPES[extension] ?? 'application/octet-stream',
    'cache-control': extension === '.html' ? 'no-store' : 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(target).pipe(response);
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function createHttpServer(context: AppContext, routes: Route[], publicDir: string) {
  return createServer(async (request, response) => {
    const host = request.headers.host ?? 'localhost';
    const url = new URL(request.url ?? '/', `http://${host}`);
    const pathname = url.pathname;

    if (pathname === '/api/health') {
      sendJson(response, 200, { status: 'ok' }, []);
      return;
    }

    if (!pathname.startsWith('/api/')) {
      serveStatic(publicDir, pathname, response);
      return;
    }

    const segments = pathname.split('/').filter((segment) => segment !== '');
    const candidates = routes
      .map((candidate) => ({ candidate, params: matchSegments(candidate, segments) }))
      .filter((entry) => entry.params !== null);

    if (candidates.length === 0) {
      sendJson(response, 404, new ApiError('NOT_FOUND').body(), []);
      return;
    }

    const matched = candidates.find((entry) => entry.candidate.method === request.method);
    if (matched === undefined) {
      sendJson(response, 405, new ApiError('METHOD_REFUSED').body(), []);
      return;
    }

    const cookies = parseCookies(request.headers.cookie);
    const sessionToken = cookies[SESSION_COOKIE] ?? null;
    const secure = request.headers['x-forwarded-proto'] === 'https';

    try {
      const origin = request.headers.origin;
      if (
        MUTATING_METHODS.has(request.method ?? '') &&
        origin !== undefined &&
        origin !== `http://${host}` &&
        origin !== `https://${host}`
      ) {
        throw new ApiError('ORIGIN_REFUSED');
      }

      const read = await readBody(request, matched.candidate.bodyLimit);
      if (read.tooLarge) throw new ApiError('BODY_TOO_LARGE');

      const hasBody = read.text.length > 0;
      if (hasBody) {
        const contentType = request.headers['content-type'] ?? '';
        if (!contentType.split(';')[0].trim().toLowerCase().startsWith('application/json')) {
          throw new ApiError('JSON_REQUIRED');
        }
      }

      let body: unknown;
      if (hasBody) {
        try {
          body = JSON.parse(read.text);
        } catch {
          throw new ApiError('INVALID_JSON');
        }
      }

      let account: AccountRecord | null = null;
      if (sessionToken !== null) {
        const store = await requireStore(context);
        account = await store.accountForToken(sessionToken);
      }
      if (matched.candidate.authenticated && account === null) throw new ApiError('AUTH_REQUIRED');

      const result = await matched.candidate.handler({
        app: context,
        method: request.method as string,
        pathname,
        query: url.searchParams,
        body,
        hasBody,
        params: matched.params as Record<string, string>,
        account,
        sessionToken,
        secure,
      });

      const cookieHeaders: string[] = [];
      if (result.setSession !== undefined) {
        cookieHeaders.push(
          `${SESSION_COOKIE}=${result.setSession}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
        );
      }
      if (result.clearSession === true) {
        cookieHeaders.push(
          `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`,
        );
      }
      sendJson(response, result.status, result.body, cookieHeaders);
    } catch (error) {
      if (error instanceof ApiError) {
        sendJson(response, error.status, error.body(), []);
        return;
      }
      process.stderr.write(`[request] ${pathname} ${(error as Error).stack ?? String(error)}\n`);
      sendJson(response, 503, new ApiError('DATABASE_UNAVAILABLE').body(), []);
    }
  });
}
