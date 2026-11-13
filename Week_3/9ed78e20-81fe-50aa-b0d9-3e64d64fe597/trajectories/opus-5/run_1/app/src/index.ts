import { config } from './config.js';
import { applySchema, waitForDatabase } from './db/pool.js';
import { applySeed, ensureSampleObjects } from './db/seed.js';
import { registerCandidateApi } from './http/api/candidate.js';
import { registerConsoleAuditApi } from './http/api/console/audit.js';
import { registerConsoleCareersApi } from './http/api/console/careers.js';
import { registerConsoleContentApi } from './http/api/console/content.js';
import { registerConsoleGrantsApi } from './http/api/console/grants.js';
import { registerConsoleJobsApi } from './http/api/console/jobs.js';
import { registerConsoleSessionApi } from './http/api/console/session.js';
import { registerPublicApi } from './http/api/public.js';
import { registerPages } from './http/pages/index.js';
import { createServer } from './http/server.js';
import { startJobWorker } from './services/jobs.js';
import { runProbes, startProbeLoop } from './services/probes.js';
import { startScheduler } from './services/scheduler.js';

async function main(): Promise<void> {
  await waitForDatabase();
  await applySchema();
  await applySeed();
  await runProbes();

  registerPublicApi();
  registerCandidateApi();
  registerConsoleSessionApi();
  registerConsoleContentApi();
  registerConsoleCareersApi();
  registerConsoleGrantsApi();
  registerConsoleJobsApi();
  registerConsoleAuditApi();
  registerPages();

  const server = createServer();
  server.listen(config.port, '0.0.0.0');

  await ensureSampleObjects();
  startProbeLoop();
  startJobWorker();
  startScheduler();
}

void main();
