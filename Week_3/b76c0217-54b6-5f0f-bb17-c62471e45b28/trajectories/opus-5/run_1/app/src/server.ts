import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { config } from './config';
import { applySchema } from './db/schema';
import { pool, waitForDatabase } from './db/pool';
import { ApiError, apiError } from './http/errors';
import {
  checkOrigin,
  sendBytes,
  sendError,
  sendJson,
  type Ctx,
} from './http/http';
import { Router } from './http/router';
import { currentUser } from './api/auth';
import * as analytics from './api/analytics';
import * as grading from './api/grading';
import * as openapiRoutes from './api/openapiRoutes';
import * as pages from './api/pages';
import * as publishing from './api/publishing';
import * as publicRoutes from './api/public';
import * as session from './api/session';
import * as team from './api/team';
import * as views from './api/views';
import { seedDemoData } from './services/demo';
import { ensureBucket, StorageUnavailable } from './services/storage';
import { startMailRetries } from './services/mailQueue';

const router = new Router();

router.get('/api/health', (ctx) => sendJson(ctx, 200, { status: 'ok' }));

router.post('/api/session', session.signIn);
router.delete('/api/session', session.signOut);
router.get('/api/me', session.me);

router.get('/api/team', team.getTeam);
router.post('/api/team/invites', team.createTeamInvite);
router.post('/api/team/invites/:inviteId/send', team.sendInviteNow);
router.put('/api/team/members/:userId', team.updateMember);
router.post('/api/invites/:token/accept', team.acceptInvite);

router.get('/api/pages/:pageId', pages.getPage);
router.post('/api/versions/:versionId/pages', pages.postPage);
router.put('/api/pages/:pageId', pages.putPage);
router.post('/api/pages/:pageId/rename', pages.renamePage);
router.delete('/api/pages/:pageId', pages.deletePage);
router.get('/api/versions/:versionId/navigation', pages.getNavigation);
router.post('/api/versions/:versionId/tabs', pages.postTab);
router.post('/api/versions/:versionId/groups', pages.postGroup);
router.post('/api/pages/:pageId/move', pages.postPageMove);
router.post('/api/groups/:groupId/move', pages.postGroupMove);
router.post('/api/versions/:versionId/redirects', pages.postRedirect);
router.delete('/api/versions/:versionId/redirects', pages.deleteRedirect);
router.post('/api/sites/:siteId/assets', pages.postAsset);
router.get('/assets/:siteSlug/:imageId', pages.getAsset);

router.post('/api/versions/:versionId/check', publishing.postCheck);
router.post('/api/versions/:versionId/publish', publishing.postPublish);
router.get('/api/versions/:versionId/publish-report', publishing.getPublishReport);
router.get('/api/sites/:siteId', publishing.getSite);
router.post('/api/sites/:siteId/versions', publishing.postVersion);
router.post('/api/versions/:versionId/make-default', publishing.postMakeDefault);
router.post('/api/pages/:pageId/preview-links', publishing.postPreviewLink);
router.get('/api/pages/:pageId/preview-links', publishing.getPreviewLinks);
router.delete('/api/preview-links/:linkId', publishing.deletePreviewLink);
router.get('/api/events', publishing.events);

router.post('/api/versions/:versionId/openapi', openapiRoutes.postImport);
router.get('/api/versions/:versionId/openapi/source', openapiRoutes.getImportSource);
router.get('/api/versions/:versionId/openapi', openapiRoutes.getImportInfo);
router.post('/api/mock/:siteSlug/:versionSlug/:operationId', openapiRoutes.postMock);

router.get('/api/sites/:siteId/analytics', analytics.getAnalytics);

router.get('/docs/:siteSlug', publicRoutes.docsRoot);
router.get('/docs/:siteSlug/events', publicRoutes.docsEvents);
router.put('/docs/:siteSlug/ratings/:pageId', publicRoutes.docsRating);
router.get('/docs/:siteSlug/:versionSlug/search', publicRoutes.docsSearch);
router.post('/docs/:siteSlug/:versionSlug/search-terms', publicRoutes.docsSearchTerms);
router.get('/docs/:siteSlug/:versionSlug/*pagePath', publicRoutes.docsPage);

router.get('/signin', views.signInView);
router.get('/app', views.homeView);
router.get('/app/team', views.teamView);
router.get('/app/sites/:siteSlug/analytics', views.analyticsView);
router.get('/app/sites/:siteSlug/:versionSlug/pages', views.editorFirstPageView);
router.get('/app/sites/:siteSlug/:versionSlug/pages/*pagePath', views.editorPageView);
router.get('/app/sites/:siteSlug/:versionSlug/redirects', views.redirectsView);
router.get('/app/sites/:siteSlug/:versionSlug/preview/*pagePath', views.draftPreviewView);
router.get('/preview/:token', views.sharedPreviewView);
router.get('/invite/:token', views.inviteView);

router.post('/api/grading/seed', grading.postSeed);
router.post('/api/grading/outage', grading.postOutage);

const STATIC_ROOT = join(__dirname, 'public');
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
};

async function serveStatic(ctx: Ctx): Promise<void> {
  const requested = normalize(ctx.params.file).replace(/^(\.\.[/\\])+/, '');
  const type = CONTENT_TYPES[extname(requested)];
  if (type === undefined) throw apiError('not_found');
  const path = join(STATIC_ROOT, requested);
  if (!path.startsWith(STATIC_ROOT)) throw apiError('not_found');
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    throw apiError('not_found');
  }
  sendBytes(ctx, 200, bytes, type, { 'Cache-Control': 'no-cache' });
}

router.get('/static/*file', serveStatic);

const GRADING_ONLY = new Set(['/api/grading/seed', '/api/grading/outage']);

function isHtmlRequest(ctx: Ctx): boolean {
  const accept = ctx.req.headers.accept ?? '';
  return accept.includes('text/html');
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = req.method ?? 'GET';
  const ctx: Ctx = { req, res, method, url, params: {} };
  if (GRADING_ONLY.has(url.pathname) && !config.gradingRoutes) {
    sendError(ctx, apiError('not_found'));
    return;
  }
  const matched = router.match(method, url.pathname);
  if (!('handler' in matched)) {
    if (matched.allowed.length > 0) {
      res.setHeader('Allow', matched.allowed.join(', '));
      sendJson(ctx, 405, apiError('not_found').body());
      return;
    }
    if (isHtmlRequest(ctx)) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>Not found</title><h1>Not found</h1>');
      return;
    }
    sendError(ctx, apiError('not_found'));
    return;
  }
  const scoped: Ctx = { ...ctx, params: matched.params };
  try {
    if (method !== 'GET' && method !== 'HEAD') {
      try {
        checkOrigin(scoped);
      } catch (error) {
        if ((await currentUser(scoped)) === null) throw apiError('unauthenticated');
        throw error;
      }
    }
    await matched.handler(scoped);
  } catch (error) {
    respond(scoped, error);
  }
}

function respond(ctx: Ctx, error: unknown): void {
  if (ctx.res.headersSent) {
    ctx.res.end();
    return;
  }
  if (error instanceof ApiError) {
    if (error.code === 'not_found' && isHtmlRequest(ctx)) {
      ctx.res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      ctx.res.end('<!doctype html><title>Not found</title><h1>Not found</h1>');
      return;
    }
    sendError(ctx, error);
    return;
  }
  const unavailable = error instanceof StorageUnavailable;
  process.stderr.write(`request failed: ${String(error)}\n`);
  sendJson(ctx, unavailable ? 503 : 500, {
    error: {
      code: unavailable ? 'storage_unavailable' : 'internal_error',
      message: unavailable ? 'File storage is unavailable.' : 'Something went wrong.',
    },
  });
}

async function start(): Promise<void> {
  await waitForDatabase(60000);
  await applySchema();
  ensureBucket().catch((error: unknown) => {
    if (!(error instanceof StorageUnavailable)) throw error;
    process.stderr.write('file storage is unreachable; serving outage behaviour\n');
  });
  await seedDemoData();
  startMailRetries();
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.listen(config.port, '0.0.0.0', () => {
    process.stdout.write(`galley listening on ${config.port}\n`);
  });
}

start().catch((error: unknown) => {
  process.stderr.write(`galley failed to start: ${String(error)}\n`);
  void pool.end();
  process.exit(1);
});
