import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';
import { WebSocketServer } from 'ws';
import { userOf } from './auth.js';
import { config } from './config.js';
import { bootDatabase, databaseReady } from './db.js';
import { BODY_LIMIT, answerFor, notFound, readBody, respond, respondFile, signInRequired, starting, tooLarge } from './http.js';
import { attach, runLiveLoops } from './live.js';
import { accessFor, layoutByViewToken } from './store.js';
import { gradingKeyMatches, routes } from './routes.js';

const CLIENT_DIR = fileURLToPath(new URL('../../client/', import.meta.url));
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

/** The built client files by URL path: only these are ever served. */
function builtFiles(): Map<string, { type: string; content: Buffer }> {
  const found = new Map<string, { type: string; content: Buffer }>();
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) walk(path);
      else found.set(`/${relative(CLIENT_DIR, path).split(sep).join('/')}`, { type: TYPES[name.slice(name.lastIndexOf('.'))] ?? 'application/octet-stream', content: readFileSync(path) });
    }
  };
  walk(CLIENT_DIR);
  return found;
}

const files = builtFiles();
const pages = /^\/(?:|signin|signup|layouts\/[^/]+|view\/[^/]+|join\/[^/]+)$/;

function serveClient(response: ServerResponse, path: string): void {
  const asset = files.get(path);
  if (asset && path !== '/index.html') {
    respondFile(response, 200, asset.type, asset.content, 'public, max-age=31536000, immutable');
    return;
  }
  const index = files.get('/index.html');
  if (!index || !pages.test(path)) throw notFound();
  respondFile(response, 200, index.type, index.content, 'no-cache');
}

/** A path parameter, percent-decoded; a malformed encoding names nothing, so it is not found. */
function decoded(part: string): string {
  try {
    const value = decodeURIComponent(part);
    if (value.includes('\u0000')) throw notFound();
    return value;
  } catch {
    throw notFound();
  }
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://app');
  const body = await readBody(request);
  if (!body) throw tooLarge();
  if (!url.pathname.startsWith('/api/')) {
    if (request.method !== 'GET' && request.method !== 'HEAD') throw notFound();
    serveClient(response, url.pathname);
    return;
  }
  for (const route of routes) {
    const match = route.pattern.exec(url.pathname);
    if (!match || route.method !== request.method) continue;
    if (route.gradingOnly && !gradingKeyMatches(request)) throw notFound();
    if (!databaseReady() && !route.beforeDatabase) throw starting();
    const input = { request, params: match.slice(1).map(decoded), query: url.searchParams, body };
    let reply;
    if (route.open) reply = await route.handler(input);
    else {
      const user = await userOf(request);
      if (!user) throw signInRequired();
      reply = await route.handler({ ...input, user });
    }
    respond(response, reply.status, reply.body, reply.headers);
    return;
  }
  throw notFound();
}

const server = createServer((request, response) => {
  handle(request, response).catch((error: unknown) => {
    const answer = answerFor(error);
    respond(response, answer.status, answer.body, answer.headers);
  });
});

const sockets = new WebSocketServer({ noServer: true, maxPayload: BODY_LIMIT });

function refuseUpgrade(socket: Duplex): void {
  socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
}

/** Live connections: same origin only, and only for someone who could read the same layout. */
server.on('upgrade', (request, socket, head) => {
  void (async () => {
    const url = new URL(request.url ?? '/', 'http://app');
    const origin = request.headers.origin;
    if ((origin && new URL(origin).host !== request.headers.host) || !databaseReady() || /%00/.test(url.pathname)) return refuseUpgrade(socket);
    const editing = /^\/api\/layouts\/([^/]+)\/live$/.exec(url.pathname);
    const viewing = /^\/api\/view\/([^/]+)\/live$/.exec(url.pathname);
    let layoutId: string | undefined;
    let username: string | null = null;
    if (editing) {
      const user = await userOf(request);
      const access = user && (await accessFor(user, editing[1]));
      layoutId = access ? access.layout.id : undefined;
      username = user ? user.username : null;
    } else if (viewing) layoutId = (await layoutByViewToken(viewing[1]))?.id;
    if (!layoutId) return refuseUpgrade(socket);
    const editor = url.searchParams.get('editor');
    const joined = layoutId;
    sockets.handleUpgrade(request, socket, head, (ws) => void attach(ws, joined, username, editor && editor.slice(0, 64)));
  })().catch((error: unknown) => {
    console.error(error);
    refuseUpgrade(socket);
  });
});

server.listen(config.port, '0.0.0.0', () => console.log(`Mullion listening on ${config.port}`));
runLiveLoops();
void bootDatabase();
