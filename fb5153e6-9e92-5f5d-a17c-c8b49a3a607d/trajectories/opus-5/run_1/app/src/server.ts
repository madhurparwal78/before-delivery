import { createServer } from 'node:http';
import { config } from './config.js';
import { handleRequest, route } from './http/app.js';
import { json } from './http/router.js';
import { registerStaticRoutes } from './http/static.js';
import { registerApiRoutes } from './api/index.js';
import { registerPageRoutes } from './pages/routes.js';
import { startBootstrap } from './bootstrap.js';
import { startHealthMonitor } from './services/health.js';
import { startQueueWorker } from './queue/worker.js';

route({
  method: 'GET',
  pattern: '/api/health',
  surface: 'api',
  body: 'none',
  handler: async () => json(200, { status: 'ok' }),
});

registerStaticRoutes();
registerApiRoutes();
registerPageRoutes();

const server = createServer((req, res) => {
  void handleRequest(req, res);
});

server.headersTimeout = 60_000;
server.requestTimeout = 300_000;

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`Turnstone Studio listening on 0.0.0.0:${config.port}\n`);
  startBootstrap();
  startHealthMonitor();
  startQueueWorker();
});
