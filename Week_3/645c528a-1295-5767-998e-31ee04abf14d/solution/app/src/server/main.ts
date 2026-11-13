import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Duplex } from 'node:stream';
import { registerAuthRoutes, sessionFromRequest } from './auth';
import { registerClubRoutes } from './clubs';
import { config } from './config';
import { storeReachable, storeReady } from './db';
import { announcePresence, registerFriendRoutes } from './friends';
import { registerGradingRoutes } from './grading';
import { assertSameOrigin, handleApi } from './http';
import { killbillReachable } from './killbill';
import { retryOutbox, smtpReachable } from './mail';
import { leaveQueueOnDisconnect, registerQueueRoutes, sweepQueue } from './matchmaking';
import { acceptUpgrade, setLiveHooks, type LiveClient } from './realtime';
import { registerShopRoutes } from './shop';
import { registerTableRoutes, restoreRooms, tickRooms, unwatchTable, watchTable } from './tables';
import { registerTournamentRoutes, tickTournaments } from './tournaments';
import { registerWalletRoutes } from './wallet';

const PUBLIC_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const SHELL = join(PUBLIC_ROOT, 'index.html');
const ROOM_TICK_MS = 500;
const SLOW_TICK_MS = 1000;
const HEALTH_REFRESH_MS = 3000;
const MAIL_RETRY_MS = 30_000;
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

let healthStatus: 'ok' | 'unavailable' = 'unavailable';

async function refreshHealth(): Promise<void> {
  const checks = await Promise.all([storeReachable(), killbillReachable(), smtpReachable()]);
  healthStatus = checks.every(Boolean) ? 'ok' : 'unavailable';
}

function sendFile(response: ServerResponse, path: string, cache: string): void {
  response.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream', 'Cache-Control': cache });
  createReadStream(path).pipe(response);
}

function notFoundFile(response: ServerResponse): void {
  response.writeHead(404, { 'Content-Type': 'text/plain' });
  response.end('Not found');
}

function serveStatic(response: ServerResponse, pathname: string): void {
  if (!URL.canParse(`http://localhost${pathname}`) || pathname.includes('%')) {
    notFoundFile(response);
    return;
  }
  const safe = normalize(pathname);
  const file = join(PUBLIC_ROOT, safe);
  if (file.startsWith(PUBLIC_ROOT + sep) && existsSync(file) && statSync(file).isFile()) {
    sendFile(response, file, safe.startsWith('/fonts/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    return;
  }
  if (extname(safe) !== '' || safe.split(sep).some((part) => part.startsWith('.'))) {
    notFoundFile(response);
    return;
  }
  sendFile(response, SHELL, 'no-cache');
}

function handleRequest(request: IncomingMessage, response: ServerResponse): void {
  if (!URL.canParse(request.url ?? '/', 'http://localhost')) {
    notFoundFile(response);
    return;
  }
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/health') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ status: healthStatus }));
    return;
  }
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    void handleApi(request, response, url);
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(404);
    response.end();
    return;
  }
  serveStatic(response, url.pathname);
}

async function handleUpgrade(request: IncomingMessage, stream: Duplex, head: Buffer): Promise<void> {
  try {
    assertSameOrigin(request.headers);
    const session = request.url === '/live' ? await sessionFromRequest(request) : null;
    if (session === null) stream.destroy();
    else acceptUpgrade(request, stream, head, session);
  } catch {
    stream.destroy();
  }
}

function withTopic(topic: string, tableAction: (client: LiveClient, id: string) => void, client: LiveClient): void {
  if (topic.startsWith('table:')) tableAction(client, topic.slice('table:'.length));
}

function everyInterval(work: () => unknown, milliseconds: number): void {
  setInterval(() => {
    Promise.resolve().then(work).catch(() => undefined);
  }, milliseconds);
}

registerAuthRoutes();
registerWalletRoutes();
registerQueueRoutes();
registerTableRoutes();
registerShopRoutes();
registerFriendRoutes();
registerClubRoutes();
registerTournamentRoutes();
registerGradingRoutes();

setLiveHooks({
  watch: (client, topic) => withTopic(topic, watchTable, client),
  unwatch: (client, topic) => withTopic(topic, unwatchTable, client),
  presence: (playerId, online) => {
    if (!online) leaveQueueOnDisconnect(playerId);
    void announcePresence(playerId).catch(() => undefined);
  },
});

const server = createServer(handleRequest);
server.on('upgrade', (request, stream, head) => void handleUpgrade(request, stream, head));
server.listen(config.port, '0.0.0.0', () => {
  console.log(`Headstring listening on ${config.port}`);
  void storeReady().then(restoreRooms).catch(() => undefined);
  void refreshHealth();
  everyInterval(refreshHealth, HEALTH_REFRESH_MS);
  everyInterval(tickRooms, ROOM_TICK_MS);
  everyInterval(sweepQueue, ROOM_TICK_MS);
  everyInterval(tickTournaments, SLOW_TICK_MS);
  everyInterval(retryOutbox, MAIL_RETRY_MS);
});
