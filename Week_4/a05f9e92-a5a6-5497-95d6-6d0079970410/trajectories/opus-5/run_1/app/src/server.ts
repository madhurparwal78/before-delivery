/**
 * The one server process: the interface, the JSON API and the live channel on
 * one port and one origin.
 */

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';

import { iso, now, nowMs } from './clock';
import { connections, settings } from './config';
import {
  applySchema,
  databaseReachable,
  loadClockOffset,
  markReady,
  query,
  waitForDatabase,
} from './db';
import { ApiError, notFound } from './errors';
import { screenOutcome, type RoleKey } from './domain/roles';
import {
  callerOf,
  checkOrigin,
  checkWriteRate,
  isWriteMethod,
  jsonBodyLimit,
  loadSession,
  multipartLimit,
  parseMultipart,
  readBody,
  sendError,
  sendJson,
  type MultipartFile,
  type RequestContext,
} from './http/context';
import { match, pathKnown } from './api/router';
import { runDueWork, startBackground } from './services/background';
import {
  addClient,
  publish,
  removeClient,
  subscribe,
  unsubscribe,
  type LiveClient,
} from './services/live';
import { ensureBucket, probeStorage, storageAvailable } from './services/storage';
import { isEmptyDatabase, seed } from './seed';

// Importing a route module registers its routes.
import './api/session';
import './api/records';
import './api/cmdb';
import './api/changeapi';
import './api/oncallapi';
import './api/catalogapi';
import './api/adminapi';
import './api/dataapi';
import './api/grading';
import './services/hooks';

const publicRoot = resolve(__dirname, 'public');

const mimeTypes: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/** The server never serves source files, lockfiles or credentials. */
const neverServed = [
  /^\/run\.json$/,
  /^\/package(-lock)?\.json$/,
  /^\/tsconfig/,
  /^\/src\//,
  /^\/web\//,
  /^\/scripts\//,
  /^\/node_modules\//,
  /^\/\.env/,
  /^\/\.git/,
  /\.map$/,
  /^\/dist\//,
  /^\/THIRD_PARTY_NOTICES\.md$/,
  /^\/AGENTS\.md$/,
];

function isNeverServed(path: string): boolean {
  return neverServed.some((pattern) => pattern.test(path));
}

function serveFile(response: ServerResponse, filePath: string, status = 200): boolean {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;
  const type = mimeTypes[extname(filePath)] ?? 'application/octet-stream';
  response.writeHead(status, {
    'content-type': type,
    'content-length': statSync(filePath).size,
    'x-content-type-options': 'nosniff',
  });
  createReadStream(filePath).pipe(response);
  return true;
}

function sendHtml(response: ServerResponse, status: number): void {
  const index = join(publicRoot, 'index.html');
  if (!serveFile(response, index, status)) {
    response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Switchyard</title>');
  }
}

async function health(response: ServerResponse): Promise<void> {
  const database = await databaseReachable();
  if (!database) {
    sendJson(response, 503, { status: 'starting' });
    return;
  }
  sendJson(response, 200, { status: storageAvailable() ? 'ok' : 'unavailable' });
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const method = request.method ?? 'GET';
  const path = url.pathname;

  if (path === '/api/health') {
    await health(response);
    return;
  }

  // The transport checks come before the API error order.
  checkOrigin(request);

  const contentType = String(request.headers['content-type'] ?? '');
  const isMultipart = contentType.includes('multipart/form-data');
  let multipart: MultipartFile | null = null;
  let bodyText = '';
  let body: Record<string, unknown> = {};
  if (isWriteMethod(method)) {
    const raw = await readBody(request, isMultipart ? multipartLimit() : jsonBodyLimit);
    if (isMultipart) {
      multipart = parseMultipart(raw, contentType);
      bodyText = multipart ? `${multipart.fileName}:${multipart.bytes.length}` : '';
      body = multipart ? { ...multipart.fields } : {};
    } else {
      bodyText = raw.toString('utf8');
      if (bodyText.trim() !== '') {
        try {
          const parsed: unknown = JSON.parse(bodyText);
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            body = parsed as Record<string, unknown>;
          }
        } catch {
          throw new ApiError(422, 'validation', 'The body must be JSON.');
        }
      }
    }
  }

  const session = await loadSession(request);
  const caller = session ? await callerOf(session) : null;

  const context: RequestContext = {
    request,
    response,
    method,
    path,
    url,
    session,
    caller,
    bodyText,
    body,
    multipart,
  };

  const matched = match(method, path);
  if (!matched) {
    if (pathKnown(path)) {
      sendJson(response, 404, notFound().body());
      return;
    }
    sendJson(response, 404, notFound().body());
    return;
  }

  // One rate check per endpoint class, before the first step of the order.
  const isGrading = path.startsWith('/api/grading/');
  if (isWriteMethod(method) && caller && !isGrading && path !== '/api/session') {
    checkWriteRate(caller.actor);
  }

  const result = await matched.handler(context, matched.params);
  if (result.bytes) {
    response.writeHead(result.status, {
      'content-type': result.contentType ?? 'application/octet-stream',
      'content-length': result.bytes.length,
      'x-content-type-options': 'nosniff',
      ...(result.headers ?? {}),
    });
    response.end(result.bytes);
    return;
  }
  if (result.status === 204) {
    response.writeHead(204, result.headers ?? {});
    response.end();
    return;
  }
  sendJson(response, result.status, result.body ?? {}, result.headers ?? {});
}

/** A visitor's screen outcome decides the status of a page request. */
async function handlePage(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const session = await loadSession(request);
  const caller = session ? await callerOf(session) : null;
  const roles: readonly RoleKey[] | null = caller ? caller.roles : null;
  const outcome = screenOutcome(url.pathname, roles);
  switch (outcome.kind) {
    case 'public':
    case 'allowed':
      sendHtml(response, 200);
      return;
    case 'redirect':
      response.writeHead(302, { location: '/login' });
      response.end();
      return;
    case 'not_found':
      sendHtml(response, 404);
      return;
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  void (async () => {
    try {
      if (isNeverServed(path)) {
        sendHtml(response, 404);
        return;
      }
      if (path.startsWith('/api/')) {
        await handleApi(request, response, url);
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendHtml(response, 404);
        return;
      }
      const asset = normalize(join(publicRoot, path));
      if (asset.startsWith(publicRoot) && path !== '/' && serveFile(response, asset)) return;
      await handlePage(request, response, url);
    } catch (error) {
      if (path.startsWith('/api/')) {
        sendError(response, error);
        return;
      }
      sendHtml(response, 500);
    }
  })();
});

const sockets = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/api/live') {
    socket.destroy();
    return;
  }
  void (async () => {
    const session = await loadSession(request);
    const caller = session ? await callerOf(session) : null;
    if (!caller) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      attachLive(ws, caller.username);
    });
  })();
});

function attachLive(ws: WebSocket, username: string): void {
  const client: LiveClient = addClient(ws, username);
  ws.send(JSON.stringify({ topic: 'session', event: 'ready', data: { username }, server_time: iso(now()) }));
  ws.on('message', (raw) => {
    void (async () => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(raw)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (Array.isArray(message.subscribe)) subscribe(client, message.subscribe.map(String));
      if (Array.isArray(message.unsubscribe)) unsubscribe(client, message.unsubscribe.map(String));
      if (typeof message.presence === 'string') {
        await query(
          `INSERT INTO presence (number, username, seen_at) VALUES ($1, $2, $3)
           ON CONFLICT (number, username) DO UPDATE SET seen_at = $3`,
          [message.presence, username, now()],
        );
        await publishPresence(message.presence);
      }
      if (typeof message.leave === 'string') {
        await query(`DELETE FROM presence WHERE number = $1 AND username = $2`, [message.leave, username]);
        await publishPresence(message.leave);
      }
    })();
  });
  ws.on('close', () => {
    removeClient(client);
    void query(`DELETE FROM presence WHERE username = $1`, [username]);
  });
}

async function publishPresence(number: string): Promise<void> {
  const cutoff = new Date(nowMs() - settings().PRESENCE_TIMEOUT_SECONDS * 1000);
  const rows = await query<{ username: string; display_name: string }>(
    `SELECT p.username, person.display_name FROM presence p
     JOIN person ON person.username = p.username
     WHERE p.number = $1 AND p.seen_at > $2 ORDER BY p.username`,
    [number, cutoff],
  );
  publish({
    topic: `presence:${number}`,
    event: 'viewing',
    data: { number, viewing: rows.map((r) => ({ username: r.username, display_name: r.display_name })) },
  });
}

async function start(): Promise<void> {
  server.listen(connections.port, '0.0.0.0', () => {
    process.stdout.write(`Switchyard listening on ${connections.port}\n`);
  });
  await waitForDatabase();
  await applySchema();
  await loadClockOffset();
  if (await isEmptyDatabase()) await seed();
  await markReady();
  // Booting with storage unreachable does not stop the server.
  await ensureBucket().catch(() => undefined);
  await probeStorage().catch(() => undefined);
  startBackground();
  await runDueWork().catch(() => undefined);
}

void start();

export { server, createHash };
