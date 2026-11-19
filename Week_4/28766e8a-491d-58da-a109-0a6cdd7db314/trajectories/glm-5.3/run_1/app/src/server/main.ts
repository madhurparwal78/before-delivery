import http from 'node:http';
import { readBody } from './body.js';
import { connectDb } from './db.js';
import { readConfig } from './config.js';
import { App } from './app.js';
import { registerRoutes } from './routes.js';
import { WebSocketServer } from 'ws';
import { registerSockets } from './sockets.js';
import { startVersionTimer, ensureBucket } from './boot.js';

async function main(): Promise<void> {
  const config = readConfig();
  const db = await connectDb(config.databaseUrl);
  const app = new App(config, db);
  void ensureBucket(config).catch(() => undefined);

  const server = http.createServer((req, res) => {
    void handle(req, res);
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const body = await readBody(req);
      const ctx = { req, res, body, app, config, db };
      await registerRoutes(ctx);
    } catch (err) {
      const { ApiError, errorBody } = await import('../shared/errors.js');
      if (err instanceof ApiError) {
        res.writeHead(err.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(errorBody(err)));
      } else {
        console.error('unhandled error', err);
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'internal', message: 'Unexpected error.' } }));
      }
    }
  }

  const wss = new WebSocketServer({ noServer: true });
  registerSockets({ wss, app, server });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const origin = req.headers['origin'];
    const ownOrigin = `http://127.0.0.1:${config.port}`;
    if (origin && origin !== ownOrigin && origin !== new URL(config.appPublicUrl).origin) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    void (async () => {
      const { sessionUser, SESSION_COOKIE_NAME } = await import('./sessions.js');
      const cookies = parseCookies(req.headers['cookie'] ?? '');
      const user = await sessionUser(db, cookies[SESSION_COOKIE_NAME] ?? null);
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, { user, diagramId: url.searchParams.get('diagram'), token: cookies[SESSION_COOKIE_NAME] ?? null });
      });
    })();
  });

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`linewell listening on ${config.port}`);
  });

  startVersionTimer(app);
}

function parseCookies(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

void main();
