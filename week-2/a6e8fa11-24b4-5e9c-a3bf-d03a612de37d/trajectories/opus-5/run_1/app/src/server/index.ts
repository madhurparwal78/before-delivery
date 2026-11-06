import { createServer } from 'node:http';
import { env } from './env';
import { pool, waitForDatabase } from './db';
import { SCHEMA_SQL } from './schema';
import { applySeed } from './seed';
import { handleRequest } from './http/pipeline';
import { registerConflictRoutes } from './routes/conflicts';
import { registerExportRoutes } from './routes/exports';
import { registerImportRoutes } from './routes/import';
import { registerMetaRoutes } from './routes/meta';
import { registerSessionRoutes } from './routes/session';
import { registerShareRoutes } from './routes/share';
import { registerStationRoutes } from './routes/station';
import { registerSyncRoutes } from './routes/sync';
import { registerVersionRoutes } from './routes/versions';
import { registerWorkbookRoutes } from './routes/workbooks';
import { startStatusChecks } from './services/status';
import { startWorkers } from './services/workers';

function registerRoutes(): void {
  registerMetaRoutes();
  registerSessionRoutes();
  registerWorkbookRoutes();
  registerImportRoutes();
  registerSyncRoutes();
  registerConflictRoutes();
  registerVersionRoutes();
  registerExportRoutes();
  registerShareRoutes();
  registerStationRoutes();
}

async function main(): Promise<void> {
  registerRoutes();
  const server = createServer((req, res) => {
    void handleRequest(req, res);
  });
  server.listen(env.port, '0.0.0.0', () => {
    process.stdout.write(`furrowbook listening on ${env.port}\n`);
  });

  await waitForDatabase();
  await pool.query(SCHEMA_SQL);
  await applySeed();
  startStatusChecks();
  startWorkers();
}

void main();
