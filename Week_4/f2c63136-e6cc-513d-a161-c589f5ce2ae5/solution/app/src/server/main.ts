import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { config } from './config.ts';
import { ensureSchema, postgresReachable } from './db.ts';
import { loadClock, now } from './clock.ts';
import { errorReply, reply, Router, send } from './http.ts';
import { startOutbox } from './mail.ts';
import { storageReachable } from './s3.ts';
import { servePage } from './pages.ts';
import { processDue } from './domain/reports.ts';
import { seedWhenReady } from './seed.ts';
import * as account from './routes/account.ts';
import * as code from './routes/code.ts';
import * as review from './routes/review.ts';
import * as grading from './grading.ts';

const router = new Router();
account.register(router);
code.register(router);
review.register(router);
grading.register(router);

let ready = false;

router.add('GET', '/api/health', async () => {
  if (!ready || !(await postgresReachable())) return reply(503, { status: 'unavailable' });
  return reply(200, { status: (await storageReachable()) ? 'ok' : 'unavailable' });
});

const TYPES: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.txt': 'text/plain', '.json': 'application/json' };
const PUBLIC = join(process.cwd(), 'dist', 'public');

async function serveStatic(pathname: string): Promise<{ type: string; data: Buffer } | null> {
  const file = normalize(join(PUBLIC, pathname));
  if (!file.startsWith(`${PUBLIC}/`) || !/^\/(assets|fonts)\//.test(pathname)) return null;
  try {
    return { type: TYPES[extname(file)] ?? 'application/octet-stream', data: await readFile(file) };
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const found = router.match(req.method ?? 'GET', url.pathname);
      if (!found) return send(res, reply(404, { error: 'Not found' }));
      return send(res, await found.route.handler({ req, res, url, params: found.params }));
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const asset = await serveStatic(url.pathname);
      if (asset) {
        res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'public, max-age=31536000, immutable' });
        return void res.end(asset.data);
      }
      return await servePage(req, res, url);
    }
    send(res, reply(404, { error: 'Not found' }));
  } catch (error) {
    send(res, errorReply(error));
  }
});

server.on('upgrade', (req, socket) => {
  const live = /^\/api\/live\/([^/]+)\/([^/]+)$/.exec(new URL(req.url ?? '/', 'http://localhost').pathname);
  if (live && req.headers.upgrade?.toLowerCase() === 'websocket') void review.openLive(req, socket, decodeURIComponent(live[1]), decodeURIComponent(live[2]));
  else socket.end('HTTP/1.1 404 Not Found\r\nconnection: close\r\ncontent-length: 0\r\n\r\n');
});

server.listen(config.port, '0.0.0.0', () => console.log(`ridgestack listening on ${config.port}`));

void (async () => {
  await ensureSchema(() => undefined);
  await loadClock();
  ready = true;
  startOutbox();
  setInterval(() => void processDue(now()).catch((error) => console.error(error)), 1000).unref();
  void seedWhenReady();
})();
