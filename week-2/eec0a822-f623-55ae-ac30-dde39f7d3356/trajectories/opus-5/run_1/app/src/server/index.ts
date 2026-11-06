import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { waitForDatabase } from './db.js';
import { applySchema, seedIfEmpty } from './seed.js';
import { ApiError, notFound, tooLarge } from './http/errors.js';
import {
  JSON_BODY_LIMIT,
  MULTIPART_ENVELOPE_ALLOWANCE,
  parseCookies,
  Router,
  type Ctx,
  type Reply,
} from './http/router.js';
import { registerSessionRoutes } from './routes/session.js';
import { registerMemberRoutes } from './routes/members.js';
import { registerPublicRoutes } from './routes/publicFleet.js';
import { registerYachtRoutes } from './routes/yachts.js';
import { registerHoldRoutes } from './routes/holds.js';
import { registerCharterRoutes } from './routes/charters.js';
import { registerManifestRoutes } from './routes/manifest.js';
import { registerBrokerRoutes } from './routes/brokers.js';
import { registerPassageRoutes } from './routes/passages.js';
import { registerRotaRoutes } from './routes/rota.js';
import { registerMarinaRoutes } from './routes/marinas.js';
import { registerStoreRoutes } from './routes/stores.js';
import { registerEnergyRoutes } from './routes/energy.js';
import { createPageRouter } from './routes/pages.js';
import { renderShell } from './shell.js';
import { startTimedWork } from './sweep.js';
import { ensureBucket } from './services/storage.js';

const apiRouter = new Router();
registerSessionRoutes(apiRouter);
registerMemberRoutes(apiRouter);
registerPublicRoutes(apiRouter);
registerYachtRoutes(apiRouter);
registerHoldRoutes(apiRouter);
registerCharterRoutes(apiRouter);
registerManifestRoutes(apiRouter);
registerBrokerRoutes(apiRouter);
registerPassageRoutes(apiRouter);
registerRotaRoutes(apiRouter);
registerMarinaRoutes(apiRouter);
registerStoreRoutes(apiRouter);
registerEnergyRoutes(apiRouter);

const pageRouter = createPageRouter();

const assetRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');

const ASSET_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

function readBody(
  request: IncomingMessage,
  limitBytes: number,
  reportedLimit: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limitBytes) {
        request.destroy();
        reject(tooLarge(reportedLimit));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

async function serveAsset(path: string): Promise<Reply> {
  const relative = normalize(path.slice('/assets/'.length));
  if (relative.startsWith('..')) throw notFound();
  const extension = relative.slice(relative.lastIndexOf('.'));
  const contentType = ASSET_TYPES[extension];
  if (contentType === undefined) throw notFound();
  try {
    const content = await readFile(join(assetRoot, relative));
    return {
      status: 200,
      body: content,
      contentType,
      headers: { 'Cache-Control': 'public, max-age=3600' },
    };
  } catch {
    throw notFound();
  }
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? 'GET';
  const url = new URL(request.url ?? '/', 'http://localhost');
  const path = url.pathname.length > 1 && url.pathname.endsWith('/')
    ? url.pathname.slice(0, -1)
    : url.pathname;
  const setCookies: string[] = [];
  try {
    if (path.startsWith('/assets/')) {
      if (method !== 'GET') throw new ApiError(405, { error: 'method_not_allowed' }, { Allow: 'GET' });
      send(response, await serveAsset(path), setCookies);
      return;
    }
    const api = apiRouter.match(path);
    if (api !== null) {
      const route = api.route;
      if (!(method in route.methods)) {
        throw new ApiError(405, { error: 'method_not_allowed' }, { Allow: route.allow });
      }
      const fileLimit = route.options.fileLimitBytes;
      const limit =
        fileLimit === undefined ? JSON_BODY_LIMIT : fileLimit + MULTIPART_ENVELOPE_ALLOWANCE;
      const reported = fileLimit ?? JSON_BODY_LIMIT;
      const ctx: Ctx = {
        method,
        path,
        query: url.searchParams,
        params: api.params,
        headers: request.headers,
        rawBody: await readBody(request, limit, reported),
        cookies: parseCookies(request.headers),
        now: new Date(),
        setCookies,
      };
      send(response, await route.methods[method](ctx), setCookies);
      return;
    }
    if (path.startsWith('/api/')) throw notFound();
    const page = pageRouter.match(path);
    if (page !== null) {
      if (!(method in page.route.methods)) {
        throw new ApiError(405, { error: 'method_not_allowed' }, { Allow: page.route.allow });
      }
      const ctx: Ctx = {
        method,
        path,
        query: url.searchParams,
        params: page.params,
        headers: request.headers,
        rawBody: Buffer.alloc(0),
        cookies: parseCookies(request.headers),
        now: new Date(),
        setCookies,
      };
      send(response, await page.route.methods[method](ctx), setCookies);
      return;
    }
    send(
      response,
      { status: 404, body: renderShell(), contentType: 'text/html; charset=utf-8' },
      setCookies,
    );
  } catch (error) {
    if (error instanceof ApiError) {
      sendError(response, error, path, setCookies);
      return;
    }
    process.stderr.write(`${String(error)}\n`);
    send(response, { status: 500, json: { error: 'server_error' } }, setCookies);
  }
}

function sendError(
  response: ServerResponse,
  error: ApiError,
  path: string,
  setCookies: string[],
): void {
  const wantsHtml = !path.startsWith('/api/') && path !== '/sitemap.xml' && !path.startsWith('/assets/');
  if (wantsHtml && (error.status === 404 || error.status === 410)) {
    send(
      response,
      {
        status: error.status,
        body: renderShell(),
        contentType: 'text/html; charset=utf-8',
        headers: error.extraHeaders,
      },
      setCookies,
    );
    return;
  }
  send(
    response,
    { status: error.status, json: error.payload, headers: error.extraHeaders },
    setCookies,
  );
}

function send(response: ServerResponse, reply: Reply, setCookies: string[]): void {
  const headers: Record<string, string | string[]> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...reply.headers,
  };
  if (setCookies.length > 0) headers['Set-Cookie'] = setCookies;
  let body: Buffer;
  if (reply.json !== undefined) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    body = Buffer.from(JSON.stringify(reply.json), 'utf8');
  } else if (reply.body === undefined) {
    body = Buffer.alloc(0);
  } else {
    headers['Content-Type'] = reply.contentType ?? 'text/plain; charset=utf-8';
    body = typeof reply.body === 'string' ? Buffer.from(reply.body, 'utf8') : reply.body;
  }
  headers['Content-Length'] = String(body.length);
  response.writeHead(reply.status, headers);
  response.end(body);
}

async function start(): Promise<void> {
  await waitForDatabase();
  await applySchema();
  await seedIfEmpty();
  await ensureBucket().catch(() => undefined);
  startTimedWork();
  createServer((request, response) => {
    void handle(request, response);
  }).listen(config.port, '0.0.0.0');
}

void start();
