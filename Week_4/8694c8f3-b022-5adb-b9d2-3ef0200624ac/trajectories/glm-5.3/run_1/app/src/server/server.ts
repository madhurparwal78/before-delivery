import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig } from './env.js';
import { applySchema, createDbPool } from './db.js';
import { Storage } from './storage.js';
import { Collab } from './collab.js';
import { Router, sendJsonError } from './router.js';
import { errors } from './errors.js';
import type { ApiDeps } from './api/api.js';
import { authRoutes } from './api/auth.js';
import { setRoutes } from './api/sets.js';
import { opRoutes } from './api/ops.js';
import { lockRoutes } from './api/locks.js';
import { assetRoutes } from './api/assets.js';
import { shaderRoutes } from './api/shaders.js';
import { memberRoutes } from './api/members.js';
import { showRoutes } from './api/shows.js';
import { exportRoutes } from './api/exports.js';
import { activityRoutes } from './api/activity-routes.js';
import { statusRoutes } from './api/status.js';
import { eventRoutes } from './api/events.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));
// Every non-API route that shows the shell. Anything else under the build
// serves from disk; unknown paths answer 404.
const SHELL_PREFIXES = ['/', '/workspace', '/show/', '/join/', '/sets/'];

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.glsl': 'text/plain; charset=utf-8',
};

async function serveStatic (pathname: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (SHELL_PREFIXES.some((prefix) => prefix === '/' ? pathname === '/' : pathname.startsWith(prefix))) {
    const bytes = await readFile(join(publicDir, 'index.html'));
    return { bytes, contentType: CONTENT_TYPES['.html'] };
  }
  const resolved = normalize(pathname).replace(/^([.]{2}[/\\])+/, '');
  if (resolved.includes('..')) return null;
  const allowedPrefixes = ['/fonts/'];
  if (!allowedPrefixes.some((prefix) => pathname.startsWith(prefix)) && pathname !== '/favicon.svg' && pathname !== '/app.js' && pathname !== '/index.html' && pathname !== '/style.css') {
    return null;
  }
  try {
    const info = await stat(join(publicDir, pathname));
    if (!info.isFile()) return null;
  } catch {
    return null;
  }
  const bytes = await readFile(join(publicDir, pathname));
  const type = CONTENT_TYPES[extname(pathname)] ?? 'application/octet-stream';
  return { bytes, contentType: type };
}

async function main (): Promise<void> {
  const config = readConfig();
  const pool = await createDbPool(config.databaseUrl).then((p) => p, async () => {
    // Retry every two seconds until PostgreSQL answers.
    for (;;) {
      try {
        return await createDbPool(config.databaseUrl);
      } catch {
        await new Promise((resolve) => { setTimeout(resolve, 2000); });
      }
    }
  });
  await applySchema(pool);
  const storage = new Storage({
    endpoint: config.s3Endpoint,
    region: config.s3Region,
    bucket: config.s3Bucket,
    forcePathStyle: config.s3ForcePathStyle,
    accessKey: config.s3AccessKeyId,
    secretKey: config.s3SecretAccessKey,
  });
  const collab = new Collab(config.valkeyUrl);
  const deps: ApiDeps = { pool, storage, collab };

  const router = new Router();
  for (const spec of [
    ...authRoutes(deps),
    ...setRoutes(deps),
    ...opRoutes(deps),
    ...lockRoutes(deps),
    ...assetRoutes(deps),
    ...shaderRoutes(deps),
    ...memberRoutes(deps),
    ...showRoutes(deps),
    ...exportRoutes(deps),
    ...activityRoutes(deps),
    ...statusRoutes(deps),
    ...eventRoutes(deps),
  ]) {
    router.add(spec.method, spec.path, spec.handler);
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://local');
      if (url.pathname.startsWith('/api/')) {
        await router.dispatch(req, res);
        return;
      }
      const served = await serveStatic(url.pathname);
      if (served === null) {
        sendJsonError(res, errors.notFound());
        return;
      }
      res.writeHead(200, { 'Content-Type': served.contentType, 'Cache-Control': 'no-store' });
      res.end(served.bytes);
    } catch (error) {
      console.error('Request error', error);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { code: 'internal', message: 'Something went wrong' } }));
    }
  });

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Afterglass listening on port ${config.port}`);
  });

  const shutdown = (): void => {
    server.close(() => { void pool.end(); });
    void collab.flush();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void main();
