import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { copy } from '../shared/copy.js';
import { config } from './config.js';
import { applySchema } from './db/pool.js';
import './grading/routes.js';
import { ApiError, notFound } from './http/errors.js';
import { servePage, serveAsset } from './http/pages.js';
import { dispatch, errorReply, writeReply } from './http/router.js';
import { userOfRequest } from './http/session.js';
import { relayHandlers, upgrade } from './live/hub.js';
import './routes/auth.js';
import './routes/invitations.js';
import './routes/live.js';
import './routes/matches.js';
import './routes/scoring.js';
import './routes/system.js';
import './routes/teams.js';
import './routes/tournaments.js';
import { prepareStorage } from './services/s3.js';
import { connectValkey } from './services/valkey.js';

const STARTUP_ROUTES = new Set(['/api/health', '/api/services', '/api/config']);
const schemaReady = applySchema();
schemaReady.catch((error: unknown) => {
  console.error('the database never became ready', error);
  process.exit(1);
});

const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const url = new URL(req.url ?? '/', 'http://overcall');
  if (url.pathname.startsWith('/api/')) {
    if (!STARTUP_ROUTES.has(url.pathname)) await schemaReady;
    let user: Awaited<ReturnType<typeof userOfRequest>> | undefined;
    const result = await dispatch(req, url, async () => (user ??= await userOfRequest(req)));
    writeReply(res, result ?? errorReply(notFound()));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    writeReply(res, errorReply(notFound()));
    return;
  }
  if (await serveAsset(res, url.pathname)) return;
  await schemaReady;
  await servePage(res, url.pathname, await userOfRequest(req));
};

const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    console.error(error);
    if (!res.headersSent) writeReply(res, errorReply(new ApiError(500, 'INTERNAL', copy.internal)));
    else res.destroy();
  });
});

server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url ?? '/', 'http://overcall').pathname === '/ws') upgrade(req, socket, head);
  else socket.destroy();
});

server.listen(config.port, '0.0.0.0', () => {
  connectValkey(relayHandlers);
  prepareStorage();
});
