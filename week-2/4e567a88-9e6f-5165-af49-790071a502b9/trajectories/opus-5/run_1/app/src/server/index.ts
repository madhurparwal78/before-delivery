import { createServer } from 'node:http';
import { config } from './config';
import { fail } from './errors';
import { Router, send, sendError } from './http/router';
import { serveStatic } from './http/static';
import { registerAssetRoutes } from './routes/assets';
import { registerFinanceRoutes } from './routes/finance';
import { registerJobRoutes } from './routes/jobs';
import { registerPolicyRoutes } from './routes/policy';
import { registerSystemRoutes } from './routes/system';
import { registerWebhookRoutes } from './routes/webhooks';
import { applySchemaAndSeed } from './seed';
import { startDependencyProbes } from './services/deps';
import { ensureBucket } from './services/s3';
import { startDispatcher } from './workers/dispatcher';
import { startSweeper } from './workers/sweeper';
import { startTopupRetries } from './workers/topups';
import { startWebhookDelivery } from './workers/webhooks';

const router = new Router();
registerSystemRoutes(router);
registerJobRoutes(router);
registerAssetRoutes(router);
registerFinanceRoutes(router);
registerPolicyRoutes(router);
registerWebhookRoutes(router);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  if (path.startsWith('/api/')) {
    router
      .dispatch(req, path, url.searchParams)
      .then((reply) => send(res, reply))
      .catch((error: unknown) => sendError(res, error));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendError(res, fail.notFound());
    return;
  }
  serveStatic(path, res).catch((error: unknown) => sendError(res, error));
});

async function bootstrap(): Promise<void> {
  for (;;) {
    try {
      await applySchemaAndSeed();
      return;
    } catch (error) {
      console.error('waiting for Postgres before applying the schema and seed', String(error));
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

server.listen(config.port, '0.0.0.0', () => {
  console.log(`Lumenfold Dispatch listening on port ${config.port}`);
});

void (async () => {
  startDependencyProbes();
  await bootstrap();
  await ensureBucket();
  startDispatcher();
  startSweeper();
  startTopupRetries();
  startWebhookDelivery();
})();
