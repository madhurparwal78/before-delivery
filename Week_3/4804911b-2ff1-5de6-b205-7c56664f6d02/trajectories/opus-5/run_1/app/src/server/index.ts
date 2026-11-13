import { config } from './config.js';
import { ping } from './db/pool.js';
import { applySchemaAndSeed } from './db/seed.js';
import { setCopyId } from './identity.js';
import { registerEditorNoticeRoutes } from './http/editorNoticeRoutes.js';
import { registerEditorSheetRoutes } from './http/editorSheetRoutes.js';
import { registerPublicRoutes } from './http/publicRoutes.js';
import { registerSessionRoutes } from './http/sessionRoutes.js';
import { registerStaticFiles } from './http/staticFiles.js';
import { registerStockistRoutes } from './http/stockistRoutes.js';
import { registerTestRoutes } from './http/testRoutes.js';
import { startHttpServer } from './http/server.js';
import { startWork } from './services/workers.js';

process.on('unhandledRejection', () => undefined);
process.on('uncaughtException', () => undefined);

registerPublicRoutes();
registerSessionRoutes();
registerStockistRoutes();
registerEditorSheetRoutes();
registerEditorNoticeRoutes();
if (config.testClockEnabled) registerTestRoutes();
registerStaticFiles();

startHttpServer(config.port);

/** The server keeps listening and retrying while Postgres is away, and recovers on its own. */
async function boot(): Promise<void> {
  for (;;) {
    if (await ping()) {
      try {
        const copyId = await applySchemaAndSeed();
        setCopyId(copyId);
        await startWork(copyId);
        return;
      } catch {
        /* another try follows */
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

void boot();

setInterval(() => {
  void ping();
}, 5_000).unref();
