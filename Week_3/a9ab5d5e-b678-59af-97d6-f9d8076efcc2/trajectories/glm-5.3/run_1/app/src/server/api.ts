/** The API server: routing, the error ladder, and every endpoint.
 *  One place decides every status and code. */
import { IncomingMessage, ServerResponse, createServer } from 'node:http';
import { Pool } from 'pg';
import { Config } from '../config';
import { Ctx, isStateChanging, JSON_BODY_LIMIT, RECEIPT_LIMIT, readBody, sendJson, sendProblem } from './http';
import { internalError, notFound, problem, Problem, validationProblem } from './problems';
import { ValidationErrors } from './validate';
import { claimIdempotency, storeResponse, releaseClaim, keyShape } from './idempotency';
import { S3 } from '../storage/s3';
import { AppDeps } from './apiTypes';
import * as auth from './auth';
import * as plan from './planApi';
import * as swapsApi from './swapApi';
import * as costsApi from './costApi';
import * as recordsApi from './recordsApi';
import * as linksApi from './shareApi';
import * as streamApi from './streamApi';
import { pagesRouter, PagesDeps } from './pages';

export interface ServerHandle extends ReturnType<typeof createServer> {
  deps: AppDeps & PagesDeps;
}

export function createApiServer(config: Config, pool: Pool, s3: S3): ServerHandle {
  const deps: AppDeps = { config, pool, s3 };
  const server = createServer((req, res) => {
    void handle(req, res, deps).catch(() => {
      // handled inside handle
    });
  });
  return Object.assign(server, { deps });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AppDeps,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${deps.config.appPublicPort}`);
  const ctx = new Ctx(req, res, url);
  try {
    await route(ctx, deps);
  } catch (e) {
    handleError(ctx, e, deps);
  }
}

export function handleError(ctx: Ctx, e: unknown, deps: AppDeps): void {
  if (ctx.res.headersSent) {
    ctx.res.destroy();
    return;
  }
  if (e instanceof ValidationErrors) {
    sendProblem(ctx, 422, validationProblem(e.errors).body());
    return;
  }
  if (e instanceof Problem) {
    sendProblem(ctx, e.status, e.body(), e.headers);
    return;
  }
  if (e instanceof Error && (e as { code?: string }).code === 'idempotency_key_reused') {
    sendProblem(ctx, 409, problem(409, 'idempotency_key_reused').body());
    return;
  }
  if (e instanceof Error && (e as { code?: string }).code === 'database_unavailable') {
    sendProblem(ctx, 503, problem(503, 'database_unavailable').body());
    return;
  }
  if (e instanceof Error && (e as { code?: string }).code === 'storage_unavailable') {
    sendProblem(ctx, 503, problem(503, 'storage_unavailable').body());
    return;
  }
  void deps;
  // Diagnostics to stderr; credentials are never logged.
  process.stderr.write(`internal_error: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  sendProblem(ctx, 500, internalError().body());
}

async function route(ctx: Ctx, deps: AppDeps): Promise<void> {
  const method = ctx.method();
  const path = ctx.url.pathname;

  if (path === '/api/health') {
    if (method !== 'GET' && method !== 'HEAD') {
      sendProblem(ctx, 405, problem(405, 'read_only').body(), { allow: 'GET, HEAD' });
      return;
    }
    try {
      await deps.pool.query('SELECT 1');
      if (method === 'HEAD') {
        ctx.res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        ctx.res.end();
      } else {
        sendJson(ctx, 200, { status: 'ok' });
      }
    } catch {
      sendProblem(ctx, 503, problem(503, 'database_unavailable').body());
    }
    return;
  }

  if (!path.startsWith('/api/')) {
    return pagesRouter(ctx, deps, { config: deps.config });
  }

  // state-changing under /api: origin first, then read the body
  if (isStateChanging(method)) {
    const origin = ctx.header('origin');
    if (origin !== new URL(deps.config.appPublicUrl).origin) {
      sendProblem(ctx, 403, problem(403, 'origin_mismatch').body());
      return;
    }
    const limit = path.includes('/receipts') ? RECEIPT_LIMIT : JSON_BODY_LIMIT;
    ctx.body = await readBody(ctx, limit);
  }

  const segs = path.slice('/api/'.length).split('/').filter(Boolean);

  // public routes
  if (path === '/api/households' && method === 'POST') return auth.createHousehold(ctx, deps);
  if (path === '/api/session' && method === 'POST') return auth.signIn(ctx, deps);
  if (path === '/api/session' && method === 'DELETE') {
    await auth.requireSession(ctx, deps);
    return auth.signOut(ctx, deps);
  }
  if (path === '/api/me' && method === 'GET') {
    await auth.requireSession(ctx, deps);
    return auth.me(ctx, deps);
  }
  if (segs[0] === 'join' && segs.length === 2 && method === 'GET') return auth.joinInfo(ctx, deps, segs[1]);
  if (path === '/api/join' && method === 'POST') return auth.joinByInvite(ctx, deps);
  if (segs[0] === 'share' && segs.length === 2 && method === 'GET') return linksApi.shareView(ctx, deps, segs[1]);
  if (segs[0] === 'share' && segs.length === 2 && method === 'HEAD') return linksApi.shareView(ctx, deps, segs[1], true);
  if (segs[0] === 'share' && segs.length === 2 && isStateChanging(method)) {
    sendProblem(ctx, 405, problem(405, 'read_only').body(), { allow: 'GET, HEAD' });
    return;
  }

  // household-private routes; the event stream also accepts its session token
  // as ?token= for the browser's EventSource, which cannot send headers
  if (segs[0] === 'households' && segs.length >= 2) {
    if (segs.length >= 3 && segs[2] === 'events' && ctx.method() === 'GET' && ctx.bearerToken() === null && ctx.query('token')) {
      return streamApi.events(ctx, deps);
    }
    await auth.authHousehold(ctx, deps, segs[1]);
    return householdRoutes(ctx, deps, segs.slice(2));
  }

  return problem404(ctx);
}

function problem404(ctx: Ctx): void {
  sendProblem(ctx, 404, notFound().body());
}

async function householdRoutes(ctx: Ctx, deps: AppDeps, rest: string[]): Promise<void> {
  const method = ctx.method();
  const p = (n: number) => rest[n] ?? '';
  const path = rest.join('/');

  // invite
  if (path === 'invite' && method === 'POST') return withIdempotency(ctx, deps, () => auth.invite(ctx, deps));

  // plan
  if (path === 'plan' && method === 'GET') return plan.getPlan(ctx, deps);
  if (path === 'plan/draft' && method === 'PUT') return plan.putDraft(ctx, deps);
  if (path === 'plan/draft' && method === 'DELETE') return plan.deleteDraft(ctx, deps);
  if (path === 'plan/draft/adopt' && method === 'POST') return plan.adoptDraft(ctx, deps);
  if (path === 'plan/preview' && method === 'POST') return plan.preview(ctx, deps);

  // years and tonight
  if (rest[0] === 'years' && rest.length === 2 && method === 'GET') return plan.getYear(ctx, deps, rest[1]);
  if (path === 'tonight' && method === 'GET') return plan.tonight(ctx, deps);

  // swaps
  if (path === 'swaps' && method === 'GET') return swapsApi.listSwaps(ctx, deps);
  if (path === 'swaps' && method === 'POST') return swapsApi.createSwap(ctx, deps);
  if (rest[0] === 'swaps' && rest.length === 2 && method === 'GET') return swapsApi.getSwap(ctx, deps, p(1));
  if (rest[0] === 'swaps' && rest.length === 2 && method === 'DELETE') return swapsApi.deleteSwap(ctx, deps, p(1));
  if (rest[0] === 'swaps' && rest.length === 3 && method === 'POST') {
    return withIdempotency(ctx, deps, () => swapsApi.swapAction(ctx, deps, p(1), p(2)));
  }

  // costs
  if (path === 'costs' && method === 'GET') return costsApi.listCosts(ctx, deps);
  if (path === 'costs' && method === 'POST') return costsApi.createCost(ctx, deps);
  if (path === 'costs/quote' && method === 'POST') return costsApi.quote(ctx, deps);
  if (rest[0] === 'costs' && rest.length === 2 && method === 'GET') return costsApi.getCost(ctx, deps, p(1));
  if (rest[0] === 'costs' && rest.length === 2 && method === 'PATCH') return costsApi.patchCost(ctx, deps, p(1));
  if (rest[0] === 'costs' && rest.length === 2 && method === 'DELETE') return costsApi.deleteCost(ctx, deps, p(1));
  if (rest[0] === 'costs' && rest.length === 3 && method === 'POST' && ['send', 'withdraw', 'accept', 'decline', 'settle'].includes(p(2))) {
    return withIdempotency(ctx, deps, () => costsApi.costAction(ctx, deps, p(1), p(2)));
  }
  if (rest[0] === 'costs' && rest.length === 3 && rest[2] === 'receipts' && method === 'POST') {
    return costsApi.uploadReceipt(ctx, deps, p(1));
  }
  if (rest[0] === 'costs' && rest.length === 4 && rest[2] === 'receipts' && method === 'GET') {
    return costsApi.downloadReceipt(ctx, deps, p(1), p(3));
  }

  // statement
  if (path === 'statement' && method === 'GET') return costsApi.getStatement(ctx, deps);
  if (path === 'statement/rebuild' && method === 'POST') return costsApi.rebuildStatement(ctx, deps);

  // records
  if (path === 'records' && method === 'GET') return recordsApi.listRecords(ctx, deps);
  if (path === 'records' && method === 'POST') return withIdempotency(ctx, deps, () => recordsApi.createRecord(ctx, deps));
  if (rest[0] === 'records' && rest.length === 2 && method === 'GET') return recordsApi.getRecord(ctx, deps, p(1));
  if (rest[0] === 'records' && rest.length === 3 && method === 'POST' && ['retry', 'cancel'].includes(p(2))) {
    return withIdempotency(ctx, deps, () => recordsApi.recordAction(ctx, deps, p(1), p(2)));
  }
  if (rest[0] === 'records' && rest.length === 3 && rest[2] === 'pdf' && method === 'GET') {
    return recordsApi.downloadPdf(ctx, deps, p(1));
  }

  // share links
  if (path === 'share-links' && method === 'GET') return linksApi.listLinks(ctx, deps);
  if (path === 'share-links' && method === 'POST') return linksApi.createLink(ctx, deps);
  if (rest[0] === 'share-links' && rest.length === 3 && rest[2] === 'regenerate' && method === 'POST') {
    return withIdempotency(ctx, deps, () => linksApi.regenerateLink(ctx, deps, p(1)));
  }
  if (rest[0] === 'share-links' && rest.length === 2 && method === 'DELETE') {
    return linksApi.revokeLink(ctx, deps, p(1));
  }

  // notices, log, events
  if (path === 'notices' && method === 'GET') return streamApi.listNotices(ctx, deps);
  if (path === 'log' && method === 'GET') return streamApi.listLog(ctx, deps);
  if (path === 'events' && method === 'GET') return streamApi.events(ctx, deps);

  if (isStateChanging(method) && method !== 'POST') {
    // unmatched write route: 404 not 405 unless it's a read-only shape
  }
  problem404(ctx);
}

/** Idempotency wrapper: replay stored responses for the same key and body,
 *  refuse a different body under the same key. */
export async function withIdempotency(
  ctx: Ctx,
  deps: AppDeps,
  run: () => Promise<void>,
): Promise<void> {
  const key = ctx.header('idempotency-key');
  if (ctx.userId === null) {
    await run();
    return;
  }
  if (key === null) {
    await run();
    return;
  }
  if (!keyShape(key)) {
    throw problem(422, 'validation_failed', { errors: { idempotencyKey: 'This value is out of range.' } });
  }
  const claim = await claimIdempotency(deps.pool, ctx.userId, key, ctx.method(), pathname(ctx), ctx.body ?? Buffer.alloc(0));
  if (claim.kind === 'replay') {
    ctx.replayed = true;
    sendProblem(ctx, claim.response.status, JSON.parse(claim.response.body.toString('utf8')), {
      ...claim.response.headers,
      'idempotent-replayed': 'true',
    });
    return;
  }
  if (claim.kind === 'wait') {
    // a duplicate in flight: wait, then replay
    await new Promise((r) => setTimeout(r, 150));
    const retry = await claimIdempotency(deps.pool, ctx.userId, key, ctx.method(), pathname(ctx), ctx.body ?? Buffer.alloc(0));
    if (retry.kind === 'replay') {
      ctx.replayed = true;
      sendProblem(ctx, retry.response.status, JSON.parse(retry.response.body.toString('utf8')), {
        ...retry.response.headers,
        'idempotent-replayed': 'true',
      });
      return;
    }
    throw problem(409, 'idempotency_key_reused');
  }
  // fresh: run the handler, capture the response, store it
  const captured = await captureResponse(ctx, run);
  if (captured.status < 500) {
    await storeResponse(deps.pool, ctx.userId, key, ctx.method(), pathname(ctx), ctx.body ?? Buffer.alloc(0), captured.status, captured.body, captured.headers);
  } else {
    await releaseClaim(deps.pool, ctx.userId, key, ctx.method(), pathname(ctx));
  }
  sendProblem(ctx, captured.status, JSON.parse(captured.body || '{}'), {
    ...captured.headers,
    ...(ctx.replayed ? { 'idempotent-replayed': 'true' } : {}),
  });
}

function pathname(ctx: Ctx): string {
  return ctx.url.pathname;
}

interface Captured {
  status: number;
  body: string;
  headers: Record<string, string>;
}

/** Run the handler against a stub response, capturing what it sends. */
async function captureResponse(ctx: Ctx, run: () => Promise<void>): Promise<Captured> {
  const headers: Record<string, string> = {};
  let status = 200;
  const chunks: Buffer[] = [];
  const real = ctx.res;
  const stub = {
    writeHead(code: number, hdrs?: Record<string, string | number>) {
      status = code;
      for (const [k, v] of Object.entries(hdrs ?? {})) headers[k] = String(v);
    },
    end(data?: unknown) {
      if (typeof data === 'string') chunks.push(Buffer.from(data, 'utf8'));
      else if (Buffer.isBuffer(data)) chunks.push(data);
      else if (data) chunks.push(Buffer.from(String(data)));
    },
  } as unknown as ServerResponse;
  ctx.res = stub;
  try {
    await run();
  } finally {
    ctx.res = real;
  }
  return { status, body: Buffer.concat(chunks).toString('utf8'), headers };
}

