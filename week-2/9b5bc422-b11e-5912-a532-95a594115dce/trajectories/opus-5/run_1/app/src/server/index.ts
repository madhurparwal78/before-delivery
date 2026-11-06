import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.ts';
import { ensureSchema } from './db.ts';
import { ApiError, apiError } from './errors.ts';
import { watchDependencies } from './health.ts';
import { checkOrigin, sendError, sendJson } from './http.ts';
import {
  deleteAttachment,
  deleteDevice,
  deleteSession,
  deleteShare,
  getAttachment,
  getDevices,
  getHealth,
  getShare,
  getShared,
  getSharedAttachment,
  getSession,
  getStatus,
  postAccount,
  postSession,
  postShare,
  postSyncPull,
  postSyncPush,
  putAttachment,
} from './routes.ts';
import { loadAssets, sendAsset } from './static.ts';

const here = dirname(fileURLToPath(import.meta.url));
const assets = loadAssets(join(here, 'client'));
const shell = assets.get('/index.html');
if (!shell) throw new Error('The built app shell is missing');

type Handler = (request: IncomingMessage, response: ServerResponse, ...params: string[]) => Promise<void>;

const routes: { method: string; pattern: RegExp; handler: Handler }[] = [
  { method: 'GET', pattern: /^\/api\/health$/, handler: getHealth },
  { method: 'GET', pattern: /^\/api\/status$/, handler: getStatus },
  { method: 'GET', pattern: /^\/api\/session$/, handler: getSession },
  { method: 'POST', pattern: /^\/api\/accounts$/, handler: postAccount },
  { method: 'POST', pattern: /^\/api\/sessions$/, handler: postSession },
  { method: 'DELETE', pattern: /^\/api\/session$/, handler: deleteSession },
  { method: 'GET', pattern: /^\/api\/devices$/, handler: getDevices },
  { method: 'DELETE', pattern: /^\/api\/devices\/([^/]+)$/, handler: deleteDevice },
  { method: 'PUT', pattern: /^\/api\/attachments\/([^/]+)$/, handler: putAttachment },
  { method: 'GET', pattern: /^\/api\/attachments\/([^/]+)$/, handler: getAttachment },
  { method: 'DELETE', pattern: /^\/api\/attachments\/([^/]+)$/, handler: deleteAttachment },
  { method: 'GET', pattern: /^\/api\/documents\/([^/]+)\/share$/, handler: getShare },
  { method: 'POST', pattern: /^\/api\/documents\/([^/]+)\/share$/, handler: postShare },
  { method: 'DELETE', pattern: /^\/api\/documents\/([^/]+)\/share$/, handler: deleteShare },
  { method: 'GET', pattern: /^\/api\/shared\/([^/]+)$/, handler: getShared },
  {
    method: 'GET',
    pattern: /^\/api\/shared\/([^/]+)\/attachments\/([^/]+)$/,
    handler: getSharedAttachment,
  },
  { method: 'POST', pattern: /^\/api\/sync\/push$/, handler: postSyncPush },
  { method: 'POST', pattern: /^\/api\/sync\/pull$/, handler: postSyncPull },
];

async function handleApi(request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
  const method = request.method ?? 'GET';
  if (method !== 'GET' && /^\/api\/shared\//.test(path)) throw apiError.readOnlyLink();
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(path);
    if (!match) continue;
    await route.handler(request, response, ...match.slice(1).map((part) => decodeURIComponent(part)));
    return;
  }
  throw apiError.notFound();
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (path.startsWith('/api/')) {
    void (async () => {
      try {
        checkOrigin(request);
        await handleApi(request, response, path);
      } catch (error) {
        if (!response.headersSent) sendError(response, error);
        else response.end();
        if (!(error instanceof ApiError)) process.stderr.write(`${String(error)}\n`);
      }
    })();
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 404, apiError.notFound().body);
    return;
  }

  const asset = assets.get(path === '/' ? '/index.html' : path);
  sendAsset(response, asset ?? shell);
});

void ensureSchema();
watchDependencies();

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`Oddment Workspace is listening on port ${config.port}\n`);
});
