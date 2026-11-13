import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig } from './config.js';
import { applySchema, connect } from './db.js';
import { applySeed } from './seed.js';
import { Storage } from './services/storage.js';
import { Mailer } from './services/mail.js';
import { startErasureWorker } from './services/erasure.js';
import { createHttpServer } from './http/server.js';
import { Router, route, type CompiledRoute } from './http/router.js';
import { jsonResponse, type AppContext } from './http/context.js';
import { sessionRoutes } from './routes/session.js';
import { memberRoutes } from './routes/members.js';
import { railRoutes } from './routes/rail.js';
import { pieceRoutes } from './routes/pieces.js';
import { ladderRoutes } from './routes/ladders.js';
import { holdRoutes } from './routes/holds.js';
import { saleRoutes } from './routes/sales.js';
import { payoutRoutes } from './routes/payouts.js';
import { consignorRoutes } from './routes/consignors.js';
import { portalRoutes } from './routes/portal.js';
import { appointmentRoutes } from './routes/appointments.js';
import { importRoutes } from './routes/imports.js';

const healthRoute: CompiledRoute = route({
  method: 'GET',
  path: '/api/health',
  access: 'public',
  handle: async () => jsonResponse(200, { status: 'ok' }),
});

async function main(): Promise<void> {
  const config = readConfig();
  const db = await connect(config.databaseUrl);
  await applySchema(db);

  const app: AppContext = {
    config,
    db,
    storage: new Storage(config.s3),
    mailer: new Mailer(config),
    now: () => Date.now(),
  };

  await applySeed(db, app.now());
  // MinIO may be unreachable at boot: the app starts and serves anyway.
  await app.storage.ensureBucket().catch((error: unknown) => {
    console.warn('MinIO is not reachable at boot', (error as Error).message);
  });

  startErasureWorker(app);

  const router = new Router([
    healthRoute,
    ...sessionRoutes,
    ...memberRoutes,
    ...railRoutes,
    ...pieceRoutes,
    ...ladderRoutes,
    ...holdRoutes,
    ...saleRoutes,
    ...payoutRoutes,
    ...consignorRoutes,
    ...portalRoutes,
    ...appointmentRoutes,
    ...importRoutes,
  ]);

  const publicDir = join(dirname(fileURLToPath(import.meta.url)), 'public');
  const server = createHttpServer(app, router, publicDir);
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Ourlet Consignment Desk is serving on 0.0.0.0:${config.port}`);
  });
}

await main();
