import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response, type NextFunction } from 'express';
import { config } from './config.js';
import { pool } from './db.js';
import { applySchema } from './store.js';
import { ensureBucket, probe } from './object-storage.js';
import router, { hub } from './routes.js';
import { startSweep, stopSweep } from './sweep.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '../../public');

const app = express();
app.disable('x-powered-by');

app.use('/api', router);

// Static client: only built files, never source, manifest, lockfiles or dot-files.
const FORBIDDEN = /\.(ts|tsx|mts|mts\.map|json|lock|env)$/i;
app.use((req, res, next) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const base = path.basename(pathname);
  if (pathname.includes('/.') || base.startsWith('.') || FORBIDDEN.test(base) || base === 'package.json' || base === 'run.json' || base === 'THIRD_PARTY_NOTICES.md' || base === 'tsconfig.json') {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  next();
});

app.use(express.static(publicDir, { index: 'index.html', fallthrough: true, dotfiles: 'ignore', maxAge: 0 }));

const indexHtml = path.join(publicDir, 'index.html');
app.get(/.*/, (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next();
    return;
  }
  fs.readFile(indexHtml, 'utf8', (err, html) => {
    if (err) {
      next();
      return;
    }
    res.status(200).type('html').send(html);
  });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = (err as { status?: number; statusCode?: number }).status ?? (err as { statusCode?: number }).statusCode ?? 500;
  if (status >= 500) {
    res.status(500).json({ error: 'internal' });
    return;
  }
  res.status(status).json({ error: 'invalid' });
});

async function waitForDatabase(): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      if (Date.now() > deadline) {
        process.exit(1);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function main(): Promise<void> {
  await waitForDatabase();
  await applySchema();
  await ensureBucket();
  void probe();

  const server = http.createServer(app);
  hub.attach(server);
  startSweep(hub);

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Airfold listening on port ${config.port}`);
  });

  const shutdown = (): void => {
    stopSweep();
    hub.close();
    server.close(() => {
      pool.end().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void main();
