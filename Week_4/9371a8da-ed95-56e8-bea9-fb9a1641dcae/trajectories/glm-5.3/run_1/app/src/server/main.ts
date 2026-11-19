import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { readConfig } from './config.js';
import { createSql, ensureSchema } from './db.js';
import { SCHEMA_SQL } from './schema.js';
import { Storage } from './storage.js';
import { Mailer } from './mail.js';
import { seed } from '../seed/seed.js';
import { ApiError, sendError } from './errors.js';
import { registerRoutes } from './routes/index.js';
import { ensureMentionWorker } from './mention-worker.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../../public');

const config = readConfig();
const sql = createSql(config.databaseUrl);
const storage = new Storage(config.s3);
const mailer = new Mailer(config.smtp);

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.path.startsWith('/api/share/') || req.path.startsWith('/s/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

// The server boundary: a state-changing request from another origin is refused.
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.origin;
    if (origin) {
      try {
        const o = new URL(origin);
        const host = req.headers.host;
        if (o.host !== host) {
          res.status(403).json({ error: 'cross_origin' });
          return;
        }
      } catch {
        res.status(403).json({ error: 'cross_origin' });
        return;
      }
    }
  }
  next();
});

registerRoutes(app, { sql, storage, mailer, config });

/** Serve only the built pages, scripts, styles, fonts and icons. */
const publicFiles = new Set(['index.html', 'app.js', 'styles.css', 'favicon.svg']);

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const rel = decodeURIComponent(req.path.replace(/^\/+/, ''));
  if (publicFiles.has(rel) || rel.startsWith('fonts/') || rel.startsWith('icons/')) {
    const target = path.resolve(publicDir, rel);
    if (target.startsWith(publicDir + path.sep)) {
      res.sendFile(target, (err) => {
        if (err) res.status(404).send('Not found');
      });
      return;
    }
  }
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  // The single-page routes.
  res.sendFile(path.join(publicDir, 'index.html'), (err) => {
    if (err) res.status(404).send('Not found');
  });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) sendError(res, err);
  else {
    console.error('unexpected', err);
    res.status(500).json({ error: 'internal' });
  }
});

const port = config.port;

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`marginalia listening on ${port}`);
});

async function connectDb(): Promise<void> {
  for (;;) {
    try {
      await ensureSchema(sql, SCHEMA_SQL);
      await seed(sql);
      return;
    } catch (err) {
      console.log('database unreachable, retrying', err instanceof Error ? err.message : err);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

void connectDb().then(() => {
  ensureMentionWorker({ sql, storage, mailer, config });
});
void server;
