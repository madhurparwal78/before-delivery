import { config } from './config.js';
import { db, prepareDatabase } from './db.js';
import { recoverRuns } from './engine.js';
import { keepAlive } from './events.js';
import { createApp, type Route } from './http.js';
import { mailReachable } from './mailer.js';
import { authRoutes } from './routes/auth.js';
import { automationRoutes } from './routes/automations.js';
import { eventRoutes } from './routes/events.js';
import { gradingRoutes } from './routes/grading.js';
import { publicRoutes } from './routes/public.js';
import { runRoutes } from './routes/runs.js';
import { workspaceRoutes } from './routes/workspace.js';
import { seedIfAbsent } from './seed.js';
import { storageReachable } from './storage.js';
import { startTicker } from './timers.js';

const KEEPALIVE_MS = 15_000;

const health: Route = {
  method: 'GET', path: '/api/health', auth: 'public',
  async handle() {
    const [storage, mail] = await Promise.all([storageReachable(), mailReachable()]);
    return { status: 200, body: { status: storage && mail ? 'ok' : 'unavailable' } };
  },
};

async function main(): Promise<void> {
  await prepareDatabase();
  await seedIfAbsent();
  const server = createApp([health, ...authRoutes, ...workspaceRoutes, ...automationRoutes, ...runRoutes, ...eventRoutes, ...publicRoutes, ...gradingRoutes]);
  server.keepAliveTimeout = 65_000;
  server.listen(config.port, '0.0.0.0');
  const ticker = startTicker();
  const keepalive = setInterval(keepAlive, KEEPALIVE_MS);
  await recoverRuns();
  const stop = (): void => {
    clearInterval(ticker);
    clearInterval(keepalive);
    server.closeAllConnections();
    server.close(() => {
      void db.close().finally(() => process.exit(0));
    });
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
