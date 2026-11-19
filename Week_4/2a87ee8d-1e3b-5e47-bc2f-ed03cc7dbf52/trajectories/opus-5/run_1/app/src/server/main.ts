import { createServer } from 'node:http';
import { config } from './config.js';
import { applySchema } from './db/schema.js';
import { applySeed } from './db/seed.js';
import { waitForDatabase } from './db/pool.js';
import { AppError } from './errors.js';
import { assertSameOrigin, RequestContext } from './http/context.js';
import { sendError, sendJson, sendUnhandled } from './http/respond.js';
import { Router, serveClient } from './http/router.js';
import { startEventBus, startVersionPoll } from './board/events.js';
import { startHealthChecks } from './health.js';
import { startWorker } from './worker.js';
import { accountRoutes } from './routes/account.js';
import { workshopRoutes } from './routes/workshops.js';
import { joinRoutes } from './routes/join.js';
import { boardRoutes } from './routes/board.js';
import { recapRoutes } from './routes/recaps.js';
import { openStreamWorkshopIds } from './routes/stream.js';

const router = new Router();
router.addAll(accountRoutes);
router.addAll(workshopRoutes);
router.addAll(joinRoutes);
router.addAll(boardRoutes);
router.addAll(recapRoutes);

const server = createServer((req, res) => {
  const context = new RequestContext(req, res);
  void handle(context).catch((error: unknown) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (error instanceof AppError) sendError(context, error);
    else sendUnhandled(context, error);
  });
});

async function handle(context: RequestContext): Promise<void> {
  // Boundary checks come first: the server accepts same-origin requests only.
  assertSameOrigin(context);

  if (context.path.startsWith('/api/')) {
    const handled = await router.dispatch(context);
    if (!handled) sendJson(context, 404, { error: { code: 'not_found', message: 'Not found' } });
    return;
  }

  const served = await serveClient(context);
  if (!served) sendJson(context, 404, { error: { code: 'not_found', message: 'Not found' } });
}

async function start(): Promise<void> {
  // If Postgres is unreachable at boot, keep retrying and answer health checks once connected.
  await waitForDatabase();
  await applySchema();
  await applySeed();
  await startEventBus();
  // Storage, mail and billing may be unreachable at boot; the worker retries their setup.
  await startHealthChecks();
  startVersionPoll(openStreamWorkshopIds);
  startWorker();

  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Lanternfold Rooms instance ${config.instanceId} listening on ${config.port}\n`);
  });
}

void start();
