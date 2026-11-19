import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySchema, query, waitForDatabase } from './db.js';
import { loadClock } from './clock.js';
import { env } from './env.js';
import { dispatch, sendJson, sameOrigin, viewerFromRequest } from './http.js';
import {
  clearInstanceViewers,
  handleUpgrade,
  startBus,
  startClockBroadcast,
} from './live.js';
import {
  deleteObject,
  ensureBucket,
  startStorageChecks,
  storageHealthy,
} from './storage.js';
import { expireDueOperations } from './domain/operations.js';
import { seedDemoContent } from './domain/seed.js';
import { extensionFor, type ImageFormat } from './images.js';

import './routes/system.js';
import './routes/accounts.js';
import './routes/boards.js';
import './routes/pins.js';
import './routes/discover.js';
import './routes/media.js';

const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'public');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

async function serveStatic(pathname: string): Promise<{ body: Buffer; type: string } | null> {
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR)) return null;
  const type = CONTENT_TYPES[extname(file)];
  if (!type) return null;
  try {
    return { body: await readFile(file), type };
  } catch {
    return null;
  }
}

let shell: Buffer | null = null;

async function appShell(): Promise<Buffer> {
  if (!shell) shell = await readFile(join(PUBLIC_DIR, 'index.html'));
  return shell;
}

const server = createServer((req, res) => {
  void (async () => {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) {
      sendJson(res, 403, { error: 'forbidden' });
      return;
    }
    if (await dispatch(req, res, url)) return;
    if (url.pathname.startsWith('/api/') || url.pathname === '/api') {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    if (url.pathname.startsWith('/media/')) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    const asset = await serveStatic(url.pathname);
    if (asset) {
      res.writeHead(200, {
        'content-type': asset.type,
        'content-length': String(asset.body.length),
        'cache-control': url.pathname === '/index.html' ? 'no-store' : 'public, max-age=300',
      });
      res.end(asset.body);
      return;
    }
    const body = await appShell();
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(body.length),
      'cache-control': 'no-store',
    });
    res.end(body);
  })().catch(() => {
    sendJson(res, 500, { error: 'server_error' });
  });
});

server.on('upgrade', (req, socket, head) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/api/live') {
      socket.destroy();
      return;
    }
    if (!sameOrigin(req)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const viewer = await viewerFromRequest(req);
    if (!viewer) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }
    handleUpgrade(req, socket, head, viewer);
  })().catch(() => socket.destroy());
});

/** Storage objects of pins that are gone for good, unless a live pin shares the image. */
async function purgeUnusedImages(): Promise<void> {
  if (!storageHealthy()) return;
  const rows = await query<{ id: number; format: ImageFormat; variants: number[] }>(
    `select i.id, i.format, i.variants
       from images i
      where i.purged = false
        and not exists (
          select 1 from pins p
           where p.image_id = i.id and p.state in ('live', 'draft', 'deleted')
        )
      limit 50`,
  );
  for (const image of rows) {
    const extension = extensionFor(image.format);
    await deleteObject(`images/${image.id}/original.${extension}`);
    for (const width of image.variants) {
      await deleteObject(`images/${image.id}/w${width}.${extension}`);
    }
    await query('update images set purged = true where id = $1', [image.id]);
  }
}

async function main(): Promise<void> {
  await waitForDatabase();
  await applySchema();
  await loadClock();
  await clearInstanceViewers();
  await startBus();
  await ensureBucket();
  startStorageChecks();
  startClockBroadcast();

  try {
    await seedDemoContent();
  } catch (error) {
    process.stderr.write(`demo content deferred: ${String(error)}\n`);
  }

  setInterval(() => {
    void expireDueOperations().catch(() => undefined);
  }, 1000).unref();
  setInterval(() => {
    void purgeUnusedImages().catch(() => undefined);
  }, 20000).unref();

  server.listen(env.port, '0.0.0.0', () => {
    process.stdout.write(`mothlight listening on ${env.port}\n`);
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`startup failed: ${String(error)}\n`);
  process.exit(1);
});
