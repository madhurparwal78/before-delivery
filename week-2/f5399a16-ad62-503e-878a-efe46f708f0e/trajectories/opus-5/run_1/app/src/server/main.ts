import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { COPY } from '../domain/copy.js';
import { matchScreen, SIGNED_IN_SCREENS } from '../domain/screens.js';
import { config, JSON_BODY_LIMIT, UPLOAD_BODY_LIMIT } from './config.js';
import { readSession } from './auth.js';
import {
  checkOrigin,
  errorReply,
  isStateChanging,
  readCookies,
  refuse,
  Router,
} from './http.js';
import type { Context, Reply } from './http.js';
import { one, withStartLock } from './infra/db.js';
import { applySchemaAndSeed } from './seed.js';
import { apiRoutes } from './routes.js';
import { shellHtml } from './shell.js';
import { startWorkers } from './workers.js';
import { readUpload } from './upload.js';

const router = new Router().addAll(apiRoutes);

const PUBLIC_DIRECTORY = new URL('./public/', import.meta.url).pathname;

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

async function handleApi(context: Context): Promise<Reply> {
  // 1. Unknown route or wrong method.
  const { route, params } = router.match(context.method, context.path);
  context.params = params;

  // 2. A body or file over its size limit.
  if (route.body === 'json') {
    const declared = Number(context.headers['content-length'] ?? '0');
    if (Number.isFinite(declared) && declared > JSON_BODY_LIMIT) {
      throw refuse.tooLarge('That body is over 1,000,000 bytes.');
    }
  }
  if (route.body === 'upload' && route.uploadLimit !== undefined) {
    const declared = Number(context.headers['content-length'] ?? '0');
    if (Number.isFinite(declared) && declared > UPLOAD_BODY_LIMIT) {
      throw refuse.tooLarge('That body is over 9,000,000 bytes.');
    }
    context.upload = await readUpload(context, await route.uploadLimit(context));
  }

  const session = await readSession(context);

  // 3. Rate limit.
  if (route.limit !== undefined) {
    await route.limit(context, session.kind === 'live' ? session.desk.id : null);
  }

  // 4. A foreign Origin on a state-changing request.
  checkOrigin(context);

  // 5. Authentication.
  if (route.auth !== 'open') {
    if (session.kind === 'ended') throw refuse.sessionEnded(COPY.sessionEnded);
    if (session.kind === 'none') throw refuse.notSignedIn();
  }
  if (session.kind === 'live') {
    context.identity = { token: session.token, desk: session.desk };
  }

  return route.handler(context);
}

async function serveStatic(path: string): Promise<Reply | null> {
  if (path === '/') return null;
  const safe = normalize(path);
  if (safe.includes('..')) return null;
  try {
    const bytes = await readFile(join(PUBLIC_DIRECTORY, safe));
    return {
      status: 200,
      bytes,
      contentType: CONTENT_TYPES[extname(safe)] ?? 'application/octet-stream',
      headers: { 'cache-control': 'no-cache' },
    };
  } catch {
    return null;
  }
}

/** A screen's own address answers 404 when the thing behind it is not this desk's. */
async function screenStatus(context: Context): Promise<number | 'sign-in'> {
  const screen = matchScreen(context.path);
  if (screen.name === 'notFound') return 404;
  if (screen.name === 'review') return tokenStatus('review_pages', screen.token);
  if (screen.name === 'signOff') return tokenStatus('sign_off_pages', screen.token);
  if (screen.name === 'fee') return tokenStatus('letters', screen.token);
  if (!SIGNED_IN_SCREENS.includes(screen.name)) return 200;
  const session = await readSession(context);
  if (session.kind !== 'live') return 'sign-in';
  if (screen.jobId !== undefined) {
    const held = await one(
      `select 1 from jobs j join clients c on c.id = j.client_id
        where j.id = $1 and j.desk_id = $2 and c.state <> 'erased'`,
      [screen.jobId, session.desk.id],
    );
    return held ? 200 : 404;
  }
  if (screen.clientId !== undefined) {
    const held = await one(
      "select 1 from clients where id = $1 and desk_id = $2 and state <> 'erased'",
      [screen.clientId, session.desk.id],
    );
    return held ? 200 : 404;
  }
  return 200;
}

const TOKEN_TABLES = {
  review_pages: 'select 1 from review_pages where token = $1',
  sign_off_pages: 'select 1 from sign_off_pages where token = $1',
  letters: 'select 1 from letters where token = $1',
} as const;

async function tokenStatus(
  table: keyof typeof TOKEN_TABLES,
  token: string | undefined,
): Promise<number> {
  const held = await one(TOKEN_TABLES[table], [token ?? '']);
  return held ? 200 : 404;
}

function send(context: Context, reply: Reply): void {
  const headers: Record<string, string> = { ...(reply.headers ?? {}) };
  headers['x-content-type-options'] = 'nosniff';
  if (reply.bytes !== undefined) {
    headers['content-type'] = reply.contentType ?? 'application/octet-stream';
    context.response.writeHead(reply.status, headers);
    context.response.end(context.method === 'HEAD' ? undefined : reply.bytes);
    return;
  }
  if (reply.body === undefined) {
    context.response.writeHead(reply.status, headers);
    context.response.end();
    return;
  }
  const body = Buffer.from(JSON.stringify(reply.body), 'utf8');
  headers['content-type'] = 'application/json; charset=utf-8';
  headers['content-length'] = String(body.length);
  context.response.writeHead(reply.status, headers);
  context.response.end(context.method === 'HEAD' ? undefined : body);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const context: Context = {
    method: request.method ?? 'GET',
    path: url.pathname,
    query: url.searchParams,
    params: {},
    headers: request.headers,
    cookies: readCookies(request.headers.cookie),
    request,
    response,
    stateChanging: isStateChanging(request.method ?? 'GET'),
    identity: null,
    upload: null,
  };

  void (async () => {
    try {
      if (context.path.startsWith('/api/')) {
        send(context, await handleApi(context));
        return;
      }
      if (context.method !== 'GET' && context.method !== 'HEAD') {
        send(context, errorReply(refuse.notFound()));
        return;
      }
      const asset = await serveStatic(context.path);
      if (asset !== null) {
        send(context, asset);
        return;
      }
      const status = await screenStatus(context);
      if (status === 'sign-in') {
        send(context, {
          status: 302,
          headers: {
            location: `/sign-in?next=${encodeURIComponent(`${context.path}${url.search}`)}`,
          },
        });
        return;
      }
      send(context, {
        status,
        bytes: Buffer.from(shellHtml(status === 404 ? '/not-found' : context.path), 'utf8'),
        contentType: 'text/html; charset=utf-8',
        headers: { 'cache-control': 'no-store' },
      });
    } catch (error) {
      send(context, errorReply(error));
    }
  })();
});

async function start(): Promise<void> {
  await withStartLock(applySchemaAndSeed);
  startWorkers();
  server.listen(config.publicPort, '0.0.0.0', () => {
    process.stdout.write(`Clapstick is serving on ${config.publicPort}\n`);
  });
}

void start();
