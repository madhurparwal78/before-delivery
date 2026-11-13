import { createReadStream, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config.js';
import { AppError } from './errors.js';
import { applySchema } from './db/index.js';
import { applyArchiveSeed } from './seed/index.js';
import { attachUser } from './http/auth.js';
import { parseBody, sameOrigin } from './http/boundary.js';
import { platformRouter } from './http/routes/platform.js';
import { exhibitionRouter } from './http/routes/exhibition.js';
import { pathRouter } from './http/routes/path.js';
import { commerceRouter } from './http/routes/commerce.js';
import { membershipRouter } from './http/routes/membership.js';
import { studioRouter } from './http/routes/studio.js';
import { boxOfficeRouter } from './http/routes/boxoffice.js';
import { startWorkers } from './workers/index.js';
import { publishedChapter } from './domain/archive.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '../web');

const PAGE_ROUTES = new Set(['/', '/timeline', '/sources', '/sessions', '/support', '/account', '/studio', '/box-office']);

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

async function pageExists(requestPath: string): Promise<boolean> {
  if (PAGE_ROUTES.has(requestPath)) return true;
  const match = /^\/chapters\/(\d+)$/.exec(requestPath);
  if (!match) return false;
  return (await publishedChapter(Number(match[1]))) !== null;
}

export async function createApp(): Promise<express.Express> {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  const api = express.Router();
  api.get('/health', (_request: Request, response: Response) => {
    response.json({ status: 'ok' });
  });
  api.use(parseBody);
  api.use(sameOrigin);
  api.use(attachUser);
  api.use(platformRouter);
  api.use(exhibitionRouter);
  api.use(pathRouter);
  api.use(commerceRouter);
  api.use(membershipRouter);
  api.use('/curator', studioRouter);
  api.use('/manager', boxOfficeRouter);
  api.use((_request: Request, _response: Response, next: NextFunction) => {
    next(new AppError('not_found'));
  });
  api.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    if (error instanceof AppError) {
      response.status(error.status).json(error.body());
      return;
    }
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    response.status(500).json({ error: { code: 'not_found', message: "We couldn't find that." } });
  });
  app.use('/api', api);

  const indexHtml = await readFile(path.join(webRoot, 'index.html'), 'utf8');

  app.get(/.*/, async (request: Request, response: Response) => {
    const requestPath = decodeURIComponent(request.path);
    if (requestPath !== '/' && !requestPath.includes('..')) {
      const candidate = path.join(webRoot, requestPath);
      if (candidate.startsWith(webRoot) && isFile(candidate) && !candidate.endsWith('index.html')) {
        const extension = path.extname(candidate);
        response.setHeader('Content-Type', CONTENT_TYPES[extension] ?? 'application/octet-stream');
        createReadStream(candidate).pipe(response);
        return;
      }
    }
    response.status((await pageExists(requestPath)) ? 200 : 404);
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.send(indexHtml);
  });

  app.use((_request: Request, response: Response) => {
    response.status(404).json({ error: { code: 'not_found', message: "We couldn't find that." } });
  });

  return app;
}

async function main(): Promise<void> {
  await applySchema();
  await applyArchiveSeed(Date.now());
  const app = await createApp();
  app.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Sightline listening on ${config.port}\n`);
  });
  startWorkers();
}

void main();
