import http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { config } from './api.js';
import { router, liveHub, serveStatic, sendJson, originMismatch, parseCookies, readBody, JSON_LIMIT, notFoundHtml, sendHtml, indexDocument } from './api.js';
import './api_review.js';
import './api_files.js';
import './api_grading.js';
import { applySchema, sessionUser } from './auth.js';
import { ApiError, ERROR_TEXT } from '../shared/errors.js';
import { writeError } from './http.js';
import { pool } from './db.js';
import { loadOffset, offsetNow } from './clock.js';
import { roleForDrawing } from './auth.js';
import { storage } from './api.js';
import { makeStorage, setStorageDown } from './storage.js';
import { s3ConfigFromEnv } from './s3core.js';
import { sheetById, versionById } from './sheets.js';
import { query } from './db.js';

const HEALTH_TIMEOUT_MS = 2000;

async function start(): Promise<void> {
  await waitForDatabase();
  await applySchema();
  await loadOffset();
  const server = http.createServer(handleRequest);
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    void handleUpgrade(request, socket, head, wss);
  });
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`plotfold listening on ${config.port}`);
  });
  setInterval(() => {
    void tickDeadlines();
  }, 500).unref();
}

async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function tickDeadlines(): Promise<void> {
  const { applyDeadlines } = await import('./clock.js');
  await applyDeadlines(offsetNow());
  const { advanceExports } = await import('./exports.js');
  await advanceExports(offsetNow());
}

interface PresenceView {
  socket: WebSocket;
  username: string;
  x: number;
  y: number;
  zoom: number;
  panX: number;
  panY: number;
}

const presenceViews = new Map<WebSocket, PresenceView>();

async function handleUpgrade(request: http.IncomingMessage, socket: import('node:stream').Duplex, head: Buffer, wss: WebSocketServer): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const originBad = originMismatch(request);
  if (originBad) {
    socket.write('HTTP/1.1 403 Forbidden\r\ncontent-type: application/json; charset=utf-8\r\n\r\n');
    socket.write(JSON.stringify({ error: 'cross_origin', message: ERROR_TEXT.crossOrigin }));
    socket.destroy();
    return;
  }
  const token = path === '/api/links/live' ? null : null;
  void token;
  if (path.startsWith('/api/links/') && path.endsWith('/live')) {
    const linkToken = path.slice('/api/links/'.length, -'/live'.length);
    const row = await query<{ version_id: string; expires_at: Date; revoked: boolean }>('SELECT version_id, expires_at, revoked FROM view_links WHERE token = $1', [linkToken]);
    const link = row.rows[0];
    const allowed = link && !link.revoked && link.expires_at.getTime() > offsetNow().getTime();
    if (!allowed) {
      socket.write('HTTP/1.1 404 Not Found\r\ncontent-type: application/json; charset=utf-8\r\n\r\n');
      socket.write(JSON.stringify({ error: 'not_found', message: 'We couldn\u2019t find that link.' }));
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const send = (message: unknown) => ws.send(JSON.stringify(message));
      send({ seq: 0, type: 'link', data: { token: linkToken } });
      ws.on('message', (raw) => {
        void (async () => {
          const parsed = JSON.parse(String(raw)) as { since?: number };
          void parsed;
        })();
      });
    });
    return;
  }
  const drawingMatch = /^\/api\/drawings\/([^/]+)\/live$/.exec(path);
  if (!drawingMatch) {
    socket.write('HTTP/1.1 404 Not Found\r\ncontent-type: application/json; charset=utf-8\r\n\r\n');
    socket.write(JSON.stringify({ error: 'not_found', message: 'We couldn\u2019t find that page.' }));
    socket.destroy();
    return;
  }
  const drawingId = decodeURIComponent(drawingMatch[1]);
  const username = await sessionUser(request);
  if (!username) {
    socket.write('HTTP/1.1 401 Unauthorized\r\ncontent-type: application/json; charset=utf-8\r\n\r\n');
    socket.write(JSON.stringify({ error: 'unauthenticated', message: 'Sign in first.' }));
    socket.destroy();
    return;
  }
  const role = await roleForDrawing(drawingId, username);
  if (!role) {
    socket.write('HTTP/1.1 404 Not Found\r\ncontent-type: application/json; charset=utf-8\r\n\r\n');
    socket.write(JSON.stringify({ error: 'not_found', message: 'We couldn\u2019t find that drawing.' }));
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    let since = 0;
    const send = (message: unknown) => {
      if (ws.readyState === 1) ws.send(JSON.stringify(message));
    };
    ws.on('message', (raw) => {
      const text = String(raw);
      let parsed: { type?: string; since?: number; x?: number; y?: number; zoom?: number; pan_x?: number; pan_y?: number };
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }
      if (parsed.type === 'hello') {
        since = Number(parsed.since ?? 0);
        liveHub.attach({ socket: ws, drawingId, username, since, token: null, send });
        liveHub.broadcast(drawingId, 'presence', { usernames: liveHub.presenceUsernames(drawingId), joined: username });
        presenceViews.set(ws, { socket: ws, username, x: 0, y: 0, zoom: 1, panX: 0, panY: 0 });
        return;
      }
      const view = presenceViews.get(ws);
      if (view && parsed.type === 'view') {
        view.x = Number(parsed.x ?? view.x);
        view.y = Number(parsed.y ?? view.y);
        view.zoom = Number(parsed.zoom ?? view.zoom);
        view.panX = Number(parsed.pan_x ?? view.panX);
        view.panY = Number(parsed.pan_y ?? view.panY);
        liveHub.broadcast(drawingId, 'presence', {
          usernames: liveHub.presenceUsernames(drawingId),
          cursor: { username, x: view.x, y: view.y },
          view: { username, zoom: view.zoom, pan_x: view.panX, pan_y: view.panY },
        });
      }
    });
    ws.on('close', () => {
      liveHub.detach(ws);
      presenceViews.delete(ws);
      const remaining = liveHub.presenceUsernames(drawingId);
      liveHub.broadcast(drawingId, 'presence', { usernames: remaining, left: username });
    });
    ws.on('pong', () => undefined);
  });
  const pingTimer = setInterval(() => {
    for (const client of wss.clients) {
      if (client.readyState === 1) client.ping();
    }
  }, 20000);
  pingTimer.unref();
}

async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const path = url.pathname;
    if (path === '/api/health') {
      const healthy = await healthCheck();
      sendJson(response, 200, { status: healthy ? 'ok' : 'unavailable' });
      return;
    }
    const isWrite = request.method === 'POST' || request.method === 'PUT' || request.method === 'PATCH' || request.method === 'DELETE';
    if (isWrite && originMismatch(request)) {
      writeError(response, new ApiError('cross_origin', ERROR_TEXT.crossOrigin));
      return;
    }
    if (path.startsWith('/api/')) {
      const match = router.match(request.method ?? 'GET', path);
      if (!match) {
        writeError(response, new ApiError('not_found', 'We couldn\u2019t find that page.'));
        return;
      }
      let body: unknown = null;
      let rawBody: Buffer | null = null;
      const limit = path.includes('/underlays') ? Math.max(config.underlayMaxBytes, 1) : path.includes('/imports') ? Math.max(config.textMaxBytes, 1) : JSON_LIMIT;
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        const contentType = request.headers['content-type'] ?? '';
        rawBody = await readBody(request, limit);
        if (rawBody && contentType.includes('application/json')) {
          try {
            body = JSON.parse(rawBody.toString('utf8'));
          } catch {
            writeError(response, new ApiError('invalid', 'That request body is not JSON.'));
            return;
          }
        } else if (rawBody) {
          body = rawBody.toString('utf8');
        }
      }
      const username = await sessionUser(request);
      const cookies = parseCookies(request);
      const context = { request, response, params: match.params, query: url.searchParams, body, rawBody, username, cookies };
      const result = await match.route.handler(context);
      if (result !== undefined && !response.headersSent) {
        sendJson(response, 200, result);
      } else if (!response.headersSent) {
        sendJson(response, 200, {});
      }
      return;
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      // Client-routed paths serve the app shell.
      const clientRoutes = ['/folders', '/register', '/signin', '/drawings', '/versions', '/v'];
      const isClientRoute = clientRoutes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
      if (isClientRoute) {
        sendHtml(response, indexDocument());
        return;
      }
      const served = serveStatic(response, path);
      if (served) return;
    }
    if (!response.headersSent) {
      response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      response.end(notFoundHtml());
    }
  } catch (error) {
    if (error instanceof ApiError) {
      writeError(response, error);
      return;
    }
    console.error('unhandled', error);
    if (!response.headersSent) {
      writeError(response, new ApiError('invalid', 'Something went wrong.'));
    }
  }
}

async function healthCheck(): Promise<boolean> {
  try {
    const ok = await withTimeout(storage.healthy(), HEALTH_TIMEOUT_MS);
    return ok;
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

void setStorageDown;
void makeStorage;
void s3ConfigFromEnv;
void sheetById;
void versionById;
void sendHtml;
void indexDocument;
void JSON_LIMIT;

start().catch((error) => {
  console.error('boot failed', error);
  process.exit(1);
});
