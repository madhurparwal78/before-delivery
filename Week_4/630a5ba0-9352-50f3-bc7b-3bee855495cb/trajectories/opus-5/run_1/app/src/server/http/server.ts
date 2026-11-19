import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import type { Router } from './router.js';
import type { BodyKind } from './router.js';
import { ApiError, crossOrigin, payloadTooLarge, unsupportedMediaType } from './errors.js';
import { parseCookies, SESSION_COOKIE, type RequestContext } from './context.js';
import { memberForSessionToken } from '../services/auth.js';
import { pool } from '../db/pool.js';
import type { WorkspaceRow } from '../db/records.js';
import { billingEventsFor, statusFrom } from '../services/workspaces.js';

const JSON_LIMIT = 65_536;
const UPLOAD_LIMIT = 1_000_000;
const PUBLIC_DIR = join(__dirname, 'public');

const CONTENT_TYPES = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.woff2', 'font/woff2'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
]);

const SPA_PATHS = new Set(['/', '/signin', '/trial', '/settings', '/workspace', '/ops']);

export class Response {
  constructor(
    readonly status: number,
    readonly body?: unknown,
    readonly headers?: Record<string, string>,
    readonly raw?: string,
    readonly contentType?: string,
  ) {}
}

export const noContent = (headers?: Record<string, string>): Response =>
  new Response(204, undefined, headers);

export const created = (body: unknown, headers?: Record<string, string>): Response =>
  new Response(201, body, headers);

export const accepted = (body: unknown): Response => new Response(202, body);

export const textResponse = (
  status: number,
  raw: string,
  contentType: string,
  headers?: Record<string, string>,
): Response => new Response(status, undefined, headers, raw, contentType);

function limitFor(kind: BodyKind): number {
  return kind === 'csv' || kind === 'calendar' ? UPLOAD_LIMIT : JSON_LIMIT;
}

function expectedType(kind: BodyKind): string {
  switch (kind) {
    case 'csv':
      return 'text/csv';
    case 'calendar':
      return 'text/calendar';
    default:
      return 'application/json';
  }
}

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = request.headers['content-length'];
  if (declared !== undefined && Number(declared) > limit) throw payloadTooLarge(limit);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) throw payloadTooLarge(limit);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined || origin === 'null') return true;
  const host = request.headers.host;
  if (host === undefined) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function originOf(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-proto'];
  const scheme = typeof forwarded === 'string' && forwarded.length > 0 ? forwarded.split(',')[0]! : 'http';
  return `${scheme}://${request.headers.host ?? 'localhost'}`;
}

function send(response: ServerResponse, method: string, payload: Response): void {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...(payload.headers ?? {}),
  };
  let body: Buffer | null = null;
  if (payload.raw !== undefined) {
    headers['Content-Type'] = payload.contentType ?? 'text/plain; charset=utf-8';
    body = Buffer.from(payload.raw, 'utf8');
  } else if (payload.body !== undefined) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    body = Buffer.from(JSON.stringify(payload.body), 'utf8');
  }
  if (body) headers['Content-Length'] = String(body.length);
  response.writeHead(payload.status, headers);
  if (body && method !== 'HEAD') response.end(body);
  else response.end();
}

async function serveStatic(path: string, method: string, response: ServerResponse): Promise<boolean> {
  const wanted = SPA_PATHS.has(path) || path.startsWith('/join/') ? '/index.html' : path;
  const extension = extname(wanted);
  const contentType = CONTENT_TYPES.get(extension);
  if (!contentType) return false;
  const resolved = normalize(join(PUBLIC_DIR, wanted));
  if (!resolved.startsWith(PUBLIC_DIR)) return false;
  try {
    const info = await stat(resolved);
    if (!info.isFile()) return false;
    response.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': String(info.size),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': extension === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (method === 'HEAD') {
      response.end();
      return true;
    }
    createReadStream(resolved).pipe(response);
    return true;
  } catch {
    return false;
  }
}

async function attachIdentity(context: RequestContext): Promise<void> {
  const token = parseCookies(context.request.headers.cookie).get(SESSION_COOKIE);
  if (!token) return;
  const member = await memberForSessionToken(token);
  if (!member) return;
  context.member = member;
  if (member.workspace_id === null) return;
  const workspace = await pool.query<WorkspaceRow>('select * from workspaces where id = $1', [
    member.workspace_id,
  ]);
  const row = workspace.rows[0];
  if (!row) return;
  const status = statusFrom(row, await billingEventsFor(row.id));
  context.workspace = row;
  context.workspaceState = status.state;
  context.billedSeats = status.billedSeats;
}

export function startHttpServer(router: Router, port: number): void {
  const server = createServer((request, response) => {
    void handle(router, request, response);
  });
  server.listen(port, '0.0.0.0');
}

async function handle(router: Router, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  try {
    const match = router.resolve(method, path);
    if (!match) {
      if (method === 'GET' || method === 'HEAD') {
        if (await serveStatic(path, method, response)) return;
      }
      send(response, method, new Response(404, { error: 'not_found', message: 'That was not found.' }));
      return;
    }

    const kind = match.route.bodyKind;
    const rawBody = await readBody(request, limitFor(kind));
    const isWrite = method !== 'GET' && method !== 'HEAD';
    if (isWrite && rawBody.length > 0) {
      const header = (request.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      if (header !== expectedType(kind)) throw unsupportedMediaType();
    }
    if (isWrite && !sameOrigin(request)) throw crossOrigin();

    const context: RequestContext = {
      request,
      response,
      method,
      path,
      query: url.searchParams,
      params: match.params,
      rawBody,
      origin: originOf(request),
      member: null,
      workspace: null,
      workspaceState: null,
      billedSeats: null,
    };
    await attachIdentity(context);

    const result = await match.route.handler(context);
    if (result instanceof Response) {
      send(response, method, result);
      return;
    }
    send(response, method, new Response(200, result ?? {}));
  } catch (error) {
    if (error instanceof ApiError) {
      send(response, method, new Response(error.status, error.body));
      return;
    }
    process.stderr.write(`request failed: ${error instanceof Error ? error.stack : String(error)}\n`);
    send(
      response,
      method,
      new Response(500, {
        error: 'server_error',
        message: 'Something went wrong on our side. Nothing was changed.',
      }),
    );
  }
}
