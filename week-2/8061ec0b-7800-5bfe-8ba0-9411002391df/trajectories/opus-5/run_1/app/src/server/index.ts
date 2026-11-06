import path from 'node:path';
import express from 'express';
import { config } from './config';
import { ensureSchema, waitForDatabase } from './db';
import { materializeExpiries } from './domain/contracts';
import { boundary, errorHandler, loadUser } from './http';
import { contractsRouter } from './routes/contracts';
import { coreRouter } from './routes/core';
import { documentsRouter } from './routes/documents';
import { ensureTenantAndCatalog } from './services/killbill';
import { startOutboxWorker } from './services/mail';

const clientDirectory = path.join(__dirname, '..', 'client');

let ready = false;

const app = express();
app.disable('x-powered-by');
app.disable('etag');

app.get('/api/health', (_req, res) => {
  if (!ready) {
    res.status(503).type('application/json; charset=utf-8').send(JSON.stringify({ status: 'starting' }));
    return;
  }
  res.status(200).type('application/json; charset=utf-8').send(JSON.stringify({ status: 'ok' }));
});

app.use('/api', boundary, loadUser, async (_req, _res, next) => {
  try {
    await materializeExpiries();
    next();
  } catch (error) {
    next(error);
  }
});

app.use('/api', coreRouter);
app.use('/api', contractsRouter);
app.use('/api', documentsRouter);

app.use('/api', (_req, res) => {
  res
    .status(404)
    .type('application/json; charset=utf-8')
    .send(JSON.stringify({ error: { code: 'not_found', message: 'Not found.' } }));
});

app.use('/api', errorHandler);

app.use(
  express.static(clientDirectory, {
    index: false,
    dotfiles: 'deny',
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }),
);

app.get(/.*/, (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(404).end();
    return;
  }
  if (path.extname(req.path) !== '') {
    res.status(404).end();
    return;
  }
  res.sendFile(path.join(clientDirectory, 'index.html'));
});

async function start(): Promise<void> {
  app.listen(config.port, '0.0.0.0');
  await waitForDatabase();
  await ensureSchema();
  ready = true;
  startOutboxWorker();
  setInterval(() => {
    void materializeExpiries().catch(() => undefined);
  }, 2000).unref();
  void ensureTenantAndCatalog().catch(() => undefined);
}

void start();
