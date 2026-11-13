import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { applySchema, waitForDatabase } from './db.js';
import { handleApi, toReply, type Reply, type Route } from './http/pipeline.js';
import { closetRoutes } from './routes/closet.js';
import { importRoutes } from './routes/imports.js';
import { listRoutes } from './routes/lists.js';
import { packSheetRoutes } from './routes/packsheets.js';
import { profileRoutes } from './routes/profile.js';
import { sessionRoutes } from './routes/session.js';
import { shareRoutes, sharedListFor } from './routes/shares.js';
import { syncRoutes } from './routes/sync.js';
import { ensureBucket } from './s3.js';
import { loadSeed } from './seed.js';
import { sessionFor } from './sessions.js';
import { sharedListPage, sharedListUnavailablePage } from './share-page.js';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const routes: Route[] = [
  ...sessionRoutes,
  ...profileRoutes,
  ...closetRoutes,
  ...listRoutes,
  ...syncRoutes,
  ...shareRoutes,
  ...packSheetRoutes,
  ...importRoutes,
];

const OWNER_PAGES = ['/closet', '/trips', '/imports', '/settings'];

const STATIC_FILES: Record<string, string> = {
  '/app.js': 'text/javascript; charset=utf-8',
  '/app.css': 'text/css; charset=utf-8',
  '/sw.js': 'text/javascript; charset=utf-8',
};

const SHELL = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Skinout</title>
<link rel="stylesheet" href="/app.css">
<link rel="preload" href="/fonts/space-grotesk-700.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/ibm-plex-sans-400.woff2" as="font" type="font/woff2" crossorigin>
</head><body><div id="app"></div><script type="module" src="/app.js"></script></body></html>`;

function send(req: IncomingMessage, res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string> = {
    'cache-control': 'no-store',
    ...(reply.headers ?? {}),
  };
  // A body cut short by a limit leaves the connection out of step: close it.
  if (!req.complete) headers['connection'] = 'close';
  if (reply.json !== undefined) {
    const body = Buffer.from(JSON.stringify(reply.json));
    headers['content-type'] = 'application/json; charset=utf-8';
    headers['content-length'] = String(body.length);
    res.writeHead(reply.status, headers);
    res.end(body);
    if (!req.complete) req.destroy();
    return;
  }
  if (reply.bytes !== undefined) {
    headers['content-type'] = reply.contentType ?? 'application/octet-stream';
    headers['content-length'] = String(reply.bytes.length);
    res.writeHead(reply.status, headers);
    res.end(reply.bytes);
    return;
  }
  res.writeHead(reply.status, headers);
  res.end();
  if (!req.complete) req.destroy();
}

function html(res: ServerResponse, status: number, body: string): void {
  const bytes = Buffer.from(body);
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': String(bytes.length),
    'cache-control': 'no-store',
  });
  res.end(bytes);
}

async function servePage(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const path = url.pathname;
  if (path === '/') {
    res.writeHead(302, { location: '/trips' });
    res.end();
    return;
  }
  if (path in STATIC_FILES) {
    try {
      const bytes = await readFile(join(publicDir, path.slice(1)));
      res.writeHead(200, {
        'content-type': STATIC_FILES[path] as string,
        'content-length': String(bytes.length),
        'cache-control': 'no-cache',
      });
      res.end(bytes);
    } catch {
      html(res, 404, 'Not found');
    }
    return;
  }
  const font = /^\/fonts\/([a-z0-9-]+\.woff2)$/.exec(path);
  if (font !== null) {
    try {
      const bytes = await readFile(join(publicDir, 'fonts', font[1] as string));
      res.writeHead(200, {
        'content-type': 'font/woff2',
        'content-length': String(bytes.length),
        'cache-control': 'public, max-age=31536000, immutable',
      });
      res.end(bytes);
    } catch {
      html(res, 404, 'Not found');
    }
    return;
  }
  const shared = /^\/s\/([A-Za-z0-9_-]+)$/.exec(path);
  if (shared !== null) {
    const share = await sharedListFor(shared[1] as string);
    if (share === null) {
      html(res, 404, sharedListUnavailablePage());
      return;
    }
    html(res, 200, sharedListPage(share));
    return;
  }
  if (path === '/sign-in') {
    html(res, 200, SHELL);
    return;
  }
  if (OWNER_PAGES.includes(path) || /^\/lists\/[^/]+$/.test(path)) {
    if ((await sessionFor(req)) === null) {
      res.writeHead(302, { location: '/sign-in' });
      res.end();
      return;
    }
    html(res, 200, SHELL);
    return;
  }
  html(res, 404, 'Not found');
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const work = url.pathname.startsWith('/api/')
    ? handleApi(req, res, url, { routes, sessionFor }).then((reply) => send(req, res, reply))
    : servePage(req, res, url);
  work.catch((error: unknown) => {
    if (url.pathname.startsWith('/api/')) {
      send(req, res, toReply(error));
      return;
    }
    console.error('page failure', error);
    html(res, 500, 'Something went wrong. Try again.');
  });
});

async function start(): Promise<void> {
  server.listen(config.port, '0.0.0.0');
  await waitForDatabase();
  await applySchema();
  await loadSeed();
  try {
    await ensureBucket();
  } catch {
    console.warn('object storage is not reachable at start');
  }
}

void start();
