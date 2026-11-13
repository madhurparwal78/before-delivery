import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { applySchema } from './schema';
import { pool, withClient } from './db';
import { errorBody, AppError, notFound } from './errors';
import { seed } from './seed';
import { app } from './routes';
import './routes-editor';
import './routes-public';

import { deliverPending } from './mail';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.join(__dirname, '..', 'client');
const PORT = Number(process.env.APP_PUBLIC_PORT ?? 4173);

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    await applySchema(client);
  } finally {
    client.release();
  }
  await seed().catch((e) => {
    console.error('seed failed', e);
  });

  // health first
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // unknown API paths
  app.use('/api', (req, res) => {
    res.status(404).json(errorBody(notFound()));
  });

  // never serve source, config or manifests
  const FORBIDDEN = /^\/(src|node_modules|run\.json|package\.json|package-lock\.json|tsconfig\.json|\.env|build\.mjs|dist\/server)/;

  // static client files
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    const urlPath = decodeURIComponent((req.path.split('?')[0] ?? '/'));
    if (FORBIDDEN.test(urlPath)) {
      res.status(404).send(notFoundPage());
      return;
    }
    const candidates = [
      path.join(clientRoot, urlPath),
    ];
    if (urlPath.endsWith('/')) candidates.push(path.join(clientRoot, urlPath, 'index.html'));
    candidates.push(path.join(clientRoot, urlPath + '.html'));
    candidates.push(path.join(clientRoot, urlPath, 'index.html'));
    for (const candidate of candidates) {
      if (!candidate.startsWith(clientRoot)) continue;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        res.sendFile(candidate);
        return;
      }
    }
    // SPA fallback for pages
    res.sendFile(path.join(clientRoot, 'index.html'));
  });

  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    if (err instanceof AppError) {
      res.status(err.status).json(errorBody(err));
      return;
    }
    const status = (err as { status?: number }).status ?? (err as { statusCode?: number }).statusCode ?? 500;
    const code = (err as { code?: string }).code ?? 'internal_error';
    const message = status === 503 && (err as { storeDown?: boolean }).storeDown
      ? 'A required service is unreachable.'
      : 'Something went wrong.';
    res.status(status).json({ error: { code, message } });
  });

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Rampwright serving on http://0.0.0.0:${PORT}`);
  });
  server.headersTimeout = 65000;
  server.requestTimeout = 0;
  server.keepAliveTimeout = 61000;

  // mail delivery loop
  setInterval(() => {
    void withClient(async (client) => {
      await deliverPending(client);
    }).catch(() => {});
  }, 5000);
}

function notFoundPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Not found</title></head><body><h1>We couldn't find that page</h1></body></html>`;
}

main().catch((e) => {
  console.error('failed to start', e);
  process.exit(1);
});
