import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiErrorBody } from './errors.js';
import { contentTypeOk, originAllowed, readSession } from './http.js';
import { applySchemaAndSeed } from './seed.js';
import { waitForPostgres } from './db.js';
import {
  addWindowRoute, agentReportRoute, approvalLinkRoute, approveRoute, breakFreezeRoute,
  clustersRoute, deleteWindowRoute, evidenceRoute, freezePolicyRoute, getPromotion,
  ingestBundle, listBundles, listPromotions, patchStage, projectGraph, projectsList,
  requestPromotionRoute, rejectRoute, rollbackRoute, scheduleFreezeRoute,
  serviceStatus, sessionRouter, stageHealthRoute, startRoute, retryWindowRoute,
  windowDecisionRoute, windowOpeningsRoute, BUNDLE_BODY_LIMIT, DEFAULT_BODY_LIMIT,
} from './api.js';
import { backgroundLoop } from './health.js';
import { expirySweep } from './promotions.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const clientDir = join(here, '../client');
const port = Number(process.env.APP_PUBLIC_PORT ?? '4173');
let postgresReady = false;

const app = express();
app.disable('x-powered-by');
// No CORS permission headers are ever sent.
app.use(cookieParser() as unknown as express.RequestHandler);

// ---------------------------------------------------------------- health

app.get('/api/health', (_req: Request, res: Response) => {
  if (!postgresReady) {
    res.status(503).json({ status: 'starting' });
    return;
  }
  res.json({ status: 'ok' });
});

// ----------------------------------------------------------- origin guard

app.use((req: Request, res: Response, next: NextFunction) => {
  if (!originAllowed(req)) {
    res.status(403).json({ error: 'cross_origin', message: 'Calls from another origin are refused.' });
    return;
  }
  next();
});

// -------------------------------------------------------- body handling

app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) { next(); return; }
  // A body-less DELETE carries no content type; that is fine.
  if (req.method === 'DELETE' && !req.headers['content-type'] && (Number(req.headers['content-length'] ?? '0') === 0)) { next(); return; }
  const isBundleIngest = /^\/projects\/[^/]+\/bundles$/.test(req.path);
  const limit = isBundleIngest ? BUNDLE_BODY_LIMIT : DEFAULT_BODY_LIMIT;
  if (!contentTypeOk(req)) {
    res.status(415).json({ error: 'unsupported_media_type', message: 'Send application/json.' });
    return;
  }
  express.json({
    limit: limit + 1,
    type: () => true,
    strict: false,
  })(req, res, (err: unknown) => {
    if (err) {
      const type = (err as { type?: string }).type;
      if (type === 'entity.too.large') {
        res.status(413).json({ error: 'payload_too_large', message: 'The request body is too large.' });
        return;
      }
      next(err);
      return;
    }
    next();
  });
});

// ------------------------------------------------------------- session

app.use('/api', async (req: Request, _res: Response, next: NextFunction) => {
  if (req.path === '/health' || req.path === '/agent/reports' || req.path.startsWith('/approval-links/')) {
    next();
    return;
  }
  const session = await readSession(req);
  if (session) (req as express.Request & { session?: unknown }).session = session;
  next();
});

// The API routes need a session except the public ones.
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  const openPaths = ['/session', '/status', '/agent/reports'];
  if (openPaths.includes(req.path)) { next(); return; }
  if (req.path.startsWith('/approval-links/')) { next(); return; }
  const hasSession = Boolean((req as express.Request & { session?: unknown }).session);
  if (!hasSession) {
    res.status(401).json({ error: 'unauthenticated', message: 'Sign in to continue.' });
    return;
  }
  next();
});

// --------------------------------------------------------------- routes

app.get('/api/projects', projectsList);
app.get('/api/projects/:p/graph', projectGraph);
app.get('/api/status', serviceStatus);

app.post('/api/projects/:p/bundles', ingestBundle);
app.get('/api/projects/:p/bundles', listBundles);

app.patch('/api/projects/:p/stages/:s', patchStage);
app.post('/api/projects/:p/stages/:s/promotions', requestPromotionRoute);
app.post('/api/projects/:p/stages/:s/rollback', rollbackRoute);
app.get('/api/projects/:p/promotions', listPromotions);
app.get('/api/projects/:p/stages/:s/health', stageHealthRoute);
app.get('/api/projects/:p/clusters', clustersRoute);
app.post('/api/projects/:p/clusters/:c/windows', addWindowRoute);
app.delete('/api/projects/:p/clusters/:c/windows/:id', deleteWindowRoute);
app.get('/api/projects/:p/clusters/:c/window-openings', windowOpeningsRoute);
app.get('/api/projects/:p/stages/:s/window-decision', windowDecisionRoute);
app.get('/api/projects/:p/freeze-policy', freezePolicyRoute);
app.post('/api/projects/:p/freeze-policy/versions', scheduleFreezeRoute);

app.get('/api/promotions/:id', getPromotion);
app.post('/api/promotions/:id/approve', approveRoute);
app.post('/api/promotions/:id/reject', rejectRoute);
app.post('/api/promotions/:id/start', startRoute);
app.post('/api/promotions/:id/retry-window', retryWindowRoute);
app.post('/api/promotions/:id/break-freeze', breakFreezeRoute);
app.get('/api/promotions/:id/evidence', evidenceRoute);

app.post('/api/agent/reports', agentReportRoute);
app.get('/api/approval-links/:token', approvalLinkRoute);
app.use('/api/session', sessionRouter);

// Every other /api path answers 404 in the error shape.
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'not_found', message: 'The resource is unknown.' });
});

// -------------------------------------------------------- static client

const CLIENT_FILES = new Map<string, { file: string; type: string }>([
  ['/', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/index.html', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
  ['/app.css', { file: 'app.css', type: 'text/css; charset=utf-8' }],
  ['/fonts/SpaceGrotesk-VF.ttf', { file: 'fonts/SpaceGrotesk-VF.ttf', type: 'font/ttf' }],
  ['/fonts/IBMPlexSans-VF.ttf', { file: 'fonts/IBMPlexSans-VF.ttf', type: 'font/ttf' }],
  ['/fonts/IBMPlexMono-Regular.ttf', { file: 'fonts/IBMPlexMono-Regular.ttf', type: 'font/ttf' }],
  ['/fonts/IBMPlexMono-Medium.ttf', { file: 'fonts/IBMPlexMono-Medium.ttf', type: 'font/ttf' }],
]);

const CLIENT_ROUTES = [/^\/sign-in$/, /^\/projects\/[^/]+$/, /^\/projects\/[^/]+\/windows$/, /^\/approvals\/[^/]+$/];

app.get('*splat', (req: Request, res: Response, next: NextFunction) => {
  const path = req.path;
  const known = CLIENT_FILES.get(path);
  if (known) {
    res.setHeader('Content-Type', known.type);
    res.setHeader('Cache-Control', 'no-store');
    createReadStream(join(clientDir, known.file)).pipe(res);
    return;
  }
  if (CLIENT_ROUTES.some((re) => re.test(path))) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    createReadStream(join(clientDir, 'index.html')).pipe(res);
    return;
  }
  next();
});

// --------------------------------------------------------- error shape

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiErrorBody) {
    err.send(res);
    return;
  }
  const any = err as { type?: string; statusCode?: number; status?: number; message?: string };
  if (any?.type === 'entity.too.large' || any?.statusCode === 413) {
    res.status(413).json({ error: 'payload_too_large', message: 'The request body is too large.' });
    return;
  }
  if (any?.type === 'entity.parse.failed') {
    res.status(415).json({ error: 'unsupported_media_type', message: 'Send application/json.' });
    return;
  }
  res.status(500).json({ error: 'internal', message: 'Keelson could not complete the request.' });
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'not_found', message: 'The resource is unknown.' });
});

// ---------------------------------------------------------------- boot

async function boot(): Promise<void> {
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`keelson listening on 0.0.0.0:${port}`);
  });
  server.keepAliveTimeout = 65_000;
  await waitForPostgres();
  await applySchemaAndSeed();
  postgresReady = true;
  void backgroundLoop(expirySweep);
}

void boot();
