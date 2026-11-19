import { createServer, type IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { AppError, setBodyText, sendError, sendJson } from '../errors.js';
import { transaction, query } from './db.js';
import { Router } from './router.js';
import { buildServices, startServiceChecks } from './services.js';
import { applySchemaAndSeed, SEED_USERS, USER_IDS } from './seed.js';
import { flushOutbox } from './outbox.js';
import { processRenderJob } from './renders.js';
import { pollPayingOrders, pollPendingPlans, pollPendingPacks, renderInvoiceForOrder } from './billing.js';
import type { RouteDeps } from './routes.js';
import * as routes from './routes.js';
import { ensureLocalUser, sessionCookie, clearSessionCookie } from './auth.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const NEVER_SERVED = /\.(ts|map)$|^\/\.env|^\/run\.json$|\/package(-lock)?\.json$|^\/node_modules\//;

export function createAppRouter(deps: RouteDeps): Router {
  const router = new Router();
  router.add('GET', '/api/health', async (ctx) => sendJson(ctx.res, 200, { status: 'ok' }));
  router.add('GET', '/api/me', async (ctx) => {
    if (!ctx.user) throw AppError.unauthenticated();
    await ensureLocalUser(ctx.user);
    sendJson(ctx.res, 200, { id: ctx.user.id, username: ctx.user.username, display_name: ctx.user.display_name, email: ctx.user.email, roles: ctx.user.roles });
  });
  router.add('GET', '/api/gallery', (ctx) => routes.gallery(ctx));
  router.add('GET', '/api/pieces/:slug', (ctx) => routes.pieceDetail(ctx));
  router.add('GET', '/api/pieces/:slug/editions', (ctx) => routes.pieceEditions(ctx));
  router.add('POST', '/api/pieces/describe', (ctx) => routes.describePiece(ctx, deps));
  router.add('PUT', '/api/pieces/:slug', (ctx) => routes.savePiece(ctx));
  router.add('POST', '/api/pieces/:slug/assets', (ctx) => routes.uploadAsset(ctx, deps));
  router.add('POST', '/api/pieces/:slug/renders', (ctx) => routes.createRender(ctx, deps));
  router.add('GET', '/api/pieces/:slug/renders', (ctx) => routes.listRenders(ctx));
  router.add('GET', '/api/renders/:id', (ctx) => routes.getRenderById(ctx));
  router.add('POST', '/api/renders/:id/cancel', (ctx) => routes.cancelRenderRoute(ctx));
  router.add('POST', '/api/pieces/:slug/publish', (ctx) => routes.publishPiece(ctx));
  router.add('POST', '/api/pieces/:slug/withdraw', (ctx) => routes.withdrawPiece(ctx));
  router.add('POST', '/api/pieces/:slug/remix', (ctx) => routes.remixPiece(ctx));
  router.add('POST', '/api/pieces/:slug/editions/:n/holds', (ctx) => routes.createHold(ctx, deps));
  router.add('GET', '/api/orders/current', (ctx) => routes.currentOrder(ctx));
  router.add('DELETE', '/api/orders/:id/hold', (ctx) => routes.releaseHold(ctx));
  router.add('POST', '/api/orders/:id/buy', (ctx) => routes.buyOrder(ctx, deps));
  router.add('GET', '/api/orders/:id', (ctx) => routes.getOrderById(ctx));
  router.add('GET', '/api/me/orders', (ctx) => routes.myOrders(ctx));
  router.add('GET', '/api/studio-pieces', (ctx) => routes.myStudioPieces(ctx));
  router.add('GET', '/api/orders/:id/export', (ctx) => routes.orderDownload(ctx, deps, 'export'));
  router.add('GET', '/api/orders/:id/invoice', (ctx) => routes.orderDownload(ctx, deps, 'invoice'));
  router.add('POST', '/api/billing/killbill-events', (ctx) => routes.killbillEvent(ctx, deps));
  router.add('GET', '/api/admin/orders', (ctx) => routes.adminOrders(ctx));
  router.add('GET', '/api/admin/orders/:id/splits', (ctx) => routes.adminOrderSplits(ctx));
  router.add('POST', '/api/admin/orders/:id/refunds', (ctx) => routes.adminRefund(ctx, deps));
  router.add('GET', '/api/admin/credit-ledger', (ctx) => routes.adminCreditLedger(ctx));
  router.add('GET', '/api/admin/renders', (ctx) => routes.adminRenders(ctx));
  router.add('POST', '/api/admin/statements', (ctx) => routes.adminCloseStatements(ctx, deps));
  router.add('GET', '/api/admin/services', (ctx) => routes.adminServices(ctx, deps));
  router.add('GET', '/api/me/credits', (ctx) => routes.myCredits(ctx));
  router.add('GET', '/api/me/plan', (ctx) => routes.myPlan(ctx));
  router.add('POST', '/api/me/plan', (ctx) => routes.choosePlan(ctx, deps));
  router.add('POST', '/api/me/plan/cancel', (ctx) => routes.cancelPlan(ctx, deps));
  router.add('POST', '/api/me/credit-packs', (ctx) => routes.buyPack(ctx, deps));
  router.add('GET', '/api/me/credit-packs/:id', (ctx) => routes.getPack(ctx));
  router.add('GET', '/api/me/statements/:period', (ctx) => routes.myStatements(ctx));
  return router;
}

async function readBody(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const contentType = (req.headers['content-type'] ?? '').toLowerCase();
  const isJson = contentType.includes('application/json');
  const isMultipart = contentType.includes('multipart/form-data');
  const isForm = contentType.includes('application/x-www-form-urlencoded');
  const write = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE';
  if (!isJson && !isMultipart && !isForm) {
    const hasBody = req.headers['content-type'] !== undefined;
    if (write && hasBody) {
      sendError(res, AppError.unsupportedMedia());
      return;
    }
    if (!write) {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > 20_000_000) { sendError(res, AppError.payloadTooLarge()); return; }
        chunks.push(chunk as Buffer);
      }
      setBodyText(req, Buffer.concat(chunks).toString('utf8'));
    }
    return;
  }
  const limit = isJson ? 1_000_000 : 20_000_000;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) {
      sendError(res, isJson ? AppError.payloadTooLarge() : AppError.payloadTooLarge());
      return;
    }
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks);
  if (isJson) {
    setBodyText(req, raw.toString('utf8'));
    return;
  }
  if (isMultipart) {
    (req as unknown as { __multipart?: unknown }).__multipart = parseMultipart(raw, contentType);
    return;
  }
  setBodyText(req, raw.toString('utf8'));
}

function parseMultipart(raw: Buffer, contentType: string): { fields: Record<string, string>; file?: { filename: string; bytes: Buffer } } {
  const match = /boundary=(.+)$/.exec(contentType);
  const boundary = match?.[1]?.replace(/"/g, '') ?? '';
  const out: { fields: Record<string, string>; file?: { filename: string; bytes: Buffer } } = { fields: {} };
  if (!boundary) return out;
  const sep = Buffer.from(`--${boundary}`);
  const parts: Buffer[] = [];
  let idx = raw.indexOf(sep);
  while (idx !== -1) {
    const next = raw.indexOf(sep, idx + sep.length);
    parts.push(raw.subarray(idx, next === -1 ? raw.length : next));
    idx = next;
  }
  for (const part of parts) {
    if (part.length === 0 || part.toString('utf8').trim() === '--') continue;
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headers = part.subarray(0, headerEnd).toString('utf8');
    let body = part.subarray(headerEnd + 4);
    if (body.subarray(body.length - 2).toString('utf8') === '\r\n') body = body.subarray(0, body.length - 2);
    const nameMatch = /name="([^"]+)"/.exec(headers);
    if (!nameMatch) continue;
    const fileMatch = /filename="([^"]+)"/.exec(headers);
    if (fileMatch) {
      out.file = { filename: fileMatch[1], bytes: Buffer.from(body) };
    } else {
      out.fields[nameMatch[1]] = body.toString('utf8');
    }
  }
  return out;
}

const PAGES: Record<string, string> = {
  '/': 'index.html',
  '/gallery': 'gallery.html',
  '/studio': 'studio.html',
  '/studio/credits': 'credits.html',
  '/library': 'library.html',
  '/console': 'console.html'
};

export function pageFor(path: string): { file: string; status: number } | null {
  if (PAGES[path]) return { file: PAGES[path], status: 200 };
  if (path.startsWith('/pieces/')) return { file: 'piece.html', status: 200 };
  if (/^\/studio\/pieces\/[^/]+$/.test(path)) return { file: 'editor.html', status: 200 };
  return null;
}

export function serveApp(deps: RouteDeps): void {
  const router = createAppRouter(deps);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const path = url.pathname;
      if (path.startsWith('/api/')) {
        await readBody(req, res);
        if (res.headersSent || res.writableEnded) return;
        await router.dispatch(req, res);
        return;
      }
      if (path === '/auth/logout' && req.method === 'POST') {
        res.writeHead(204, { 'Set-Cookie': clearSessionCookie() });
        res.end();
        return;
      }
      if (path === '/auth/login' && req.method === 'GET') {
        const returnTo = url.searchParams.get('return_to') ?? '/';
        res.writeHead(302, { Location: `${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/auth?client_id=${encodeURIComponent(config.authClientId)}&redirect_uri=${encodeURIComponent(`${config.appPublicUrl}/auth/callback?return_to=${encodeURIComponent(returnTo)}`)}&response_type=code&scope=openid` });
        res.end();
        return;
      }
      if (path === '/auth/callback' && req.method === 'GET') {
        const code = url.searchParams.get('code');
        const returnTo = url.searchParams.get('return_to') ?? '/';
        if (!code) {
          res.writeHead(302, { Location: returnTo });
          res.end();
          return;
        }
        try {
          const tokenRes = await fetch(`${config.keycloakUrl}/realms/${config.keycloakRealm}/protocol/openid-connect/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code,
              client_id: config.authClientId,
              client_secret: config.authClientSecret,
              redirect_uri: `${config.appPublicUrl}/auth/callback?return_to=${encodeURIComponent(returnTo)}`
            }).toString()
          });
          if (!tokenRes.ok) throw new Error('token_exchange_failed');
          const tokens = await tokenRes.json() as { access_token: string };
          const parts = tokens.access_token.split('.')[1] ?? '';
          const claims = JSON.parse(Buffer.from(parts, 'base64url').toString('utf8')) as { sub: string; preferred_username?: string; email?: string; name?: string; realm_access?: { roles?: string[] } };
          const roles = claims.realm_access?.roles ?? [];
          const ensured = ['creator', 'collector', ...(roles.includes('founder-operator') ? ['founder-operator'] : [])];
          await ensureLocalUser({ id: claims.sub, username: claims.preferred_username ?? '', display_name: claims.name ?? claims.preferred_username ?? '', email: claims.email ?? '', roles: ensured });
          res.writeHead(302, { Location: returnTo, 'Set-Cookie': sessionCookie(claims.sub) });
          res.end();
          return;
        } catch {
          res.writeHead(302, { Location: '/' });
          res.end();
          return;
        }
      }
      if (NEVER_SERVED.test(path)) {
        sendError(res, AppError.notFound());
        return;
      }
      const page = pageFor(path);
      if (page) {
        const file = join(process.cwd(), 'public', page.file);
        if (existsSync(file)) {
          const html = readFileSync(file, 'utf8');
          res.writeHead(page.status, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
          return;
        }
      }
      const assetPath = join(process.cwd(), 'public', path.replace(/^\//, ''));
      if (existsSync(assetPath) && !assetPath.endsWith('.ts') && !assetPath.includes('..') && statSync(assetPath).isFile()) {
        const ext = assetPath.slice(assetPath.lastIndexOf('.'));
        const mime = MIME[ext] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=300' });
        res.end(readFileSync(assetPath));
        return;
      }
      sendError(res, AppError.notFound());
    } catch (err) {
      console.error('[http] error', err);
      if (!res.headersSent) sendJson(res, 500, { error: { code: 'internal_error', message: 'Something went wrong.' } });
      else res.end();
    }
  });
  server.listen(config.appPublicPort, '0.0.0.0', () => {
    console.log(`[phosphene] serving on 0.0.0.0:${config.appPublicPort}`);
  });
}

export async function boot(): Promise<void> {
  const services = buildServices();
  // Postgres is the system of record: retry until the schema applies.
  for (;;) {
    try {
      await transaction(async (tx) => {
        await applySchemaAndSeed(tx, {
          storage: {
            put: async (key, bytes, contentType) => {
              await services.storage.put(key, bytes, contentType);
            }
          }
        });
      });
      break;
    } catch (err) {
      console.warn('[phosphene] postgres not ready, retrying in 2s:', err instanceof Error ? err.message : err);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  const checks = startServiceChecks(services);
  const deps: RouteDeps = { services, checks };
  serveApp(deps);

  // Keycloak roles and seeded users, idempotent and safe to run concurrently.
  void services.keycloak.ensureRoles().then(async () => {
    for (const user of SEED_USERS) {
      const id = USER_IDS[user.username.split('.')[0]];
      await services.keycloak.ensureUser(user.username, user.email, user.password, user.display_name, user.roles).then((kcId) => {
        return query(`UPDATE users SET id = $2 WHERE id = $1 AND id LIKE 'u_%'`, [id, kcId]).catch(() => null);
      }).catch((err) => console.warn('[phosphene] keycloak user seed failed', user.username, err));
    }
  }).catch((err) => console.warn('[phosphene] keycloak seed skipped:', err instanceof Error ? err.message : err));

  void services.killbill.ensureCatalog().catch(() => null);
  const { callbackToken } = await import('./lib/killbill.js');
  void services.killbill.registerCallback(callbackToken()).catch(() => null);

  // Background loops.
  const billingDeps = { killbill: services.killbill, storage: services.storage };
  const every = (ms: number, fn: () => Promise<void>) => {
    const timer = setInterval(() => { void fn().catch(() => null); }, ms);
    timer.unref();
  };
  every(2000, async () => {
    await pollPayingOrders(billingDeps);
    await pollPendingPlans(billingDeps);
    await pollPendingPacks(billingDeps);
  });
  every(5000, async () => {
    if (await checks.mailReachable()) await flushOutbox();
  });
  every(30_000, async () => {
    const rows = await query<{ id: string }>(`SELECT id FROM orders WHERE invoice_status = 'pending'`);
    for (const row of rows) {
      await renderInvoiceForOrder(billingDeps, row.id).catch(() => null);
    }
  });

  // Render queue consumer.
  const consume = () => {
    services.queue.consume((message, ack) => {
      void processRenderJob({ provider: services.renderProvider, storage: services.storage, queue: services.queue }, message.render_id, message.attempt, ack)
        .catch((err) => { console.warn('[render] job failed', err); ack(); });
    }).catch(() => {
      setTimeout(consume, 5000);
    });
  };
  consume();

  const holdTimer = setInterval(() => {
    void query(`UPDATE orders SET state = 'expired' WHERE state = 'held' AND expires_at <= now()`).catch(() => null);
  }, 1000);
  holdTimer.unref();
}

