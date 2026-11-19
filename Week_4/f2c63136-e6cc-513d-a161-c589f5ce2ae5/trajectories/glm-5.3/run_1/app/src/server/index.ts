import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { readConfig, type AppConfig } from './config.js';
import { Database } from './db.js';
import { Clock, formatWorkspaceTime } from './clock.js';
import { S3Storage } from './storage.js';
import { Mailer } from './mail.js';
import { LiveHub } from './live.js';
import { ApiError, Errors, resolveAuth, type RequestContext } from './api/context.js';
import * as accounts from './api/accounts.js';
import * as reposApi from './api/repos.js';
import * as pushApi from './api/push.js';
import * as changesApi from './api/changes.js';
import * as grading from './api/grading.js';
import { renderPage } from './pages/router.js';
import { seed } from './seed.js';

const JSON_LIMIT_DEFAULT = 262144;

export interface Services {
  cfg: AppConfig;
  db: Database;
  clock: Clock;
  storage: S3Storage;
  mailer: Mailer;
  live: LiveHub;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

function send(res: http.ServerResponse, status: number, headers: Record<string, string>, body: Buffer | string): void {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  send(res, status, { 'Content-Type': 'application/json', ...extraHeaders }, JSON.stringify(body));
}

async function main(): Promise<void> {
  const cfg = readConfig();
  const clock = new Clock();
  const db = new Database(cfg);
  const storage = new S3Storage(cfg);
  const mailer = new Mailer(db, cfg, clock);
  const live = new LiveHub();
  const services: Services = { cfg, db, clock, storage, mailer, live };

  await db.init();
  // Seed idempotently on start.
  await seed(services).catch((e: unknown) => console.error('seed failed', e));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = req.method ?? 'GET';
    try {
      await handle(services, req, res, method, url);
    } catch (e) {
      if (e instanceof ApiError) {
        sendJson(res, e.status, e.body);
      } else {
        console.error('unhandled', e);
        sendJson(res, 500, { error: 'Internal error' });
      }
    }
  });

  // Live updates: one SSE connection per viewer, filtered by repository.
  server.on('upgrade', () => undefined);
  server.listen(cfg.appPublicPort, '0.0.0.0', () => {
    console.log(`ridgestack listening on 0.0.0.0:${cfg.appPublicPort}`);
  });

  // Timers: queue steps, check timeouts and outbox delivery follow the server clock.
  const timers = new (await import('./timers.js')).Timers(services);
  timers.start();
}

async function handle(
  s: Services, req: http.IncomingMessage, res: http.ServerResponse, method: string, url: URL,
): Promise<void> {
  const pathname = decodeURIComponent(url.pathname);
  const headers = req.headers as Record<string, string | undefined>;
  const cookies = parseCookies(headers['cookie']);

  // Live update stream.
  if (pathname === '/api/live' && method === 'GET') {
    const auth = await s.db.withTransaction(async (tx) => resolveAuth(tx, headers, cookies));
    if (!auth.user) { sendJson(res, 401, { error: 'Authentication required' }); return; }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    const repoRows = await s.db.pool.query(
      `SELECT r.id FROM repos r JOIN orgs o ON o.id = r.org_id
       WHERE EXISTS (SELECT 1 FROM repo_roles rr WHERE rr.repo_id = r.id AND rr.subject = $1)
          OR r.visibility = 'public'`,
      [`user:${auth.user.username}`],
    );
    const ids = new Set<number>(repoRows.rows.map((r: { id: number }) => r.id));
    s.live.attach(res, ids);
    return;
  }

  // Health.
  if (pathname === '/api/health' && method === 'GET') {
    const dbOk = await s.db.healthy();
    const storageOk = await s.storage.healthy();
    sendJson(res, 200, { status: dbOk && storageOk ? 'ok' : 'unavailable' });
    return;
  }

  // Grading routes: 404 without the right key.
  if (pathname === '/api/grading/setup' || pathname === '/api/grading/clock') {
    if (headers['x-grading-key'] !== s.cfg.gradingKey) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    const body = await readBody(req, 8 * 1024 * 1024);
    if (pathname === '/api/grading/setup') {
      const out = await s.db.withTransaction(async (tx) => {
        const ctx = makeContext(s, method, url, headers, cookies, body, tx);
        return await grading.setup(ctx);
      });
      sendJson(res, out.status, out.body);
      return;
    }
    // The clock route: advance first, commit, then fire every due timer in
    // time order outside the transaction before answering.
    const clockOut = await s.db.withTransaction(async (tx) => {
      const ctx = makeContext(s, method, url, headers, cookies, body, tx);
      return await grading.clock(ctx);
    });
    const timers = new (await import('./timers.js')).Timers(s);
    await timers.fireDue();
    sendJson(res, clockOut.status, clockOut.body);
    return;
  }

  // API routes under /api.
  if (pathname.startsWith('/api/')) {
    const handled = await handleApi(s, req, res, method, url, pathname, headers, cookies);
    if (handled) return;
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  // Static assets (the app's own stylesheet, client bundle and bundled fonts)
  // are served before page routing.
  const asset = staticAsset(pathname);
  if (asset) {
    send(res, 200, asset.headers, asset.body);
    return;
  }

  // Pages.
  const pageOut = await renderPage(s, method, url, pathname, headers, cookies);
  if (pageOut) {
    send(res, pageOut.status, pageOut.headers, String(pageOut.body));
    return;
  }
  const notFound = await renderPage(s, method, url, '/', headers, cookies, true);
  send(res, 404, { 'Content-Type': 'text/html; charset=utf-8' }, notFound?.body ?? 'Not found');
}

function makeContext(
  s: Services, method: string, url: URL, headers: Record<string, string | undefined>,
  cookies: Record<string, string>, body: Buffer, tx: import('pg').PoolClient,
): RequestContext {
  return {
    cfg: s.cfg, db: s.db, clock: s.clock, storage: s.storage, mailer: s.mailer, live: s.live,
    req: { method, url, headers, cookies, body },
    auth: { user: null, token: null },
    tx,
  };
}

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(Errors.tooLarge(limit));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleApi(
  s: Services, req: http.IncomingMessage, res: http.ServerResponse, method: string, url: URL,
  pathname: string, headers: Record<string, string | undefined>, cookies: Record<string, string>,
): Promise<boolean> {
  // The push and checks routes take the push size limit; every other JSON
  // route takes the default limit.
  const segs = pathname.split('/').filter(Boolean);
  const last = segs[segs.length - 1];
  const isPushOrChecks = (last === 'push' || last === 'checks') && segs.includes('repos');
  const limit = isPushOrChecks ? s.cfg.pushSizeLimitBytes : JSON_LIMIT_DEFAULT;
  const raw = await readBody(req, limit * 2).catch(() => Buffer.alloc(0));
  // The whole route runs in one transaction; the response is sent only after
  // the commit so no caller can observe uncommitted state.
  const out = await s.db.withTransaction(async (tx) => {
    const ctx: RequestContext = {
      cfg: s.cfg, db: s.db, clock: s.clock, storage: s.storage, mailer: s.mailer, live: s.live,
      req: { method, url, headers, cookies, body: raw },
      auth: await resolveAuth(tx, headers, cookies),
      tx,
    };
    return await routeApi(ctx, method, url, pathname);
  });
  if (!out) return false;
  if (out.redirect) {
    send(res, out.status, { Location: out.redirect, 'Content-Type': 'application/json' }, JSON.stringify(out.body));
  } else if (out.type) {
    send(res, out.status, { 'Content-Type': out.type }, String(out.body));
  } else {
    const extra: Record<string, string> = {};
    if (out.setCookie) extra['Set-Cookie'] = out.setCookie;
    sendJson(res, out.status, out.body, extra);
  }
  return true;
}

function parts(pathname: string): string[] {
  return pathname.split('/').filter(Boolean);
}

interface ApiOut {
  status: number;
  body: unknown;
  redirect?: string;
  type?: string;
  setCookie?: string;
}

/** The one place every API route is dispatched. */
async function routeApi(ctx: RequestContext, method: string, url: URL, pathname: string): Promise<ApiOut | null> {
  const segs = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const len = segs.length;
  // segs[0] === 'api'
  if (segs[1] === 'signup' && method === 'POST') return await accounts.signup(ctx);
  if (segs[1] === 'confirm' && method === 'POST') return await accounts.confirm(ctx);
  if (segs[1] === 'login' && method === 'POST') {
    const out = await accounts.login(ctx);
    return {
      status: out.status,
      body: out.body,
      setCookie: out.session
        ? `ridgestack_session=${out.session}; HttpOnly; Path=/; SameSite=Lax`
        : undefined,
    };
  }
  if (segs[1] === 'logout' && method === 'POST') {
    if (!ctx.auth.user) throw Errors.unauthenticated();
    await ctx.tx.query('DELETE FROM sessions WHERE token = $1', [ctx.req.cookies['ridgestack_session']]);
    return { status: 204, body: null };
  }
  if (segs[1] === 'me' && method === 'GET') {
    if (!ctx.auth.user) throw Errors.unauthenticated();
    return { status: 200, body: { username: ctx.auth.user.username, name: ctx.auth.user.name, email: ctx.auth.user.email } };
  }
  if (segs[1] === 'orgs') {
    if (len === 2 && method === 'POST') return await accounts.createOrg(ctx);
    // /api/orgs/<org>/...
    const org = segs[2];
    if (segs[3] === 'teams') {
      if (len === 4 && method === 'POST') return await accounts.createTeam(ctx, org);
      if (len === 7 && method === 'PUT' && segs[5] === 'members') {
        return await accounts.addTeamMember(ctx, org, segs[4], segs[6]);
      }
    }
    if (segs[3] === 'repos') {
      if (len === 4 && method === 'POST') return await reposApi.createRepo(ctx, org);
      if (len >= 5) {
        const l: number = len;
        const repo = segs[4];
        if (len === 5 && method === 'GET') return await reposApi.getRepo(ctx, org, repo);
        // /api/orgs/<org>/repos/<repo>/...
        const sub = segs[5];
        if (sub === 'settings' && method === 'PUT') return await reposApi.updateSettings(ctx, org, repo);
        if (sub === 'roles') {
          if (l === 6 && method === 'PUT') return await reposApi.grantRole(ctx, org, repo);
          if (l === 7 && method === 'DELETE') return await reposApi.removeRole(ctx, org, repo, segs[6]);
        }
        if (sub === 'tokens') {
          if (l === 6 && method === 'POST') return await reposApi.createToken(ctx, org, repo);
          if (l === 7 && method === 'DELETE') return await reposApi.revokeToken(ctx, org, repo, Number(segs[6]));
        }
        if (sub === 'branches' && l === 7 && method === 'GET') return await pushApi.getBranchRoute(ctx, org, repo, segs[6]);
        if (sub === 'revisions') {
          const rev = segs[6];
          if (l === 7 && method === 'GET') return await pushApi.getRevisionRoute(ctx, org, repo, rev);
          if (segs[7] === 'files' && l === 9 && method === 'GET') {
            return await pushApi.getRevisionFile(ctx, org, repo, rev, segs[8]);
          }
          if (segs[7] === 'archive' && l === 8 && method === 'POST') {
            return await pushApi.exportArchive(ctx, org, repo, rev);
          }
        }
        if (sub === 'push' && method === 'POST') return await pushApi.push(ctx, org, repo);
        if (sub === 'checks' && method === 'POST') return await pushApi.reportCheck(ctx, org, repo);
        if (sub === 'changes') {
          if (l === 6 && method === 'POST') return await changesApi.createChange(ctx, org, repo);
          if (l === 6 && method === 'GET') return await changesApi.listChanges(ctx, org, repo);
          const n = Number(segs[6]);
          if (!Number.isInteger(n) || n < 1) throw Errors.notFound();
          if (l === 7 && method === 'GET') return await changesApi.getChangeRoute(ctx, org, repo, n);
          const action = segs[7];
          if (action === 'diff' && method === 'GET') return await changesApi.getChangeDiff(ctx, org, repo, n);
          if (action === 'ready' && method === 'PUT') return await changesApi.markReady(ctx, org, repo, n);
          if (action === 'review-requests' && method === 'POST') return await changesApi.requestReview(ctx, org, repo, n);
          if (action === 'threads') {
            if (l === 8 && method === 'POST') return await changesApi.createThread(ctx, org, repo, n);
            const threadId = Number(segs[8]);
            if (!Number.isInteger(threadId)) throw Errors.notFound();
            if (segs[9] === 'replies' && method === 'POST') return await changesApi.replyThread(ctx, org, repo, n, threadId);
            if (segs[9] === 'state' && method === 'PUT') return await changesApi.setThreadState(ctx, org, repo, n, threadId);
          }
          if (action === 'suggestions' && segs[8] === 'apply' && method === 'POST') {
            return await changesApi.applySuggestions(ctx, org, repo, n);
          }
          if (action === 'reviews') {
            if (l === 8 && method === 'POST') return await changesApi.submitReview(ctx, org, repo, n);
            const reviewId = Number(segs[8]);
            if (!Number.isInteger(reviewId)) throw Errors.notFound();
            if (segs[9] === 'dismiss' && method === 'POST') return await changesApi.dismissReview(ctx, org, repo, n, reviewId);
          }
          if (action === 'viewed' && method === 'PUT') return await changesApi.setViewed(ctx, org, repo, n);
          if (action === 'merge' && method === 'POST') return await changesApi.mergeChange(ctx, org, repo, n);
          if (action === 'queue' && method === 'POST') return await changesApi.addToQueue(ctx, org, repo, n);
        }
        if (sub === 'queue') {
          if (l === 6 && method === 'GET') return await changesApi.getQueue(ctx, org, repo);
          const entryId = Number(segs[6]);
          if (!Number.isInteger(entryId)) throw Errors.notFound();
          if (segs[7] === 'position' && method === 'PUT') return await changesApi.moveQueueEntry(ctx, org, repo, entryId);
        }
      }
    }
  }
  if (segs[1] === 'repos' && len === 2 && method === 'GET') return await reposApi.listRepos(ctx);
  return null;
}

/**
 * Static assets: only the app's own stylesheet, client bundle and bundled
 * fonts are served. No source file, environment value or dependency folder is
 * reachable through the web root.
 */
function staticAsset(pathname: string): { headers: Record<string, string>; body: Buffer } | null {
  const root = path.resolve('public');
  const file = path.resolve(root, pathname.replace(/^\//, ''));
  if (!file.startsWith(root + path.sep)) return null;
  const allowed =
    file === path.resolve(root, 'app.css') ||
    file === path.resolve(root, 'client.js') ||
    file === path.resolve(root, 'fonts.css') ||
    file.startsWith(path.resolve(root, 'fonts') + path.sep);
  if (!allowed) return null;
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  const types: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
  };
  const ext = path.extname(file);
  return {
    headers: { 'Content-Type': types[ext] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' },
    body: readFileSync(file),
  };
}

main().catch((e) => {
  console.error('fatal', e);
  process.exit(1);
});
