import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySchema, waitForDatabase } from './db.js';
import { settings } from './env.js';
import { startServer } from './http.js';
import { applyStartSeed } from './seed.js';
import { ensureBucket } from './storage.js';
import { registerAlertRoutes } from './routes/alerts.js';
import { registerGradingRoutes, runEveryLifecycleStep, runEveryRuleCheck } from './routes/grading.js';
import { registerMiscRoutes } from './routes/misc.js';
import { registerPipelineRoutes } from './routes/pipelines.js';
import { registerPlatformRoutes } from './routes/platform.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerStreamRoutes } from './routes/streams.js';

async function main(): Promise<void> {
  try {
    await waitForDatabase();
  } catch (cause) {
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exit(1);
  }
  await applySchema();
  await ensureBucket();
  await applyStartSeed();

  registerPlatformRoutes();
  registerStreamRoutes();
  registerSearchRoutes();
  registerPipelineRoutes();
  registerAlertRoutes();
  registerMiscRoutes();
  registerGradingRoutes();

  if (!settings.grading) {
    setInterval(() => {
      void runEveryRuleCheck();
    }, settings.checkIntervalMs);
    setInterval(() => {
      void runEveryLifecycleStep();
    }, settings.lifecycleIntervalMs);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  startServer(join(here, 'public'));
}

void main();
