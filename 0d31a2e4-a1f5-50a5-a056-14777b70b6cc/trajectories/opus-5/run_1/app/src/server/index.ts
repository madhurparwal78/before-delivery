import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from './config.js';
import { ping } from './db.js';
import { AppError, fail } from './errors.js';
import { Router, asRecord, toAppError } from './http/router.js';
import { isForbiddenPath, readAppShell, readClientFile } from './http/static.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerChatRoutes } from './routes/chat.js';
import { registerFriendRoutes } from './routes/friends.js';
import { registerMatchRoutes } from './routes/matches.js';
import { registerPartyRoutes } from './routes/party.js';
import { applySchema } from './schema.js';
import { seed } from './seed.js';
import { SESSION_COOKIE, userForSession } from './services/accounts.js';
import { startMatchmaker } from './services/matchmaking.js';
import { startPresenceSweep } from './services/presence.js';
import { attachWebSocket, sameOrigin } from './ws/socket.js';

const BODY_LIMIT = 16 * 1024;
const SIMULATE_BODY_LIMIT = 256 * 1024;

const router = new Router();
registerAuthRoutes(router);
registerFriendRoutes(router);
registerPartyRoutes(router);
registerMatchRoutes(router);
registerChatRoutes(router);

let ready = false;

function cookieValue(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

async function readBody(request: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) throw fail.payloadTooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = body === undefined ? '' : JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  response.end(payload);
}

function sessionCookie(value: string): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax`;
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  if (url.pathname === '/api/health') {
    if (!ready) {
      sendJson(response, 503, { status: 'starting' });
      return;
    }
    try {
      await ping();
      sendJson(response, 200, { status: 'ok' });
    } catch {
      sendJson(response, 503, { status: 'starting' });
    }
    return;
  }

  const method = request.method ?? 'GET';
  const limit = url.pathname === '/api/simulate' ? SIMULATE_BODY_LIMIT : BODY_LIMIT;
  const origin = request.headers.origin;
  if (!sameOrigin(typeof origin === 'string' ? origin : undefined, request.headers.host)) {
    throw fail.badOrigin();
  }
  const raw = await readBody(request, limit);
  if (raw.length > 0) {
    const contentType = request.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().includes('application/json')) throw fail.unsupportedMediaType();
  }
  let parsed: unknown = {};
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw fail.unsupportedMediaType();
    }
  }
  const token = cookieValue(request.headers.cookie, SESSION_COOKIE);
  const user = token === null ? null : await userForSession(token);
  const reply = await router.run(method, url, asRecord(parsed), user, token);
  const headers: Record<string, string> = { ...reply.headers };
  if (reply.cookie !== undefined) {
    headers['set-cookie'] =
      'clear' in reply.cookie
        ? `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
        : sessionCookie(reply.cookie.value);
  }
  if (reply.status === 204) {
    response.writeHead(204, headers);
    response.end();
    return;
  }
  sendJson(response, reply.status, reply.body, headers);
}

const NOT_FOUND_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Not found · Pratfall Cup</title><style>body{background:#fdf6e8;color:#1d1b3a;
font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}
a{color:#1d1b3a}</style></head><body><main><h1>404 — nothing here</h1>
<p><a href="/">Back to Pratfall Cup</a></p></main></body></html>`;

async function handleStatic(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const method = request.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(response, 404, fail.notFound().body());
    return;
  }
  if (!isForbiddenPath(url.pathname)) {
    const file = await readClientFile(url.pathname);
    if (file !== null) {
      response.writeHead(200, {
        'content-type': file.contentType,
        'content-length': file.body.length,
        'x-content-type-options': 'nosniff',
      });
      response.end(method === 'HEAD' ? undefined : file.body);
      return;
    }
  }
  if (isForbiddenPath(url.pathname) || url.pathname.startsWith('/assets/')) {
    response.writeHead(404, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(NOT_FOUND_PAGE),
    });
    response.end(method === 'HEAD' ? undefined : NOT_FOUND_PAGE);
    return;
  }
  const shell = await readAppShell();
  response.writeHead(200, {
    'content-type': shell.contentType,
    'content-length': shell.body.length,
    'cache-control': 'no-store',
  });
  response.end(method === 'HEAD' ? undefined : shell.body);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const work = url.pathname.startsWith('/api/')
    ? handleApi(request, response, url)
    : handleStatic(request, response, url);
  void work.catch((error: unknown) => {
    const appError = toAppError(error);
    if (!(error instanceof AppError)) console.error('request failed', error);
    if (!response.headersSent) {
      sendJson(response, appError.status, appError.body(), appError.headers ?? {});
    }
    else response.end();
  });
});

attachWebSocket(server);

async function boot(): Promise<void> {
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Pratfall Cup listening on port ${config.port}`);
  });
  for (;;) {
    try {
      await applySchema();
      await seed();
      ready = true;
      break;
    } catch (error) {
      console.error('database not ready, retrying in 2s', error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  startPresenceSweep();
  startMatchmaker();
}

void boot();
