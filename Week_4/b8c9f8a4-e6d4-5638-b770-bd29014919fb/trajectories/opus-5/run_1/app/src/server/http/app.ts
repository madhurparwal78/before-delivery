import { join } from 'node:path';
import express, { Router, type Request, type Response } from 'express';
import { refuse } from '../domain/errors';
import { asRecord } from './validate';
import {
  CAPTURE_BODY_LIMIT,
  JSON_BODY_LIMIT,
  errorHandler,
  jsonBody,
  originGuard,
  uploadRequestGuard,
} from './boundary';
import { linkRouter } from './linkRoutes';
import { ownerRouter } from './ownerRoutes';
import { pageRouter } from './pages';
import { requireOwner, signIn, signOutEverywhere } from './session';

const asyncRoute =
  (handler: (request: Request, response: Response) => Promise<void>) =>
  (request: Request, response: Response, next: express.NextFunction): void => {
    handler(request, response).catch(next);
  };

export const buildApp = (): express.Express => {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use(originGuard);

  app.get('/api/health', (_request: Request, response: Response) => {
    response.json({ status: 'ok' });
  });

  const sessionRouter = Router();
  sessionRouter.use(jsonBody(JSON_BODY_LIMIT));
  sessionRouter.post(
    '/',
    asyncRoute(async (request, response) => {
      const body = asRecord(request.body);
      const passphrase = typeof body.passphrase === 'string' ? body.passphrase : '';
      await signIn(passphrase, response);
      response.json({ signedIn: true });
    }),
  );
  sessionRouter.delete(
    '/',
    asyncRoute(async (_request, response) => {
      await signOutEverywhere(response);
      response.status(204).end();
    }),
  );
  app.use('/api/owner/session', sessionRouter);

  // One reader for the whole owner API, so a body is never read twice.
  const readJsonBody = jsonBody(JSON_BODY_LIMIT);
  const ownerBody = (request: Request, response: Response, next: express.NextFunction): void => {
    if (request.method === 'POST' && request.path.endsWith('/uploads')) {
      uploadRequestGuard(request, response, next);
      return;
    }
    readJsonBody(request, response, next);
  };
  app.use('/api/owner', requireOwner, ownerBody, ownerRouter);

  // One reader for the whole link API, so a body is never read twice.
  app.use(
    '/api/link',
    jsonBody((request) => (request.path.endsWith('/capture') ? CAPTURE_BODY_LIMIT : JSON_BODY_LIMIT)),
    linkRouter,
  );

  app.use('/api', (_request: Request, _response: Response, next: express.NextFunction) => {
    next(refuse(404, 'not_found', 'That route could not be found'));
  });

  app.use(
    express.static(join(__dirname, '..', '..', 'public'), {
      index: false,
      dotfiles: 'ignore',
      setHeaders: (response, path) => {
        if (path.endsWith('.woff2')) response.setHeader('Cache-Control', 'public, max-age=86400');
      },
    }),
  );

  app.use(pageRouter);

  app.use((_request: Request, response: Response) => {
    response.status(404).type('txt').send('Not found');
  });

  app.use(errorHandler);

  return app;
};
