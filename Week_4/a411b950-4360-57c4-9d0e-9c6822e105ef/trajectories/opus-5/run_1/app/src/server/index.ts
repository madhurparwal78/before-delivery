import { createServer } from 'node:http';
import { config } from './config.ts';
import { applySchema, applySeedData, startSeedStemWorker } from './db/seed.ts';
import { dispatchApi, registerRoutes } from './http/router.ts';
import { serveStatic } from './http/static.ts';
import { consoleEnquiryRoutes } from './routes/consoleEnquiries.ts';
import { consoleProjectRoutes } from './routes/consoleProjects.ts';
import { consoleSessionRoutes } from './routes/consoleSession.ts';
import { consoleSettingsRoutes } from './routes/consoleSettings.ts';
import { enquiryRoutes } from './routes/enquiries.ts';
import { listenRoutes } from './routes/listen.ts';
import { proposalRoutes } from './routes/proposals.ts';
import { publicJourneyRoutes } from './routes/publicJourney.ts';
import { startMailWorker } from './services/mail.ts';
import { ensureBucket } from './services/storage.ts';

registerRoutes([
  ...publicJourneyRoutes,
  ...listenRoutes,
  ...enquiryRoutes,
  ...proposalRoutes,
  ...consoleSessionRoutes,
  ...consoleProjectRoutes,
  ...consoleEnquiryRoutes,
  ...consoleSettingsRoutes,
]);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  void (async () => {
    const handled = await dispatchApi(request, response, url);
    if (!handled) await serveStatic(response, url.pathname);
  })().catch(() => {
    if (!response.headersSent) {
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'internal', message: 'Something went wrong on the server.' }));
    }
  });
});

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`earshot listening on port ${config.port}\n`);
});

async function prepareDatabase(): Promise<void> {
  try {
    await applySchema();
    await applySeedData();
    startSeedStemWorker();
  } catch {
    const timer = setTimeout(() => void prepareDatabase(), 5_000);
    timer.unref();
  }
}

void ensureBucket().catch(() => {
  /* storage comes back by itself; the seed stem worker keeps trying */
});
void prepareDatabase();
startMailWorker();
