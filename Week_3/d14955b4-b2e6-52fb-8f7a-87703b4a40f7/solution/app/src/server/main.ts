import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadSigningKey } from './auth.js';
import { config } from './config.js';
import { pool, waitForDatabase, withTransaction } from './db.js';
import {
  HttpError, STREAMED, errorBody, hasBody, newNonce, notFound, parseJsonObject, readBody, sendJson, setSecurityHeaders,
} from './http.js';
import type { Ctx, Route } from './http.js';
import { SCHEMA } from './schema.js';
import { seed } from './seed.js';
import { serveAsset, servePage } from './static.js';
import { authRoutes } from './routes/auth.js';
import { hookRoutes } from './routes/hooks.js';
import { teamRoutes } from './routes/team.js';
import { threadRoutes } from './routes/threads.js';
import { widgetRoutes } from './routes/widget.js';

const MIGRATION_LOCK = 727_274;

interface Target {
  pathname: string;
  searchParams: URLSearchParams;
}

const routes: Route[] = [...authRoutes, ...threadRoutes, ...teamRoutes, ...widgetRoutes, ...hookRoutes];

let markReady: () => void = () => undefined;
const ready = new Promise<void>((resolve) => {
  markReady = resolve;
});

async function boot(): Promise<void> {
  await waitForDatabase();
  await withTransaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
    await tx.query(SCHEMA);
    await seed(tx);
  });
  await loadSigningKey();
  markReady();
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

async function handleApi(req: IncomingMessage, res: ServerResponse, target: Target, nonce: string): Promise<void> {
  if (target.pathname === '/api/health' && req.method === 'GET') return sendJson(res, 200, { status: 'ok' });
  await ready;
  let params: Record<string, string> = {};
  const matched = routes.find((candidate) => {
    const found = candidate.method === req.method ? candidate.pattern.exec(target.pathname) : null;
    if (found) params = Object.fromEntries(candidate.names.map((name, index) => [name, decodeSegment(found[index + 1] as string)]));
    return found !== null;
  });
  if (!matched || Object.values(params).some((value) => value.includes('\u0000'))) throw notFound();
  let preloaded: Buffer | null = null;
  if (req.method !== 'GET' && !matched.lazyBody) {
    preloaded = await readBody(req, matched.limit);
    const type = req.headers['content-type'] ?? '';
    const accepted = matched.kind === 'multipart' ? /^multipart\/form-data\b/i.test(type) : !hasBody(req) || /^application\/json\b/i.test(type);
    if (!accepted) throw new HttpError(415, 'unsupported_media_type', 'That media type is not supported.');
  }
  const rawBody = async (): Promise<Buffer> => (preloaded ??= await readBody(req, matched.limit));
  const ctx: Ctx = { req, res, pathname: target.pathname, searchParams: target.searchParams, params, nonce, rawBody, json: async () => parseJsonObject(await rawBody()) };
  const answer = await matched.handler(ctx);
  if (answer === STREAMED) return;
  const headers = { ...answer.headers };
  if (answer.raw !== undefined) {
    const raw = Buffer.from(answer.raw);
    res.writeHead(answer.status, { 'Content-Length': raw.length, ...headers });
    res.end(raw);
  } else if (answer.body === undefined) {
    res.writeHead(answer.status, headers);
    res.end();
  } else sendJson(res, answer.status, answer.body, headers);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const nonce = newNonce();
  setSecurityHeaders(res, nonce);
  const raw = req.url ?? '/';
  const mark = raw.indexOf('?');
  const pathname = mark < 0 ? raw : raw.slice(0, mark);
  const target: Target = { pathname, searchParams: new URLSearchParams(mark < 0 ? '' : raw.slice(mark + 1)) };
  try {
    if (pathname.startsWith('/api/')) return await handleApi(req, res, target, nonce);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw notFound();
    await ready;
    if (await serveAsset(req, res, pathname)) return;
    await servePage(req, res, pathname, nonce);
  } catch (error) {
    if (res.headersSent) return void res.end();
    if (error instanceof HttpError) return sendJson(res, error.status, errorBody(error), error.headers ?? {});
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    sendJson(res, 500, { error: { code: 'internal', message: 'Something went wrong.' } });
  }
}

const server = createServer((req, res) => void handle(req, res));
server.requestTimeout = 0;
server.listen(config.port, '0.0.0.0');

process.on('unhandledRejection', (reason) => process.stderr.write(`unhandled: ${String(reason)}\n`));
process.on('uncaughtException', (error) => process.stderr.write(`uncaught: ${error.stack ?? error.message}\n`));
process.on('SIGTERM', () => void pool.end().finally(() => process.exit(0)));

void boot();
