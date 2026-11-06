import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import type { Account, ApiResponse, AppServices, RequestContext, Route } from './context';
import { matchRoute } from './context';
import { ApiError, errors } from './errors';
import { KeyQueue, assertNoConflict, withIdempotency } from './idempotency';
import { accountRoutes, SESSION_COOKIE } from '../routes/accounts';
import { bookingRoutes } from '../routes/bookings';
import { metaRoutes } from '../routes/meta';
import { trainRoutes } from '../routes/trains';

const MAX_BODY_BYTES = 65_536;
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const ROUTES: readonly Route[] = [
  ...metaRoutes,
  ...accountRoutes,
  ...trainRoutes,
  ...bookingRoutes,
];

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function readCookies(header: string | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  if (header === undefined) return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    jar[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return jar;
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer | 'too_large'> {
  const declared = Number.parseInt(request.headers['content-length'] ?? '0', 10);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return 'too_large';
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return 'too_large';
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** A state-changing request whose Origin header names another origin is refused. */
function isCrossOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined || origin === 'null') return false;
  const host = request.headers.host;
  if (host === undefined) return true;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

async function resolveSession(
  app: AppServices,
  sessionId: string | null,
): Promise<Account | null> {
  if (sessionId === null) return null;
  const rows = await app.database.query<Account>(
    `select a.id, a.name, a.email, a.phone, a.killbill_account_id
     from sessions s join accounts a on a.id = s.account_id
     where s.id = $1`,
    [sessionId],
  );
  return rows[0] ?? null;
}

function sendJson(
  response: ServerResponse,
  status: number,
  json: unknown,
  headers: Readonly<Record<string, string>>,
): void {
  const body = Buffer.from(JSON.stringify(json), 'utf8');
  response.writeHead(status, {
    ...headers,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

/** The server never serves source files, the manifest, lockfiles, env files or version control. */
function isNeverServed(pathname: string): boolean {
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment.startsWith('.'))) return true;
  const last = segments[segments.length - 1];
  return last !== undefined && /\.[A-Za-z0-9]+$/.test(last);
}

export interface RequestHandlerOptions {
  readonly app: AppServices;
  readonly staticDir: string;
}

export function createRequestHandler(
  options: RequestHandlerOptions,
): (request: IncomingMessage, response: ServerResponse) => void {
  const keyQueue = new KeyQueue();
  const { app, staticDir } = options;

  const serveStatic = async (
    response: ServerResponse,
    filePath: string,
    status: number,
  ): Promise<boolean> => {
    try {
      const info = await stat(filePath);
      if (!info.isFile()) return false;
      response.writeHead(status, {
        'Content-Type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
        'Content-Length': info.size,
        'Cache-Control': extname(filePath) === '.html' ? 'no-store' : 'public, max-age=3600',
      });
      createReadStream(filePath).pipe(response);
      return true;
    } catch {
      return false;
    }
  };

  const notFoundPage = (response: ServerResponse): void => {
    const body = Buffer.from('<!doctype html><title>404</title>Not found', 'utf8');
    response.writeHead(404, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    response.end(body);
  };

  const runApi = async (
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> => {
    const cookies: string[] = [];
    const method = request.method ?? 'GET';
    const matched = matchRoute(ROUTES, method, url.pathname);

    const raw = STATE_CHANGING.has(method) ? await readRequestBody(request) : Buffer.alloc(0);
    if (raw === 'too_large') throw errors.tooLarge();
    const contentType = request.headers['content-type'] ?? '';
    if (STATE_CHANGING.has(method) && raw.length > 0
      && !contentType.toLowerCase().startsWith('application/json')) {
      throw errors.unsupportedMediaType();
    }
    if (method === 'POST' && !contentType.toLowerCase().startsWith('application/json')) {
      throw errors.unsupportedMediaType();
    }
    let body: unknown = null;
    if (raw.length > 0) {
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        throw errors.badJson();
      }
    } else if (method === 'POST') {
      throw errors.badJson();
    }

    const idempotencyKey = request.headers['idempotency-key'];
    const key = typeof idempotencyKey === 'string' && /^[ -~]{1,100}$/.test(idempotencyKey)
      ? idempotencyKey
      : null;
    if (matched !== null && matched.route.needsIdempotencyKey === true && key === null) {
      throw errors.idempotencyKeyRequired();
    }

    if (STATE_CHANGING.has(method) && isCrossOrigin(request)) throw errors.crossOrigin();

    const sessionId = readCookies(request.headers.cookie)[SESSION_COOKIE] ?? null;
    const account = await resolveSession(app, sessionId);
    if (matched !== null && matched.route.auth === 'required' && account === null) {
      throw errors.unauthenticated();
    }

    if (matched === null) throw errors.notFound();

    const context: RequestContext = {
      app,
      method,
      path: url.pathname,
      params: matched.params,
      query: url.searchParams,
      body,
      bodyHash: createHash('sha256').update(raw).digest('hex'),
      idempotencyKey: key,
      sessionId,
      account,
      now: app.clock.now(),
      setCookie: (value) => cookies.push(value),
    };

    let result: ApiResponse;
    if (matched.route.needsIdempotencyKey === true && key !== null && account !== null) {
      await assertNoConflict(app.database, account.id, key, context.bodyHash);
      result = await keyQueue.run(
        `${account.id}:${key}`,
        () => withIdempotency(
          app.database,
          account.id,
          key,
          context.bodyHash,
          () => matched.route.handler(context),
        ),
      );
    } else {
      result = await matched.route.handler(context);
    }

    const headers: Record<string, string> = { ...(result.headers ?? {}) };
    if (cookies.length > 0) response.setHeader('Set-Cookie', cookies);
    if (result.body !== undefined) {
      response.writeHead(result.status, {
        ...headers,
        'Content-Length': result.body.length,
        'Cache-Control': 'no-store',
      });
      response.end(result.body);
      return;
    }
    if (result.status === 204) {
      response.writeHead(204, { ...headers, 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    sendJson(response, result.status, result.json ?? null, headers);
  };

  return (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    void (async () => {
      try {
        if (url.pathname.startsWith('/api/')) {
          await runApi(request, response, url);
          return;
        }
        if (url.pathname.startsWith('/static/')) {
          const target = join(staticDir, normalize(url.pathname.slice('/static/'.length)));
          if (!target.startsWith(staticDir) || !await serveStatic(response, target, 200)) {
            notFoundPage(response);
          }
          return;
        }
        if (request.method !== 'GET' || isNeverServed(url.pathname)) {
          notFoundPage(response);
          return;
        }
        if (!await serveStatic(response, join(staticDir, 'index.html'), 200)) {
          notFoundPage(response);
        }
      } catch (error) {
        if (error instanceof ApiError) {
          sendJson(response, error.status, error.body(), {});
          return;
        }
        process.stderr.write(`request failed: ${String(error)}\n`);
        sendJson(response, 500, { error: 'internal', message: 'Something went wrong.' }, {});
      }
    })();
  };
}
