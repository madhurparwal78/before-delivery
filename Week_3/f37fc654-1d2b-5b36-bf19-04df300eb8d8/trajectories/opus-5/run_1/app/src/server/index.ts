import express from 'express';
import { env } from './env.js';
import { applySchema } from './db/pool.js';
import { bodyTooLarge, sendApiError } from './http/errors.js';
import { appShell, clientRoot } from './http/spa.js';
import { startEventListener } from './jobs/events.js';
import { startWorkers } from './jobs/workers.js';
import { ensureRealmSetup } from './services/keycloak.js';
import { ensureCatalog } from './services/killbill.js';
import { ensureBucket } from './services/s3.js';
import { authRouter } from './routes/auth.js';
import { briefsRouter } from './routes/briefs.js';
import { checkoutRouter } from './routes/checkout.js';
import { commissionsRouter } from './routes/commissions.js';
import { crewRouter } from './routes/crew.js';
import { crmRouter } from './routes/crm.js';
import { documentsRouter } from './routes/documents.js';
import { filesRouter } from './routes/files.js';
import { fundersRouter } from './routes/funders.js';
import { jobsRouter } from './routes/jobs.js';
import { maintenanceRouter } from './routes/maintenance.js';
import { platformRouter } from './routes/platform.js';
import { rendersRouter } from './routes/renders.js';
import { venuesRouter } from './routes/venues.js';

const JSON_BODY_LIMIT = 65_536;

const app = express();
app.disable('x-powered-by');
app.set('etag', false);

// The render callback reads its own raw body; everything else is JSON.
app.use((req, res, next) => {
  if (req.path === '/api/render-callbacks') {
    next();
    return;
  }
  if (req.method === 'POST' && req.path.endsWith('/files')) {
    next();
    return;
  }
  express.json({ limit: JSON_BODY_LIMIT, strict: false })(req, res, (error: unknown) => {
    if (error) {
      // A body over its size limit is answered before anything else.
      const status = (error as { status?: number }).status;
      sendApiError(res, status === 413 ? bodyTooLarge() : error);
      return;
    }
    next();
  });
});

app.use(platformRouter);
app.use(authRouter);
app.use(venuesRouter);
app.use(briefsRouter);
app.use(commissionsRouter);
app.use(filesRouter);
app.use(rendersRouter);
app.use(checkoutRouter);
app.use(fundersRouter);
app.use(documentsRouter);
app.use(crewRouter);
app.use(crmRouter);
app.use(maintenanceRouter);
app.use(jobsRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: { code: 'not_found' } });
});

// The server serves only the built app, its assets and the API.
app.use(
  express.static(clientRoot, {
    index: false,
    dotfiles: 'ignore',
    setHeaders: (res) => res.setHeader('x-content-type-options', 'nosniff'),
  }),
);

// Every other address is a screen of the app.
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next();
    return;
  }
  appShell()
    .then((html) => res.status(200).type('html').send(html))
    .catch(next);
});

/**
 * Finish the setup each service needs. The app starts and answers the health
 * check whether or not a service is reachable, and keeps trying until each
 * one succeeds, with no restart.
 */
function completeSetup(): void {
  const steps: { name: string; run: () => Promise<void> }[] = [
    { name: 'schema', run: applySchema },
    { name: 'keycloak', run: ensureRealmSetup },
    { name: 'killbill', run: ensureCatalog },
    { name: 'minio', run: ensureBucket },
  ];
  for (const step of steps) {
    const attempt = (): void => {
      step.run().catch(() => setTimeout(attempt, 5_000));
    };
    attempt();
  }
}

async function main(): Promise<void> {
  // The schema must exist before any request touches it.
  await applySchema().catch(() => undefined);
  completeSetup();
  startEventListener();
  startWorkers();
  app.listen(env.port, '0.0.0.0', () => {
    process.stdout.write(`Spindrift Rooms listening on ${env.port}\n`);
  });
}

void main();
