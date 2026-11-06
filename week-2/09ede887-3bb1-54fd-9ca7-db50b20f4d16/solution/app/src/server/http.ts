import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { accountForToken } from './accounts';
import { databaseReady, db } from './db';
import { ApiError, v1ErrorBody, v2ErrorBody, type Version } from './errors';
import { CONTRACT, ROUTES, type Reply, type RequestContext, type Route } from './routes';

// The request pipeline. API requests are answered in the published precedence: path encoding,
// unknown path or method, database readiness, body size, body type, JSON, then the route's own
// authentication, role, lookup, idempotency, validation and state checks.

const BODY_LIMIT = 10_240;
const JSON_TYPE = 'application/json; charset=utf-8';
const DEPRECATION = { Deprecation: 'true', Sunset: 'Sat, 31 Oct 2026 16:00:00 GMT' };
const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };

const CLIENT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'client');

function send(res: ServerResponse, req: IncomingMessage, status: number, headers: Record<string, string>, body: string | Buffer): void {
  const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  res.writeHead(status, { ...BASE_HEADERS, ...headers, 'Content-Length': String(payload.length) });
  res.end(req.method === 'HEAD' ? undefined : payload);
}

function sendJson(res: ServerResponse, req: IncomingMessage, status: number, body: unknown, headers: Record<string, string> = {}): void {
  send(res, req, status, { ...headers, 'Content-Type': JSON_TYPE }, JSON.stringify(body));
}

function sendError(res: ServerResponse, req: IncomingMessage, version: Version, error: ApiError, headers: Record<string, string>): void {
  const body = version === 'v1' ? v1ErrorBody(error) : v2ErrorBody(error);
  sendJson(res, req, error.status, body, { ...headers, ...error.headers });
}

function decodeSegments(rawPath: string): string[] {
  return rawPath.split('/').map((segment) => decodeURIComponent(segment));
}

interface Match {
  route: Route;
  params: Record<string, string>;
}

function matchPath(routes: readonly Route[], segments: string[]): Match[] {
  const matches: Match[] = [];
  for (const route of routes) {
    const pattern = route.path.split('/').slice(1);
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const fits = pattern.every((part, index) => {
      const segment = segments[index] ?? '';
      if (part.startsWith('{') && part.endsWith('}')) {
        params[part.slice(1, -1)] = segment;
        return segment !== '';
      }
      return part === segment;
    });
    if (fits) matches.push({ route, params });
  }
  return matches;
}

async function readBody(req: IncomingMessage): Promise<Buffer | null> {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (declared > BODY_LIMIT) {
    req.resume();
    return null;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const piece = chunk as Buffer;
    size += piece.length;
    if (size > BODY_LIMIT) {
      req.resume();
      return null;
    }
    chunks.push(piece);
  }
  return Buffer.concat(chunks);
}

function isJsonType(header: string | undefined): boolean {
  const media = (header ?? '').split(';')[0]?.trim().toLowerCase();
  return media === 'application/json';
}

function bearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') && header.length > 7 ? header.slice(7).trim() : null;
}

async function apiRequest(req: IncomingMessage, res: ServerResponse, rawPath: string, rawQuery: string): Promise<void> {
  const version: Version = rawPath.startsWith('/api/v2/') ? 'v2' : 'v1';
  let segments: string[];
  try {
    segments = decodeSegments(rawPath);
  } catch {
    sendError(res, req, version, new ApiError('invalid'), {});
    return;
  }
  const method = req.method === 'HEAD' ? 'GET' : (req.method ?? 'GET');

  if (rawPath === '/api/health' || rawPath === '/api/_contract') {
    if (method !== 'GET') {
      sendError(res, req, 'v1', new ApiError('method_not_allowed'), { Allow: 'GET, HEAD' });
    } else if (rawPath === '/api/_contract') {
      sendJson(res, req, 200, CONTRACT);
    } else {
      sendJson(res, req, ...(await health()));
    }
    return;
  }

  const prefix = rawPath.startsWith('/api/v2/') ? '/api/v2' : rawPath.startsWith('/api/v1/') ? '/api/v1' : '/api';
  const rest = segments.slice(prefix.split('/').length);
  const matches = matchPath(
    ROUTES.filter((route) => route.versions.includes(version)),
    rest,
  );
  const headers: Record<string, string> = version === 'v1' && matches.length > 0 ? { ...DEPRECATION } : {};
  if (matches.length === 0) {
    sendError(res, req, version, new ApiError('not_found'), headers);
    return;
  }
  const match = matches.find((candidate) => candidate.route.method === method);
  if (match === undefined) {
    const allowed: string[] = matches.map((candidate) => candidate.route.method);
    if (allowed.includes('GET')) allowed.push('HEAD');
    sendError(res, req, version, new ApiError('method_not_allowed'), { ...headers, Allow: allowed.join(', ') });
    return;
  }
  if (!databaseReady()) {
    req.resume();
    sendError(res, req, version, new ApiError('unavailable'), headers);
    return;
  }

  try {
    const raw = await readBody(req);
    if (raw === null) throw new ApiError('payload_too_large');
    let body: unknown;
    if (raw.length > 0) {
      if (!isJsonType(req.headers['content-type'])) throw new ApiError('unsupported_media_type');
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        throw new ApiError('invalid');
      }
    }
    const token = bearer(req);
    const access = match.route.access;
    const account = access === 'public' || token === null ? null : await accountForToken(token);
    if (access !== 'public' && access !== 'optional') {
      if (account === null) throw new ApiError('unauthenticated');
      if (access !== 'account' && account.role !== access) throw new ApiError('forbidden');
    }
    const ctx: RequestContext = {
      version,
      prefix,
      params: match.params,
      query: new URLSearchParams(rawQuery),
      body,
      headers: req.headers,
      account,
      token,
    };
    const reply: Reply = await match.route.handle(ctx);
    if ('raw' in reply) {
      send(res, req, reply.status, { ...headers, ...reply.headers, 'Content-Type': reply.contentType }, reply.raw);
    } else {
      sendJson(res, req, reply.status, reply.json, { ...headers, ...reply.headers });
    }
  } catch (error) {
    if (error instanceof ApiError) {
      sendError(res, req, version, error, headers);
      return;
    }
    // Anything else (a lost database connection included) is reported only in the server log.
    console.error(error);
    sendError(res, req, version, new ApiError('unavailable'), headers);
  }
}

async function health(): Promise<[number, { status: string }]> {
  if (!databaseReady()) return [503, { status: 'starting' }];
  try {
    await db.query('SELECT 1 FROM sessions LIMIT 1');
    return [200, { status: 'ok' }];
  } catch {
    return [503, { status: 'starting' }];
  }
}

const PAGE_ROUTES = new Set(['/', '/agenda', '/my-agenda', '/speakers', '/record', '/organiser', '/signin', '/signup']);

function isPageRoute(pathname: string): boolean {
  if (PAGE_ROUTES.has(pathname)) return true;
  const parts = pathname.split('/');
  return parts.length === 3 && parts[1] === 'sessions' && parts[2] !== '';
}

const ASSET_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const STARTING_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Keel Outpost 2026</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:system-ui,sans-serif;background:#131518;color:#fff;padding:2rem">
<p>Keel Outpost is starting. Try again in a moment.</p></body></html>`;

let indexHtml: Buffer | null = null;

async function appPage(): Promise<Buffer> {
  indexHtml ??= await readFile(path.join(CLIENT_DIR, 'index.html'));
  return indexHtml;
}

async function pageRequest(req: IncomingMessage, res: ServerResponse, rawPath: string): Promise<void> {
  const html = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' };
  if (rawPath.startsWith('/assets/')) {
    const relative = path.posix.normalize(rawPath.slice('/assets/'.length));
    const type = ASSET_TYPES[path.extname(relative)];
    if (type === undefined || relative.startsWith('..') || relative.includes('\0')) {
      send(res, req, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
      return;
    }
    try {
      const file = await readFile(path.join(CLIENT_DIR, 'assets', relative));
      send(res, req, 200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable' }, file);
    } catch {
      send(res, req, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
    }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, req, 405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' }, 'Method not allowed');
    return;
  }
  if (!isPageRoute(rawPath)) {
    send(res, req, 404, html, await appPage());
  } else if (!databaseReady()) {
    send(res, req, 503, html, STARTING_PAGE);
  } else {
    send(res, req, 200, html, await appPage());
  }
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const target = req.url ?? '/';
  const queryAt = target.indexOf('?');
  const rawPath = queryAt === -1 ? target : target.slice(0, queryAt);
  const rawQuery = queryAt === -1 ? '' : target.slice(queryAt + 1);
  try {
    if (rawPath === '/api' || rawPath.startsWith('/api/')) await apiRequest(req, res, rawPath, rawQuery);
    else await pageRequest(req, res, rawPath);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) send(res, req, 503, { 'Content-Type': 'text/html; charset=utf-8' }, STARTING_PAGE);
  }
}
