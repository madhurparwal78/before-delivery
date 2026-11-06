import { createServer } from 'node:http';
import { config } from './config';
import { serveAsset, serveDocument } from './documents';
import { handleApi, Refusal, notFound } from './http';
import { prepareDatabase } from './seed';
import { startWorkers } from './workers';
import './routes/access';
import './routes/clients';
import './routes/jobs';
import './routes/board';
import './routes/lines';
import './routes/cues';
import './routes/cuts';
import './routes/renders';
import './routes/pages';
import './routes/notes';
import './routes/calls';
import './routes/delivery';
import './routes/letters';
import './routes/enquiries';

await prepareDatabase();

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://app.invalid');
  if (url.pathname === '/api' || url.pathname.startsWith('/api/') || (req.method !== 'GET' && req.method !== 'HEAD')) {
    void handleApi(req, res, url);
    return;
  }
  if (serveAsset(res, url.pathname)) return;
  serveDocument(req, res, url).catch((error: unknown) => {
    console.error(error);
    const refusal = error instanceof Refusal ? error : notFound();
    res.statusCode = refusal.status;
    res.end();
  });
});

server.listen(config.port, '0.0.0.0', () => {
  startWorkers();
  console.log(`Clapstick is serving on port ${config.port}`);
});
