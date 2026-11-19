import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { userFor } from './auth';
import { config, limits } from './config';
import { migrate, pool } from './db';
import { ApiError, internal, invalid, methodNotAllowed, notFound, unsupportedMediaType } from './errors';
import { holdsNul } from '../shared/text';
import { bodyReader, jsonReader, matchPath, RawBody, respondError, sendJson, type Route } from './http';
import { attachLive } from './live';
import { handlePage, notFoundPage, serveStatic } from './pages';
import { routes } from './routes';
import { ensureSeedObjects, seedOdile } from './seed';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const BINARY_TYPES = ['model/gltf-binary', 'application/octet-stream'];

function hasBody(req: IncomingMessage): boolean {
  return Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
}

function unsupportedType(route: Route, req: IncomingMessage): boolean {
  if (!route.body || !BODY_METHODS.has(req.method ?? '') || !hasBody(req)) return false;
  const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
  return route.body === 'json' ? type !== 'application/json' : !BINARY_TYPES.includes(type);
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? 'GET';
  const matches = routes.map((route) => ({ route, params: matchPath(route.path, url.pathname) })).filter((m) => m.params);
  const found = matches.find((m) => m.route.method === method);
  if (!found) {
    if (!matches.length) throw notFound();
    throw methodNotAllowed([...new Set(matches.map((m) => m.route.method))].join(', '));
  }
  if (unsupportedType(found.route, req)) throw unsupportedMediaType();
  if (holdsNul([...url.searchParams.entries()])) throw invalid('query');
  const raw = bodyReader(req, found.route.body === 'binary' ? limits.model_max_bytes : config.bodyLimit);
  const result = await found.route.handler({
    req, res, url, params: found.params!, user: await userFor(req), ip: req.socket.remoteAddress ?? '', raw, json: jsonReader(raw),
  });
  if (result instanceof RawBody) {
    res.writeHead(result.status, { 'Content-Type': result.type, 'Content-Length': result.bytes.length, ...result.headers });
    res.end(result.bytes);
  } else sendJson(res, result === undefined ? 204 : found.route.status ?? 200, result);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', config.publicUrl);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (url.pathname.startsWith('/api/')) {
      await api(req, res, url);
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (serveStatic(req, res, url.pathname) || (await handlePage(req, res, url))) return;
      notFoundPage(res, url.pathname.startsWith('/embed/'));
      return;
    }
    throw notFound();
  } catch (error) {
    if (!(error instanceof ApiError)) console.error(error);
    if (!res.headersSent) respondError(res, error instanceof ApiError ? error : internal());
  }
}

async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function main(): Promise<void> {
  await waitForDatabase();
  await migrate();
  await seedOdile();
  const server = createServer((req, res) => void handle(req, res));
  attachLive(server);
  server.listen(config.port, '0.0.0.0');
  const heal = async () => {
    if (!(await ensureSeedObjects())) setTimeout(() => void heal(), 5000).unref();
  };
  void heal();
}

void main();
