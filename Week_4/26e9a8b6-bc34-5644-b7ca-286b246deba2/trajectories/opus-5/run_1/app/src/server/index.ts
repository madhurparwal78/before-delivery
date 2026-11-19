import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from './config.js';
import { applySchema, waitForPostgres } from './db/index.js';
import { ApiError } from './http/errors.js';
import { Router } from './http/router.js';
import { sendHtml, sendJson } from './http/respond.js';
import { attachLive } from './live.js';
import { accountRoutes } from './routes/accounts.js';
import { assetRoutes } from './routes/assets.js';
import { discoveryRoutes } from './routes/discovery.js';
import { guideRoutes } from './routes/guides.js';
import { versionRoutes } from './routes/versions.js';
import { isPagePath, pageRoutes, renderNotFoundHtml } from './routes/pages.js';
import { createWorld } from './grading.js';
import { ensureBucket, StorageUnreachable } from './storage/s3.js';
import { storageIsAnsweringNow } from './storage/health.js';
import { startSeedWhenStorageAnswers } from './seed.js';

const router = new Router();
router.addAll(accountRoutes);
router.addAll(guideRoutes);
router.addAll(versionRoutes);
router.addAll(discoveryRoutes);
router.addAll(assetRoutes);
router.addAll(pageRoutes);

if (config.gradingRoutes) {
  router.add({
    method: 'POST',
    path: '/api/grading/world',
    body: 'json',
    handle: async (exchange) => {
      try {
        sendJson(exchange.res, exchange.isEmbed, 201, await createWorld());
      } catch (error) {
        if (error instanceof StorageUnreachable) {
          throw new ApiError(503, { error: 'storage_unavailable' });
        }
        throw error;
      }
    },
  });
}

function reportFailure(res: ServerResponse, url: URL, error: unknown): void {
  const isEmbed = url.pathname === '/embed' || url.pathname.startsWith('/embed/');
  const failure =
    error instanceof ApiError ? error : new ApiError(500, { error: 'server_error' });
  if (failure.status === 500) process.stderr.write(`${String(error)}\n`);
  if (failure.status === 404 && isPagePath(url.pathname)) {
    sendHtml(res, isEmbed, 404, renderNotFoundHtml(), failure.headers);
    return;
  }
  sendJson(res, isEmbed, failure.status, failure.body, failure.headers);
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
  router
    .run(req, res, url, config.limits.model_max_bytes)
    .catch((error: unknown) => reportFailure(res, url, error));
});

attachLive(server);

async function boot(): Promise<void> {
  await waitForPostgres();
  await applySchema();
  try {
    await ensureBucket();
  } catch (error) {
    if (!(error instanceof StorageUnreachable)) throw error;
  }
  /* Primes the cached storage state so the first page render knows the truth. */
  await storageIsAnsweringNow();
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Pennywasher listening on ${config.port}\n`);
  });
  startSeedWhenStorageAnswers();
}

void boot();
