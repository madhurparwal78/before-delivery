import { config } from './config';
import { applySchema } from './db';
import { createApp, router } from './http/app';
import { registerCheckinRoutes } from './routes/checkin';
import { registerCloseRoutes } from './routes/close';
import { registerDeskRoutes } from './routes/desk';
import { registerFolioRoutes } from './routes/folios';
import { registerGuestRoutes } from './routes/guests';
import { registerHousekeepingRoutes } from './routes/housekeeping';
import { registerRateRoutes } from './routes/rates';
import { registerSessionRoutes } from './routes/session';
import { registerStayRoutes } from './routes/stays';
import { registerSystemRoutes } from './routes/system';
import { applySeed } from './seed';
import { ensureBucket } from './services/fileStore';
import { startListening } from './services/live';

registerSystemRoutes(router);
registerSessionRoutes(router);
registerDeskRoutes(router);
registerHousekeepingRoutes(router);
registerStayRoutes(router);
registerFolioRoutes(router);
registerCloseRoutes(router);
registerRateRoutes(router);
registerGuestRoutes(router);
registerCheckinRoutes(router);

async function start(): Promise<void> {
  await applySchema();
  await applySeed();
  await startListening();
  ensureBucket().catch(() => undefined);

  const server = createApp();
  server.listen(config.appPublicPort, '0.0.0.0', () => {
    process.stdout.write(`nightroll listening on 0.0.0.0:${config.appPublicPort}\n`);
  });
}

start().catch((error: unknown) => {
  process.stderr.write(`failed to start: ${String(error)}\n`);
  process.exit(1);
});
