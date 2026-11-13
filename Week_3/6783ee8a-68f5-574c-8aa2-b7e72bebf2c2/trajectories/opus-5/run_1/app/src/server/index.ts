import { createServer } from 'node:http';
import { config } from './config.js';
import { waitForDatabase } from './db.js';
import { startPresenceSweeper } from './events.js';
import { handleRequest } from './http.js';
import { startSearchRetry } from './notebookstore.js';
import { applySeedData } from './seed.js';
import { applyIndexSettings } from './search.js';
import { ensureBucket } from './storage.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCellRoutes } from './routes/cells.js';
import { registerCheckpointRoutes } from './routes/checkpoints.js';
import { registerFileRoutes } from './routes/files.js';
import { registerGradingRoutes } from './routes/grading.js';
import { markDatabaseReady, registerHealthRoutes } from './routes/health.js';
import { registerNotebookRoutes } from './routes/notebooks.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerShareRoutes } from './routes/shares.js';

registerHealthRoutes();
registerAuthRoutes();
registerNotebookRoutes();
registerCellRoutes();
registerRunRoutes();
registerCheckpointRoutes();
registerFileRoutes();
registerShareRoutes();
registerGradingRoutes();

const server = createServer((req, res) => {
  void handleRequest(req, res);
});

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`Brackenpad is serving on port ${config.port}\n`);
});

/**
 * MinIO, Mailpit and Meilisearch may be unreachable without stopping the
 * server, so the bucket, index settings and seed data are tried until they take.
 */
async function prepareServices(): Promise<void> {
  for (;;) {
    try {
      await ensureBucket();
      await applyIndexSettings();
      await applySeedData();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

await waitForDatabase();
markDatabaseReady();
startPresenceSweeper();
startSearchRetry();
void prepareServices();
