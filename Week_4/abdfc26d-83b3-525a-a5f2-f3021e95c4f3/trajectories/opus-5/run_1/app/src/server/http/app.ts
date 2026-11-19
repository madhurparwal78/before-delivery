import { existsSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import { attachPrincipal } from '../auth/guard.js';
import { apiRouter } from '../routes/api.js';
import { authRouter } from '../routes/auth.js';
import { ApiError } from '../errors.js';
import { bodyBoundary } from './boundary.js';
import { asyncRoute, errorHandler, sendJson } from './respond.js';

const serverDir = dirname(fileURLToPath(import.meta.url));
const clientDir = resolve(serverDir, '../../client');

/** The paths the app's own screens occupy; anything else is not a page. */
const PAGE_ROUTES: readonly RegExp[] = [
  /^\/$/,
  /^\/gallery$/,
  /^\/pieces\/[A-Za-z0-9-]+$/,
  /^\/studio$/,
  /^\/studio\/credits$/,
  /^\/studio\/pieces\/[A-Za-z0-9-]+$/,
  /^\/library$/,
  /^\/console$/,
];

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use(bodyBoundary);
  app.use(attachPrincipal);

  app.use('/api', apiRouter);
  app.use('/auth', authRouter);

  // Built assets carry content hashes, so they may be cached hard.
  app.use(
    '/assets',
    express.static(join(clientDir, 'assets'), {
      index: false,
      fallthrough: false,
      maxAge: '1y',
      immutable: true,
      dotfiles: 'deny',
    }),
  );

  // Self-hosted OFL font files, referenced by the built stylesheet.
  app.use(
    '/fonts',
    express.static(join(clientDir, 'fonts'), {
      index: false,
      fallthrough: false,
      maxAge: '1y',
      immutable: true,
      dotfiles: 'deny',
    }),
  );

  app.get(
    '/favicon.svg',
    asyncRoute(async (_req, res) => {
      res.setHeader('content-type', 'image/svg+xml');
      res.setHeader('cache-control', 'public, max-age=86400');
      res.send(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#0a0a0b"/><path d="M8 24 L16 8 L24 24 Z" fill="#e8ff3a"/></svg>',
      );
    }),
  );

  /**
   * Only the app's own screens fall back to the shell. Source files, source maps,
   * dotfiles, the run manifest, lockfiles and dependency folders are never served.
   */
  app.get('*', (req, res, next) => {
    const path = normalize(decodeURIComponent(req.path));
    if (!PAGE_ROUTES.some((route) => route.test(path))) {
      next(ApiError.notFound());
      return;
    }
    const shell = join(clientDir, 'index.html');
    if (!existsSync(shell)) {
      sendJson(res, 503, {
        error: { code: 'internal_error', message: 'The app shell has not been built.' },
      });
      return;
    }
    res.setHeader('cache-control', 'no-store');
    res.sendFile(shell);
  });

  app.use((_req, _res, next) => {
    next(ApiError.notFound());
  });

  app.use(errorHandler);
  return app;
}
