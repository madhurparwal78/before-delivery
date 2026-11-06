import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import pg from 'pg';
import { Store } from './store.js';
import { Api } from './api.js';
import { Publisher } from './publisher.js';
import { Services } from './services.js';
import { S3Client } from './s3.js';
import { openHours } from './dates.js';
import { errors, ApiError } from './errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'public');

const config = loadConfig();

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
const store = new Store(pool, 686); // open hours patched after migration

const services = new Services(config, store);
const api = new Api(config, store, services, 'Europe/London', 686);
const publisher = new Publisher(config, store, services.imageStore(), 'Europe/London');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const FORBIDDEN_FILES = new Set([
  'package.json', 'package-lock.json', 'run.json', 'tsconfig.json',
]);

const PAGES: Record<string, string> = {
  '/': 'index.html',
  '/records': 'records.html',
};

async function serveFile(res: http.ServerResponse, filePath: string, status = 200): Promise<void> {
  const ext = path.extname(filePath);
  const type = MIME[ext] ?? 'application/octet-stream';
  const data = await fs.promises.readFile(filePath);
  res.writeHead(status, {
    'content-type': type,
    'content-length': data.length,
    'cache-control': 'no-cache',
  });
  res.end(data);
}

let dbMigrated = false;

async function ensureMigrated(): Promise<void> {
  if (dbMigrated) return;
  await store.migrate();
  const exhibition = await store.exhibition();
  const hours = openHours(exhibition.runStart, exhibition.runEnd, exhibition.closedWeekdays, exhibition.openHoursPerDay);
  store.setOpenHours(hours);
  dbMigrated = true;
}

async function retryMigrate(): Promise<void> {
  try {
    await ensureMigrated();
  } catch {
    setTimeout(retryMigrate, 5000).unref();
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${config.port}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith('/api/')) {
      const handled = await api.handle(req, res, pathname, url);
      if (handled) return;
      throw errors.notFound('No such API route.');
    }
    if (pathname.startsWith('/p/') && req.method !== 'GET' && req.method !== 'HEAD') {
      throw errors.readOnly();
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw errors.notFound();
    }

    // Staff pages and lender pages: one SPA shell each.
    if (pathname === '/' || pathname === '/records' || pathname.startsWith('/records/')) {
      if (!dbMigrated) {
        try {
          await ensureMigrated();
        } catch {
          res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
          res.end(pageShell(true, true));
          return;
        }
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(pageShell(true, false));
      return;
    }
    if (pathname.startsWith('/p/')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(pageShell(false, false));
      return;
    }

    // Static assets from public/
    const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(PUBLIC_DIR, safe);
    if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
      throw errors.notFound();
    }
    const base = path.basename(filePath);
    if (FORBIDDEN_FILES.has(base) || base.startsWith('.env') || base.endsWith('.ts')) {
      throw errors.notFound();
    }
    try {
      await serveFile(res, filePath);
      return;
    } catch {
      throw errors.notFound();
    }
  } catch (e) {
    if (e instanceof ApiError) {
      const body = JSON.stringify(e.body());
      res.writeHead(e.status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }
    console.error('Unhandled error:', e);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: { code: 'internal', message: 'Something went wrong.' } }));
    }
  }
});

function pageShell(staff: boolean, dbDown: boolean): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hangline</title>
<link rel="stylesheet" href="/assets/app.css">
<script src="/assets/app.js" defer></script>
</head>
<body>
<div id="app"></div>
</body>
</html>`;
}

async function main(): Promise<void> {
  await new Promise<void>((resolve) => {
    server.listen(config.port, '0.0.0.0', resolve);
  });
  console.log(`Hangline listening on 0.0.0.0:${config.port}`);
  services.startProbing();
  await retryMigrate();
  publisher.start();
}

main().catch((e) => {
  console.error('Failed to start:', e);
  process.exit(1);
});
