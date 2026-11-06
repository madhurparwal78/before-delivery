import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config';
import { prepareDatabase } from './db/pool';
import { applySeed } from './db/seed';
import { ensureBucket } from './storage/s3';
import {
  HttpError,
  JSON_BODY_MAX_BYTES,
  RequestContext,
  Route,
  contentTypeOf,
  csrfFailed,
  errorReply,
  matchRoute,
  notFound,
  parseCookies,
  readBody,
  sendReply,
  tooLarge,
  unauthenticated,
  unsupportedMediaType,
  validationError,
} from './http/core';
import { SESSION_COOKIE, loadLiveSession } from './auth/sessions';
import { authRoutes } from './routes/auth';
import { contentRoutes } from './routes/content';
import { queryRoutes } from './routes/queries';
import { collectionRoutes } from './routes/collections';
import { settingsRoutes } from './routes/settings';
import { attachmentRoutes } from './routes/attachments';
import { SHARE_HEADERS, shareRoutes } from './routes/share';
import { openStream, startEventPruning } from './events';
import { startIdempotencyPruning, beginIdempotent, finishIdempotent, abandonIdempotent } from './idempotency';
import { loadSettings } from './domain/commit';
import { UPLOAD_REQUEST_MAX_BYTES, isIdempotencyKey } from '../shared/rules';


const apiRoutes: Route[] = [
  ...authRoutes,
  ...settingsRoutes,
  ...contentRoutes,
  ...queryRoutes,
  ...collectionRoutes,
  ...attachmentRoutes,
];

const IDEMPOTENT_PATTERNS = ['/api/objects/:id/quotes', '/api/daily/today/blocks'];

const WORKSPACE_PREFIXES = [
  '/today',
  '/o/',
  '/types/',
  '/collections/',
  '/timeline',
  '/queries',
  '/graph',
  '/settings',
  '/sign-in',
];

const publicDir = join(__dirname, 'public');
const assetCache = new Map<string, { bytes: Buffer; type: string }>();

const ASSET_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

function loadAsset(relative: string): { bytes: Buffer; type: string } | null {
  const cached = assetCache.get(relative);
  if (cached !== undefined) return cached;
  const extension = relative.slice(relative.lastIndexOf('.'));
  const type = ASSET_TYPES[extension];
  if (type === undefined) return null;
  const path = join(publicDir, relative);
  if (!path.startsWith(publicDir) || !existsSync(path)) return null;
  const asset = { bytes: readFileSync(path), type };
  assetCache.set(relative, asset);
  return asset;
}

const WORKSPACE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function workspaceShell(theme: string): string {
  return `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quire</title>
<link rel="stylesheet" href="/assets/app.css">
<script src="/assets/app.js" defer></script>
</head>
<body><div id="quire-root"></div></body>
</html>
`;
}

function shareShell(): string {
  return `<!doctype html>
<html lang="en" data-theme="paper">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quire share</title>
<link rel="stylesheet" href="/assets/share.css">
<script src="/assets/share.js" defer></script>
</head>
<body><div id="quire-share-root"></div></body>
</html>
`;
}

function peerAddressOf(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown';
}

async function dispatchApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<void> {
  const path = url.pathname;
  const isSignIn = path === '/api/auth/sign-in' && method === 'POST';
  const isUpload = method === 'POST' && path.endsWith('/attachments');
  const limit = isUpload ? UPLOAD_REQUEST_MAX_BYTES : JSON_BODY_MAX_BYTES;

  const body = await readBody(req, limit);
  if (body === 'too_large') throw tooLarge();

  const contentType = contentTypeOf(req.headers);
  if (!isUpload && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    if (contentType !== '' && contentType !== 'application/json') throw unsupportedMediaType();
    if (contentType === '' && body.length > 0) throw unsupportedMediaType();
  }
  let parsed: unknown = null;
  if (!isUpload && body.length > 0) {
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      throw errorReply(400, 'malformed_json');
    }
  }

  const cookies = parseCookies(req.headers['cookie']);
  const session = path === '/api/health' || isSignIn ? null : await loadLiveSession(cookies[SESSION_COOKIE]);
  if (path !== '/api/health' && !isSignIn && session === null) throw unauthenticated();

  if (!isSignIn && (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE')) {
    const token = req.headers['x-csrf-token'];
    if (typeof token !== 'string' || session === null || token !== session.csrfToken) throw csrfFailed();
  }

  if (path === '/api/events' && method === 'GET') {
    const lastEventId = req.headers['last-event-id'];
    await openStream(
      res,
      (session as { id: string }).id,
      typeof lastEventId === 'string' ? lastEventId : undefined,
    );
    return;
  }

  const idempotencyHeader = req.headers['idempotency-key'];
  let idempotencyKey: string | null = null;
  if (typeof idempotencyHeader === 'string') {
    if (!isIdempotencyKey(idempotencyHeader)) {
      throw validationError({ idempotency_key: 'Use 1 to 100 visible characters.' });
    }
    idempotencyKey = idempotencyHeader;
  }

  const matched = matchRoute(apiRoutes, method, path);
  if (matched === null) throw notFound();

  const context: RequestContext = {
    method,
    url,
    path,
    headers: req.headers,
    body,
    json: parsed,
    params: matched.params,
    session,
    peerAddress: peerAddressOf(req),
    cookies,
    raw: req,
    response: res,
  };

  const useIdempotency = idempotencyKey !== null && IDEMPOTENT_PATTERNS.includes(matched.route.pattern);
  if (!useIdempotency) {
    sendReply(res, await matched.route.handler(context));
    return;
  }
  const key = idempotencyKey as string;
  const endpoint = `${method} ${path}`;
  const normalised =
    parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { after_block_id: null, ...(parsed as Record<string, unknown>) }
      : parsed;
  const outcome = await beginIdempotent(key, endpoint, normalised);
  if (outcome.kind === 'conflict') throw errorReply(409, 'idempotency_conflict');
  if (outcome.kind === 'replay') {
    sendReply(res, {
      status: outcome.status,
      body: outcome.body,
      headers: { 'Idempotent-Replay': 'true' },
    });
    return;
  }
  try {
    const reply = await matched.route.handler(context);
    if (reply.status >= 200 && reply.status < 300) {
      await finishIdempotent(key, endpoint, reply.status, reply.body ?? null);
    } else {
      await abandonIdempotent(key, endpoint);
    }
    sendReply(res, reply);
  } catch (error) {
    await abandonIdempotent(key, endpoint);
    throw error;
  }
}

async function dispatchShare(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<void> {
  if (method !== 'GET' && method !== 'HEAD') {
    throw new HttpError(405, { error: 'read_only' }, { Allow: 'GET, HEAD' });
  }
  const path = url.pathname;
  const pageMatch = /^\/s\/([^/]+)(\/o\/[^/]+)?\/?$/.exec(path);
  if (pageMatch !== null) {
    sendReply(res, {
      status: 200,
      raw: Buffer.from(shareShell(), 'utf8'),
      contentType: 'text/html; charset=utf-8',
      headers: SHARE_HEADERS,
    });
    return;
  }
  const matched = matchRoute(shareRoutes, 'GET', path);
  if (matched === null) throw new HttpError(404, { status: 'unknown' }, SHARE_HEADERS);
  const context: RequestContext = {
    method,
    url,
    path,
    headers: req.headers,
    body: Buffer.alloc(0),
    json: null,
    params: matched.params,
    session: null,
    peerAddress: peerAddressOf(req),
    cookies: {},
    raw: req,
    response: res,
  };
  sendReply(res, await matched.route.handler(context));
}

async function serveWorkspacePage(res: ServerResponse): Promise<void> {
  let theme = 'paper';
  try {
    theme = (await loadSettings()).theme;
  } catch {
    theme = 'paper';
  }
  sendReply(res, {
    status: 200,
    raw: Buffer.from(workspaceShell(theme), 'utf8'),
    contentType: 'text/html; charset=utf-8',
    headers: {
      'Content-Security-Policy': WORKSPACE_CSP,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}

function isWorkspacePath(path: string): boolean {
  if (path === '/') return true;
  if (path.includes('.')) return false;
  return WORKSPACE_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

const server = createServer((req, res) => {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  void (async () => {
    try {
      if (path.startsWith('/api/')) {
        await dispatchApi(req, res, url, method);
        return;
      }
      if (path === '/s' || path.startsWith('/s/')) {
        await dispatchShare(req, res, url, method);
        return;
      }
      if (method !== 'GET' && method !== 'HEAD') throw notFound();
      if (path.startsWith('/assets/')) {
        const asset = loadAsset(path.slice('/assets/'.length));
        if (asset === null) throw notFound();
        sendReply(res, { status: 200, raw: asset.bytes, contentType: asset.type });
        return;
      }
      if (path.startsWith('/fonts/')) {
        const asset = loadAsset(`fonts/${path.slice('/fonts/'.length)}`);
        if (asset === null) throw notFound();
        sendReply(res, {
          status: 200,
          raw: asset.bytes,
          contentType: asset.type,
          headers: { 'Cache-Control': 'public, max-age=604800' },
        });
        return;
      }
      if (isWorkspacePath(path) || !path.includes('.')) {
        await serveWorkspacePage(res);
        return;
      }
      throw notFound();
    } catch (error) {
      if (error instanceof HttpError) {
        sendReply(res, { status: error.status, body: error.payload, headers: error.extraHeaders });
        return;
      }
      process.stderr.write(`request failed: ${(error as Error).message}\n`);
      sendReply(res, { status: 500, body: { error: 'server_error' } });
    }
  })();
});

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`quire listening on ${config.port}\n`);
});

startEventPruning();
startIdempotencyPruning();
void prepareDatabase(applySeed);
void ensureBucket();
