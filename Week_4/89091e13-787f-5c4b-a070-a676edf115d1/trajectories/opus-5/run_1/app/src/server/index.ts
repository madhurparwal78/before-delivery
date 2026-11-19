import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserSettings, config } from './config.js';
import { applySchema, db } from './db.js';
import { attachLiveChannel } from './live.js';
import { flushOutbox, startMailSender } from './mail.js';
import { handleApi } from './routes/index.js';
import { loadClock, startClock } from './domain/engine.js';
import { buildSeed } from './domain/seed.js';
import { probeStorage, putObject, StorageUnavailable } from './storage.js';

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'client');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function serveFile(path: string): Promise<{ type: string; path: string } | null> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    return { type: CONTENT_TYPES[extname(path)] ?? 'application/octet-stream', path };
  } catch {
    return null;
  }
}

/** Writes objects that could not be stored while MinIO was unreachable. */
async function flushPendingObjects(): Promise<void> {
  const { rows } = await db.query<{ key: string; body: Buffer }>(
    'SELECT key, body FROM pending_objects ORDER BY created_at LIMIT 20',
  );
  for (const row of rows) {
    try {
      await putObject(row.key, new Uint8Array(row.body));
      await db.query('DELETE FROM pending_objects WHERE key = $1', [row.key]);
      const square = /^squares\/([^/]+)\/(\d+)\.bin$/.exec(row.key);
      if (square) {
        await db.query(
          'UPDATE blocks SET snapshot_stored = true WHERE workspace_id = $1 AND height = $2',
          [square[1], Number(square[2])],
        );
      }
    } catch (error) {
      if (!(error instanceof StorageUnavailable)) throw error;
      return;
    }
  }
}

async function seedIfEmpty(): Promise<void> {
  const { rows } = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM people');
  if (rows[0].count === '0') await buildSeed();
}

async function main(): Promise<void> {
  await applySchema();
  await seedIfEmpty();
  await loadClock();
  void probeStorage();

  const indexHtml = (await readFile(join(clientRoot, 'index.html'), 'utf8')).replace(
    '__FERNSQUARE_SETTINGS__',
    JSON.stringify(browserSettings),
  );

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      void handleApi(request, response, url.pathname, url.searchParams);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('Not found');
      return;
    }
    const assetPath = normalize(join(clientRoot, url.pathname));
    if (!assetPath.startsWith(clientRoot)) {
      response.writeHead(404).end();
      return;
    }
    void serveFile(assetPath).then((file) => {
      if (file) {
        response.writeHead(200, { 'content-type': file.type, 'cache-control': 'no-store' });
        createReadStream(file.path).pipe(response);
        return;
      }
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(indexHtml);
    });
  });

  attachLiveChannel(server);
  startClock();
  startMailSender();
  void flushOutbox();
  setInterval(() => {
    void probeStorage().then((reachable) => (reachable ? flushPendingObjects() : undefined));
  }, 2000).unref();

  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Fernsquare listening on 0.0.0.0:${config.port}\n`);
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(`failed to start: ${String(error)}\n`);
  process.exit(1);
});
