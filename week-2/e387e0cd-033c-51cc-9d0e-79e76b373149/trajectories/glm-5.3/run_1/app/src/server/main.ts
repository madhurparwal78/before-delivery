import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readBody, parseCookies, matchRoute, errorResponse, type Ctx } from './api/http.js';
import { routes } from './api/route-table.js';
import { errors } from './api/errors.js';
import { loadSession, loadPartnerKey } from './api/auth.js';
import * as sessionApi from './api/session.js';
import * as membersApi from './api/members.js';
import * as workspaceApi from './api/workspace.js';
import * as publicApi from './api/public.js';
import * as rulesApi from './api/rules.js';
import * as counterpartiesApi from './api/counterparties.js';
import * as importApi from './api/import.js';
import * as casesApi from './api/cases.js';
import * as caseActionsApi from './api/case-actions.js';
import * as reviewApi from './api/review.js';
import * as messagesApi from './api/messages.js';
import * as requestPagesApi from './api/request-pages.js';
import * as requestPageAnswerApi from './api/request-page-answer.js';
import * as monthsApi from './api/months.js';
import * as filesApi from './api/files.js';
import * as partnerApi from './api/partner.js';
import { servePage, type ListingState } from './static.js';
import { sweep } from './sweep.js';
import { migrate, applySeed } from './domain/schema.js';
import { config } from './config.js';
import { ensureBucket } from './services/s3.js';

type HandlerTable = Record<string, (ctx: Ctx) => Promise<Response>>;

const handlers: HandlerTable = {
  'session.create': sessionApi.createSession,
  'session.get': sessionApi.getSession,
  'session.delete': sessionApi.deleteSession,
  health: workspaceApi.health,
  'workspace.get': workspaceApi.workspaceGet,
  'members.list': membersApi.listMembers,
  'members.create': membersApi.createMember,
  'members.get': membersApi.getMember,
  'members.update': membersApi.updateMember,
  'members.remove': membersApi.removeMember,
  'public.stats': publicApi.stats,
  'public.jurisdictions': publicApi.jurisdictions,
  'public.jurisdiction': publicApi.jurisdiction,
  'public.exchanges': publicApi.exchanges,
  'public.exchange': publicApi.exchange,
  'public.sitemap': publicApi.sitemap,
  'listing.get': rulesApi.getListing,
  'listing.put': rulesApi.putListing,
  'rules.list': rulesApi.listRules,
  'rules.get': rulesApi.getRule,
  'rules.announce': rulesApi.announceChange,
  'rules.daily': rulesApi.dailyReport,
  'rules.rates': rulesApi.rates,
  'counterparties.list': counterpartiesApi.listCounterparties,
  'counterparties.create': counterpartiesApi.createCounterparty,
  'counterparties.get': counterpartiesApi.getCounterparty,
  'counterparties.update': counterpartiesApi.updateCounterparty,
  'counterparties.preview': importApi.previewImport,
  'counterparties.import': importApi.saveImport,
  'counterparties.customers': counterpartiesApi.customers,
  'counterparties.registry': counterpartiesApi.addressRegistry,
  'cases.list': casesApi.listCases,
  'cases.create': casesApi.createCase,
  'cases.get': casesApi.getCase,
  'cases.release': caseActionsApi.releaseCase,
  'cases.return': caseActionsApi.returnCase,
  'cases.releaseReason': caseActionsApi.recordReleaseReason,
  'cases.ownership': caseActionsApi.recordOwnership,
  'cases.newRequestPage': caseActionsApi.newRequestPage,
  'cases.endRequestPage': caseActionsApi.endRequestPage,
  'cases.archive': caseActionsApi.archiveCase,
  'cases.restore': caseActionsApi.restoreCase,
  'review.list': reviewApi.listReview,
  'review.claim': reviewApi.claimCase,
  'review.decision': reviewApi.decideCase,
  'messages.post': messagesApi.postMessage,
  'messages.list': messagesApi.listMessages,
  'messages.get': messagesApi.getMessage,
  'messages.original': messagesApi.downloadOriginal,
  'requestPages.get': requestPagesApi.getPage,
  'requestPages.answer': requestPageAnswerApi.answerPage,
  'months.list': monthsApi.listMonths,
  'months.get': monthsApi.getMonth,
  'months.close': monthsApi.closeMonth,
  'files.list': filesApi.listFileMonths,
  'files.regulator': filesApi.regulatorFile,
  'partner.createCase': partnerApi.createPartnerCase,
  'partner.keys': partnerApi.listPartnerKeys,
  'partner.createKey': partnerApi.createPartnerKey,
  'partner.revokeKey': partnerApi.revokePartnerKey,
};

async function handleApi(req: Request, url: URL): Promise<Response> {
  const { route, params, allowHeader } = matchRoute(routes, req.method, url.pathname);
  if (route === null) {
    if (allowHeader !== null) throw errors.methodNotAllowed(allowHeader);
    throw errors.notFound();
  }

  const setCookies: string[] = [];
  let bodyCache: Buffer | null = null;
  const ctx: Ctx = {
    req,
    url,
    method: req.method,
    path: url.pathname,
    params,
    query: url.searchParams,
    cookies: parseCookies(req.headers.get('cookie')),
    rawBody: async () => {
      if (bodyCache === null) {
        const result = await readBody(req, route.bodyLimit);
        if (!result.ok) throw errors.tooLarge();
        bodyCache = result.body;
      }
      return bodyCache;
    },
    setCookie: (value: string) => setCookies.push(value),
    responseHeaders: {},
    session: null,
    partnerKey: null,
  };

  if (route.roles === 'session' || Array.isArray(route.roles)) {
    await loadSession(ctx);
  } else if (route.roles === 'partner') {
    await loadPartnerKey(ctx);
  }

  if (Array.isArray(route.roles) && route.roles.length > 0 && ctx.session !== null && !route.roles.includes(ctx.session.role)) {
    throw errors.forbidden();
  }

  const handler = handlers[route.handler];
  const response = await handler(ctx);
  for (const cookie of setCookies) {
    response.headers.append('set-cookie', cookie);
  }
  return response;
}

function readNodeBody(req: IncomingMessage, limit: number, res: ServerResponse): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let refused = false;
    req.on('data', (chunk: Buffer) => {
      if (refused) return;
      total += chunk.length;
      if (total > limit) {
        refused = true;
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!refused) resolve(Buffer.concat(chunks));
    });
    req.on('error', () => {
      if (!refused) resolve(Buffer.concat(chunks));
    });
    void res;
  });
}

const server = createServer((nodeReq, nodeRes) => {
  void (async () => {
    const url = new URL(nodeReq.url ?? '/', `http://${nodeReq.headers.host ?? 'localhost'}`);
    const isApi = url.pathname.startsWith('/api/') || url.pathname === '/sitemap.xml';
    if (!isApi) {
      let listingState: ListingState = 'listed';
      if (url.pathname.startsWith('/exchanges/')) {
        listingState = await exchangeListingState(url.pathname.slice('/exchanges/'.length));
      }
      await servePage(nodeRes, url.pathname, listingState);
      return;
    }
    // Read the body up front so the 413 answer can come before parsing.
    const routeMatch = matchRoute(routes, nodeReq.method ?? 'GET', url.pathname);
    const limit = routeMatch.route !== null ? routeMatch.route.bodyLimit : 64000;
    const body = await readNodeBody(nodeReq, Math.max(limit, 1), nodeRes);
    if (body === null) {
      const err = errors.tooLarge();
      nodeRes.writeHead(err.status, { 'Content-Type': 'application/json' });
      nodeRes.end(err.body());
      return;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(nodeReq.headers)) {
      if (typeof value === 'string') headers.set(name, value);
      else if (Array.isArray(value)) headers.set(name, value.join(', '));
    }
    const request = new Request(url.toString(), { method: nodeReq.method, headers, body: ['GET', 'HEAD', 'DELETE'].includes(nodeReq.method ?? '') || body.length === 0 ? undefined : body });
    try {
      const response = await handleApi(request, url);
      const buffer = Buffer.from(await response.arrayBuffer());
      const headersOut: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headersOut[key] = value;
      });
      nodeRes.writeHead(response.status, headersOut);
      nodeRes.end(buffer);
    } catch (err) {
      const response = errorResponse(err);
      const buffer = Buffer.from(await response.arrayBuffer());
      const headersOut: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headersOut[key] = value;
      });
      nodeRes.writeHead(response.status, headersOut);
      nodeRes.end(buffer);
    }
  })();
});

async function exchangeListingState(slug: string): Promise<ListingState> {
  try {
    const { query } = await import('./db.js');
    const r = await query<{ listed: boolean }>('SELECT listed FROM listings WHERE slug = $1', [slug]);
    if (r.rows.length === 0) return 'unknown';
    return r.rows[0].listed ? 'listed' : 'withdrawn';
  } catch {
    return 'listed';
  }
}

async function start(): Promise<void> {
  // PostgreSQL is required: the server waits for it at boot.
  await migrate().catch(async (err) => {
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        await migrate();
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    throw err;
  });
  await applySeed();
  void ensureBucket().then(() => {});
  setInterval(() => {
    void sweep().catch(() => {});
  }, 5000);
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Lanternline desk listening on port ${config.port}`);
  });
}

void start();
