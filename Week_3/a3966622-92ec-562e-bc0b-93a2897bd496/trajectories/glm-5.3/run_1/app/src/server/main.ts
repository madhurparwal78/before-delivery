// The Slackwater server. Serves the built frontend from /public, the API from
// /api, and keeps its own embedded store under /app, separated by its port.

import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Store } from './store.js';
import { KillBillClient } from './killbill.js';
import { MailClient } from './mail.js';
import { ObjectStore } from './objectstore.js';
import { Services } from './services.js';
import { StepRunner } from './steps.js';
import { Router, type HttpEnv } from './router.js';

const PORT = Number(process.env.APP_PUBLIC_PORT ?? 4173);
const DETENTION_UNIT_SECONDS = Number(process.env.DETENTION_UNIT_SECONDS ?? 1800);

// Provider wiring comes only from the environment.
const killbill = new KillBillClient({
  url: env('KILLBILL_URL'),
  username: env('KILLBILL_USERNAME'),
  password: env('KILLBILL_PASSWORD'),
  apiKey: env('KILLBILL_API_KEY'),
  apiSecret: env('KILLBILL_API_SECRET'),
});
const objects = new ObjectStore({
  endpoint: env('S3_ENDPOINT'),
  region: env('S3_REGION'),
  bucket: env('S3_BUCKET'),
  forcePathStyle: env('S3_FORCE_PATH_STYLE') === 'true',
  accessKeyId: env('S3_ACCESS_KEY_ID'),
  secretAccessKey: env('S3_SECRET_ACCESS_KEY'),
});
const mail = new MailClient({
  host: env('SMTP_HOST'),
  port: Number(env('SMTP_PORT')),
  from: env('MAIL_FROM'),
});
const services = new Services(killbill, objects, mail);

// Each serving instance keeps its own store, separated by its port.
const storeRoot = path.resolve(process.cwd(), `data-${PORT}`);
await fs.mkdir(storeRoot, { recursive: true });
const store = new Store(storeRoot);
await store.load();

// The bucket is checked at start and again at each storage check.
void objects.ensureBucket();
void services.state();

const stepRunner = new StepRunner(store, { killbill, objects, mail }, () => Date.now());

const envHttp: HttpEnv = {
  store,
  now: () => Date.now(),
  detentionUnitSeconds: DETENTION_UNIT_SECONDS,
  photoStore: objects,
  servicesState: () => services.state(),
  runPendingStep: (stepId: string) => stepRunner.runOne(stepId),
  runPendingDue: () => stepRunner.due(),
};

const router = new Router(envHttp);

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith('/api/')) {
      await router.handle(req, res, pathname, url.searchParams);
      return;
    }
    await serveStatic(pathname, res);
  } catch {
    // Errors that reach here have no published shape; they answer 500.
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal_error', message: 'Something went wrong' }));
  }
});

async function serveStatic(pathname: string, res: http.ServerResponse): Promise<void> {
  // The server never serves source files, the store or credentials.
  const safePath = path.posix.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const relative = safePath === '/' ? 'index.html' : safePath.slice(1);
  const resolved = path.resolve(PUBLIC_DIR, relative);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  try {
    const bytes = await fs.readFile(resolved);
    const ext = path.extname(resolved);
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(bytes);
  } catch {
    // The app is a single page: unknown paths render the not-found page.
    const index = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(index);
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Slackwater serving on 0.0.0.0:${PORT}`);
});

// Pending steps are retried at least every 15 seconds.
stepRunner.start();
setInterval(() => {
  void services.state();
}, 15_000);

function env(name: string): string {
  return process.env[name] ?? '';
}
