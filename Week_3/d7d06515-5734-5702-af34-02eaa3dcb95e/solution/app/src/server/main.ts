// Entry point: one process serves the API and the built frontend, and starts even when a provider is unreachable.
import { createServer } from 'node:http';
import { registerAccountRoutes } from './accounts.ts';
import { config } from './config.ts';
import { pool } from './db.ts';
import { registerDrawingRoutes } from './drawings.ts';
import { registerEventRoutes, startEvents, stopEvents } from './events.ts';
import { registerExportRoutes } from './exports.ts';
import { registerFileRoutes } from './files.ts';
import { registerGradingRoutes } from './grading.ts';
import { handleApi } from './http.ts';
import { registerHealthRoute, startProviders, stopProviders } from './providers.ts';
import { registerShareRoutes } from './shares.ts';
import { serveStatic } from './static.ts';
import { registerTraceRoutes } from './traces.ts';
import { registerUploadRoutes } from './uploads.ts';
import { closeValkey } from './valkey.ts';

registerHealthRoute();
registerGradingRoutes();
registerAccountRoutes();
registerFileRoutes();
registerDrawingRoutes();
registerUploadRoutes();
registerShareRoutes();
registerTraceRoutes();
registerExportRoutes();
registerEventRoutes();

const server = createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) void handleApi(req, res, url);
  else void serveStatic(req, res, url.pathname);
});

// Event streams stay open for as long as the tab does.
server.requestTimeout = 0;
server.headersTimeout = 20000;

process.on('unhandledRejection', (reason) => {
  process.stdout.write(`unhandled rejection: ${reason instanceof Error ? reason.message : 'unknown'}\n`);
});

function shutdown(): void {
  stopProviders();
  stopEvents();
  server.close(() => {
    void pool.end().finally(() => {
      closeValkey();
      process.exit(0);
    });
  });
  server.closeAllConnections();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

startProviders();
startEvents();
server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`corbel-draft listening on ${config.port}\n`);
});
