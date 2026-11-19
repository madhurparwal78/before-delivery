import http from 'node:http';
import { config } from './config.js';
import { applySchema, waitForDatabase } from './db.js';
import { crossOrigin, handleApiRequest, sendJson } from './http.js';
import { serveStatic } from './static.js';
import { handleUpgrade, watchSocketsForOutage } from './sockets.js';
import { startDueLoop } from './duework.js';
import { startSeedAttempts } from './seed.js';
import { startMailWorker } from './services/mail.js';
import { ensureBucket, watchStorage } from './services/storage.js';
import { watchValkeyState } from './services/valkey.js';

import './routes/accounts.js';
import './routes/friends.js';
import './routes/sessionRoutes.js';
import './routes/assetRoutes.js';
import './routes/reportRoutes.js';
import './routes/communityRoutes.js';
import './routes/grading.js';

const CROSS_ORIGIN_ERROR = 'Cross-origin requests are refused.';

async function start(): Promise<void> {
  await waitForDatabase();
  await applySchema();
  watchStorage();
  watchValkeyState();
  watchSocketsForOutage();
  startMailWorker();
  startDueLoop();
  void ensureBucket().catch(() => undefined);
  startSeedAttempts();

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      const method = req.method ?? 'GET';
      if (method !== 'GET' && method !== 'HEAD' && crossOrigin(req)) {
        sendJson(res, 403, { error: CROSS_ORIGIN_ERROR });
        return;
      }
      if (await handleApiRequest(req, res, url)) return;
      if (method !== 'GET' && method !== 'HEAD') {
        sendJson(res, 404, { error: 'Not found.' });
        return;
      }
      await serveStatic(res, url.pathname);
    })();
  });

  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      if (crossOrigin(req)) {
        socket.destroy();
        return;
      }
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
      await handleUpgrade(req, socket, head, url);
    })();
  });

  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`hearthtile instance ${config.instanceName} listening on 0.0.0.0:${config.port}\n`);
  });
}

void start();
