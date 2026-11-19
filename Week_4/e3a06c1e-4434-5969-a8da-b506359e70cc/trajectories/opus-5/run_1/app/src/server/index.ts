import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureAllOrgAccounts, startBillingWorker } from './billing.js';
import { config } from './config.js';
import { applySchema } from './db/schema.js';
import { pool } from './db/pool.js';
import { startQuotaWatch } from './engine.js';
import { checkBodyHeaders, readJsonBody, readMultipartBody, type MultipartBody } from './http/body.js';
import { crossOrigin, notFound } from './http/errors.js';
import { parseCookies, Router, sendError, sendReply, type Ctx } from './http/router.js';
import { registerOrgRoutes } from './routes/orgroutes.js';
import { registerProjectRoutes } from './routes/projectroutes.js';
import { registerPublicRoutes } from './routes/publicroutes.js';
import { registerReviewRoutes } from './routes/reviewroutes.js';
import { registerSessionRoutes } from './routes/sessionroutes.js';
import { registerSynthesisRoutes } from './routes/synthroutes.js';
import { applySeed, uploadSeedArtifacts } from './seed.js';
import { ensureCatalog } from './services/killbill.js';
import { handleListenUpgrade, registerListenRoute } from './ws/listen.js';

const publicDir = path.join(import.meta.dirname, '..', 'public');

const emptyMultipart: MultipartBody = { fields: {}, files: {} };

const router = new Router();
registerPublicRoutes(router);
registerProjectRoutes(router);
registerSessionRoutes(router);
registerReviewRoutes(router);
registerSynthesisRoutes(router);
registerOrgRoutes(router);
registerListenRoute(router);

const appRoutes: readonly RegExp[] = [
  /^\/$/,
  /^\/sign-in$/,
  /^\/join\/[^/]+$/,
  /^\/console\/projects$/,
  /^\/console\/projects\/[^/]+\/(keys|sessions|review|synthesis|settings)$/,
  /^\/console\/sessions\/[^/]+$/,
  /^\/console\/usage$/,
  /^\/console\/org\/(members|plan)$/,
];

const assetTypes: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

const writeMode = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

const serveAsset = async (res: ServerResponse, name: string): Promise<boolean> => {
  const extension = path.extname(name);
  const contentType = assetTypes[extension];
  if (contentType === undefined || name.includes('..') || name.includes('/')) return false;
  let body: Buffer;
  try {
    body = await readFile(path.join(publicDir, 'assets', name));
  } catch {
    return false;
  }
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': String(body.length),
    'cache-control': 'public, max-age=31536000, immutable',
  });
  res.end(body);
  return true;
};

const serveDocument = async (res: ServerResponse): Promise<void> => {
  const body = await readFile(path.join(publicDir, 'index.html'));
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-cache',
  });
  res.end(body);
};

const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const method = req.method ?? 'GET';
  const host = req.headers.host ?? `localhost:${config.port}`;
  const url = new URL(req.url ?? '/', `http://${host}`);
  const scheme = 'encrypted' in req.socket && req.socket.encrypted === true ? 'https' : 'http';
  const origin = `${scheme}://${host}`;

  const match = router.match(method, url.pathname);
  if (match !== null) {
    checkBodyHeaders(req, match.bodyKind);
    if (url.pathname.startsWith('/api/') && writeMode.has(method)) {
      const sent = req.headers.origin;
      if (sent !== undefined && sent !== origin) throw crossOrigin();
    }
    const ctx: Ctx = {
      req,
      res,
      method,
      path: url.pathname,
      params: match.params,
      search: url.searchParams,
      cookies: parseCookies(req.headers.cookie),
      origin,
      body: match.bodyKind === 'json' ? await readJsonBody(req) : {},
      multipart: match.bodyKind === 'multipart' ? await readMultipartBody(req) : emptyMultipart,
    };
    sendReply(res, await match.handler(ctx));
    return;
  }

  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/v1/') || url.pathname.startsWith('/fixtures/'))
    throw notFound();

  if (method === 'GET' || method === 'HEAD') {
    if (url.pathname.startsWith('/assets/')) {
      if (await serveAsset(res, url.pathname.slice('/assets/'.length))) return;
      throw notFound();
    }
    if (appRoutes.some((pattern) => pattern.test(url.pathname))) {
      await serveDocument(res);
      return;
    }
  }
  throw notFound();
};

const retryUntil = async (label: string, run: () => Promise<void>): Promise<void> => {
  for (;;) {
    try {
      await run();
      return;
    } catch (error) {
      console.warn(`${label} not ready, retrying`, error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
};

const start = async (): Promise<void> => {
  await retryUntil('postgres', applySchema);
  await retryUntil('seed', applySeed);

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => sendError(res, error));
  });
  server.on('upgrade', handleListenUpgrade);
  server.headersTimeout = 0;
  server.requestTimeout = 0;
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`lowfield console listening on ${config.port}`);
  });

  startQuotaWatch();
  startBillingWorker();

  void retryUntil('kill bill catalog', async () => {
    await ensureCatalog();
    await ensureAllOrgAccounts();
  });

  const artifacts = setInterval(() => {
    void uploadSeedArtifacts()
      .then(() => clearInterval(artifacts))
      .catch(() => undefined);
  }, 5000);
};

void start().catch((error: unknown) => {
  console.error('failed to start', error);
  void pool.end();
  process.exitCode = 1;
});
