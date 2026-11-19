import http from 'node:http';
import { ApiError } from '../shared/errors.ts';
import './deadlines.ts';
import './routes/index.ts';
import { config } from './config.ts';
import { connectDatabase, isDatabaseReady } from './db.ts';
import { dispatch, json, send, sendError } from './http.ts';
import { ensureBucket } from './s3.ts';
import { serveClient } from './static.ts';
import { startTicker } from './tick.ts';
import { handleUpgrade } from './upgrade.ts';

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const respond = async (): Promise<void> => {
    if (url.pathname.startsWith('/api/')) {
      if (!isDatabaseReady()) {
        if (url.pathname === '/api/health') send(res, json(503, { status: 'starting' }));
        else sendError(res, new ApiError('storage_unavailable', 'The app is starting. Try again in a moment.'));
        return;
      }
      if (!(await dispatch(req, res, url))) sendError(res, new ApiError('not_found', 'Not found.'));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendError(res, new ApiError('not_found', 'Not found.'));
      return;
    }
    await serveClient(req, res, url.pathname);
  };
  respond().catch(() => {
    if (!res.headersSent) sendError(res, new ApiError('storage_unavailable', 'Something went wrong. Try again in a moment.'));
    else res.end();
  });
});

server.on('upgrade', (req, socket, head) => {
  if (!isDatabaseReady()) socket.destroy();
  else void handleUpgrade(req, socket, head);
});

/** Listen once the schema is applied, or as soon as a first attempt fails so health can answer `starting`. */
let listening = false;
const listen = (): void => {
  if (listening) return;
  listening = true;
  server.listen(config.port, '0.0.0.0');
};

void connectDatabase(listen).then(async () => {
  listen();
  await ensureBucket().catch(() => undefined);
  startTicker();
});
