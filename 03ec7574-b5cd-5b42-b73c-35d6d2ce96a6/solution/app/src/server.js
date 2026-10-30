import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { apiRouter } from './api.js';
import { state } from './db.js';
import { prepareDatabase } from './seed.js';
import { sweepExpired } from './services/intents.js';
import { notFoundPage, pageErrors, webRouter } from './web/routes.js';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const BOOT_RETRY_MS = 2000;
const SWEEP_MS = 1000;

const app = express();
app.disable('x-powered-by');
app.set('query parser', 'simple');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  });
  next();
});
app.use('/static', express.static(path.join(root, 'public', 'build'), { maxAge: '1h', fallthrough: true, index: false }));
app.use('/api', apiRouter());
app.use(webRouter());
app.use(notFoundPage);
app.use(pageErrors);

// The server listens at once; the schema and the seed are retried every 2 seconds until PostgreSQL answers.
async function boot() {
  try {
    await prepareDatabase();
    state.ready = true;
    console.log('database ready');
  } catch (err) {
    console.error(`database not ready: ${err.message}`);
    setTimeout(boot, BOOT_RETRY_MS);
  }
}

// Expiry is applied on every read and decision, and by this sweep within a second or two of expires_at.
async function sweep() {
  if (state.ready) await sweepExpired().catch(() => {});
  setTimeout(sweep, SWEEP_MS);
}

const server = app.listen(config.port, config.host, () => {
  console.log(`corvo listening on ${config.host}:${config.port} as ${config.publicUrl || 'its own host'}`);
  boot();
  sweep();
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
