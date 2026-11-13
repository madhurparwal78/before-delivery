import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { authenticate } from './auth.ts';
import { UPLOAD_LIMIT } from '../shared/attachments.ts';
import { contentMatchesType } from './attachment-rules.ts';
import {
  ApiError, crossOrigin, internal, methodNotAllowed, notFound, signedOut, tooLarge, unsupportedMediaType,
} from './errors.ts';
import { HANDLED, type PublicContext, type Reply, type Route, type Upload } from './http-types.ts';
import { parseUpload } from './multipart.ts';
import { ROUTES } from './routes.ts';
import { INVALID_JSON } from './validate.ts';

const JSON_LIMIT = 65_536;
const UPLOAD_BODY_LIMIT = UPLOAD_LIMIT + 65_536;
const DRAIN_LIMIT = 64 * 1024 * 1024;
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const HTML = 'text/html; charset=utf-8';

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

const PAGE_ROUTES = [/^\/$/, /^\/signin$/, /^\/boards\/[^/]+$/, /^\/cards\/[^/]+$/, /^\/workspaces\/[^/]+\/permission-log$/];

interface Assets {
  index: Buffer;
  files: Map<string, Buffer>;
}

async function loadAssets(root: string): Promise<Assets> {
  const files = new Map<string, Buffer>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else files.set(`/${relative(root, path).split('\\').join('/')}`, await readFile(path));
    }
  };
  await walk(root);
  // The build always emits index.html beside the bundle.
  const index = files.get('/index.html') as Buffer;
  files.delete('/index.html');
  return { index, files };
}

function send(response: ServerResponse, status: number, body: Buffer | string, headers: Record<string, string | string[]> = {}): void {
  response.writeHead(status, headers);
  response.end(body);
}

const sendJson = (response: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}): void =>
  send(response, status, JSON.stringify(body), { 'Content-Type': 'application/json; charset=utf-8', ...headers });

/** Reads the request body up to `limit` bytes; a longer body is drained and reported as too large. */
async function readBody(request: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  let over = false;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > DRAIN_LIMIT) {
      request.destroy();
      return null;
    }
    if (!over && size <= limit) chunks.push(chunk);
    else over = true;
  }
  return over ? null : Buffer.concat(chunks);
}

function checkOrigin(request: IncomingMessage): void {
  const origin = request.headers.origin;
  if (origin === undefined || !WRITE_METHODS.has(request.method ?? '')) return;
  let host: string | null = null;
  try {
    host = new URL(origin).host;
  } catch {
    host = null;
  }
  if (host !== request.headers.host) throw crossOrigin();
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const body = await readBody(request, JSON_LIMIT);
  if (body === null) throw tooLarge();
  if (!/^application\/json\s*(;|$)/i.test(request.headers['content-type'] ?? '')) throw unsupportedMediaType();
  try {
    const parsed: unknown = JSON.parse(body.toString('utf8'));
    return parsed;
  } catch {
    return INVALID_JSON;
  }
}

async function readUpload(request: IncomingMessage): Promise<Upload | null> {
  const body = await readBody(request, UPLOAD_BODY_LIMIT);
  if (body === null) throw tooLarge();
  const type = request.headers['content-type'] ?? '';
  if (!/^multipart\/form-data\s*;/i.test(type)) throw unsupportedMediaType();
  const upload = parseUpload(body, type);
  if (upload && upload.bytes.length > UPLOAD_LIMIT) throw tooLarge();
  if (upload && !contentMatchesType(upload.contentType, upload.bytes)) throw unsupportedMediaType();
  return upload;
}

function matchRoute(path: string): { route: Route; params: [string, string] } | null {
  for (const route of ROUTES) {
    const found = route.pattern.exec(path);
    if (found) return { route, params: [found[1] ?? '', found[2] ?? ''] };
  }
  return null;
}

async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const method = request.method ?? 'GET';
  if (url.pathname === '/api/health' && method === 'GET') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }
  const matched = matchRoute(url.pathname);
  const handler = matched?.route.methods[method as keyof Route['methods']];
  const open = matched?.route.open?.[method as keyof Route['methods']];
  let body: unknown;
  let upload: Upload | null = null;
  if (matched && (handler || open)) {
    checkOrigin(request);
    if (BODY_METHODS.has(method)) {
      if (matched.route.upload) upload = await readUpload(request);
      else body = await readJson(request);
    } else {
      await readBody(request, 0);
    }
  }
  const context = { params: matched?.params ?? ['', ''], url, body, upload, headers: request.headers, response } satisfies PublicContext;
  if (open) {
    sendReply(response, await open(context));
    return;
  }
  const actor = await authenticate(request.headers.cookie);
  if (!actor) throw signedOut();
  if (!matched) throw notFound();
  if (!handler) throw methodNotAllowed(Object.keys({ ...matched.route.methods, ...matched.route.open }));
  const reply = await handler({ ...context, actor });
  if (reply === HANDLED) return;
  sendReply(response, reply);
}

function sendReply(response: ServerResponse, reply: Reply): void {
  if (reply.raw) send(response, reply.status, reply.raw, reply.headers);
  else if (reply.body === undefined) send(response, reply.status, '', reply.headers);
  else sendJson(response, reply.status, reply.body, reply.headers);
}

export async function createApp(clientRoot: string): Promise<Server> {
  const assets = await loadAssets(clientRoot);
  return createServer((request, response) => {
    response.setHeader('X-Kinfold-Worker', process.env['KINFOLD_WORKER'] ?? '1');
    response.setHeader('Cache-Control', 'no-store');
    void respond(request, response, assets);
  });
}

async function respond(request: IncomingMessage, response: ServerResponse, assets: Assets): Promise<void> {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      throw notFound();
    }
    if (path.includes('..') || url.pathname.toLowerCase().includes('%2e')) throw notFound();
    if (path.startsWith('/api/')) {
      await handleApi(request, response, url);
      return;
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      const file = assets.files.get(path);
      if (file) {
        send(response, 200, request.method === 'HEAD' ? '' : file, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' });
        return;
      }
      if (PAGE_ROUTES.some((page) => page.test(path))) {
        send(response, 200, request.method === 'HEAD' ? '' : assets.index, { 'Content-Type': HTML });
        return;
      }
    }
    throw notFound();
  } catch (error) {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const known = error instanceof ApiError ? error : null;
    if (!known) process.stderr.write(`unexpected failure: ${error instanceof Error ? error.name : 'error'}\n`);
    const apiError = known ?? internal();
    sendJson(response, apiError.status, apiError.body, apiError.headers);
  }
}
