/** The one origin: pages, assets and /api on port 4173. */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { withAdvisoryLock } from './db.js';
import { applySchemaAndSeed, schemaApplied } from './seed.js';
import { dispatchApi, sendResult } from './http/router.js';
import { registerAuthRoutes } from './api/auth.js';
import { registerCartRoutes } from './api/cart.js';
import { registerCatalogueRoutes } from './api/catalogue.js';
import { registerCheckoutRoutes } from './api/checkout.js';
import { registerOrderRoutes } from './api/orders.js';
import { registerSellerRoutes } from './api/seller.js';
import { registerSupportRoutes } from './api/support.js';
import { registerWishlistRoutes } from './api/wishlist.js';
import { productArtSvg } from './art.js';
import { reindexAll, syncSearchIndex } from './indexSync.js';
import {
  pollAllProviderPayments,
  recordPendingCodCollections,
  recordPendingLegs,
  settleAllPendingRefunds,
} from './payments.js';
import { storePendingDocuments } from './documents.js';
import { getObject, objectKeys } from './services/storage.js';
import { one } from './db.js';

const WEB_ROOT = fileURLToPath(new URL('../web', import.meta.url));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

let ready = false;

async function bootDatabase(): Promise<void> {
  for (;;) {
    try {
      await applySchemaAndSeed();
      if (await schemaApplied()) {
        ready = true;
        return;
      }
    } catch (error) {
      process.stderr.write(`waiting for postgres: ${String(error)}\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

function clientIp(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? 'unknown';
}

async function serveFile(path: string, response: ServerResponse): Promise<boolean> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    const bytes = await readFile(path);
    response.setHeader('content-type', MIME[extname(path)] ?? 'application/octet-stream');
    response.setHeader('content-length', String(bytes.length));
    response.statusCode = 200;
    response.end(bytes);
    return true;
  } catch {
    return false;
  }
}

async function servePhoto(pathname: string, response: ServerResponse): Promise<boolean> {
  const match = /^\/photos\/([^/]+)\/([^/.]+)\.(jpg|png|webp)$/.exec(pathname);
  if (match === null) return false;
  const [, listingId, photoId, ext] = match;
  const photo = await one<{ photo_id: string }>(
    `SELECT photo_id FROM listing_photos WHERE photo_id = $1 AND listing_id = $2 AND ext = $3`,
    [photoId, listingId, ext],
  );
  if (photo === null) return false;
  const bytes = await getObject(objectKeys.photo(listingId, photoId, ext));
  if (bytes === null) return false;
  response.setHeader('content-type', MIME[`.${ext}`] ?? 'application/octet-stream');
  response.setHeader('content-length', String(bytes.length));
  response.statusCode = 200;
  response.end(bytes);
  return true;
}

function notFoundPage(response: ServerResponse): void {
  response.statusCode = 404;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.end('nothing here. wrong turn at the chauraha.');
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/api/health') {
    response.statusCode = ready ? 200 : 503;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ status: ready ? 'ok' : 'starting' }));
    return;
  }

  if (pathname.startsWith('/api/')) {
    const result = await dispatchApi(request, url, clientIp(request));
    if (result === null) {
      notFoundPage(response);
      return;
    }
    sendResult(response, result);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    notFoundPage(response);
    return;
  }

  const artMatch = /^\/art\/([A-Za-z0-9_-]+)\.svg$/.exec(pathname);
  if (artMatch !== null) {
    const svg = productArtSvg(artMatch[1]);
    response.setHeader('content-type', 'image/svg+xml');
    response.setHeader('cache-control', 'public, max-age=86400');
    response.statusCode = 200;
    response.end(svg);
    return;
  }

  if (pathname.startsWith('/photos/')) {
    if (await servePhoto(pathname, response)) return;
    notFoundPage(response);
    return;
  }

  const candidate = join(WEB_ROOT, normalize(pathname));
  if (candidate.startsWith(WEB_ROOT) && pathname !== '/' && (await serveFile(candidate, response))) {
    return;
  }

  if (extname(pathname) !== '') {
    notFoundPage(response);
    return;
  }

  if (await serveFile(join(WEB_ROOT, 'index.html'), response)) return;
  notFoundPage(response);
}

function startBackgroundPasses(): void {
  const every = (seconds: number, lockKey: number, job: () => Promise<void>): void => {
    setInterval(() => {
      if (!ready) return;
      void withAdvisoryLock(lockKey, job).catch((error) => {
        process.stderr.write(`background pass failed: ${String(error)}\n`);
      });
    }, seconds * 1_000);
  };
  every(5, 720_001, async () => {
    await pollAllProviderPayments();
    await recordPendingLegs();
    await settleAllPendingRefunds();
    await recordPendingCodCollections();
    await storePendingDocuments();
  });
  every(2, 720_002, syncSearchIndex);
}

function registerRoutes(): void {
  registerAuthRoutes();
  registerCatalogueRoutes();
  registerCartRoutes();
  registerWishlistRoutes();
  registerCheckoutRoutes();
  registerOrderRoutes();
  registerSellerRoutes();
  registerSupportRoutes();
}

registerRoutes();

const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    process.stderr.write(`request failed: ${String(error)}\n`);
    if (!response.headersSent) {
      response.statusCode = 500;
      response.end();
    }
  });
});

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`chauraha bazaar listening on ${config.port}\n`);
});

void bootDatabase().then(async () => {
  startBackgroundPasses();
  await withAdvisoryLock(720_003, reindexAll).catch(() => undefined);
});
