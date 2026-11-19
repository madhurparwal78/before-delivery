import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { roleOf, tokenFrom, userForToken, type SessionUser } from './auth.js';
import { config } from './config.js';
import { db } from './db.js';
import { ApiError, errorBody, refuse } from './errors.js';
import { depthOf, isObject, type JsonObject } from './json.js';
import { msg } from './messages.js';
import type { Role } from './model.js';
import { authorize, type Access } from './roles.js';

export const JSON_LIMIT = 65_536;

export interface Ctx {
  request: IncomingMessage;
  response: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  token: string | null;
  user: SessionUser;
  workspaceId: string;
  role: Role;
  body: JsonObject;
  raw: Buffer;
}

interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string | string[]>;
  raw?: Buffer;
  contentType?: string;
  html?: string;
  stream?: boolean;
}

export interface Route {
  method: string;
  path: string;
  auth?: 'public' | 'session';
  access?: Access;
  check?: (ctx: Ctx) => Promise<void>;
  body?: 'json' | 'optional-json' | 'raw';
  rawLimit?: number;
  anyOrigin?: boolean;
  handle: (ctx: Ctx) => Promise<Reply>;
}

const MUTATING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');

function compile(pattern: string): RegExp {
  return new RegExp(`^${pattern.replace(/:[a-z]+/g, '([^/]+)')}$`);
}

function paramNames(pattern: string): string[] {
  return [...pattern.matchAll(/:([a-z]+)/g)].map((match) => match[1] as string);
}

/** Reads a body of at most `limit` bytes; a longer one is refused after being drained. */
export function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(request.headers['content-length']);
    const chunks: Buffer[] = [];
    let size = 0;
    let over = Number.isFinite(declared) && declared > limit;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) over = true;
      else chunks.push(chunk);
    });
    request.on('end', () => (over ? reject(refuse.tooLarge(limit)) : resolve(Buffer.concat(chunks))));
    request.on('error', reject);
  });
}

export function hasJsonType(request: IncomingMessage): boolean {
  return /^application\/json\s*(;|$)/i.test(request.headers['content-type'] ?? '');
}

/** Parses a JSON object body: valid JSON, an object, and no deeper than 20 levels. */
export function parseObject(raw: Buffer): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(raw.toString('utf8'));
  } catch {
    throw refuse.invalid(msg.bodyNotJson);
  }
  if (depthOf(value as never) > 20) throw refuse.invalid(msg.tooDeep);
  if (!isObject(value)) throw refuse.invalid(msg.bodyNotObject);
  return value;
}

function expectedOrigin(request: IncomingMessage): string {
  const proto = request.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return `${proto}://${request.headers.host ?? ''}`;
}

function send(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string | string[]> = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
    ...reply.headers,
  };
  if (reply.html !== undefined) {
    headers['content-type'] = 'text/html; charset=utf-8';
    response.writeHead(reply.status, headers);
    response.end(reply.html);
    return;
  }
  if (reply.raw !== undefined) {
    headers['content-type'] = reply.contentType ?? 'application/octet-stream';
    response.writeHead(reply.status, headers);
    response.end(reply.raw);
    return;
  }
  if (reply.body === undefined) {
    response.writeHead(reply.status, headers);
    response.end();
    return;
  }
  headers['content-type'] = 'application/json; charset=utf-8';
  response.writeHead(reply.status, headers);
  response.end(JSON.stringify(reply.body));
}

function fail(response: ServerResponse, error: ApiError): void {
  send(response, { status: error.status, body: errorBody(error), headers: error.headers });
}

const types: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function serveFile(response: ServerResponse, file: string): boolean {
  const resolved = path.join(webRoot, file);
  if (!resolved.startsWith(webRoot + path.sep) || !existsSync(resolved) || !statSync(resolved).isFile() || file === 'index.html') return false;
  response.writeHead(200, {
    'content-type': types[path.extname(resolved)] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(resolved).pipe(response);
  return true;
}

let shell = '';

/** The app shell with the two settings the browser may know, and the public form when the address names one. */
export function shellPage(status: number, form: JsonObject | null = null): Reply {
  if (shell === '') shell = readFileSync(path.join(webRoot, 'index.html'), 'utf8');
  const settings = JSON.stringify({ canvasBreakpointPx: config.canvasBreakpointPx, timeZone: config.timeZone, form }).replace(/</g, '\\u003c');
  return { status, html: shell.replace('__SETTINGS__', () => settings) };
}

const pages: RegExp[] = [
  /^\/$/, /^\/sign-up$/, /^\/sign-in$/, /^\/confirm\/[^/]+$/, /^\/invite\/[^/]+$/, /^\/w\/[^/]+$/, /^\/w\/[^/]+\/automations\/[^/]+$/,
  /^\/w\/[^/]+\/runs$/, /^\/w\/[^/]+\/runs\/[^/]+$/, /^\/w\/[^/]+\/tables$/, /^\/w\/[^/]+\/tables\/[^/]+$/, /^\/w\/[^/]+\/members$/,
];

function isPage(pathname: string): boolean {
  return pages.some((page) => page.test(pathname));
}

interface Compiled extends Route {
  pattern: RegExp;
  names: string[];
}

/** A path segment decoded; one that is not valid percent-encoding or holds a NUL names nothing, and Postgres rejects NUL in text. */
function decodeParam(segment: string): string {
  let value: string;
  try {
    value = decodeURIComponent(segment);
  } catch {
    throw refuse.notFound();
  }
  if (value.includes('\u0000')) throw refuse.notFound();
  return value;
}

async function runRoute(route: Compiled, match: RegExpExecArray, request: IncomingMessage, response: ServerResponse, url: URL): Promise<Reply> {
  const params = Object.fromEntries(route.names.map((name, index) => [name, decodeParam(match[index + 1] ?? '')]));
  if (MUTATING.has(request.method ?? '') && !route.anyOrigin) {
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== expectedOrigin(request)) throw refuse.crossOrigin();
  }
  const ctx = { request, response, params, query: url.searchParams, token: tokenFrom(request), body: {}, raw: Buffer.alloc(0) } as unknown as Ctx;
  if (route.auth !== 'public') {
    const user = await userForToken(ctx.token);
    if (user === null) throw refuse.signIn();
    ctx.user = user;
    if (params.ws !== undefined) {
      const role = await roleOf(db, params.ws, user.id);
      if (role === null) throw refuse.notFound();
      ctx.workspaceId = params.ws;
      ctx.role = role;
    }
  }
  if (route.check) await route.check(ctx);
  if (route.access && route.auth !== 'public') authorize(ctx.role, route.access);
  if (route.body === 'raw') {
    ctx.raw = await readBody(request, route.rawLimit ?? JSON_LIMIT);
    if (!hasJsonType(request)) throw refuse.unsupported(msg.contentType);
  } else if (route.body === 'json' || route.body === 'optional-json') {
    ctx.raw = await readBody(request, JSON_LIMIT);
    if (route.body === 'json' || ctx.raw.length > 0) {
      if (!hasJsonType(request)) throw refuse.unsupported(msg.contentType);
      ctx.body = parseObject(ctx.raw);
    }
  }
  return route.handle(ctx);
}

export function createApp(routes: Route[]): Server {
  const compiled: Compiled[] = routes.map((route) => ({ ...route, pattern: compile(route.path), names: paramNames(route.path) }));
  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const method = request.method ?? 'GET';
    const handle = async (): Promise<Reply | null> => {
      const candidates = compiled.filter((route) => route.pattern.test(url.pathname));
      const route = candidates.find((candidate) => candidate.method === method || candidate.method === '*');
      if (route !== undefined) return runRoute(route, route.pattern.exec(url.pathname) as RegExpExecArray, request, response, url);
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/hooks/')) throw refuse.notFound();
      if (method !== 'GET' && method !== 'HEAD') throw refuse.notFound();
      if (serveFile(response, url.pathname.slice(1))) return null;
      return shellPage(isPage(url.pathname) ? 200 : 404);
    };
    handle().then(
      (reply) => {
        if (reply !== null && !reply.stream) send(response, reply);
      },
      (error: unknown) => {
        if (error instanceof ApiError) return fail(response, error);
        console.error(error);
        fail(response, refuse.internal());
      },
    );
  });
}
