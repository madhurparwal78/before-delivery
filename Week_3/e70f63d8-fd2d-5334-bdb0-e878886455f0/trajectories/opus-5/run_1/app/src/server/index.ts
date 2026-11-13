import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MSG } from '../shared/messages.js';
import { currentUser, handleApi } from './api.js';
import { config } from './config.js';
import { ensureSchema } from './db.js';
import { HttpError } from './errors.js';
import { handleGrading } from './grading.js';
import {
  type Ctx,
  cookiesOf,
  parseJson,
  readBody,
  sendBytes,
  sendHtml,
  sendJson,
} from './http.js';
import { notFoundPage } from './pages.js';
import { handlePage } from './routes.js';
import { ensureBucket } from './storage.js';
import { handleUpgrade, startSockets } from './ws.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function serveFile(res: ServerResponse, base: string, relative: string): Promise<boolean> {
  const target = join(base, normalize(relative).replace(/^(\.\.(\/|\\|$))+/, ''));
  if (!target.startsWith(base)) return false;
  try {
    const bytes = await readFile(target);
    const extension = target.slice(target.lastIndexOf('.'));
    sendBytes(res, 200, bytes, MIME[extension] ?? 'application/octet-stream', 'public, max-age=3600');
    return true;
  } catch {
    return false;
  }
}

function bodyLimit(path: string[], method: string): number {
  if (path[1] === 'grading' && path[2] === 'seed') return config.maxSeedBytes;
  if (method === 'POST' && path[path.length - 1] === 'logo') {
    return config.logoMaxBytes + config.maxJsonBytes;
  }
  return config.maxJsonBytes;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const segments = url.pathname.split('/').filter((part) => part.length > 0).map(decodeURIComponent);
  const isApi = segments[0] === 'api';
  const ctx: Ctx = {
    req,
    res,
    url,
    method: req.method ?? 'GET',
    cookies: cookiesOf(req),
    rawBody: null,
    parsed: null,
  };

  try {
    if (!isApi && ctx.method === 'GET') {
      if (url.pathname === '/styles.css') {
        if (await serveFile(res, join(root, 'public'), 'styles.css')) return;
      }
      if (segments[0] === 'fonts') {
        if (await serveFile(res, join(root, 'public', 'fonts'), segments.slice(1).join('/'))) return;
      }
      if (segments[0] === 'js') {
        if (await serveFile(res, join(root, 'dist', 'client'), segments.slice(1).join('/'))) return;
      }
    }

    if (ctx.method === 'POST' || ctx.method === 'PUT' || ctx.method === 'PATCH') {
      ctx.rawBody = await readBody(req, bodyLimit(segments, ctx.method));
      const contentType = req.headers['content-type'] ?? '';
      if (!contentType.includes('multipart/form-data')) {
        ctx.parsed = parseJson(ctx.rawBody);
      }
    }

    if (isApi && segments[1] === 'grading') {
      if (await handleGrading(ctx, segments.slice(2))) return;
      throw new HttpError(404, 'NOT_FOUND', MSG.notFound);
    }

    if (isApi) {
      await handleApi(ctx, segments);
      return;
    }

    const user = await currentUser(ctx);
    await handlePage(ctx, segments, user);
  } catch (error) {
    if (res.headersSent) return;
    if (error instanceof HttpError) {
      if (isApi) sendJson(res, error.status, error.body());
      else if (error.status === 404) sendHtml(res, 404, notFoundPage(false));
      else sendJson(res, error.status, error.body());
      return;
    }
    process.stderr.write(`${String(error)}\n`);
    if (isApi) sendJson(res, 500, { error: { code: 'INTERNAL', message: MSG.serverError } });
    else sendHtml(res, 500, notFoundPage(false));
  }
}

const server = createServer((req, res) => {
  void handle(req, res);
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  handleUpgrade(req, socket, head);
});

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`overcall listening on ${config.port}\n`);
});

startSockets();

void (async () => {
  await ensureSchema();
  await ensureBucket();
})();
