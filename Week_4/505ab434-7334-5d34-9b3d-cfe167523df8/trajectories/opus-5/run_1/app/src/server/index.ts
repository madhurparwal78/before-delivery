import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { initClock, readClock } from './clock.js';
import { businessDate } from './time.js';
import { config } from './config.js';
import { applySchema, waitForDatabase } from './db.js';
import { ApiError, errors } from './errors.js';
import {
  bodyLimitFor,
  principalFromRequest,
  readBody,
  type Ctx,
} from './http/context.js';
import { fieldCellPage } from './http/pages.js';
import { sendApiError, sendText, toApiError } from './http/respond.js';
import { handleUpgrade, startLiveListener } from './live.js';
import { startMailer } from './mail.js';
import { repo } from './repo.js';
import { applySeed, databaseIsEmpty, DEMO_SEED } from './seed.js';
import { storage } from './storage.js';
import { resolveRule } from './services/rules.js';
import * as assets from './routes/assets.js';
import * as audit from './routes/audit.js';
import * as chapters from './routes/chapters.js';
import * as grading from './routes/grading.js';
import * as grants from './routes/grants.js';
import * as invitations from './routes/invitations.js';
import * as library from './routes/library.js';
import * as queue from './routes/queue.js';
import * as requests from './routes/requests.js';
import * as session from './routes/session.js';

type Handler = (ctx: Ctx) => Promise<void>;

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
}

const routes: Route[] = [];

function route(method: string, path: string, handler: Handler): void {
  routes.push({ method, parts: path.split('/').filter((part) => part !== ''), handler });
}

route('GET', '/api/health', session.health);
route('POST', '/api/session', session.signIn);
route('DELETE', '/api/session', session.signOut);
route('GET', '/api/me', session.me);

route('POST', '/api/invitations', invitations.createInvitation);
route('GET', '/api/invitations/:token', invitations.readInvitation);
route('POST', '/api/invitations/:token/activate', invitations.activateInvitation);
route('GET', '/api/organisations', invitations.listOrganisations);
route('PUT', '/api/organisations/:id/engagement', invitations.setEngagementEnd);

route('GET', '/api/library', library.listLibrary);
route('POST', '/api/derivatives/:id/link', library.issueLink);
route('GET', '/dl/:token', library.download);

route('POST', '/api/requests', requests.createRequest);
route('GET', '/api/requests', requests.listRequests);
route('GET', '/api/requests/:id', requests.readRequest);
route('POST', '/api/requests/:id/submit', requests.submitExistingRequest);
route('POST', '/api/requests/:id/withdraw', requests.withdrawRequest);
route('POST', '/api/requests/:id/resubmit', requests.resubmitRequest);
route('POST', '/api/requests/:id/stages/:n/decision', requests.decideStage);
route('POST', '/api/requests/:id/conditions', requests.addCondition);

route('GET', '/api/grants', grants.listGrants);
route('GET', '/api/grants/:id', grants.readGrant);
route('POST', '/api/grants/:id/revoke', grants.revokeGrant);
route('POST', '/api/grants/:id/proofs', grants.uploadProof);
route('GET', '/api/proofs/:id/content', grants.readProofContent);
route('POST', '/api/proofs/:id/accept', grants.acceptProof);
route('POST', '/api/proofs/:id/reject', grants.rejectProof);

route('GET', '/api/queue', queue.listQueue);

route('GET', '/api/admin/assets', assets.listAdminAssets);
route('POST', '/api/assets/:id/derivatives', assets.addDerivative);
route('DELETE', '/api/derivatives/:id', assets.removeDerivative);
route('POST', '/api/assets/:id/release', assets.releaseAsset);
route('POST', '/api/assets/:id/restrict', assets.restrictAsset);
route('POST', '/api/assets/:id/retire', assets.retireAsset);

route('GET', '/api/chapters', chapters.listChapters);
route('GET', '/api/chapters/:slug', chapters.readChapter);
route('GET', '/api/rules', chapters.listRules);
route('GET', '/api/rules/:identifier', chapters.readRule);
route('GET', '/api/chapters/:slug/versions', chapters.listVersions);
route('POST', '/api/chapters/:slug/versions', chapters.startVersion);
route('POST', '/api/chapters/:slug/republish', chapters.republishVersion);
route('GET', '/api/versions/:id', chapters.readVersion);
route('PUT', '/api/versions/:id', chapters.saveVersion);
route('POST', '/api/versions/:id/submit', chapters.submitVersion);
route('POST', '/api/versions/:id/approve', chapters.approveVersion);
route('POST', '/api/versions/:id/request-changes', chapters.requestVersionChanges);
route('POST', '/api/versions/:id/publish', chapters.publishVersion);

route('GET', '/api/audit', audit.listAudit);
route('GET', '/api/audit/verify', audit.verifyAudit);

route('POST', '/api/grading/reset', grading.gradingReset);
route('POST', '/api/grading/seed', grading.gradingSeed);
route('POST', '/api/grading/clock', grading.gradingClock);
route('POST', '/api/grading/audit/tamper', grading.gradingTamper);

function matchRoute(method: string, segments: string[]): { handler: Handler; params: Record<string, string> } | null {
  for (const candidate of routes) {
    if (candidate.method !== method || candidate.parts.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (const [index, part] of candidate.parts.entries()) {
      const value = segments[index]!;
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(value);
      } else if (part !== value) {
        matched = false;
        break;
      }
    }
    if (matched) return { handler: candidate.handler, params };
  }
  return null;
}

const publicDirectory = new URL('../public/', import.meta.url);

const STATIC_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

async function serveStatic(res: ServerResponse, name: string): Promise<boolean> {
  const extension = name.slice(name.lastIndexOf('.'));
  const contentType = STATIC_TYPES[extension];
  if (!contentType) return false;
  try {
    const body = await readFile(new URL(name.replace(/^\//, ''), publicDirectory));
    sendText(res, 200, contentType, body);
    return true;
  } catch {
    return false;
  }
}

async function serveAppShell(res: ServerResponse, status: number, now: Date): Promise<void> {
  const shell = await readFile(new URL('index.html', publicDirectory), 'utf8');
  const appConfig = JSON.stringify({
    today: businessDate(now),
    now: now.toISOString(),
    timeZone: config.timeZone,
    weightAnnounceDelayMs: config.weightAnnounceDelayMs,
  });
  sendText(res, status, 'text/html; charset=utf-8', shell.replace('{"embedded":true}', appConfig));
}

const SIGNED_IN_PREFIXES = ['/library', '/requests', '/queue', '/editor', '/admin'];

async function pageStatus(ctx: Ctx, segments: string[]): Promise<number | 'redirect'> {
  const path = `/${segments.join('/')}`;
  if (segments.length === 0) return 200;

  const first = segments[0]!;
  if (first === 'chapters') {
    if (segments.length !== 2) return 404;
    const chapter = (await repo.chapters()).find((candidate) => candidate.slug === segments[1]);
    return chapter ? 200 : 404;
  }
  if (first === 'rules') {
    if (segments.length === 1) return 200;
    if (segments.length !== 2) return 404;
    return (await resolveRule(segments[1]!)) ? 200 : 404;
  }
  if (first === 'signin' && segments.length === 1) return 200;
  if (first === 'activate' && segments.length === 2) return 200;

  if (!SIGNED_IN_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return 404;
  const principal = ctx.principal;
  if (!principal) return 'redirect';

  if (first === 'library' && segments.length === 1) return 200;
  if (first === 'requests') {
    if (segments.length === 1) return 200;
    if (segments.length !== 2) return 404;
    const request = await repo.request(segments[1]!);
    if (!request) return 404;
    const visible =
      request.requesterId === principal.id ||
      principal.role === 'brand_reviewer' ||
      principal.role === 'legal_reviewer' ||
      principal.role === 'owner';
    return visible ? 200 : 404;
  }
  if (first === 'queue' && segments.length === 1) {
    return principal.role === 'brand_reviewer' || principal.role === 'legal_reviewer' || principal.role === 'owner'
      ? 200
      : 404;
  }
  if (first === 'editor' && segments.length === 2) {
    const canEdit = principal.role === 'author' || principal.role === 'brand_reviewer' || principal.role === 'owner';
    if (!canEdit) return 404;
    const chapter = (await repo.chapters()).find((candidate) => candidate.slug === segments[1]);
    return chapter ? 200 : 404;
  }
  if (first === 'admin' && segments.length === 2) {
    const area = segments[1]!;
    if (area === 'assets' || area === 'people') return principal.role === 'owner' ? 200 : 404;
    if (area === 'audit' || area === 'grants') {
      return principal.role === 'owner' || principal.role === 'legal_reviewer' ? 200 : 404;
    }
    return 404;
  }
  return 404;
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const segments = url.pathname.split('/').filter((part) => part !== '');
  const method = req.method ?? 'GET';

  const { body, tooLarge } = await readBody(req, bodyLimitFor(req));
  const principal = await principalFromRequest(req);
  const ctx: Ctx = {
    req,
    res,
    url,
    method,
    params: {},
    now: await readClock(),
    principal,
    viewer: principal ? await repo.viewer(principal) : null,
    rawBody: body,
    bodyTooLarge: tooLarge,
  };

  try {
    if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) throw errors.crossOrigin();

    if (
      segments[0] === 'api' &&
      segments[1] === 'audit' &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
    ) {
      await audit.auditWriteBlocked(ctx);
      return;
    }

    const match = matchRoute(method, segments);
    if (match) {
      ctx.params = match.params;
      await match.handler(ctx);
      return;
    }

    if (segments[0] === 'api' || segments[0] === 'dl') throw errors.notFound();

    if (method === 'GET') {
      if (segments.length === 1 && (await serveStatic(res, `/${segments[0]}`))) return;
      const status = await pageStatus(ctx, segments);
      if (status === 'redirect') {
        res.writeHead(302, { location: '/signin', 'cache-control': 'no-store' });
        res.end();
        return;
      }
      await serveAppShell(res, status, ctx.now);
      return;
    }

    throw errors.notFound();
  } catch (error) {
    const apiError = toApiError(error);
    if (!(error instanceof ApiError)) {
      process.stderr.write(`Unhandled error: ${String(error)}\n`);
    }
    if (res.headersSent) {
      res.end();
      return;
    }
    if (segments[0] === 'dl') {
      sendText(res, apiError.status, 'text/html; charset=utf-8', fieldCellPage(apiError.message));
      return;
    }
    sendApiError(res, apiError);
  }
}

async function boot(): Promise<void> {
  await waitForDatabase();
  await applySchema();
  await initClock();

  try {
    await storage.ensureBucket();
  } catch {
    process.stderr.write('Storage is unreachable at boot; continuing without it.\n');
  }

  if (await databaseIsEmpty()) {
    await applySeed(DEMO_SEED);
  }

  await startLiveListener();
  startMailer();

  const server = createServer((req, res) => {
    void handle(req, res);
  });

  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      if (url.pathname !== '/api/live' || !sameOrigin(req)) {
        socket.destroy();
        return;
      }
      const principal = await principalFromRequest(req);
      if (!principal) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      handleUpgrade(req, socket, head, principal);
    })();
  });

  server.listen(config.publicPort, '0.0.0.0', () => {
    process.stdout.write(`Rulehouse listening on ${config.publicPort}\n`);
  });
}

void boot();
