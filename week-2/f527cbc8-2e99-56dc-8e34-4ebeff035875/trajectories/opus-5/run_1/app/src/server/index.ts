import { createServer } from 'node:http';
import { config } from './config.js';
import { pool, withTransaction } from './db.js';
import { migrate } from './migrate.js';
import { seedIfEmpty } from './seed.js';
import { handleRequest, startDraining, whenIdle } from './http.js';
import { installStatic } from './static.js';
import { log } from './log.js';
import { ensureBucket } from './services/storage.js';
import { registerRoutes } from './routes/index.js';
import { startWorkers, stopWorkers, releaseClaims } from './jobs/runner.js';
import { closeAllStreams } from './routes/streams.js';
import { releaseUnattemptedClaims } from './services/mail.js';

async function boot(): Promise<void> {
  await migrate();
  // The bucket and the seed are safe when several instances start at once.
  await ensureBucket().catch((error: unknown) => {
    log.error('bucket_unavailable_at_boot', { detail: String(error) });
  });
  await seedIfEmpty();

  registerRoutes();
  installStatic();

  const server = createServer((req, res) => {
    void handleRequest(req, res);
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;

  server.listen(config.port, '0.0.0.0', () => {
    log.event({ event: 'listening', port: config.port, instance: config.instanceLabel });
  });

  startWorkers();

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    // At once readiness answers draining and every other new request writes nothing.
    startDraining();
    const exitTimer = setTimeout(() => {
      log.event({ event: 'shutdown_forced' });
      process.exit(0);
    }, config.shutdownGraceSeconds * 1000);
    exitTimer.unref();

    const startedDrainingAt = Date.now();
    // The listener stays open so that new requests are refused with the draining 503
    // rather than meeting a closed socket.
    closeAllStreams();
    await whenIdle();
    await stopWorkers();
    await withTransaction(async (db) => {
      // Unstarted job claims go back to the queue and unattempted emails are released.
      await releaseClaims(db);
      await releaseUnattemptedClaims(db);
    }).catch((error: unknown) => log.error('drain_release_failed', { detail: String(error) }));

    const drainWindowMs = Math.max(1000, (config.shutdownGraceSeconds - 2) * 1000);
    const remaining = drainWindowMs - (Date.now() - startedDrainingAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));

    server.close();
    await pool.end().catch(() => undefined);
    clearTimeout(exitTimer);
    log.event({ event: 'shutdown_complete' });
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

process.on('unhandledRejection', (reason) => {
  log.error('unhandled_rejection', { detail: String(reason) });
});

boot().catch((error: unknown) => {
  log.error('boot_failed', { detail: String(error instanceof Error ? error.stack : error) });
  process.exit(1);
});

