/**
 * The app: pages, the API and its own media, on one origin.
 */

import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { config } from './config.js';
import { migrate, pool, one } from './db.js';
import { seed } from './seed.js';
import { ensureMedia } from './media.js';
import { api } from './api/index.js';
import { pages, notFoundPage } from './pages.js';
import { resolveMember, Refusal } from './http.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.set('query parser', 'simple');

// One structured line per request, carrying the identifier the response
// returns in X-Request-Id.
app.use((req, res, next) => {
  const requestId = crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  const started = process.hrtime.bigint();
  const requestPath = req.originalUrl.split('?')[0];
  let logged = false;
  const write = () => {
    if (logged) return;
    logged = true;
    const line = {
      level: 'info',
      ts: new Date().toISOString(),
      request_id: requestId,
      method: req.method,
      path: requestPath,
      status: res.statusCode,
      duration_ms: Number(process.hrtime.bigint() - started) / 1e6,
      member: req.member ? req.member.username : null,
      bytes: Number(res.getHeader('content-length') || 0),
    };
    process.stdout.write(`${JSON.stringify(line)}\n`);
  };
  res.on('finish', write);
  res.on('close', write);
  next();
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  next();
});

// Raw body for uploads, JSON for everything else.
app.use(express.json({ limit: '1mb' }));
app.use(express.raw({ type: 'multipart/form-data', limit: '8mb' }));
app.use((req, res, next) => {
  if (Buffer.isBuffer(req.body)) {
    req.rawBody = req.body;
    req.body = {};
  }
  next();
});

app.use((req, res, next) => {
  resolveMember(req)
    .then((member) => {
      req.member = member;
      next();
    })
    .catch(next);
});

app.use('/css', express.static(path.join(ROOT, 'public', 'css'), { maxAge: '5m' }));
app.use('/js', express.static(path.join(ROOT, 'public', 'js'), { maxAge: '5m' }));
app.use('/media', express.static(path.join(ROOT, 'public', 'media'), { maxAge: '1h' }));

// An uploaded picture, served from the store as a 256 by 256 PNG.
app.get('/media/members/:id.png', (req, res, next) => {
  one('select avatar_bytes from members where id = $1', [req.params.id])
    .then((row) => {
      if (!row || !row.avatar_bytes) {
        res.redirect(302, '/media/avatars/avatar_01.png');
        return;
      }
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(row.avatar_bytes);
    })
    .catch(next);
});

app.use('/api', api);
app.use(pages);

// A game that may not be seen, a game that does not exist and an unknown
// address all answer the same way.
app.use((req, res) => {
  res.status(404);
  if (req.path.startsWith('/api/')) {
    res.json({ error: 'There is nothing at that address.', request_id: req.requestId });
    return;
  }
  res.send(notFoundPage(req.member || null));
});

app.use((error, req, res, next) => {
  const status = error instanceof Refusal ? error.status : (error.status || error.statusCode || 500);
  const message = error instanceof Refusal || (status >= 400 && status < 500)
    ? error.message
    : 'Something went wrong in the club. Please try that again.';
  if (status >= 500) {
    process.stdout.write(`${JSON.stringify({
      level: 'error', ts: new Date().toISOString(), request_id: req.requestId,
      msg: error.message, stack: error.stack,
    })}\n`);
  }
  if (res.headersSent) return;
  res.status(status);
  if (req.path.startsWith('/api/') || req.get('accept')?.includes('application/json')) {
    res.json({ error: message, request_id: req.requestId });
    return;
  }
  if (status === 404) {
    res.send(notFoundPage(req.member || null));
    return;
  }
  res.send(notFoundPage(req.member || null));
});

async function start() {
  await migrate();
  await ensureMedia();
  const counts = await seed();
  process.stdout.write(`${JSON.stringify({
    level: 'info', ts: new Date().toISOString(), msg: 'seed ready', counts,
  })}\n`);

  const server = app.listen(config.port, config.host, () => {
    process.stdout.write(`${JSON.stringify({
      level: 'info', ts: new Date().toISOString(), msg: 'listening',
      host: config.host, port: config.port, url: config.publicUrl,
    })}\n`);
  });

  const shutdown = async (signal) => {
    process.stdout.write(`${JSON.stringify({ level: 'info', msg: 'shutting down', signal })}\n`);
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((error) => {
  process.stdout.write(`${JSON.stringify({
    level: 'fatal', ts: new Date().toISOString(), msg: error.message, stack: error.stack,
  })}\n`);
  process.exit(1);
});

export { app };
