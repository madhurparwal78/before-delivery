import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { createSchema } from './db.js';
import { errors, isCrossSite, sendError, sendJson } from './http.js';
import { Router } from './router.js';
import { openSession, viewerFromRequest } from './access.js';
import { bus } from './valkey.js';
import { store } from './storage.js';
import { addClient, removeClient, startBusRelay, type LiveClient } from './hub.js';
import { snapshotFor } from './livestate.js';
import { startDueTicker } from './sessionflow.js';
import { isAsset, isPagePath, serveAsset, servePage } from './static.js';
import { accountRoutes } from './routes/accounts.js';
import { classRoutes } from './routes/classes.js';
import { lessonRoutes } from './routes/lessons.js';
import { sessionRoutes } from './routes/sessions.js';
import { pollRoutes } from './routes/polls.js';
import { reportRoutes } from './routes/reports.js';
import { gradingRoutes } from './routes/grading.js';

const router = new Router();
accountRoutes(router);
classRoutes(router);
lessonRoutes(router);
sessionRoutes(router);
pollRoutes(router);
reportRoutes(router);
gradingRoutes(router);

let storeHealth = { checked: 0, available: true };

async function storeAvailable(): Promise<boolean> {
  const now = Date.now();
  if (now - storeHealth.checked < 1_000) return storeHealth.available;
  const available = await store.available();
  storeHealth = { checked: now, available };
  return available;
}

function gradingAllowed(req: IncomingMessage): boolean {
  if (config.gradingKey === null) return false;
  return req.headers['x-grading-key'] === config.gradingKey;
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;
    try {
      if (isCrossSite(req, false)) throw errors.crossSite();
      if (path === '/api/health') {
        const ok = bus.available() && (await storeAvailable());
        sendJson(res, 200, { status: ok ? 'ok' : 'unavailable' });
        return;
      }
      if (path.startsWith('/api/grading/') && !gradingAllowed(req)) throw errors.notFound();
      const match = router.match(req.method ?? 'GET', path);
      if (match !== null) {
        const viewer = path.startsWith('/api/grading/') ? null : await viewerFromRequest(req);
        await match.handler({ req, res, url, params: match.params, viewer });
        return;
      }
      if (path.startsWith('/api/') || path.startsWith('/ws/')) throw errors.notFound();
      if (isAsset(path)) {
        await serveAsset(res, path);
        return;
      }
      if (path.includes('.') || path.startsWith('/src/') || path.startsWith('/node_modules/')) {
        throw errors.notFound();
      }
      await servePage(res, isPagePath(path) ? 200 : 404);
    } catch (error) {
      sendError(res, error);
    }
  })();
});

const sockets = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const match = /^\/ws\/sessions\/([^/]+)$/.exec(url.pathname);
    const refuse = (status: number, text: string): void => {
      const body = JSON.stringify({ error: text });
      socket.end(
        `HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : 'Not Found'}\r\n` +
          'content-type: application/json\r\n' +
          `content-length: ${Buffer.byteLength(body)}\r\n` +
          `x-slatehall-instance: ${config.instanceName}\r\n` +
          'connection: close\r\n\r\n' +
          body
      );
    };
    if (isCrossSite(req, true)) {
      refuse(403, 'Cross-site requests are refused.');
      return;
    }
    if (match === null) {
      refuse(404, 'Not found.');
      return;
    }
    const sessionId = match[1] as string;
    try {
      const viewer = await viewerFromRequest(req);
      if (viewer === null) {
        refuse(404, 'Not found.');
        return;
      }
      const { session, cls, role } = await openSession(viewer, sessionId);
      sockets.handleUpgrade(req, socket, head, (socketConnection) => {
        const client: LiveClient = {
          socket: socketConnection,
          sessionId,
          role,
          learnerId: role === 'learner' ? viewer.id : null,
          connectionId: null
        };
        void (async () => {
          await addClient(client);
          const snapshot = await snapshotFor(session, cls, { role, learnerId: client.learnerId });
          socketConnection.send(JSON.stringify({ event: 'snapshot', snapshot }));
        })();
        socketConnection.on('close', () => {
          void removeClient(client);
        });
        socketConnection.on('error', () => {
          void removeClient(client);
        });
      });
    } catch {
      refuse(404, 'Not found.');
    }
  })();
});

async function boot(): Promise<void> {
  await createSchema();
  bus.start();
  startBusRelay();
  startDueTicker();
  await store.ensureBucket().catch(() => undefined);
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`slatehall instance ${config.instanceName} listening on ${config.port}\n`);
  });
}

void boot();
