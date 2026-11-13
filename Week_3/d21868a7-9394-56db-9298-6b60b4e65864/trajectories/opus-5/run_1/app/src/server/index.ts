import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from '../domain/errors.ts';
import { apiRoutes } from './api.ts';
import { SESSION_COOKIE, userForToken } from './auth.ts';
import { config } from './config.ts';
import { isSchemaReady } from './db.ts';
import {
  bodyLimitFor,
  type Ctx,
  errorReply,
  matchApiRoute,
  parseCookies,
  readBody,
  sendReply,
} from './http.ts';
import { applySchemaAndSeed } from './schema.ts';
import { applyDueLapses } from './service/lapse.ts';
import { startWorker } from './worker.ts';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public');

const ASSETS: Record<string, string> = {
  '/app.js': 'text/javascript; charset=utf-8',
  '/app.css': 'text/css; charset=utf-8',
  '/fonts/archivo-400.woff2': 'font/woff2',
  '/fonts/archivo-700.woff2': 'font/woff2',
  '/fonts/plex-400.woff2': 'font/woff2',
  '/fonts/plex-600.woff2': 'font/woff2',
};

const PAGE_SHELL = `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ditchbook</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="app"></div>
<script type="module" src="/app.js"></script>
</body>
</html>
`;

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = request.method ?? 'GET';

  if (path !== '/api' && !path.startsWith('/api/')) {
    if (method !== 'GET' && method !== 'HEAD') {
      sendReply(response, { status: 404, json: { error: 'not_found', message: 'That record was not found.' } });
      return;
    }
    const contentType = ASSETS[path];
    if (contentType !== undefined) {
      const bytes = await readFile(resolve(publicDir, path.slice(1)));
      sendReply(response, {
        bytes,
        headers: {
          'content-type': contentType,
          'cache-control': path.startsWith('/fonts/') ? 'public, max-age=86400' : 'no-store',
        },
      });
      return;
    }
    sendReply(response, { text: PAGE_SHELL, headers: { 'content-type': 'text/html; charset=utf-8' } });
    return;
  }

  const cookieHeader = request.headers.cookie;
  let cookieToSet: string | null = null;
  try {
    const body = await readBody(request, bodyLimitFor(path));
    const cookies = parseCookies(cookieHeader);
    const user = await userForToken(cookies[SESSION_COOKIE] ?? null);

    if (path !== '/api/health') await applyDueLapses();

    const matched = matchApiRoute(apiRoutes, method, path);
    if (matched === null) throw new ApiError('not_found');

    const ctx: Ctx = {
      method,
      path,
      params: matched.params,
      query: url.searchParams,
      body,
      user,
      cookies,
      setCookie: (value) => {
        cookieToSet = value;
      },
    };
    const reply = await matched.route.handler(ctx);
    const headers = { ...reply.headers };
    if (cookieToSet !== null) headers['set-cookie'] = cookieToSet;
    sendReply(response, { ...reply, headers });
  } catch (cause) {
    const reply = errorReply(cause);
    const headers = { ...reply.headers };
    if (cookieToSet !== null) headers['set-cookie'] = cookieToSet;
    sendReply(response, { ...reply, headers });
  }
}

const server = createServer((request, response) => {
  handle(request, response).catch((cause: unknown) => {
    sendReply(response, errorReply(cause));
  });
});

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`Ditchbook listening on ${config.port}\n`);
});

async function prepareDatabase(): Promise<void> {
  while (!isSchemaReady()) {
    try {
      await applySchemaAndSeed();
    } catch (cause) {
      process.stderr.write(`waiting for the database: ${cause instanceof Error ? cause.message : String(cause)}\n`);
      await new Promise((done) => {
        setTimeout(done, 3000).unref();
      });
    }
  }
  startWorker();
}

void prepareDatabase();
