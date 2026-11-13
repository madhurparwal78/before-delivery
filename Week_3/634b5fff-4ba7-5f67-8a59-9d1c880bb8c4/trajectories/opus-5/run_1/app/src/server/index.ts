import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config.js';
import { ApiError, fail, sendError } from './errors.js';
import { attachStaff, readBody, refuseForeignOrigin } from './http.js';
import { authRouter } from './routes/auth.js';
import { callbacksRouter } from './routes/callbacks.js';
import { checkoutRouter } from './routes/checkout.js';
import { holdsRouter } from './routes/holds.js';
import { publicRouter } from './routes/public.js';
import { staffRouter } from './routes/staff.js';
import { startScheduler } from './scheduler.js';
import { startSeeding } from './seed.js';
import { identityFromAccessToken } from './services/identity.js';
import { startValkey } from './services/valkey.js';

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(here, '../../client');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', false);

app.use(readBody);
app.use(refuseForeignOrigin);

app.use(attachStaff(identityFromAccessToken));

app.use(publicRouter);
app.use(holdsRouter);
app.use(checkoutRouter);
app.use(callbacksRouter);
app.use(staffRouter);
app.use(authRouter);

app.use('/api', (unusedRequest: Request, res: Response) => {
  sendError(res, fail(404, 'not_found'));
});

app.use(
  express.static(clientRoot, {
    index: false,
    dotfiles: 'deny',
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  }),
);

/**
 * Every route of the one scene-backed page serves its document; anything that
 * asks for a file by name and is not a built asset is not here.
 */
app.get('*', (req: Request, res: Response) => {
  const lastSegment = req.path.slice(req.path.lastIndexOf('/') + 1);
  const page = join(clientRoot, 'index.html');
  if (req.path.includes('..') || lastSegment.includes('.') || !existsSync(page)) {
    sendError(res, fail(404, 'not_found'));
    return;
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(page);
});

app.use((error: Error, unusedRequest: Request, res: Response, unusedNext: NextFunction) => {
  if (error instanceof ApiError) {
    sendError(res, error);
    return;
  }
  process.stderr.write(`unhandled: ${error.stack ?? error.message}\n`);
  sendError(res, fail(404, 'not_found'));
});

startValkey();
startSeeding();
startScheduler();

app.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`Svovlstik Press listening on ${config.port}\n`);
});
