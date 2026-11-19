import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { DatabaseUnavailable, ensureSchema, withClient } from './db.js';
import {
  ApiError,
  databaseUnavailable,
  notFound,
  unauthenticated,
} from './errors.js';
import { readRequest, sendJson, sendText, type RequestContext } from './http.js';
import { accountFromRequest, type Account } from './session.js';
import { ensureBucket } from './storage.js';
import { me, signIn, signOut } from './routes/auth.js';
import {
  createDocument,
  listDocuments,
  readDocument,
  readHistory,
} from './routes/documents.js';
import {
  createSummary,
  createTable,
  formulaPreview,
  patchTable,
  readTable,
  setRowOwner,
} from './routes/tables.js';
import { createColumn, deleteColumn, patchColumn } from './routes/columns.js';
import { createRow, pasteCells, removeRow, writeCell } from './routes/rows.js';
import { redo, undo } from './routes/undo.js';
import { createShare, listShares, resendInvite } from './routes/shares.js';
import {
  createExport,
  downloadExport,
  listExports,
  readExportRecord,
} from './routes/exports.js';
import type { Reply, RouteContext } from './routes/types.js';

type Handler = (context: RouteContext) => Promise<Reply> | Reply;

type Route = { method: string; pattern: string[]; handler: Handler; public?: boolean };

function pattern(path: string): string[] {
  return path.split('/').filter((part) => part !== '');
}

const ROUTES: Route[] = [
  { method: 'POST', pattern: pattern('/api/auth/sign-in'), handler: signIn, public: true },
  { method: 'POST', pattern: pattern('/api/auth/sign-out'), handler: signOut },
  { method: 'GET', pattern: pattern('/api/me'), handler: me },
  { method: 'GET', pattern: pattern('/api/documents'), handler: listDocuments },
  { method: 'POST', pattern: pattern('/api/documents'), handler: createDocument },
  { method: 'GET', pattern: pattern('/api/documents/:doc'), handler: readDocument },
  { method: 'GET', pattern: pattern('/api/documents/:doc/history'), handler: readHistory },
  { method: 'POST', pattern: pattern('/api/documents/:doc/tables'), handler: createTable },
  { method: 'GET', pattern: pattern('/api/documents/:doc/tables/:table'), handler: readTable },
  { method: 'PATCH', pattern: pattern('/api/documents/:doc/tables/:table'), handler: patchTable },
  {
    method: 'POST',
    pattern: pattern('/api/documents/:doc/tables/:table/columns'),
    handler: createColumn,
  },
  {
    method: 'PATCH',
    pattern: pattern('/api/documents/:doc/tables/:table/columns/:column'),
    handler: patchColumn,
  },
  {
    method: 'DELETE',
    pattern: pattern('/api/documents/:doc/tables/:table/columns/:column'),
    handler: deleteColumn,
  },
  {
    method: 'PUT',
    pattern: pattern('/api/documents/:doc/tables/:table/access'),
    handler: setRowOwner,
  },
  {
    method: 'POST',
    pattern: pattern('/api/documents/:doc/tables/:table/rows'),
    handler: createRow,
  },
  {
    method: 'DELETE',
    pattern: pattern('/api/documents/:doc/tables/:table/rows/:row'),
    handler: removeRow,
  },
  {
    method: 'PUT',
    pattern: pattern('/api/documents/:doc/tables/:table/rows/:row/cells/:column'),
    handler: writeCell,
  },
  {
    method: 'POST',
    pattern: pattern('/api/documents/:doc/tables/:table/cells'),
    handler: pasteCells,
  },
  {
    method: 'POST',
    pattern: pattern('/api/documents/:doc/tables/:table/formula-preview'),
    handler: formulaPreview,
  },
  {
    method: 'POST',
    pattern: pattern('/api/documents/:doc/tables/:table/exports'),
    handler: createExport,
  },
  { method: 'POST', pattern: pattern('/api/documents/:doc/undo'), handler: undo },
  { method: 'POST', pattern: pattern('/api/documents/:doc/redo'), handler: redo },
  { method: 'POST', pattern: pattern('/api/documents/:doc/summaries'), handler: createSummary },
  { method: 'GET', pattern: pattern('/api/documents/:doc/shares'), handler: listShares },
  { method: 'POST', pattern: pattern('/api/documents/:doc/shares'), handler: createShare },
  {
    method: 'POST',
    pattern: pattern('/api/documents/:doc/shares/:share/resend'),
    handler: resendInvite,
  },
  { method: 'GET', pattern: pattern('/api/documents/:doc/exports'), handler: listExports },
  { method: 'GET', pattern: pattern('/api/exports/:export'), handler: readExportRecord },
  { method: 'GET', pattern: pattern('/api/exports/:export/download'), handler: downloadExport },
];

function match(route: Route, parts: string[]): Record<string, string> | null {
  if (route.pattern.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (const [index, piece] of route.pattern.entries()) {
    const part = parts[index] as string;
    if (piece.startsWith(':')) {
      params[piece.slice(1)] = decodeURIComponent(part);
      continue;
    }
    if (piece !== part) return null;
  }
  return params;
}

const publicDir = join(fileURLToPath(new URL('.', import.meta.url)), '../public');

const MEDIA_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

async function serveStatic(path: string, response: ServerResponse): Promise<void> {
  const relative = normalize(path).replace(/^(\.\.(\/|\\|$))+/, '');
  const candidate = join(publicDir, relative);
  if (candidate.startsWith(publicDir)) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) {
        const bytes = await readFile(candidate);
        const mediaType = MEDIA_TYPES[extname(candidate)] ?? 'application/octet-stream';
        sendText(response, 200, bytes, { 'content-type': mediaType });
        return;
      }
    } catch {
      // falls through to the app shell
    }
  }
  const shell = await readFile(join(publicDir, 'index.html'));
  sendText(response, 200, shell, { 'content-type': MEDIA_TYPES['.html'] as string });
}

async function handleApi(request: RequestContext): Promise<Reply> {
  const parts = pattern(request.path);
  const route = ROUTES.find(
    (candidate) => candidate.method === request.method && match(candidate, parts) !== null,
  );
  if (route === undefined) throw notFound();
  const params = match(route, parts) as Record<string, string>;
  return withClient(async (client) => {
    const account = await accountFromRequest(client, request);
    if (account === null && route.public !== true) throw unauthenticated();
    return route.handler({
      request,
      client,
      account: account as Account,
      params,
    });
  });
}

async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://internal');
  if (url.pathname === '/api/health' && request.method === 'GET') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }
  let context: RequestContext;
  try {
    context = await readRequest(request);
  } catch (error) {
    request.resume();
    if (error instanceof ApiError) {
      sendJson(response, error.status, error.body(), { connection: 'close' });
      return;
    }
    sendJson(response, 500, { error: { code: 'server_error', message: 'Something went wrong.' } });
    return;
  }

  if (!context.path.startsWith('/api/')) {
    await serveStatic(context.path === '/' ? 'index.html' : context.path, response);
    return;
  }

  try {
    await ensureSchema();
    const reply = await handleApi(context);
    if (reply.bytes !== undefined) {
      sendText(response, reply.status, reply.bytes, reply.headers ?? {});
      return;
    }
    if (reply.status === 204) {
      response.writeHead(204, { 'cache-control': 'no-store', ...(reply.headers ?? {}) });
      response.end();
      return;
    }
    sendJson(response, reply.status, reply.body, reply.headers ?? {});
  } catch (error) {
    if (error instanceof ApiError) {
      sendJson(response, error.status, error.body(), {});
      return;
    }
    if (error instanceof DatabaseUnavailable || isConnectionError(error)) {
      const unavailable = databaseUnavailable();
      sendJson(response, unavailable.status, unavailable.body());
      return;
    }
    process.stderr.write(`request failed: ${String(error)}\n`);
    sendJson(response, 500, { error: { code: 'server_error', message: 'Something went wrong.' } });
  }
}

function isConnectionError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === '57P01' ||
    code === '57P03'
  );
}

const server = createServer((request, response) => {
  void serve(request, response).catch(() => {
    if (!response.headersSent) {
      sendJson(response, 500, {
        error: { code: 'server_error', message: 'Something went wrong.' },
      });
    }
  });
});

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`Tallyframe listening on ${config.port}\n`);
  void ensureSchema().catch(() => undefined);
  void ensureBucket().catch(() => undefined);
});
