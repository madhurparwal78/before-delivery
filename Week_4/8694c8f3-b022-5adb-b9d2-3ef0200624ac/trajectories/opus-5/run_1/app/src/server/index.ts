import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { applySchema, waitForDatabase } from './db.js';
import { Err } from './errors.js';
import {
  buildContext,
  checkOrigin,
  LIMITS,
  matchRoute,
  route,
  sendError,
  sendReply,
  type Route,
} from './http.js';
import { startStorageHealthLoop } from './storage.js';
import { startCollab } from './collab.js';
import { emit, relayFromCollab } from './events.js';
import { login, logout, me, signup } from './api/auth.js';
import {
  createSet,
  getOps,
  getSet,
  listSets,
  postOp,
  streamSetEvents,
} from './api/sets.js';
import { acceptInvite, createInvite, getInvite, listMembers } from './api/members.js';
import {
  getPresence,
  heartbeatLock,
  listLocks,
  postPresence,
  releaseLock,
  takeLock,
} from './api/collabapi.js';
import { deleteAsset, getAssetContent, listAssets, uploadAsset } from './api/assets.js';
import { getShaderVersion, listShaderVersions } from './api/shaders.js';
import {
  activateShow,
  getShow,
  getShowAsset,
  getShowBundle,
  listShows,
  publishShow,
  rollbackShow,
  streamShowEvents,
} from './api/shows.js';
import { createExport, downloadExport, importSet } from './api/transfer.js';
import { getHealth, getStatus, listActivity } from './api/misc.js';

const routes: Route[] = [
  route('POST', '/api/auth/signup', 'json', signup),
  route('POST', '/api/auth/login', 'json', login),
  route('POST', '/api/auth/logout', 'none', logout),
  route('GET', '/api/me', 'none', me),

  route('GET', '/api/sets', 'none', listSets),
  route('POST', '/api/sets', 'json', createSet),
  route('POST', '/api/sets/import', 'bytes', importSet, LIMITS.importZip),
  route('GET', '/api/sets/:id', 'none', getSet),
  route('POST', '/api/sets/:id/ops', 'json', postOp),
  route('GET', '/api/sets/:id/ops', 'none', getOps),
  route('GET', '/api/sets/:id/events', 'none', streamSetEvents),

  route('GET', '/api/sets/:id/members', 'none', listMembers),
  route('POST', '/api/sets/:id/invites', 'json', createInvite),
  route('GET', '/api/invites/:token', 'none', getInvite),
  route('POST', '/api/invites/:token/accept', 'none', acceptInvite),

  route('POST', '/api/sets/:id/layers/:layerId/lock', 'none', takeLock),
  route('POST', '/api/sets/:id/layers/:layerId/lock/heartbeat', 'none', heartbeatLock),
  route('DELETE', '/api/sets/:id/layers/:layerId/lock', 'none', releaseLock),
  route('GET', '/api/sets/:id/locks', 'none', listLocks),
  route('POST', '/api/sets/:id/presence', 'json', postPresence),
  route('GET', '/api/sets/:id/presence', 'none', getPresence),

  route('POST', '/api/sets/:id/assets', 'bytes', uploadAsset, LIMITS.model),
  route('GET', '/api/sets/:id/assets', 'none', listAssets),
  route('GET', '/api/assets/:assetId/content', 'none', getAssetContent),
  route('DELETE', '/api/sets/:id/assets/:assetId', 'none', deleteAsset),

  route('GET', '/api/sets/:id/layers/:layerId/shader/versions', 'none', listShaderVersions),
  route('GET', '/api/sets/:id/layers/:layerId/shader/versions/:n', 'none', getShaderVersion),

  route('POST', '/api/sets/:id/shows', 'json', publishShow),
  route('GET', '/api/sets/:id/shows', 'none', listShows),
  route('POST', '/api/sets/:id/shows/rollback', 'none', rollbackShow),
  route('POST', '/api/sets/:id/shows/:n/activate', 'none', activateShow),
  route('GET', '/api/show/:token', 'none', getShow),
  route('GET', '/api/show/:token/bundle', 'none', getShowBundle),
  route('GET', '/api/show/:token/assets/:assetId', 'none', getShowAsset),
  route('GET', '/api/show/:token/events', 'none', streamShowEvents),

  route('POST', '/api/sets/:id/exports', 'none', createExport),
  route('GET', '/api/exports/:exportId/download', 'none', downloadExport),
  route('GET', '/api/sets/:id/activity', 'none', listActivity),
  route('GET', '/api/status', 'none', getStatus),
  route('GET', '/api/health', 'none', getHealth),
];

const webRoot = path.join(import.meta.dirname, '../web');
const SPA_PATHS = /^\/(workspace|sets\/[^/]+|join\/[^/]+|show\/[^/]+)$/;
const STATIC_FILES = new Map<string, string>([
  ['/app.js', 'application/javascript; charset=utf-8'],
  ['/app.css', 'text/css; charset=utf-8'],
  ['/favicon.svg', 'image/svg+xml'],
]);
const FONT_PATH = /^\/fonts\/[a-z0-9-]+\.woff2$/;

async function serveStatic(pathname: string): Promise<{ bytes: Buffer; type: string } | null> {
  if (pathname === '/' || SPA_PATHS.test(pathname)) {
    return { bytes: await readFile(path.join(webRoot, 'index.html')), type: 'text/html; charset=utf-8' };
  }
  const staticType = STATIC_FILES.get(pathname);
  if (staticType !== undefined) {
    return { bytes: await readFile(path.join(webRoot, pathname.slice(1))), type: staticType };
  }
  if (FONT_PATH.test(pathname)) {
    return { bytes: await readFile(path.join(webRoot, pathname.slice(1))), type: 'font/woff2' };
  }
  return null;
}

async function main(): Promise<void> {
  await waitForDatabase();
  await applySchema();
  startStorageHealthLoop();
  startCollab(relayFromCollab, (setId, layerId) => {
    emit(setId, {
      event: 'lock',
      data: { layer_id: layerId, holder: null, expires_at: null, reason: 'expired' },
    });
  });

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://${req.headers['host'] ?? 'localhost'}`);
      try {
        checkOrigin(req);
        const matched = matchRoute(routes, req.method ?? 'GET', url.pathname);
        if (matched === 'no-path' || matched === 'no-method') {
          if (url.pathname.startsWith('/api/') || req.method !== 'GET') throw Err.notFound();
          const file = await serveStatic(url.pathname);
          if (file === null) throw Err.notFound();
          sendReply(res, {
            status: 200,
            body: file.bytes,
            headers: { 'Content-Type': file.type, 'Cache-Control': 'no-cache' },
          });
          return;
        }
        const ctx = await buildContext(req, res, matched, url);
        const reply = await matched.route.handler(ctx);
        if (reply !== undefined) sendReply(res, reply);
      } catch (error) {
        if (res.headersSent) {
          res.end();
          return;
        }
        sendError(res, error);
      }
    })();
  });

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Afterglass listening on port ${config.port}`);
  });
}

void main();
