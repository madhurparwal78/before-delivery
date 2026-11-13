import { IncomingMessage, ServerResponse, createServer } from 'node:http';
import { config } from './config';
import { pool, waitForDatabase } from './db/pool';
import { applySchemaAndSeed } from './db/seed';
import { releaseExpiredHolds } from './domain/holds';
import { ApiError } from './errors';
import { Reply, RequestContext } from './http';
import { RouteMatch, bodyLimitFor, matchRoute } from './routes';
import { ensureBucket } from './services/s3';
import './services/killbill';
import { SESSION_COOKIE, readCookie, userForSession } from './session';
import { serveStatic } from './static';

const STATE_CHANGING = ['POST', 'PUT', 'DELETE', 'PATCH'];

interface BodyRead {
  body: Buffer;
  tooLarge: boolean;
}

function readBody(request: IncomingMessage, limit: number): Promise<BodyRead> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let tooLarge = false;
    request.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve({ body: Buffer.concat(chunks), tooLarge }));
    request.on('error', reject);
  });
}

function sendReply(response: ServerResponse, reply: Reply): void {
  const headers: Record<string, string | string[]> = { 'x-content-type-options': 'nosniff', ...(reply.headers ?? {}) };
  if (reply.cookies !== undefined) headers['set-cookie'] = reply.cookies;
  if (reply.rawJson !== undefined) {
    const payload = Buffer.from(reply.rawJson, 'utf8');
    headers['content-type'] = 'application/json; charset=utf-8';
    headers['content-length'] = String(payload.length);
    response.writeHead(reply.status, headers);
    response.end(payload);
    return;
  }
  if (reply.body !== undefined) {
    headers['content-length'] = String(reply.body.length);
    response.writeHead(reply.status, headers);
    response.end(reply.body);
    return;
  }
  if (reply.json === undefined) {
    response.writeHead(reply.status, headers);
    response.end();
    return;
  }
  const payload = Buffer.from(JSON.stringify(reply.json), 'utf8');
  headers['content-type'] = 'application/json; charset=utf-8';
  headers['content-length'] = String(payload.length);
  response.writeHead(reply.status, headers);
  response.end(payload);
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined || origin === 'null') return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function contentTypeOf(request: IncomingMessage): string {
  return (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

function checkBoundary(request: IncomingMessage, match: RouteMatch | null, read: BodyRead): unknown {
  if (STATE_CHANGING.includes(request.method ?? 'GET') && !sameOrigin(request)) throw new ApiError('cross_origin');
  if (read.tooLarge) throw new ApiError('too_large');

  const declared = contentTypeOf(request);
  const isPhotoRoute = match !== null && match.route.bodyKind === 'photo' && match.methodMatches;
  if (isPhotoRoute) {
    if (declared !== 'image/jpeg' && declared !== 'image/png') throw new ApiError('unsupported_media_type');
    return {};
  }
  if (declared !== '' && declared !== 'application/json') throw new ApiError('unsupported_media_type');
  if (declared === '' && read.body.length > 0) throw new ApiError('unsupported_media_type');
  if (read.body.length === 0) return {};
  try {
    return JSON.parse(read.body.toString('utf8')) as unknown;
  } catch {
    throw new ApiError('bad_json');
  }
}

async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const method = request.method ?? 'GET';
  const match = matchRoute(method, url.pathname);
  const read = await readBody(request, bodyLimitFor(match));
  try {
    const parsed = checkBoundary(request, match, read);
    const user = await userForSession(readCookie(request.headers.cookie, SESSION_COOKIE));
    if (match === null || !match.methodMatches) throw new ApiError('not_found');
    if (match.route.needsSession && user === null) throw new ApiError('unauthenticated');

    const context: RequestContext = {
      method,
      url,
      path: url.pathname,
      params: match.params,
      headers: request.headers,
      body: read.body,
      json: typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {},
      jsonRaw: parsed,
      user,
      now: new Date()
    };
    sendReply(response, await match.route.handle(context));
  } catch (error) {
    if (error instanceof ApiError) {
      sendReply(response, { status: error.status, json: error.body() });
      return;
    }
    process.stderr.write(`request failed: ${String(error)}\n`);
    sendReply(response, { status: 500, json: { error: 'server_error', message: 'Something went wrong. Try again.' } });
  }
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    await handleApi(request, response, url);
    return;
  }
  serveStatic(request.method ?? 'GET', url.pathname, response);
}

async function start(): Promise<void> {
  await waitForDatabase();
  await applySchemaAndSeed();
  void ensureBucket();

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      process.stderr.write(`unhandled request error: ${String(error)}\n`);
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      response.end('{"error":"server_error","message":"Something went wrong. Try again."}');
    });
  });
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Kerfwell Rack is serving on port ${config.port}\n`);
  });

  setInterval(() => {
    releaseExpiredHolds(pool, new Date()).catch(() => undefined);
  }, 5000).unref();
}

start().catch((error: unknown) => {
  process.stderr.write(`Kerfwell Rack failed to start: ${String(error)}\n`);
  process.exit(1);
});
