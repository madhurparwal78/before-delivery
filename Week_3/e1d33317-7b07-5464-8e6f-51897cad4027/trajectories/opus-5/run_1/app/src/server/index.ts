import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { applySchema } from './db/schema.js';
import { ping } from './db/pool.js';
import { seedIfMissing } from './db/seed.js';
import { HttpApp, listen } from './http/server.js';
import { hub } from './live/hub.js';
import { registerBankRoutes } from './routes/banks.js';
import { registerCollaboratorRoutes } from './routes/collaborators.js';
import { registerOpsRoutes } from './routes/ops.js';
import { registerPartRoutes } from './routes/parts.js';
import { registerScoreRoutes } from './routes/score.js';
import { ensureBucket } from './services/s3.js';
import { broadcast } from './services/valkey.js';
import { callerForSeatToken } from './store/collaborators.js';
import { retryPendingPdfs } from './store/parts.js';
import { loadScore } from './store/score.js';

const DATABASE_RETRY_MS = 3000;

function refuseUpgrade(socket: Duplex, status: number, code: string, message: string): void {
  const payload = JSON.stringify({ error: code, message });
  socket.write(
    `HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : 'Forbidden'}\r\n` +
      'content-type: application/json; charset=utf-8\r\n' +
      `content-length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`,
  );
  socket.destroy();
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined || origin === 'null') return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

async function prepareDatabase(): Promise<void> {
  for (;;) {
    if (await ping()) {
      await applySchema();
      await seedIfMissing();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, DATABASE_RETRY_MS));
  }
}

function start(): void {
  const app = new HttpApp();
  registerScoreRoutes(app);
  registerOpsRoutes(app);
  registerCollaboratorRoutes(app);
  registerPartRoutes(app);
  registerBankRoutes(app);

  const server = listen(app, config.port);
  const sockets = new WebSocketServer({ noServer: true });
  hub.start();
  broadcast.start();

  server.on('upgrade', (request, socket, head) => {
    void (async () => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      const match = /^\/api\/scores\/([^/]+)\/live$/.exec(url.pathname);
      if (!match) {
        socket.destroy();
        return;
      }
      if (!sameOrigin(request)) {
        refuseUpgrade(socket, 403, 'cross_origin', 'Requests must come from Fairline itself.');
        return;
      }
      const token = url.searchParams.get('token') ?? '';
      const caller = token === '' ? undefined : await callerForSeatToken(token);
      if (!caller || caller.score_id !== decodeURIComponent(match[1]!)) {
        refuseUpgrade(socket, 401, 'unauthorized', 'Open your seat link again.');
        return;
      }
      const state = await loadScore(caller.score_id);
      sockets.handleUpgrade(request, socket, head, (webSocket) => {
        void hub.add(webSocket, caller.score_id, caller, state.head.lamport, state.head.lastSeq);
      });
    })().catch(() => socket.destroy());
  });

  void prepareDatabase().then(() => ensureBucket().catch(() => undefined));
  let retrying = false;
  setInterval(() => {
    if (retrying) return;
    retrying = true;
    void retryPendingPdfs()
      .catch(() => undefined)
      .finally(() => {
        retrying = false;
      });
  }, config.pdfRetrySeconds * 1000).unref();
}

start();
