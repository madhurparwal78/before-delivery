import express, { type Request, type Response } from 'express';
import { config } from './config.js';
import { ensureSchema } from './db.js';
import { registerApi } from './api.js';
import { ApiError } from '../shared/errors.js';
import { sendApiError, isDbFailure } from './boundary.js';
import { storyPage, managePage, signinPage, partnerPage, privacyPage, notFoundPage } from './pages.js';
import { runDueReminders } from './scheduler.js';
import { drainOutbox } from './outbox.js';
import { COOKIE_NAME } from './sessions.js';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const app = express();

// A tiny cookie reader; the app only needs one cookie.
function readCookie(req: Request, res: Response): void {
  const raw = req.headers.cookie;
  const jar: Record<string, string> = {};
  if (raw) {
    for (const part of raw.split(';')) {
      const idx = part.indexOf('=');
      if (idx > 0) jar[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    }
  }
  res.locals.cookies = jar;
  (req as Request & { cookies?: Record<string, string> }).cookies = jar;
}

app.disable('x-powered-by');
app.use((req, res, next) => {
  readCookie(req, res);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'self'",
  );
  next();
});

const apiRouter = express.Router();
registerApi(apiRouter);

// Known paths with the wrong method answer 405.
const methods405 = ['/health', '/tonight', '/plans', '/session/request', '/session/verify', '/session/end', '/me/plan', '/me/share', '/me'];
for (const path of methods405) {
  apiRouter.all(path, (req, res) => {
    sendApiError(res, new ApiError('method_not_allowed'));
  });
}
apiRouter.all('/share/:token', (req, res) => {
  sendApiError(res, new ApiError('method_not_allowed'));
});
if (config.testClock) {
  apiRouter.all('/test/clock', (req, res) => {
    sendApiError(res, new ApiError('method_not_allowed'));
  });
}
apiRouter.use((req, res) => {
  sendApiError(res, new ApiError('not_found'));
});
app.use('/api', apiRouter);

const publicDir = resolve('public');
app.use(
  express.static(publicDir, {
    index: false,
    fallthrough: true,
    maxAge: '1y',
    immutable: true,
  }),
);

function page(res: Response, html: string, status = 200): void {
  res.status(status).type('html').send(html);
}

app.get('/', (req, res) => page(res, storyPage()));
app.get('/manage', (req, res) => page(res, managePage()));
app.get('/signin', (req, res) => page(res, signinPage()));
app.get('/privacy', (req, res) => page(res, privacyPage()));
app.get('/p/:token', (req, res) => page(res, partnerPage()));
app.use((req, res) => page(res, notFoundPage(), 404));

app.use((err: unknown, req: Request, res: Response, _next: (e?: unknown) => void) => {
  if (res.headersSent) return;
  if (req.path.startsWith('/api')) {
    sendApiError(res, err);
    return;
  }
  res.status(500).type('html').send('<!doctype html><html><body><h1>Something went wrong on our side. Please try again.</h1></body></html>');
});

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`Stillhour listening on 0.0.0.0:${config.port}`);
  ensureSchema().then(() => {
    runDueReminders().catch(() => undefined);
  }).catch(() => undefined);
});

setInterval(() => {
  runDueReminders().catch(() => undefined);
}, 30_000).unref();
setInterval(() => {
  drainOutbox().catch(() => undefined);
}, 15_000).unref();

process.on('uncaughtException', (err) => {
  if (isDbFailure(err)) return;
  console.error('unexpected failure');
});
