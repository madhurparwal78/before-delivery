import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiPathExists, matchRoute } from './api.js';
import { sessionFromRequest } from './auth.js';
import { applySchema } from './db.js';
import { requireMembership } from './diagrams.js';
import { config } from './env.js';
import {
  ApiError,
  crossOrigin,
  notFound,
  tooLarge,
  unsupportedMediaType,
} from './errors.js';
import { startPresencePings } from './hub.js';
import { handleUpgrade } from './sockets.js';
import { loadVersion, startVersionTimer } from './versions.js';

const CLIENT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../client');
const MAX_BODY_BYTES = 1_000_000;
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

/** The paths the server never serves, whatever the build output contains. */
const NEVER_SERVED = /(^|\/)(package(-lock)?\.json|tsconfig[^/]*\.json|run\.json|\.env[^/]*|.*\.ts|.*\.map|node_modules|src)(\/|$)/;

function sendJson(response: ServerResponse, status: number, body: unknown, cookie?: string): void {
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(payload)),
    'cache-control': 'no-store',
  };
  if (cookie !== undefined) headers['set-cookie'] = cookie;
  response.writeHead(status, headers);
  response.end(payload);
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  const host = request.headers.host;
  if (host === undefined) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const piece = chunk as Buffer;
    total += piece.length;
    if (total > MAX_BODY_BYTES) throw tooLarge();
    chunks.push(piece);
  }
  if (total === 0) return undefined;
  const type = request.headers['content-type'] ?? '';
  if (!type.toLowerCase().includes('application/json')) throw unsupportedMediaType();
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw unsupportedMediaType();
  }
}

async function serveStatic(response: ServerResponse, pathname: string): Promise<boolean> {
  const relative = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '').replace(/^[/\\]+/, '');
  if (relative === '' || NEVER_SERVED.test(`/${relative}`)) return false;
  const file = join(CLIENT_ROOT, relative);
  if (!file.startsWith(CLIENT_ROOT)) return false;
  try {
    const body = await readFile(file);
    const type = CONTENT_TYPES[extname(file)] ?? 'application/octet-stream';
    response.writeHead(200, {
      'content-type': type,
      'content-length': String(body.length),
      'cache-control': extname(file) === '.woff2' ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    response.end(body);
    return true;
  } catch {
    return false;
  }
}

let shell: string | null = null;

async function serveShell(response: ServerResponse, status: number, notFoundPage: boolean): Promise<void> {
  shell ??= await readFile(join(CLIENT_ROOT, 'index.html'), 'utf8');
  const body = notFoundPage
    ? shell.replace('<!--boot-->', '<script>window.__linewellNotFound=true</script>')
    : shell;
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    'cache-control': 'no-store',
  });
  response.end(body);
}

/** The app pages the client router owns. */
function isAppPath(pathname: string): boolean {
  return (
    pathname === '/' ||
    pathname === '/signin' ||
    pathname === '/signup' ||
    /^\/d\/[^/]+$/.test(pathname)
  );
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const method = request.method ?? 'GET';

  if (url.pathname.startsWith('/api/')) {
    if (STATE_CHANGING.has(method) && !sameOrigin(request)) {
      const error = crossOrigin();
      sendJson(response, error.status, error.body());
      return;
    }
    const matched = matchRoute(method, url.pathname);
    if (!matched) {
      if (apiPathExists(url.pathname)) {
        response.writeHead(405, { allow: 'GET, POST, PATCH, DELETE' });
        response.end();
        return;
      }
      const error = notFound();
      sendJson(response, error.status, error.body());
      return;
    }
    const body = method === 'GET' || method === 'DELETE' ? undefined : await readBody(request);
    const session = await sessionFromRequest(request);
    const result = await matched.handler({ method, url, session, body, params: matched.params });
    if (result.file) {
      response.writeHead(result.status, {
        'content-type': result.file.contentType,
        'content-length': String(result.file.body.length),
        'content-disposition': `attachment; filename="${result.file.filename}"`,
        'cache-control': 'no-store',
      });
      response.end(result.file.body);
      return;
    }
    if (result.status === 204) {
      const headers: Record<string, string> = {};
      if (result.cookie !== undefined) headers['set-cookie'] = result.cookie;
      response.writeHead(204, headers);
      response.end();
      return;
    }
    sendJson(response, result.status, result.body, result.cookie);
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET' });
    response.end();
    return;
  }

  if (await serveStatic(response, url.pathname)) return;

  if (isAppPath(url.pathname)) {
    const diagram = /^\/d\/([^/]+)$/.exec(url.pathname)?.[1];
    if (diagram === undefined) {
      await serveShell(response, 200, false);
      return;
    }
    const session = await sessionFromRequest(request);
    if (!session) {
      await serveShell(response, 200, false);
      return;
    }
    try {
      const membership = await requireMembership(diagram, session.user.id);
      const version = url.searchParams.get('version');
      if (version !== null) {
        if (!(await loadVersion(membership.diagram.id, version))) {
          await serveShell(response, 404, true);
          return;
        }
      }
      await serveShell(response, 200, false);
    } catch {
      await serveShell(response, 404, true);
    }
    return;
  }

  await serveShell(response, 404, true);
}

const server = createServer((request, response) => {
  handle(request, response).catch((error: unknown) => {
    if (response.headersSent) {
      response.end();
      return;
    }
    if (error instanceof ApiError) {
      sendJson(response, error.status, error.body());
      return;
    }
    process.stderr.write(`Unhandled request error: ${String(error)}\n`);
    sendJson(response, 500, { error: { code: 'internal', message: 'Something went wrong.' } });
  });
});

server.on('upgrade', (request, socket, head) => {
  handleUpgrade(request, socket, head as Buffer).catch(() => socket.destroy());
});

async function start(): Promise<void> {
  await applySchema();
  startPresencePings();
  startVersionTimer();
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`Linewell listening on 0.0.0.0:${config.port}\n`);
  });
}

void start();
