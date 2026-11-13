import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { registerAccountRoutes } from './accounts.js';
import { sessionFor } from './auth.js';
import { registerBlobRoutes, removeDiscardedObjects } from './blobs.js';
import { registerBlockRoutes } from './blocks.js';
import { config } from './config.js';
import { registerConversationRoutes } from './conversations.js';
import { connectAndMigrate, pool } from './db.js';
import { applyReturns } from './events.js';
import { registerGradingRoutes } from './grading.js';
import { attach, pingAll } from './hub.js';
import {
  ApiError,
  JSON_LIMIT,
  findRoute,
  hasJsonContentType,
  isStateChanging,
  notFound,
  open,
  readBody,
  sameOrigin,
  sendError,
  sendReply,
  unauthenticated,
  type AuthedContext,
  type OpenContext,
  type Outcome,
} from './http.js';
import { registerLetterRoutes } from './letters.js';
import { ensureBucket, reachable } from './s3.js';
import { serveClient } from './static.js';

const SWEEP_MS = 5000;
const PING_MS = 30_000;

function registerRoutes(): void {
  open('GET', '/api/health', async () => ({ status: 200, body: { status: (await reachable()) ? 'ok' : 'unavailable' } }));
  open('GET', '/api/config', async () => ({
    status: 200,
    body: { attachment_max_bytes: config.attachmentMaxBytes, timers: config.timers, grading: config.grading },
  }));
  registerAccountRoutes();
  registerConversationRoutes();
  registerLetterRoutes();
  registerBlobRoutes();
  registerBlockRoutes();
  registerGradingRoutes();
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? 'GET';
  const found = findRoute(method, url.pathname);
  if (!found) throw notFound();
  const { route, params } = found;
  let body: Buffer = Buffer.alloc(0);
  if (isStateChanging(method)) {
    if (!route.raw) {
      body = await readBody(req, JSON_LIMIT);
      if (body.length > 0 && !hasJsonContentType(req)) throw new ApiError(415, 'unsupported_media_type');
    }
    if (!sameOrigin(req)) throw new ApiError(403, 'cross_origin');
  }
  const context: OpenContext = { req, res, params, query: url.searchParams, body };
  let outcome: Outcome;
  if (route.auth) {
    const session = await sessionFor(pool, req);
    if (!session) throw unauthenticated();
    const signedIn: AuthedContext = { ...context, account: session.account, sessionHash: session.hash };
    outcome = await route.handler(signedIn);
  } else {
    outcome = await route.handler(context);
  }
  if (outcome !== 'handled') sendReply(res, outcome);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://exchange.invalid');
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else serveClient(req, res, url.pathname);
  } catch (error) {
    if (error instanceof ApiError) sendError(res, error);
    else {
      console.error('request failed:', error instanceof Error ? error.message : 'unknown error');
      sendError(res, new ApiError(500, 'internal_error'));
    }
  }
}

const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 });

async function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://exchange.invalid');
  const refuse = (error: ApiError): void => {
    const response = new http.ServerResponse(req);
    response.assignSocket(socket as never);
    response.on('finish', () => socket.destroy());
    sendError(response, error);
  };
  if (url.pathname !== '/ws') return refuse(notFound());
  if (!sameOrigin(req)) return refuse(new ApiError(403, 'cross_origin'));
  const session = await sessionFor(pool, req);
  if (!session) return refuse(unauthenticated());
  sockets.handleUpgrade(req, socket, head, (client) => {
    (client as typeof client & { alive?: boolean }).alive = true;
    client.on('pong', () => {
      (client as typeof client & { alive?: boolean }).alive = true;
    });
    attach(session.account.id, client, session.hash);
  });
}

async function main(): Promise<void> {
  registerRoutes();
  await connectAndMigrate();
  ensureBucket().catch(() => undefined);
  const server = http.createServer((req, res) => void handle(req, res));
  server.on('upgrade', (req, socket, head) => {
    upgrade(req, socket, head).catch(() => socket.destroy());
  });
  server.listen(config.port, '0.0.0.0');
  setInterval(() => {
    applyReturns()
      .then(() => removeDiscardedObjects(pool))
      .catch(() => undefined);
  }, SWEEP_MS).unref();
  setInterval(pingAll, PING_MS).unref();
}

process.on('unhandledRejection', (reason) => {
  console.error('unhandled rejection:', reason instanceof Error ? reason.message : 'unknown reason');
});

main().catch((error: unknown) => {
  console.error('the exchange could not start:', error instanceof Error ? error.message : 'unknown error');
  process.exit(1);
});

