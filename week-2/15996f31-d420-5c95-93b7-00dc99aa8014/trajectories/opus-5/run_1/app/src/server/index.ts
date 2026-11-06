import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from './config';
import { applySchemaAndSeed } from './data/seed';
import { actorForSession } from './data/users';
import { pool } from './db';
import { apiError } from './http/errors';
import {
  SESSION_COOKIE,
  compileRoutes,
  isCrossOriginWrite,
  matchRoute,
  readBody,
  readCookie,
  sendReply,
  toApiError,
  type Actor,
} from './http/router';
import { markDatabaseReady } from './readiness';
import { dropRoutes } from './routes/drops';
import { fileRoutes } from './routes/files';
import { inspectRoutes } from './routes/inspect';
import { orchardRoutes } from './routes/orchards';
import { orderRoutes } from './routes/orders';
import { sessionRoutes } from './routes/session';
import { serveStatic } from './static';
import { ensureStorageBucket, reconcileSeededBilling } from './workers/billing-reconcile';
import { pumpOutbox } from './workers/outbox';
import { pumpQueuedSettlements } from './workers/settlements';

const WORKER_INTERVAL_MS = 10_000;
const DATABASE_RETRY_MS = 2_000;

const routes = compileRoutes([
  ...sessionRoutes,
  ...orchardRoutes,
  ...orderRoutes,
  ...dropRoutes,
  ...inspectRoutes,
  ...fileRoutes,
]);

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  try {
    if (isCrossOriginWrite(method, request.headers)) throw apiError.crossOrigin();
    const matched = matchRoute(routes, method, url.pathname);
    if (matched === null) {
      if (method === 'GET' && !url.pathname.startsWith('/api/')) {
        const asset = await serveStatic(url.pathname);
        if (asset !== null) {
          sendReply(response, asset);
          return;
        }
      }
      throw apiError.notFound();
    }
    const body = await readBody(request, matched.route.body);
    let actor: Actor | null = null;
    if (matched.route.auth === 'session') {
      const sessionId = readCookie(request.headers, SESSION_COOKIE);
      actor = sessionId === null ? null : await actorForSession(pool, sessionId);
      if (actor === null) throw apiError.unauthenticated();
    }
    const reply = await matched.route.handle({
      url,
      params: matched.params,
      headers: request.headers,
      body,
      actor,
    });
    sendReply(response, reply);
  } catch (error) {
    const failure = toApiError(error);
    sendReply(response, { status: failure.status, json: failure.body() });
  }
}

const server = createServer((request, response) => {
  void handle(request, response);
});

async function connectDatabase(): Promise<void> {
  for (;;) {
    try {
      await applySchemaAndSeed();
      markDatabaseReady();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, DATABASE_RETRY_MS));
    }
  }
}

function startWorkers(): void {
  const tick = (): void => {
    void pumpOutbox();
    void pumpQueuedSettlements();
    void reconcileSeededBilling();
    void ensureStorageBucket();
  };
  tick();
  setInterval(tick, WORKER_INTERVAL_MS).unref();
}

server.listen(config.port, '0.0.0.0', () => {
  void connectDatabase().then(startWorkers);
});
