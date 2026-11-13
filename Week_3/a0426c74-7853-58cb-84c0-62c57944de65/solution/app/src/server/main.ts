import { config } from './config.ts';
import { db } from './db.ts';
import { createHttpServer } from './http.ts';
import { hub } from './live.ts';
import { runStartSteps } from './registry.ts';
import { applySchema } from './schema.ts';
import { scheduler } from './scheduler.ts';
import './auth.ts';
import './roles.ts';
import './folders.ts';
import './drawings.ts';
import './ops.ts';
import './health.ts';
import './grading.ts';
import './features.ts';

// A failure nobody awaited is logged and the server keeps serving the other requests.
process.on('unhandledRejection', (reason) => console.error('unhandled rejection', reason));
process.on('uncaughtException', (error) => console.error('uncaught exception', error));

// PostgreSQL is retried every second; nothing listens (so health cannot answer) until it is connected and the schema is applied.
// MinIO is not needed to boot: storage calls fail with `storage_unavailable` until it answers.
await db.connect();
await applySchema();
await runStartSteps();

const server = createHttpServer();
scheduler.start();
hub.start();
server.listen(config.port, '0.0.0.0', () => console.log(`Plotfold listening on ${config.port}`));

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    scheduler.stop();
    hub.stop();
    server.closeAllConnections();
    server.close(() => {
      void db.close().then(() => process.exit(0));
    });
  });
}
