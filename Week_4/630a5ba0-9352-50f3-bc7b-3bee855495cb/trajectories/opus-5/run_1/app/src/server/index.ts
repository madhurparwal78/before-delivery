import { config } from './config.js';
import { applySchema } from './db/pool.js';
import { applySeed } from './db/seed.js';
import { Router } from './http/router.js';
import { startHttpServer } from './http/server.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerBillingRoutes } from './routes/billing.js';
import { registerCalendarRoutes } from './routes/calendar.js';
import { registerImportRoutes } from './routes/imports.js';
import { registerOpsRoutes } from './routes/ops.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerShutdownRoutes } from './routes/shutdown.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { registerWorkspaceRoutes } from './routes/workspace.js';
import { startOutboxWorker } from './services/outbox.js';
import { startTrialSweep } from './services/workspaces.js';

function buildRouter(): Router {
  const router = new Router();
  router.get('/api/health', () => ({ status: 'ok' }));
  registerAuthRoutes(router);
  registerTaskRoutes(router);
  registerSessionRoutes(router);
  registerCalendarRoutes(router);
  registerImportRoutes(router);
  registerShutdownRoutes(router);
  registerWorkspaceRoutes(router);
  registerBillingRoutes(router);
  registerOpsRoutes(router);
  return router;
}

const SCHEMA_RETRY_MS = 2000;
const SCHEMA_DEADLINE_MS = 60_000;

/** The database may still be starting when the app does, so give it a bounded wait. */
async function applySchemaWhenReachable(): Promise<void> {
  const deadline = Date.now() + SCHEMA_DEADLINE_MS;
  for (;;) {
    try {
      await applySchema();
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, SCHEMA_RETRY_MS));
    }
  }
}

async function main(): Promise<void> {
  await applySchemaWhenReachable();
  await applySeed();
  startHttpServer(buildRouter(), config.port);
  startOutboxWorker();
  startTrialSweep();
  process.stdout.write(`Tidemark Daybook listening on port ${config.port}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`startup failed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
