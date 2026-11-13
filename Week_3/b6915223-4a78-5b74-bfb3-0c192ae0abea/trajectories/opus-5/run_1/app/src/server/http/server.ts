import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { MAX_BODY_BYTES, SESSION_COOKIE } from '../config.ts';
import { sessionManager, type ManagerRecord } from '../game/sessions.ts';
import {
  ApiError,
  crossOrigin,
  forbidden,
  notFound,
  payloadTooLarge,
  unauthenticated,
  unsupportedMediaType,
} from './errors.ts';
import { matchRoute } from '../routes/index.ts';

export interface RequestContext {
  method: string;
  url: URL;
  params: Record<string, string>;
  body: Record<string, unknown>;
  rawBody: string;
  headers: IncomingMessage['headers'];
  manager: ManagerRecord;
}

export interface ApiResponse {
  status: number;
  body?: unknown;
  bytes?: Buffer;
  headers?: Record<string, string>;
  setSession?: string | null;
}

export type Handler = (context: RequestContext) => Promise<ApiResponse>;

export type RouteAuth = 'public' | 'any' | 'manager' | 'operator';

export interface Route {
  method: string;
  path: string;
  auth: RouteAuth;
  handler: Handler;
}

const CLIENT_ROUTES = [
  /^\/$/,
  /^\/signin$/,
  /^\/team$/,
  /^\/transfers$/,
  /^\/leagues$/,
  /^\/leagues\/[^/]+$/,
  /^\/leagues\/[^/]+\/members\/[^/]+$/,
  /^\/history$/,
  /^\/operator$/,
];

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const readBody = async (request: IncomingMessage): Promise<string> => {
  const declared = Number(request.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw payloadTooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw payloadTooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
};

const sameOrigin = (request: IncomingMessage): boolean => {
  const origin = request.headers.origin;
  if (origin === undefined || origin === 'null') return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
};

const sendJson = (
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void => {
  const payload = JSON.stringify(body ?? null);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...headers,
  });
  response.end(payload);
};

const sessionCookie = (token: string | null): string =>
  token === null
    ? `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
    : `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`;

const serveClient = async (
  pathname: string,
  response: ServerResponse,
  clientRoot: string,
): Promise<void> => {
  const isAsset = pathname.startsWith('/assets/');
  const relative = isAsset ? normalize(pathname).replace(/^(\.\.[/\\])+/, '') : '/index.html';
  if (!isAsset && !CLIENT_ROUTES.some((pattern) => pattern.test(pathname))) {
    sendJson(response, 404, { error: 'not_found', message: 'Nothing lives at that address.' });
    return;
  }
  const file = join(clientRoot, relative);
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-store',
    });
    createReadStream(file).pipe(response);
  } catch {
    sendJson(response, 404, { error: 'not_found', message: 'Nothing lives at that address.' });
  }
};

export const createHttpServer = (clientRoot: string): Server =>
  createServer((request, response) => {
    void handle(request, response, clientRoot).catch(() => {
      sendJson(response, 500, {
        error: 'server_error',
        message: 'Something went wrong on the server.',
      });
    });
  });

const handle = async (
  request: IncomingMessage,
  response: ServerResponse,
  clientRoot: string,
): Promise<void> => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const method = request.method ?? 'GET';

  if (!url.pathname.startsWith('/api/')) {
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(response, 404, { error: 'not_found', message: 'Nothing lives at that address.' });
      return;
    }
    await serveClient(url.pathname, response, clientRoot);
    return;
  }

  try {
    const rawBody = await readBody(request);
    const contentType = String(request.headers['content-type'] ?? '');
    if (
      WRITE_METHODS.has(method) &&
      rawBody.length > 0 &&
      !/^application\/json(\s*;\s*charset=.+)?$/i.test(contentType.trim())
    ) {
      throw unsupportedMediaType();
    }
    if (WRITE_METHODS.has(method) && !sameOrigin(request)) throw crossOrigin();

    const match = matchRoute(method, url.pathname);
    if (match === null) throw notFound();

    const manager = await sessionManager(request.headers.cookie);
    if (match.route.auth !== 'public' && manager === null) throw unauthenticated();
    if (match.route.auth === 'manager' && manager!.role !== 'manager') throw forbidden();
    if (match.route.auth === 'operator' && manager!.role !== 'operator') throw forbidden();

    let body: Record<string, unknown> = {};
    if (rawBody.length > 0) {
      try {
        const parsed: unknown = JSON.parse(rawBody);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw unsupportedMediaType();
        }
        body = parsed as Record<string, unknown>;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw unsupportedMediaType();
      }
    }

    const result = await match.route.handler({
      method,
      url,
      params: match.params,
      body,
      rawBody,
      headers: request.headers,
      manager: manager as ManagerRecord,
    });

    const headers = { ...(result.headers ?? {}) };
    if (result.setSession !== undefined) {
      headers['Set-Cookie'] = sessionCookie(result.setSession);
    }
    if (result.bytes !== undefined) {
      response.writeHead(result.status, {
        'Content-Length': result.bytes.length,
        'X-Content-Type-Options': 'nosniff',
        ...headers,
      });
      response.end(result.bytes);
      return;
    }
    if (result.status === 204) {
      response.writeHead(204, headers);
      response.end();
      return;
    }
    sendJson(response, result.status, result.body, headers);
  } catch (error) {
    if (error instanceof ApiError) {
      sendJson(response, error.status, error.body);
      return;
    }
    throw error;
  }
};
