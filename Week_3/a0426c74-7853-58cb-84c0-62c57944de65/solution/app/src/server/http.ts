import { createServer, STATUS_CODES, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import * as copy from '../shared/copy.ts';
import { ApiError, invalid, serverFault } from '../shared/errors.ts';
import { authenticate } from './auth.ts';
import { assertStorableText } from './body.ts';
import { JSON_LIMIT_BYTES } from './config.ts';
import { matchRoute, matchSocketRoute, type Reply, type RequestContext } from './router.ts';
import { notFoundPage, serveStatic } from './static.ts';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** How much of an over-long body is read and thrown away so the client can read the refusal; beyond it the connection is dropped. */
const DRAIN_LIMIT_BYTES = 64 * 1024 * 1024;

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function jsonReply(status: number, body: unknown, headers: Record<string, string> = {}): Reply {
  return { status, headers: { ...JSON_HEADERS, ...headers }, body: Buffer.from(JSON.stringify(body)) };
}

function makeReply(status: number, body?: unknown, headers: Record<string, string> = {}): Reply {
  if (body === undefined) return { status, headers: { 'cache-control': 'no-store', ...headers }, body: Buffer.alloc(0) };
  if (Buffer.isBuffer(body)) return { status, headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', ...headers }, body };
  return jsonReply(status, body, headers);
}

function errorReply(error: unknown): Reply {
  if (error instanceof ApiError) return jsonReply(error.status, error.toBody());
  console.error('request failed', error);
  const fault = serverFault();
  return jsonReply(fault.status, fault.toBody());
}

/**
 * Reads the request body. A body over `limit` is read to its end and discarded, then refused as `too_large`
 * (a client that is still sending would otherwise see the connection reset instead of the answer).
 */
async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > DRAIN_LIMIT_BYTES) {
      req.destroy();
      throw new ApiError('too_large', copy.REQUEST_TOO_LARGE);
    }
    if (size <= limit) chunks.push(chunk);
  }
  if (size > limit) throw new ApiError('too_large', copy.REQUEST_TOO_LARGE);
  return Buffer.concat(chunks);
}

/** Writes and live-channel upgrades from another origin are refused; a request with no Origin header is not a browser cross-site one. */
function assertSameOrigin(req: IncomingMessage, isUpgrade: boolean): void {
  const origin = req.headers.origin;
  if (origin === undefined || !(isUpgrade || WRITE_METHODS.has(req.method ?? ''))) return;
  let host: string | null;
  try {
    host = new URL(origin).host;
  } catch {
    host = null;
  }
  if (host === null || host !== req.headers.host) throw new ApiError('cross_origin', copy.CROSS_ORIGIN);
}

function parseUrl(req: IncomingMessage): URL {
  try {
    return new URL(req.url ?? '/', 'http://localhost');
  } catch {
    throw new ApiError('not_found', copy.NOT_FOUND);
  }
}

function context(req: IncomingMessage, url: URL, params: Record<string, string>, body: Buffer, user: RequestContext['user']): RequestContext {
  return {
    method: req.method ?? 'GET',
    path: url.pathname,
    params,
    query: url.searchParams,
    headers: req.headers,
    user,
    json: () => {
      if (body.length === 0) return {};
      let json: unknown;
      try {
        json = JSON.parse(body.toString('utf8'));
      } catch {
        throw invalid(copy.NOT_JSON);
      }
      assertStorableText(json);
      return json;
    },
    rawBody: () => body,
    reply: makeReply,
  };
}

/**
 * The one pipeline of an API request, in the published error order: too_large, cross_origin, then the route (an unknown path is
 * not_found), unauthenticated, and from there the handler's own checks (rate_limited, not_found, forbidden, …).
 */
async function dispatch(req: IncomingMessage, url: URL): Promise<Reply> {
  const match = matchRoute(req.method ?? 'GET', url.pathname);
  const body = await readBody(req, match?.bodyLimit ?? JSON_LIMIT_BYTES);
  assertSameOrigin(req, false);
  if (!match) throw new ApiError('not_found', copy.NOT_FOUND);
  const user = await authenticate(req.headers);
  if (!user && match.access !== 'public') throw new ApiError('unauthenticated', copy.UNAUTHENTICATED);
  return match.handler(context(req, url, match.params, body, user));
}

function write(res: ServerResponse, req: IncomingMessage, reply: Reply): void {
  res.writeHead(reply.status, { 'x-content-type-options': 'nosniff', ...reply.headers, 'content-length': reply.body.length });
  res.end(req.method === 'HEAD' ? undefined : reply.body);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = parseUrl(req);
    if (url.pathname.startsWith('/api/')) {
      write(res, req, await dispatch(req, url));
      return;
    }
    await readBody(req, JSON_LIMIT_BYTES);
    assertSameOrigin(req, false);
    const page = req.method === 'GET' || req.method === 'HEAD' ? await serveStatic(url.pathname) : notFoundPage();
    write(res, req, { status: page.status, headers: { 'content-type': page.contentType, 'cache-control': 'no-cache' }, body: page.body });
  } catch (error) {
    // a client that went away mid-request is not a failure of the server and has nobody left to answer
    if (!res.destroyed) write(res, req, errorReply(error));
  }
}

/** A page sends hello and cursor messages; the largest carries the handles of a selection of some thousands of entities. */
const LIVE_MESSAGE_LIMIT_BYTES = 256 * 1024;
const sockets = new WebSocketServer({ noServer: true, maxPayload: LIVE_MESSAGE_LIMIT_BYTES });

function refuseUpgrade(socket: Duplex, error: unknown): void {
  const reply = errorReply(error);
  const head = [`HTTP/1.1 ${reply.status} ${STATUS_CODES[reply.status]}`, `content-length: ${reply.body.length}`, 'connection: close'];
  for (const [name, value] of Object.entries(reply.headers)) head.push(`${name}: ${value}`);
  socket.end(`${head.join('\r\n')}\r\n\r\n${reply.body.toString()}`);
}

async function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  // Once a request is handed over as an upgrade, Node no longer listens for socket errors: a peer that resets the connection while
  // the session is looked up would otherwise raise an unhandled 'error' and stop the whole server.
  socket.on('error', () => socket.destroy());
  try {
    assertSameOrigin(req, true);
    const url = parseUrl(req);
    const match = matchSocketRoute(url.pathname);
    if (!match) throw new ApiError('not_found', copy.NOT_FOUND);
    const user = await authenticate(req.headers);
    if (!user && match.access !== 'public') throw new ApiError('unauthenticated', copy.UNAUTHENTICATED);
    const admission = await match.handler(context(req, url, match.params, Buffer.alloc(0), user));
    sockets.handleUpgrade(req, socket, head, (ws) => admission.attach(ws));
  } catch (error) {
    refuseUpgrade(socket, error);
  }
}

/** The HTTP server for pages, the API and the live channel: one origin. */
export function createHttpServer(): Server {
  const server = createServer((req, res) => void handle(req, res));
  server.on('upgrade', (req, socket, head) => void upgrade(req, socket, head));
  return server;
}
