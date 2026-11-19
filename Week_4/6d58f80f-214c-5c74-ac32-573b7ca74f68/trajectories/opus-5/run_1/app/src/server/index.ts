import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { config, SESSION_COOKIE } from './config.js';
import { applySchema, databaseReady, db } from './db.js';
import { APP_SCREENS, StaticAssets } from './static.js';
import { buildContext, findRoute, sendError, sendJson, type Route } from './http/api.js';
import { notFound } from './http/errors.js';
import { readCookie } from './http/boundary.js';
import { systemRoutes } from './routes/system.js';
import { folderRoutes } from './routes/folders.js';
import { fileRoutes } from './routes/files.js';
import { moveRoutes } from './routes/moves.js';
import { uploadRoutes } from './routes/uploads.js';
import { binRoutes } from './routes/bin.js';
import { grantRoutes } from './routes/grants.js';
import { policyRoutes } from './routes/policies.js';
import { handoverRoutes } from './routes/handovers.js';
import { startProbes } from './services/health.js';
import { ensureBucket, onStorageChange } from './services/storage.js';
import { ensureDirectoryFields, onDirectoryChange } from './services/directory.js';
import { addConnection, broadcastStatus } from './events.js';
import { startSweep } from './sweep.js';
import { startSeedRetry } from './seed/seed.js';
import { knownPerson } from './domain/people.js';

const routes: Route[] = [
  ...systemRoutes,
  ...folderRoutes,
  ...fileRoutes,
  ...moveRoutes,
  ...uploadRoutes,
  ...binRoutes,
  ...grantRoutes,
  ...policyRoutes,
  ...handoverRoutes,
];

const assets = new StaticAssets(join(import.meta.dirname, '../client'));

const handleApi = async (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> => {
  const found = findRoute(routes, req.method ?? 'GET', url.pathname);
  if (found === null) {
    sendError(res, notFound());
    return;
  }
  try {
    const ctx = await buildContext(req, res, url, found.params, found.route);
    const reply = await found.route.handler(ctx);
    if (reply !== null) sendJson(res, reply);
  } catch (error) {
    sendError(res, error);
  }
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    void handleApi(req, res, url);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }
  if (assets.serve(url.pathname, res)) return;
  if (APP_SCREENS.has(url.pathname)) {
    assets.serveShell(res);
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end('Not found');
});

const sockets = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/api/events') {
    socket.destroy();
    return;
  }
  void (async () => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token === null) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const { rows } = await db.query<{ person_id: string }>(
      'SELECT person_id FROM sessions WHERE id = $1',
      [token],
    );
    const personId = rows[0]?.person_id;
    const person = personId === undefined ? null : await knownPerson(personId);
    if (person === null) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(req, socket, head, (websocket) => {
      const drop = addConnection(person, websocket);
      const beat = setInterval(() => websocket.ping(), 30_000);
      websocket.on('close', () => {
        clearInterval(beat);
        drop();
      });
      websocket.on('error', () => {
        clearInterval(beat);
        drop();
      });
    });
  })();
});

const waitForDatabase = async (): Promise<void> => {
  for (;;) {
    if (await databaseReady()) return;
    console.warn('waiting for the database');
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
};

const prepareSchema = async (): Promise<void> => {
  for (;;) {
    try {
      await applySchema();
      return;
    } catch (error) {
      console.error('schema not applied yet, retrying', error);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
};

const prepareServices = (): void => {
  const tryBucket = async (): Promise<void> => {
    try {
      await ensureBucket();
    } catch {
      setTimeout(() => void tryBucket(), 10_000).unref();
    }
  };
  const tryFields = async (): Promise<void> => {
    try {
      await ensureDirectoryFields();
    } catch {
      setTimeout(() => void tryFields(), 10_000).unref();
    }
  };
  void tryBucket();
  void tryFields();
};

const start = async (): Promise<void> => {
  await assets.load();
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Lintel Drive listening on ${config.port}`);
  });
  onStorageChange(() => broadcastStatus());
  onDirectoryChange(() => broadcastStatus());
  startProbes();
  await waitForDatabase();
  await prepareSchema();
  prepareServices();
  startSeedRetry();
  startSweep();
};

void start();
