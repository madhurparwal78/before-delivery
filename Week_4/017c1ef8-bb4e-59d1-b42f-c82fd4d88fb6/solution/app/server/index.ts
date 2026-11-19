import { buildApp } from './app.js';
import { initClock } from './clock.js';
import { config } from './config.js';
import { migrate, pool, waitForDatabase } from './db.js';
import { startMailWorker } from './mail.js';
import { startTicks } from './tick.js';
import { authRoutes } from './routes/auth.js';
import { liveRoutes, systemRoutes } from './routes/system.js';
import { memberRouteModules, publicRouteModules, prepare } from './modules.js';

async function main(): Promise<void> {
  await waitForDatabase();
  await migrate();
  await initClock(pool);
  await prepare();
  startMailWorker();
  startTicks();
  const app = await buildApp([systemRoutes, authRoutes, ...publicRouteModules], [liveRoutes, ...memberRouteModules]);
  await app.listen({ host: '0.0.0.0', port: config.port });
}

main().catch((error: unknown) => {
  console.error('startup failed', error);
  process.exit(1);
});
