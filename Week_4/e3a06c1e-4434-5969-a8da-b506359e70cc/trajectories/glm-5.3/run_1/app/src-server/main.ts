// The HTTP server: same-origin enforcement, body limits, routing, WS upgrade, static assets.

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, type Config } from './config';
import { applySchema, createPool, type Db } from './db';
import { SessionHub } from './hub';
import { Storage } from './storage';
import { KillBillClient } from './killbill';
import { BillingWorker } from './billing';
import { LiveServer, handleEvents } from './live';
import { errors, ApiError, sendError, writeJson } from './errors';
import { memberForCookie, parseCookies, principalForToken } from './auth';
import { allowed, requireAction, visibleProjectIds, landingRoute } from './access';
import { matchRoute, type Ctx, type Route } from './router';
import { authRoutes, orgRoutes, publicRoutes } from './routes-org';
import { projectRoutes } from './routes-projects';
import { sessionRoutes } from './routes-sessions';
import { reviewRoutes } from './routes-review';
import { billingRoutes } from './routes-billing';
import { v1Routes } from './routes-v1';
import { seed } from './seed';
import { catalogXml } from './catalog';
import { checkText } from '../src-shared/text';
import { FIELD_MESSAGES } from '../src-shared/copy';

// dist-server sits next to dist-browser in the build output.
const browserRoot = path.join(__dirname, '..', 'dist-browser');

async function main(): Promise<void> {
  const cfg = loadConfig();
  const db = await createPool(cfg.databaseUrl);

  // Health answers 200 only once the schema is applied.
  let schemaReady = false;
  for (;;) {
    try {
      await applySchema(db);
      schemaReady = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const storage = new Storage(cfg);
  const kb = new KillBillClient(cfg);
  const billing = new BillingWorker(db, kb, cfg.billingPrefix);
  const hub = new SessionHub(db, () => new Date(), cfg.idleSeconds, cfg.sessionCapSeconds);
  const live = new LiveServer(db, hub, storage, cfg);

  // Kill Bill startup: catalog, accounts and subscriptions, retried until reachable.
  void provisionBilling(db, kb, cfg);

  // Seed records are created idempotently at start.
  const seedResult = await seed(db, storage);
  billing.start();
  void billing.retryPending();

  const routes: Route[] = [
    ...publicRoutes(),
    ...authRoutes(),
    ...orgRoutes(),
    ...projectRoutes(),
    ...sessionRoutes(),
    ...reviewRoutes(),
    ...billingRoutes(),
    ...v1Routes(),
  ];

  const MIME: Record<string, string> = {
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.woff2': 'font/woff2',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.map': 'application/json',
  };

  function serveStatic(res: http.ServerResponse, file: string): boolean {
    const base = browserRoot;
    const full = path.resolve(base, file);
    if (!full.startsWith(base + path.sep)) return false;
    if (!existsSync(full)) return false;
    const data = readFileSync(full);
    const ext = path.extname(full);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Content-Length': data.length });
    res.end(data);
    return true;
  }

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((e) => {
      if (!res.headersSent) sendError(res, e);
      else res.destroy();
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    // ---------- public fixtures and health ----------
    if (method === 'GET' && pathname === '/api/health') {
      if (!schemaReady) { res.writeHead(503); res.end(); return; }
      writeJson(res, 200, { status: 'ok' });
      return;
    }
    if (method === 'GET' && pathname === '/fixtures/tone-1khz.wav') {
      const tone = Buffer.from((await import('../src-shared/audio')).toneFixture());
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': tone.length });
      res.end(tone);
      return;
    }
    if (method === 'GET' && pathname === '/api/public/demo-spectrum') {
      writeJson(res, 200, seedResult.demoSpectrum);
      return;
    }

    // ---------- same-origin writes ----------
    if (isStateChanging(method) && (pathname.startsWith('/api/') || pathname.startsWith('/v1/'))) {
      const origin = req.headers.origin;
      if (origin !== undefined) {
        const expected = `${url.protocol}//${req.headers.host}`;
        if (origin !== expected) throw errors.crossOrigin();
      }
    }

    // ---------- route dispatch ----------
    const cookies = parseCookies(req);
    const member = pathname.startsWith('/api/') ? await memberForCookie(db, cookies['lowfield_session']) : null;

    const matched = matchRoute(routes, method, pathname);
    if (matched) {
      const ctx: Ctx = { req, res, url, method, db, hub, storage, billing, kb, cfg, member, setMember: () => {} };
      try {
        await matched.route.handler(ctx);
      } catch (e) {
        if (e instanceof Error) process.stderr.write(`route ${method} ${pathname}: ${e.stack}\n`);
        sendError(res, e);
      }
      return;
    }

    // ---------- SSE events ----------
    if (method === 'GET' && pathname.startsWith('/api/sessions/') && pathname.endsWith('/events')) {
      const sessionId = pathname.split('/')[3];
      const ctx: Ctx = { req, res, url, method, db, hub, storage, billing, kb, cfg, member, setMember: () => {} };
      if (!member) throw errors.unauthenticated();
      requireAction(member, 'viewSessions');
      const { visibleProjectIds } = await import('./access');
      const { loadSessionRow } = await import('./api');
      const row = await loadSessionRow(db, sessionId);
      if (!row) throw errors.notFound();
      const visible = await visibleProjectIds(db, member);
      if (!visible.includes(row.project_id)) throw errors.notFound();
      await handleEvents(db, hub, req, res, sessionId);
      return;
    }

    // ---------- /v1/listen upgrade (plain-HTTP validation first) ----------
    if (pathname === '/v1/listen') {
      const auth = req.headers.authorization;
      const m = /^Token (.+)$/.exec(String(auth ?? ''));
      if (!m) { sendError(res, errors.invalidKey()); return; }
      const principal = await principalForToken(db, m[1]);
      if (!principal) { sendError(res, errors.invalidKey()); return; }
      const channels = url.searchParams.get('channels');
      if (channels !== null && channels !== '1' && channels !== '2') {
        sendError(res, errors.validation({ channels: FIELD_MESSAGES.channels }));
        return;
      }
      const sampleRate = url.searchParams.get('sample_rate');
      if (sampleRate !== null && sampleRate !== '16000') {
        sendError(res, errors.validation({ sample_rate: FIELD_MESSAGES.sampleRate }));
        return;
      }
      const label = url.searchParams.get('label');
      if (label !== null) {
        const lc = checkText(label, 0, 80);
        if (!lc.ok) { sendError(res, errors.validation({ label: FIELD_MESSAGES.label })); return; }
      }
      const { rows: proj } = await db.query(`SELECT monthly_quota_minutes FROM projects WHERE id=$1`, [principal.project_id]);
      const quota = await hub.quotaFor(principal.project_id, proj[0].monthly_quota_minutes as number);
      if (quota.exhausted) { sendError(res, errors.tooMany('quota_exhausted', 'This project\u2019s quota is used up.')); return; }
      const storageHealthy = await storage.health();
      if (!storageHealthy) { sendError(res, errors.unavailable('storage_unavailable', 'Audio storage is unreachable.')); return; }
      // Hand the principal to the upgrade through the request object.
      (req as unknown as { __principal?: typeof principal }).__principal = principal;
      if (method === 'GET' && String(req.headers.upgrade ?? '').toLowerCase() === 'websocket') {
        // handled by the 'upgrade' event
        res.writeHead(426, { 'Content-Type': 'text/plain' });
        res.end('WebSocket required');
        return;
      }
      res.writeHead(400);
      res.end();
      return;
    }

    // ---------- console pages and static assets ----------
    if (method === 'GET') {
      if (pathname === '/' || pathname === '/sign-in' || pathname.startsWith('/join/') || pathname.startsWith('/console')) {
        if (serveStatic(res, 'index.html')) return;
      }
      if (pathname === '/app.js' || pathname === '/console.css' || pathname.startsWith('/assets/') || pathname.startsWith('/fonts/')) {
        if (serveStatic(res, pathname.slice(1))) return;
      }
    }

    // Anything else is not found — including source files, maps and configs.
    sendError(res, errors.notFound());
  }

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/v1/listen') {
      socket.destroy();
      return;
    }
    const auth = req.headers.authorization;
    const m = /^Token (.+)$/.exec(String(auth ?? ''));
    if (!m) { refuseUpgrade(socket, errors.invalidKey()); return; }
    void principalForToken(db, m[1]).then((principal) => {
      if (!principal) { refuseUpgrade(socket, errors.invalidKey()); return; }
      (req as unknown as { __principal?: typeof principal }).__principal = principal;
      live.handleUpgrade(req, socket, head);
    }).catch(() => refuseUpgrade(socket, errors.internal()));
  });

  function refuseUpgrade(socket: import('node:stream').Duplex, err: ApiError): void {
    const body = JSON.stringify({ error: err.code, message: err.message });
    socket.end(`HTTP/1.1 ${err.status} ${err.status === 401 ? 'Unauthorized' : 'Bad Request'}\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`);
  }

  server.listen(cfg.port, '0.0.0.0', () => {
    process.stdout.write(`lowfield serving on ${cfg.port}\n`);
  });
}

function isStateChanging(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

/** Catalog + account + subscription per org, retried until Kill Bill answers. */
async function provisionBilling(db: Db, kb: KillBillClient, cfg: Config): Promise<void> {
  for (;;) {
    try {
      const has = await kb.hasCatalog();
      if (!has) await kb.uploadCatalog(catalogXml(cfg.billingPrefix));
      const { rows } = await db.query<{ id: string; name: string; slug: string }>(`SELECT id, name, slug FROM orgs`);
      const now = new Date().toISOString();
      for (const org of rows) {
        const acctKey = `${cfg.billingPrefix}-${org.slug}`;
        const subKey = `${cfg.billingPrefix}-sub-${org.slug}`;
        let account = await kb.findAccountByExternalKey(acctKey);
        if (!account) account = await kb.createAccount(org.name, acctKey, now);
        if (!account) throw new Error('account create failed');
        if (!org) continue;
        let sub: { subscriptionId: string } | null = await kb.findSubscription(account.accountId, subKey);
        // The plan at seed time comes from the org row.
        const { rows: planRows } = await db.query(`SELECT plan FROM orgs WHERE id=$1`, [org.id]);
        const planName = `${cfg.billingPrefix}-${planRows[0].plan}`;
        if (!sub) {
          sub = await kb.createSubscription(account.accountId, subKey, planName);
        }
        if (!sub) throw new Error('subscription create failed');
        await db.query(
          `UPDATE orgs SET billing_account_id=$2, billing_subscription_id=$3, billing_account_created=true, billing_subscription_created=true WHERE id=$1`,
          [org.id, account.accountId, sub.subscriptionId],
        );
      }
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
