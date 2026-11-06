import express, { type Request, type Response } from 'express';
import { loadConfig, type Config } from './config.js';
import { initDb, getPool, withContentionRetry } from './db.js';
import { applySchema } from './schema.js';
import { applySeed, seedPdfBytes } from './seed.js';
import { KillBillClient } from './kb.js';
import { StorageClient } from './storage.js';
import { ApiError, errorCopy } from './errors.js';
import { isCrossSite, noStore, sendError, JSON_BODY_LIMIT, UPLOAD_BODY_LIMIT } from './http.js';
import { parseJsonBody, wrap, type Handler, type RouteContext, type RouteDef } from './pipeline.js';
import { methodPathListed, type AuthedRequest } from './api-core.js';
import * as core from './routes-core.js';
import * as bookings from './routes/bookings.js';
import * as actions from './routes/actions.js';
import * as members from './routes/members.js';
import * as documents from './routes/documents.js';
import * as sanitation from './routes/sanitation.js';
import * as months from './routes/months.js';
import * as misc from './routes/misc.js';
import { OutboxWorker, initialSeedWork } from './worker.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const config = loadConfig();
const killbill = new KillBillClient(config);
const storage = new StorageClient(config);
const ctx: RouteContext = { config, killbill, storage };

// ---------------------------------------------------------------------------
// Route table: the whole published API surface.
// ---------------------------------------------------------------------------
const ROUTES: RouteDef[] = [
  { method: 'POST', pattern: '/api/session', handler: core.signIn, public: true },
  { method: 'GET', pattern: '/api/session', handler: core.getSession },
  { method: 'DELETE', pattern: '/api/session', handler: core.signOut },
  { method: 'GET', pattern: '/api/kitchen', handler: core.getKitchen },
  { method: 'GET', pattern: '/api/board', handler: core.getBoard },
  { method: 'GET', pattern: '/api/stations', handler: core.getStations },
  { method: 'POST', pattern: '/api/stations/:stationId/rates', handler: core.postStationRates },
  { method: 'PUT', pattern: '/api/kitchen/peak-windows', handler: core.putPeakWindows },
  { method: 'PUT', pattern: '/api/kitchen/document-requirements', handler: core.putRequirements },
  { method: 'POST', pattern: '/api/bookings', handler: bookings.createHold },
  { method: 'POST', pattern: '/api/bookings/:id/confirm', handler: bookings.confirmBooking },
  { method: 'GET', pattern: '/api/bookings', handler: misc.listBookings },
  { method: 'GET', pattern: '/api/bookings/:id', handler: misc.getBookingById },
  { method: 'POST', pattern: '/api/bookings/:id/cancel', handler: actions.cancelBooking },
  { method: 'POST', pattern: '/api/bookings/:id/check-in', handler: actions.checkIn },
  { method: 'POST', pattern: '/api/bookings/:id/check-out', handler: actions.checkOut },
  { method: 'POST', pattern: '/api/bookings/:id/no-show', handler: actions.markNoShow },
  { method: 'POST', pattern: '/api/bookings/:id/move', handler: actions.moveBooking },
  { method: 'POST', pattern: '/api/bookings/:id/release', handler: actions.releaseBooking },
  { method: 'POST', pattern: '/api/bookings/:id/waive-penalty', handler: actions.waivePenalty },
  { method: 'POST', pattern: '/api/out-of-service', handler: misc.createOutOfService },
  { method: 'DELETE', pattern: '/api/out-of-service/:id', handler: misc.deleteOutOfService },
  { method: 'GET', pattern: '/api/members', handler: members.listMembers },
  { method: 'GET', pattern: '/api/members/:memberId', handler: members.getMember },
  { method: 'PATCH', pattern: '/api/members/me', handler: members.patchMember },
  { method: 'GET', pattern: '/api/members/:memberId/hour-bank', handler: members.memberHourBank },
  { method: 'GET', pattern: '/api/members/:memberId/invoices/:month', handler: months.memberInvoice },
  { method: 'POST', pattern: '/api/months/:month/close', handler: months.closeMonth },
  { method: 'GET', pattern: '/api/reports/utilisation', handler: months.utilisationReport },
  { method: 'GET', pattern: '/api/exports/usage.csv', handler: months.usageCsv },
  { method: 'POST', pattern: '/api/documents', handler: documents.uploadDocument, public: false },
  { method: 'GET', pattern: '/api/documents', handler: documents.listDocuments },
  { method: 'GET', pattern: '/api/documents/:id', handler: documents.getDocument },
  { method: 'GET', pattern: '/api/documents/:id/file', handler: documents.downloadDocument },
  { method: 'POST', pattern: '/api/documents/:id/approve', handler: documents.approveDocument },
  { method: 'POST', pattern: '/api/sanitation-entries', handler: sanitation.createSanitationEntry },
  { method: 'GET', pattern: '/api/sanitation-entries', handler: sanitation.listSanitationEntries },
  { method: 'POST', pattern: '/api/sanitation-reports', handler: sanitation.createSanitationReport },
  { method: 'GET', pattern: '/api/sanitation-reports', handler: sanitation.listSanitationReports },
  { method: 'GET', pattern: '/api/sanitation-reports/:month/file', handler: sanitation.downloadSanitationReport },
  { method: 'POST', pattern: '/api/inspector-links', handler: sanitation.createInspectorLink },
  { method: 'GET', pattern: '/api/inspector-links', handler: sanitation.listInspectorLinks },
  { method: 'POST', pattern: '/api/inspector-links/:id/regenerate', handler: sanitation.regenerateInspectorLink },
  { method: 'DELETE', pattern: '/api/inspector-links/:id', handler: sanitation.revokeInspectorLink },
  { method: 'GET', pattern: '/api/inspect/:token', handler: misc.inspectView, inspector: true },
  { method: 'GET', pattern: '/api/inspect/:token/documents/:documentId/file', handler: misc.inspectDocumentFile, inspector: true },
  { method: 'GET', pattern: '/api/inspect/:token/sanitation-reports/:month/file', handler: misc.inspectReportFile, inspector: true },
  { method: 'GET', pattern: '/api/service-status', handler: misc.serviceStatus },
  { method: 'GET', pattern: '/api/health', handler: health, public: true },
];

async function health(req: Request, res: Response): Promise<void> {
  noStore(res);
  res.status(200).json({ status: 'ok' });
}

// ---------------------------------------------------------------------------
// The server boundary: body capture, limits, cross-origin, route dispatch.
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');

app.use((req: Request, res: Response, next: () => void) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    (req as AuthedRequest).rawBody = Buffer.concat(chunks);
    next();
  });
  req.on('error', () => next());
});

// ---------------------------------------------------------------------------
// Uploads: multipart parsing for POST /api/documents
// ---------------------------------------------------------------------------
app.use('/api/documents', (req: Request, res: Response, next: () => void) => {
  if (req.method !== 'POST' || req.originalUrl.split('?')[0] !== '/api/documents') {
    next();
    return;
  }
  const raw = (req as AuthedRequest).rawBody;
  if (raw && raw.length > UPLOAD_BODY_LIMIT) {
    sendError(res, 413, 'payload_too_large', errorCopy('payload_too_large'));
    return;
  }
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.startsWith('multipart/form-data')) {
    sendError(res, 415, 'unsupported_media_type', errorCopy('unsupported_media_type'));
    return;
  }
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) {
    sendError(res, 400, 'bad_request', errorCopy('bad_request'));
    return;
  }
  const boundary = '--' + (m[1] ?? m[2]);
  const fields = new Map<string, string>();
  const fileParts = new Map<string, { fileName: string; data: Buffer }>();
  const body = raw ?? Buffer.alloc(0);
  const parts = body.subarray(body.indexOf(Buffer.from(boundary)));
  const boundaryBuf = Buffer.from(boundary);
  let index = parts.indexOf(boundaryBuf);
  while (index !== -1) {
    const nextIndex = parts.indexOf(boundaryBuf, index + boundaryBuf.length);
    if (nextIndex === -1) break;
    let part = parts.subarray(index + boundaryBuf.length, nextIndex);
    if (part[0] === 0x0d && part[1] === 0x0a) part = part.subarray(2);
    if (part[part.length - 2] === 0x0d && part[part.length - 1] === 0x0a) part = part.subarray(0, part.length - 2);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString('utf8');
      const data = part.subarray(headerEnd + 4);
      const nameMatch = /name="([^"]*)"/.exec(headers);
      const fileMatch = /filename="([^"]*)"/.exec(headers);
      if (nameMatch) {
        if (fileMatch) fileParts.set(nameMatch[1], { fileName: fileMatch[1], data: Buffer.from(data) });
        else fields.set(nameMatch[1], data.toString('utf8'));
      }
    }
    index = nextIndex;
  }
  (req as AuthedRequest & { fileParts?: Map<string, { fileName: string; data: Buffer }> }).fileParts = fileParts;
  (req as AuthedRequest & { fields?: Map<string, string> }).fields = fields;
  next();
});



function findRoute(req: Request, method: string, path: string): RouteDef | undefined {
  const segments = path.split('/').filter(Boolean);
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const routeSegments = route.pattern.split('/').filter(Boolean);
    if (routeSegments.length !== segments.length) continue;
    const match = routeSegments.every((seg, i) => (seg.startsWith(':') ? true : seg === segments[i]));
    if (match) {
      const params: Record<string, string> = {};
      routeSegments.forEach((seg, i) => {
        if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(segments[i]);
      });
      (req as AuthedRequest).params = params;
      return route;
    }
  }
  return undefined;
}

app.all('/api/*any', async (req: Request, res: Response) => {
  const authed = req as AuthedRequest;
  const path = req.path === '/api' ? '/api/' : req.path;
  const method = req.method.toUpperCase();
  noStore(res);
  if (req.path.startsWith('/api/inspect')) {
    res.setHeader('Referrer-Policy', 'no-referrer');
  }
  try {
    // 1. Cross-origin state-changing requests are refused first.
    if (method !== 'GET' && method !== 'HEAD' && isCrossSite(req)) {
      sendError(res, 403, 'cross_origin', errorCopy('cross_origin'));
      return;
    }
    // 2. Body size limit.
    const raw = authed.rawBody;
    if (raw && raw.length > JSON_BODY_LIMIT) {
      sendError(res, 413, 'payload_too_large', errorCopy('payload_too_large'));
      return;
    }
    const route = findRoute(req, method, req.path);
    const inspectorPath = req.path.startsWith('/api/inspect/');
    if (inspectorPath && method !== 'GET') {
      sendError(res, 405, 'read_only', errorCopy('read_only'));
      return;
    }
    if (!route) {
      // Unlisted paths: session check, then 404. Every path not in the table
      // needs a session.
      if (!methodPathListed(method, path)) {
        try {
          await requireSession(authed);
        } catch {
          sendError(res, 401, 'unauthenticated', errorCopy('unauthenticated'));
          return;
        }
        sendError(res, 404, 'not_found', errorCopy('not_found'));
        return;
      }
    }
    if (!route) {
      sendError(res, 404, 'not_found', errorCopy('not_found'));
      return;
    }
    // 3. Content type: JSON with Content-Type application/json.
    if (method !== 'GET' && method !== 'HEAD' && route.pattern !== '/api/documents' && req.headers['content-type'] !== undefined) {
      const type = (req.headers['content-type'].split(';')[0] ?? '').trim().toLowerCase();
      if (type !== 'application/json') {
        sendError(res, 415, 'unsupported_media_type', errorCopy('unsupported_media_type'));
        return;
      }
    }
    // 4. Malformed JSON.
    if (route.pattern !== '/api/documents' && raw && raw.length > 0) {
      try {
        JSON.parse(raw.toString('utf8'));
      } catch {
        sendError(res, 400, 'bad_request', errorCopy('bad_request'));
        return;
      }
    }
    await wrap(route.handler, route, ctx)(req, res);
  } catch (err) {
    if (res.headersSent) return;
    if (err instanceof ApiError) {
      sendError(res, err.status, err.code, err.message, err.extra);
      return;
    }
    // eslint-disable-next-line no-console
    console.error('unexpected error', err);
    sendError(res, 500, 'internal', errorCopy('internal'));
  }
});

async function requireSession(req: AuthedRequest): Promise<void> {
  const { requireCaller } = await import('./api-core.js');
  await requireCaller(req);
}

// ---------------------------------------------------------------------------
// Screens and static assets
// ---------------------------------------------------------------------------
const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lineboard</title>
<link rel="stylesheet" href="/app.css">
<link rel="preload" href="/fonts/archivo-black-latin.woff2" as="font" type="font/woff2" crossorigin>
</head>
<body>
<div id="root"></div>
<script src="/app.js" type="module"></script>
</body>
</html>`;

const SCREEN_PATHS = new Set(['/', '/board', '/bookings', '/documents', '/invoices', '/reports', '/sanitation', '/settings']);

app.use((req: Request, res: Response) => {
  noStore(res);
  const path = req.path === '' ? '/' : req.path;
  if (SCREEN_PATHS.has(path) || path.startsWith('/inspect/')) {
    if (path.startsWith('/inspect/')) res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(INDEX_HTML);
    return;
  }
  const assetPath = resolve(process.cwd(), 'public', path.replace(/^\//, ''));
  const publicDir = resolve(process.cwd(), 'public');
  if (assetPath.startsWith(publicDir) && existsSync(assetPath)) {
    const types: Record<string, string> = {
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.woff2': 'font/woff2',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
    };
    const ext = assetPath.slice(assetPath.lastIndexOf('.'));
    if (types[ext]) {
      if (path.startsWith('/fonts/')) res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Content-Type', types[ext]);
      res.status(200).end(readFileSync(assetPath));
      return;
    }
  }
  res.status(404).send('Not found');
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot(): Promise<void> {
  const pool = initDb(config);
  // Wait for PostgreSQL.
  for (let attempt = 0; ; attempt++) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (err) {
      if (attempt > 300) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  const client = await pool.connect();
  try {
    await withContentionRetry(async (c) => {
      await applySchema(c);
      await applySeed(c, new Date());
    });
  } finally {
    client.release();
  }
  const worker = new OutboxWorker(ctx);
  worker.start();
  void initialSeedWork(ctx);
  app.listen(config.port, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(`Lineboard serving on port ${config.port}`);
  });
}

void boot();
