import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { actorForToken, isOperator, SESSION_COOKIE } from '../auth';
import { routes } from '../api';
import { queryOne } from '../db/pool';
import { ApiError, apiError } from './errors';
import {
  matchRoute,
  routeKeyOf,
  type BaseContext,
  type HandlerResult,
  type RequestContext,
} from './router';

const MAX_BODY_BYTES = 65_536;
const PUBLIC_DIR = join(__dirname, '..', '..', 'public');

const CLIENT_ROUTE_PATTERNS: RegExp[] = [
  /^\/$/,
  /^\/signin$/,
  /^\/join\/[^/]+$/,
  /^\/events$/,
  /^\/events\/[^/]+$/,
  /^\/events\/[^/]+\/(timing|rota|live|protests|corrections|publish)$/,
  /^\/index-tables$/,
  /^\/season$/,
  /^\/operator$/,
];

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

function cookies(header: string | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  if (!header) return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    jar[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return jar;
}

function isStateChanging(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

function requestOrigin(req: IncomingMessage): string {
  return `http://${req.headers.host ?? ''}`;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      req.destroy();
      throw apiError.payloadTooLarge();
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function send(res: ServerResponse, result: HandlerResult): void {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  };
  for (const [name, value] of result.headers ?? []) {
    if (name.toLowerCase() === 'set-cookie') continue;
    headers[name] = value;
  }
  const setCookies = (result.headers ?? [])
    .filter(([name]) => name.toLowerCase() === 'set-cookie')
    .map(([, value]) => value);

  let payload: Buffer | null = null;
  if (result.json !== undefined) {
    payload = Buffer.from(JSON.stringify(result.json), 'utf8');
    headers['Content-Type'] = 'application/json; charset=utf-8';
  } else if (result.body) {
    payload = result.body;
    headers['Content-Type'] = result.contentType ?? 'application/octet-stream';
  }
  if (payload) headers['Content-Length'] = String(payload.length);
  res.writeHead(result.status, setCookies.length > 0 ? { ...headers, 'Set-Cookie': setCookies } : headers);
  if (payload && result.status !== 204) res.end(payload);
  else res.end();
}

function errorResult(error: unknown): HandlerResult {
  if (error instanceof ApiError) {
    return { status: error.status, json: error.body() };
  }
  process.stderr.write(`unhandled request failure: ${String(error)}\n`);
  return {
    status: 500,
    json: { error: 'internal_error', message: 'Something went wrong on the server.' },
  };
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The join screen is headed with the club name, so the shell carries it. */
async function clubNameMeta(path: string): Promise<string> {
  const match = /^\/join\/([^/]+)$/.exec(path);
  if (!match) return '';
  const club = await queryOne<{ name: string }>('SELECT name FROM clubs WHERE slug = $1', [
    decodeURIComponent(match[1] as string),
  ]);
  return club?.name ?? '';
}

async function serveStatic(path: string, res: ServerResponse): Promise<void> {
  const target = CLIENT_ROUTE_PATTERNS.some((pattern) => pattern.test(path))
    ? 'index.html'
    : path.startsWith('/assets/')
      ? normalize(path).replace(/^(\.\.(\/|\\|$))+/, '').slice(1)
      : null;
  if (target === null) {
    send(res, { status: 404, body: Buffer.from('Not found\n', 'utf8'), contentType: 'text/plain; charset=utf-8' });
    return;
  }
  const file = join(PUBLIC_DIR, target);
  if (!file.startsWith(PUBLIC_DIR)) {
    send(res, { status: 404, body: Buffer.from('Not found\n', 'utf8'), contentType: 'text/plain; charset=utf-8' });
    return;
  }
  try {
    const bytes = await readFile(file);
    const contentType = CONTENT_TYPES[extname(file)] ?? 'application/octet-stream';
    if (target === 'index.html') {
      const clubName = await clubNameMeta(path);
      const html = bytes
        .toString('utf8')
        .replace('{{CLUB_NAME}}', escapeAttribute(clubName));
      send(res, {
        status: 200,
        body: Buffer.from(html, 'utf8'),
        contentType,
        headers: [['Cache-Control', 'no-store']],
      });
      return;
    }
    send(res, {
      status: 200,
      body: bytes,
      contentType,
      headers: [['Cache-Control', 'public, max-age=3600']],
    });
  } catch {
    send(res, { status: 404, body: Buffer.from('Not found\n', 'utf8'), contentType: 'text/plain; charset=utf-8' });
  }
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? 'GET';
  const declaredLength = Number.parseInt(req.headers['content-length'] ?? '0', 10);
  const hasBody =
    (Number.isFinite(declaredLength) && declaredLength > 0) ||
    req.headers['transfer-encoding'] !== undefined;
  if (hasBody) {
    const contentType = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
    if (contentType !== 'application/json') throw apiError.unsupportedMediaType();
    if (declaredLength > MAX_BODY_BYTES) throw apiError.payloadTooLarge();
  }
  const rawBody = await readBody(req);

  const match = matchRoute(routes, method, url.pathname);
  if (!match) throw apiError.notFound();

  let body: Record<string, unknown> = {};
  if (rawBody.length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw apiError.validation({ body: 'Request body must be valid JSON.' });
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw apiError.validation({ body: 'Request body must be a JSON object.' });
    }
    body = parsed as Record<string, unknown>;
  }

  const jar = cookies(req.headers.cookie);
  const sessionToken = jar[SESSION_COOKIE] ?? null;
  const idempotencyHeader = req.headers['idempotency-key'];
  const idempotencyKey = typeof idempotencyHeader === 'string' ? idempotencyHeader : null;
  if (idempotencyKey !== null && (idempotencyKey.length < 1 || idempotencyKey.length > 100)) {
    throw apiError.validation({ idempotencyKey: 'Idempotency key must be 1 to 100 characters.' });
  }

  const base: BaseContext = {
    req,
    res,
    method,
    path: url.pathname,
    params: match.params,
    searchParams: url.searchParams,
    body,
    now: new Date(),
    sessionToken,
    idempotencyKey,
    routeKey: routeKeyOf(match.route),
  };

  if (match.route.audience === 'public') {
    send(res, await match.route.handler(base));
    return;
  }

  const actor = sessionToken === null ? null : await actorForToken(sessionToken);
  if (actor === null) throw apiError.unauthenticated();
  if (match.route.audience === 'operator' && !isOperator(actor)) throw apiError.forbidden();
  const ctx: RequestContext = { ...base, actor };
  send(res, await match.route.handler(ctx));
}

export function createApp(): Server {
  return createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      try {
        const origin = req.headers.origin;
        if (
          isStateChanging(req.method ?? 'GET') &&
          typeof origin === 'string' &&
          origin !== requestOrigin(req)
        ) {
          throw apiError.crossOrigin();
        }
        if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
          await handleApi(req, res, url);
          return;
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          send(res, {
            status: 404,
            body: Buffer.from('Not found\n', 'utf8'),
            contentType: 'text/plain; charset=utf-8',
          });
          return;
        }
        await serveStatic(url.pathname, res);
      } catch (error) {
        send(res, errorResult(error));
      }
    })();
  });
}
