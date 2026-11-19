import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import type { LiveMessage } from '../shared/types.js';
import { viewerBySession } from './accounts.js';
import { config } from './config.js';
import { applySchema, pool, waitForDatabase } from './db.js';
import { ApiError, notFound } from './errors.js';
import {
  parseJsonBody,
  readBody,
  readCookies,
  requireJsonType,
  sendError,
  sendJson,
  SESSION_COOKIE,
  type RequestContext
} from './http.js';
import {
  fanoutOk,
  registerSocket,
  replay,
  startLive,
  unregisterSocket,
  type LiveSocket
} from './live.js';
import { readBullet } from './outline.js';
import { startPurgeSweep } from './purge.js';
import { matchRoute } from './routes.js';
import { baseDepth, scopeForRoot } from './scope.js';
import { seed } from './seed.js';

const publicDir = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const STATIC_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml'
};

let shellTemplate = '';
let databaseReady = false;

function shell(signedIn: boolean): string {
  return shellTemplate.replace(
    '<!--boot-->',
    `<script>window.__twigline=${JSON.stringify({ signedIn })};</script>`
  );
}

function sendShell(response: ServerResponse, status: number, signedIn: boolean): void {
  const payload = Buffer.from(shell(signedIn), 'utf8');
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': String(payload.length),
    'cache-control': 'no-store'
  });
  response.end(payload);
}

async function sendStatic(response: ServerResponse, pathname: string): Promise<boolean> {
  const extension = extname(pathname);
  const type = STATIC_TYPES[extension];
  if (type === undefined) return false;
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(publicDir, safe);
  if (!file.startsWith(publicDir)) return false;
  try {
    const content = await readFile(file);
    response.writeHead(200, {
      'content-type': type,
      'content-length': String(content.length),
      'cache-control': extension === '.woff2' ? 'public, max-age=604800' : 'no-cache'
    });
    response.end(content);
    return true;
  } catch {
    return false;
  }
}

async function viewerOf(request: IncomingMessage) {
  const cookies = readCookies(request.headers.cookie);
  const session = cookies[SESSION_COOKIE];
  if (session === undefined) return null;
  return viewerBySession(session);
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  segments: string[]
): Promise<void> {
  const method = request.method ?? 'GET';
  if (method === 'GET' && segments.length === 2 && segments[1] === 'health') {
    if (!databaseReady) {
      sendJson(response, 503, { status: 'starting' });
      return;
    }
    try {
      await pool.query('select 1');
      sendJson(response, 200, { status: 'ok' });
    } catch {
      sendJson(response, 503, { status: 'starting' });
    }
    return;
  }

  const matched = matchRoute(method, segments);
  if (matched === null) throw notFound();

  const isGrading = matched.route.pattern.join('/') === 'api/grading/setup';
  if (isGrading && (config.gradingKey === '' || request.headers['x-grading-key'] !== config.gradingKey)) {
    throw notFound();
  }

  const raw = await readBody(request, isGrading ? config.gradingBodyLimit : config.bodyLimit);
  if (method !== 'GET' && method !== 'HEAD') requireJsonType(request, raw);

  const viewer = await viewerOf(request);
  if (matched.route.auth && viewer === null) throw new ApiError(401, { error: 'unauthenticated' });

  let parsed: Record<string, unknown> | null = null;
  const context: RequestContext = {
    method,
    path: url.pathname,
    params: matched.params,
    url,
    request,
    response,
    cookies: readCookies(request.headers.cookie),
    body: () => {
      parsed ??= parseJsonBody(raw);
      return parsed;
    }
  };
  await matched.route.handler(context, viewer!);
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const segments = url.pathname.split('/').filter((part) => part !== '');

  if (segments[0] === 'api') {
    try {
      await handleApi(request, response, url, segments);
    } catch (error) {
      sendError(response, error);
    }
    return;
  }

  if (request.method === 'GET' && (await sendStatic(response, url.pathname))) return;

  const viewer = await viewerOf(request);
  if (segments[0] === 'b' && segments.length === 2) {
    if (viewer === null) {
      response.writeHead(302, { location: `/signin?next=${encodeURIComponent(url.pathname)}` });
      response.end();
      return;
    }
    try {
      await readBullet(viewer, segments[1]!);
    } catch {
      sendShell(response, 404, true);
      return;
    }
  }
  sendShell(response, 200, viewer !== null);
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function refuseUpgrade(socket: Duplex, status: number, code: string): void {
  const body = JSON.stringify({ error: code });
  socket.end(
    `HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : 'Not Found'}\r\n` +
      `content-type: application/json; charset=utf-8\r\ncontent-length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
  );
}

async function start(): Promise<void> {
  shellTemplate = await readFile(join(publicDir, 'index.html'), 'utf8');
  const server = createServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      sendJson(response, 500, { error: 'server_error' });
    });
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    void (async () => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      if (url.pathname !== '/api/live' || !sameOrigin(request)) {
        refuseUpgrade(socket, 404, 'not_found');
        return;
      }
      const viewer = await viewerOf(request);
      if (viewer === null) {
        refuseUpgrade(socket, 401, 'unauthenticated');
        return;
      }
      const rootValue = url.searchParams.get('root');
      const rootId = rootValue === null || rootValue === '' ? null : rootValue;
      let resolved;
      try {
        resolved = await scopeForRoot(viewer, rootId);
      } catch {
        refuseUpgrade(socket, 404, 'not_found');
        return;
      }
      const since = Number(url.searchParams.get('since') ?? '');
      wss.handleUpgrade(request, socket, head, (connection) => {
        const live: LiveSocket = {
          ownerId: resolved.scope.ownerId,
          rootId,
          shareRootId: resolved.scope.shareRootId,
          depthBase:
            resolved.scope.shareRootId === null
              ? 0
              : baseDepth(
                  { ...resolved.scope, shareRootId: null },
                  resolved.tree,
                  resolved.scope.shareRootId
                ),
          email: viewer.email,
          lastSeq: Number.isFinite(since) && since >= 0 ? since : 0,
          sendMessage: (message: LiveMessage) => {
            if (connection.readyState === connection.OPEN) connection.send(JSON.stringify(message));
          },
          closeSocket: () => connection.close()
        };
        let first = true;
        const beat = (): void => {
          const message: LiveMessage = {
            type: 'heartbeat',
            fanout: fanoutOk() ? 'ok' : 'paused'
          };
          if (first) {
            message.pauseAfterSeconds = config.pauseAfterSeconds;
            message.heartbeatSeconds = config.heartbeatSeconds;
            first = false;
          }
          live.sendMessage(message);
        };
        registerSocket(live);
        void replay(live).catch(() => undefined);
        beat();
        const timer = setInterval(beat, config.heartbeatSeconds * 1_000);
        connection.on('close', () => {
          clearInterval(timer);
          unregisterSocket(live);
        });
        connection.on('error', () => connection.close());
      });
    })().catch(() => {
      refuseUpgrade(socket, 404, 'not_found');
    });
  });

  server.listen(config.port, '0.0.0.0');

  await waitForDatabase();
  await applySchema();
  await seed();
  databaseReady = true;
  startLive();
  startPurgeSweep();
}

void start();
