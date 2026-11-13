import { MAX_JSON_BYTES, MAX_UPLOAD_BYTES, config } from './config.ts';
import { waitForDatabase } from './db/pool.ts';
import { applySchema } from './db/schema.ts';
import { HttpApp } from './http/server.ts';
import { registerDocumentRoutes } from './routes/documents.ts';
import { registerFieldRoutes } from './routes/fields.ts';
import { registerRecipientRoutes } from './routes/recipients.ts';
import { registerRoutingRoutes } from './routes/routing.ts';
import { registerEventRoutes } from './routes/events.ts';
import { registerGradingRoutes } from './routes/grading.ts';
import { registerPageRoutes } from './routes/pages.ts';
import { registerSessionRoutes } from './routes/session.ts';
import { registerSignRoutes } from './routes/sign.ts';
import { registerTeamRoutes } from './routes/team.ts';
import { registerTemplateRoutes } from './routes/templates.ts';
import { startHealthChecks } from './services/health.ts';
import { ensureBucket } from './services/storage.ts';
import { startWorkers } from './services/workers.ts';

const DATABASE_WAIT_MS = 60000;

const main = async (): Promise<void> => {
  try {
    await waitForDatabase(DATABASE_WAIT_MS);
  } catch (error) {
    process.stderr.write(`database unreachable: ${String(error)}\n`);
    process.exit(1);
  }
  await applySchema();
  await ensureBucket().catch(() => undefined);
  await startHealthChecks();
  startWorkers();

  const app = new HttpApp({ json: MAX_JSON_BYTES, upload: MAX_UPLOAD_BYTES });
  registerSessionRoutes(app);
  registerDocumentRoutes(app);
  registerRecipientRoutes(app);
  registerFieldRoutes(app);
  registerRoutingRoutes(app);
  registerSignRoutes(app);
  registerTemplateRoutes(app);
  registerTeamRoutes(app);
  registerGradingRoutes(app);
  registerEventRoutes(app);
  registerPageRoutes(app);
  app.listen(config.port);
  process.stdout.write(`undersign listening on ${config.port}\n`);
};

void main();
