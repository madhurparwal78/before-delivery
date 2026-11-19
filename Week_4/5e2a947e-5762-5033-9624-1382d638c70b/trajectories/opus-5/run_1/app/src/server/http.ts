import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from '../shared/errors.js';
import { JSON_BODY_MAX_BYTES } from '../shared/settings.js';

export interface RequestContext {
  method: string;
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  headers: IncomingMessage['headers'];
  cookies: Record<string, string>;
  body: Buffer;
  setCookie: (value: string) => void;
  origin: string;
}

export interface Reply {
  status: number;
  json?: unknown;
  body?: Buffer | string;
  contentType?: string;
  headers?: Record<string, string>;
}

export type Handler = (ctx: RequestContext) => Promise<Reply>;

export interface RouteOptions {
  /** Body limit in bytes; defaults to the JSON limit. */
  maxBytes?: number | (() => number);
}

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  options: RouteOptions;
}

const routes: Route[] = [];

export function route(method: string, pattern: string, handler: Handler, options: RouteOptions = {}): void {
  routes.push({ method, segments: pattern.split('/').filter((part) => part !== ''), handler, options });
}

function match(route: Route, parts: string[]): Record<string, string> | null {
  if (route.segments.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i += 1) {
    const segment = route.segments[i];
    if (segment.startsWith(':')) {
      params[segment.slice(1)] = decodeURIComponent(parts[i]);
      continue;
    }
    if (segment !== parts[i]) return null;
  }
  return params;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > limit) {
    throw new ApiError('too_large', 'That upload is larger than the limit.');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) {
      req.destroy();
      throw new ApiError('too_large', 'That upload is larger than the limit.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

const publicDir = join(dirname(fileURLToPath(import.meta.url)), 'public');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

function securityHeaders(): Record<string, string> {
  return {
    'content-security-policy': CSP,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
  };
}

export function sameOriginOk(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return true;
  const host = req.headers.host;
  if (typeof host !== 'string') return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.url ?? '/', `http://${host}`);
  const path = normalize(decodeURIComponent(url.pathname));
  const parts = path.split('/').filter((part) => part !== '');
  const cookieHeader = Array.isArray(req.headers.cookie)
    ? req.headers.cookie.join('; ')
    : req.headers.cookie;
  const setCookies: string[] = [];

  const send = (reply: Reply): void => {
    const headers: Record<string, string | string[]> = {
      ...securityHeaders(),
      ...(reply.headers ?? {}),
    };
    let payload: Buffer;
    if (reply.json !== undefined) {
      payload = Buffer.from(JSON.stringify(reply.json));
      headers['content-type'] = 'application/json; charset=utf-8';
    } else if (reply.body !== undefined) {
      payload = Buffer.isBuffer(reply.body) ? reply.body : Buffer.from(reply.body);
      headers['content-type'] = reply.contentType ?? 'text/plain; charset=utf-8';
    } else {
      payload = Buffer.alloc(0);
    }
    if (setCookies.length > 0) headers['set-cookie'] = setCookies;
    headers['content-length'] = String(payload.length);
    res.writeHead(reply.status, headers);
    res.end(reply.status === 204 || req.method === 'HEAD' ? undefined : payload);
  };

  const sendError = (error: ApiError): void => {
    const headers: Record<string, string> = {};
    if (error.retryAfterSeconds !== undefined) {
      headers['retry-after'] = String(error.retryAfterSeconds);
    }
    send({ status: error.status, json: error.body(), headers });
  };

  const stateChanging = req.method !== 'GET' && req.method !== 'HEAD';
  if (stateChanging && !sameOriginOk(req)) {
    sendError(new ApiError('forbidden', 'Requests from another origin are refused.'));
    return;
  }

  for (const candidate of routes) {
    if (candidate.method !== req.method) continue;
    const params = match(candidate, parts);
    if (params === null) continue;
    const limit =
      typeof candidate.options.maxBytes === 'function'
        ? candidate.options.maxBytes()
        : (candidate.options.maxBytes ?? JSON_BODY_MAX_BYTES);
    try {
      const body = stateChanging ? await readBody(req, limit) : Buffer.alloc(0);
      const ctx: RequestContext = {
        method: req.method ?? 'GET',
        path,
        query: url.searchParams,
        params,
        headers: req.headers,
        cookies: parseCookies(cookieHeader),
        body,
        setCookie: (value) => setCookies.push(value),
        origin: `http://${host}`,
      };
      send(await candidate.handler(ctx));
    } catch (error) {
      if (error instanceof ApiError) sendError(error);
      else {
        process.stderr.write(`request failed: ${String(error)}\n`);
        sendError(new ApiError('invalid', 'That request could not be completed.'));
      }
    }
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    const served = await serveStatic(path, send);
    if (served) return;
    if (path.startsWith('/api/')) {
      sendError(new ApiError('not_found', 'There is no such endpoint.'));
      return;
    }
    await serveShell(send);
    return;
  }
  sendError(new ApiError('not_found', 'There is no such endpoint.'));
}

const ALLOWED_STATIC = /^\/(app\.js|app\.css|assets\/[A-Za-z0-9/._-]+)$/;

async function serveStatic(path: string, send: (reply: Reply) => void): Promise<boolean> {
  if (!ALLOWED_STATIC.test(path)) return false;
  const file = join(publicDir, path);
  if (!file.startsWith(publicDir)) return false;
  try {
    const info = await stat(file);
    if (!info.isFile()) return false;
    const dot = file.lastIndexOf('.');
    const type = CONTENT_TYPES[file.slice(dot)] ?? 'application/octet-stream';
    const body = await readFileBuffer(file);
    send({ status: 200, body, contentType: type, headers: { 'cache-control': 'no-cache' } });
    return true;
  } catch {
    return false;
  }
}

async function readFileBuffer(file: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of createReadStream(file)) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function serveShell(send: (reply: Reply) => void): Promise<void> {
  const body = await readFileBuffer(join(publicDir, 'index.html'));
  send({ status: 200, body, contentType: 'text/html; charset=utf-8', headers: { 'cache-control': 'no-cache' } });
}

export function readJson(ctx: RequestContext): Record<string, unknown> {
  if (ctx.body.length === 0) return {};
  try {
    const parsed = JSON.parse(ctx.body.toString('utf8')) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ApiError('invalid', 'The request body must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('invalid', 'The request body must be JSON.');
  }
}
