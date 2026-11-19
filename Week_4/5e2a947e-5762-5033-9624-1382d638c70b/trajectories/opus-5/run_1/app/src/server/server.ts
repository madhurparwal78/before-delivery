import { createServer } from 'node:http';
import { ApiError } from '../shared/errors.js';
import { connectAndMigrate, databaseReady } from './db.js';
import { handleRequest, route } from './http.js';
import { upgrade } from './live.js';
import { port } from './settings.js';
import { ensureBucket, storageReachable } from './storage.js';
import { startTicker } from './ticker.js';
import './routes/accounts.js';
import './routes/maps.js';
import './routes/social.js';
import './routes/versions.js';
import './routes/share.js';
import './routes/presentations.js';
import './routes/files.js';
import './routes/grading.js';

route('GET', '/api/health', async () => {
  if (!databaseReady()) return { status: 503, json: { status: 'starting' } };
  const reachable = await storageReachable();
  return { status: 200, json: { status: reachable ? 'ok' : 'unavailable' } };
});

const server = createServer((req, res) => {
  void handleRequest(req, res).catch((error: unknown) => {
    if (!res.headersSent) {
      const api = error instanceof ApiError ? error : new ApiError('invalid', 'That request failed.');
      res.writeHead(api.status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(api.body()));
      return;
    }
    res.end();
  });
});

server.on('upgrade', upgrade);

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`sprigmap listening on ${port}\n`);
});

void connectAndMigrate().then(() => {
  startTicker();
});

void ensureBucket().catch(() => {
  /* the app serves without file storage and reports it from the health check */
});
