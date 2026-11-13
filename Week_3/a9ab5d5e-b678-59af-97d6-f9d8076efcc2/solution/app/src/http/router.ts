import { IncomingMessage, ServerResponse } from 'node:http';
import { JSON_BODY_LIMIT, RECEIPT_BODY_LIMIT, config } from '../config';
import { ApiError, fail } from '../errors';
import { JsonSyntaxError, ParsedBody, parseJsonStrict } from '../lib/json';
import { ApiResponse, Ctx, Session, readBody } from './context';
import { logFault } from '../log';
import { idempotencyKeyOf, withIdempotency } from './protocol';
import {
  createHousehold,
  joinHousehold,
  me,
  readInvite,
  requireHousehold,
  sendInvite,
  sessionFromHeader,
  signIn,
  signOut,
} from '../api/auth';
import { adoptDraft, deleteDraft, getPlan, previewPlan, putDraft } from '../api/plan';
import { getTonight, getYear } from '../api/calendar';
import {
  acceptSwap,
  createSwap,
  declineSwap,
  deleteSwap,
  getSwap,
  listSwaps,
  sendSwap,
  systemOnlySwapAction,
  withdrawSwap,
} from '../api/swaps';
import {
  acceptCost,
  createCost,
  declineCost,
  deleteCost,
  getCost,
  getStatement,
  listCosts,
  patchCost,
  quoteCost,
  rebuildStatement,
  sendCost,
  settleCost,
  systemOnlyCostAction,
  withdrawCost,
} from '../api/costs';
import { downloadReceipt, uploadReceipt } from '../api/receipts';
import { cancelRecord, downloadRecordPdf, getRecord, listRecords, requestRecord, retryRecord } from '../api/records';
import { createShareLink, listShareLinks, readSharePage, regenerateShareLink, revokeShareLink } from '../api/share';
import { listLog, listNotices, streamEvents } from '../api/feed';

type BodyKind = 'json' | 'none' | 'raw';

interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  pattern: string;
  auth: 'public' | 'session';
  body: BodyKind;
  fields?: readonly string[];
  household?: boolean;
  role?: 'planning';
  handler?: (ctx: Ctx) => Promise<ApiResponse>;
  stream?: boolean;
}

const versionFields = [
  'effectiveFrom',
  'exchangeZone',
  'firstExchangeAt',
  'base',
  'splitBp',
  'maxConsecutiveNights',
  'rules',
] as const;

const H = '/api/households/:hid';

const routes: Route[] = [
  { method: 'GET', pattern: '/api/health', auth: 'public', body: 'none', handler: async () => ({ status: 200, json: { status: 'ok' } }) },
  {
    method: 'POST',
    pattern: '/api/households',
    auth: 'public',
    body: 'json',
    fields: ['householdName', 'currency', 'yourName', 'email', 'password', 'otherParentName', 'otherParentEmail'],
    handler: createHousehold,
  },
  { method: 'POST', pattern: '/api/session', auth: 'public', body: 'json', fields: ['email', 'password'], handler: signIn },
  { method: 'DELETE', pattern: '/api/session', auth: 'session', body: 'none', fields: [], handler: signOut },
  { method: 'GET', pattern: '/api/me', auth: 'session', body: 'none', household: true, handler: me },
  { method: 'GET', pattern: '/api/join/:token', auth: 'public', body: 'none', handler: readInvite },
  { method: 'POST', pattern: '/api/join', auth: 'public', body: 'json', fields: ['token', 'password'], handler: joinHousehold },
  { method: 'POST', pattern: `${H}/invite`, auth: 'session', body: 'none', fields: [], household: true, role: 'planning', handler: sendInvite },

  { method: 'GET', pattern: `${H}/plan`, auth: 'session', body: 'none', household: true, handler: getPlan },
  { method: 'PUT', pattern: `${H}/plan/draft`, auth: 'session', body: 'json', fields: versionFields, household: true, role: 'planning', handler: putDraft },
  { method: 'DELETE', pattern: `${H}/plan/draft`, auth: 'session', body: 'none', fields: [], household: true, role: 'planning', handler: deleteDraft },
  { method: 'POST', pattern: `${H}/plan/draft/adopt`, auth: 'session', body: 'none', fields: [], household: true, role: 'planning', handler: adoptDraft },
  { method: 'POST', pattern: `${H}/plan/preview`, auth: 'session', body: 'json', fields: versionFields, household: true, role: 'planning', handler: previewPlan },

  { method: 'GET', pattern: `${H}/years/:year`, auth: 'session', body: 'none', household: true, handler: getYear },
  { method: 'GET', pattern: `${H}/tonight`, auth: 'session', body: 'none', household: true, handler: getTonight },

  { method: 'GET', pattern: `${H}/swaps`, auth: 'session', body: 'none', household: true, handler: listSwaps },
  { method: 'POST', pattern: `${H}/swaps`, auth: 'session', body: 'json', fields: ['nights', 'makeupNights', 'toParent', 'note'], household: true, handler: createSwap },
  { method: 'GET', pattern: `${H}/swaps/:id`, auth: 'session', body: 'none', household: true, handler: getSwap },
  { method: 'DELETE', pattern: `${H}/swaps/:id`, auth: 'session', body: 'none', fields: [], household: true, handler: deleteSwap },
  { method: 'POST', pattern: `${H}/swaps/:id/send`, auth: 'session', body: 'none', fields: [], household: true, handler: sendSwap },
  { method: 'POST', pattern: `${H}/swaps/:id/withdraw`, auth: 'session', body: 'none', fields: [], household: true, handler: withdrawSwap },
  { method: 'POST', pattern: `${H}/swaps/:id/accept`, auth: 'session', body: 'none', fields: [], household: true, handler: acceptSwap },
  { method: 'POST', pattern: `${H}/swaps/:id/decline`, auth: 'session', body: 'json', fields: ['reason'], household: true, handler: declineSwap },
  { method: 'POST', pattern: `${H}/swaps/:id/lapse`, auth: 'session', body: 'none', fields: [], household: true, handler: systemOnlySwapAction },
  { method: 'POST', pattern: `${H}/swaps/:id/settle`, auth: 'session', body: 'none', fields: [], household: true, handler: systemOnlySwapAction },

  { method: 'GET', pattern: `${H}/costs`, auth: 'session', body: 'none', household: true, handler: listCosts },
  { method: 'POST', pattern: `${H}/costs`, auth: 'session', body: 'json', fields: ['description', 'category', 'amountMinor', 'incurredAt', 'note'], household: true, handler: createCost },
  { method: 'POST', pattern: `${H}/costs/quote`, auth: 'session', body: 'json', fields: ['amountMinor', 'incurredAt'], household: true, handler: quoteCost },
  { method: 'GET', pattern: `${H}/costs/:id`, auth: 'session', body: 'none', household: true, handler: getCost },
  { method: 'PATCH', pattern: `${H}/costs/:id`, auth: 'session', body: 'json', fields: ['description', 'category', 'amountMinor', 'incurredAt', 'note', 'agreedSplitBp'], household: true, handler: patchCost },
  { method: 'DELETE', pattern: `${H}/costs/:id`, auth: 'session', body: 'none', fields: [], household: true, handler: deleteCost },
  { method: 'POST', pattern: `${H}/costs/:id/send`, auth: 'session', body: 'none', fields: [], household: true, handler: sendCost },
  { method: 'POST', pattern: `${H}/costs/:id/withdraw`, auth: 'session', body: 'none', fields: [], household: true, handler: withdrawCost },
  { method: 'POST', pattern: `${H}/costs/:id/accept`, auth: 'session', body: 'none', fields: [], household: true, handler: acceptCost },
  { method: 'POST', pattern: `${H}/costs/:id/decline`, auth: 'session', body: 'json', fields: ['reason'], household: true, handler: declineCost },
  { method: 'POST', pattern: `${H}/costs/:id/settle`, auth: 'session', body: 'none', fields: [], household: true, handler: settleCost },
  { method: 'POST', pattern: `${H}/costs/:id/lapse`, auth: 'session', body: 'none', fields: [], household: true, handler: systemOnlyCostAction },
  { method: 'POST', pattern: `${H}/costs/:id/receipts`, auth: 'session', body: 'raw', household: true, handler: uploadReceipt },
  { method: 'GET', pattern: `${H}/costs/:id/receipts/:rid`, auth: 'session', body: 'none', household: true, handler: downloadReceipt },

  { method: 'GET', pattern: `${H}/statement`, auth: 'session', body: 'none', household: true, handler: getStatement },
  { method: 'POST', pattern: `${H}/statement/rebuild`, auth: 'session', body: 'none', fields: [], household: true, handler: rebuildStatement },

  { method: 'GET', pattern: `${H}/records`, auth: 'session', body: 'none', household: true, handler: listRecords },
  { method: 'POST', pattern: `${H}/records`, auth: 'session', body: 'json', fields: ['year'], household: true, handler: requestRecord },
  { method: 'GET', pattern: `${H}/records/:id`, auth: 'session', body: 'none', household: true, handler: getRecord },
  { method: 'POST', pattern: `${H}/records/:id/retry`, auth: 'session', body: 'none', fields: [], household: true, handler: retryRecord },
  { method: 'POST', pattern: `${H}/records/:id/cancel`, auth: 'session', body: 'none', fields: [], household: true, handler: cancelRecord },
  { method: 'GET', pattern: `${H}/records/:id/pdf`, auth: 'session', body: 'none', household: true, handler: downloadRecordPdf },

  { method: 'GET', pattern: `${H}/share-links`, auth: 'session', body: 'none', household: true, handler: listShareLinks },
  { method: 'POST', pattern: `${H}/share-links`, auth: 'session', body: 'json', fields: ['label', 'expiresAt'], household: true, role: 'planning', handler: createShareLink },
  { method: 'POST', pattern: `${H}/share-links/:id/regenerate`, auth: 'session', body: 'none', fields: [], household: true, role: 'planning', handler: regenerateShareLink },
  { method: 'DELETE', pattern: `${H}/share-links/:id`, auth: 'session', body: 'none', fields: [], household: true, role: 'planning', handler: revokeShareLink },

  { method: 'GET', pattern: '/api/share/:token', auth: 'public', body: 'none', handler: readSharePage },

  { method: 'GET', pattern: `${H}/notices`, auth: 'session', body: 'none', household: true, handler: listNotices },
  { method: 'GET', pattern: `${H}/log`, auth: 'session', body: 'none', household: true, handler: listLog },
  { method: 'GET', pattern: `${H}/events`, auth: 'session', body: 'none', household: true, stream: true },
];

interface Match {
  route: Route;
  params: Record<string, string>;
}

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index] as string;
    const actual = pathParts[index] as string;
    if (expected.startsWith(':')) {
      if (actual === '') return null;
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) return null;
  }
  return params;
}

function routesForPath(path: string): Match[] {
  const matches: Match[] = [];
  for (const route of routes) {
    const params = matchPath(route.pattern, path);
    if (params) matches.push({ route, params });
  }
  return matches;
}

export function sendProblem(response: ServerResponse, error: ApiError): void {
  const body = Buffer.from(JSON.stringify(error.body()), 'utf8');
  response.writeHead(error.status, {
    'Content-Type': 'application/problem+json; charset=utf-8',
    'Content-Length': body.length,
    ...error.headers(),
  });
  response.end(body);
}

function sendResponse(response: ServerResponse, result: ApiResponse, method: string): void {
  const headers: Record<string, string> = { ...(result.headers ?? {}) };
  let body = Buffer.alloc(0);
  if (result.json !== undefined) {
    body = Buffer.from(JSON.stringify(result.json), 'utf8');
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json; charset=utf-8';
  } else if (result.body) {
    body = result.body;
  }
  if (result.status !== 204 && result.status !== 304) headers['Content-Length'] = String(body.length);
  response.writeHead(result.status, headers);
  if (method === 'HEAD' || result.status === 204 || result.status === 304) response.end();
  else response.end(body);
}

export async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const method = request.method === 'HEAD' ? 'GET' : (request.method as string);
  const matches = routesForPath(url.pathname);
  const limit = matches.some((match) => match.route.body === 'raw') ? RECEIPT_BODY_LIMIT : JSON_BODY_LIMIT;
  try {
    const raw = await readBody(request, limit);
    if (matches.length === 0) fail('not_found');
    const match = matches.find((candidate) => candidate.route.method === method);
    if (!match) {
      if (url.pathname.startsWith('/api/share/')) fail('read_only');
      fail('not_found');
    }
    const route = match.route;
    let parsed: ParsedBody | null = null;
    if (route.body !== 'raw' && raw.length > 0) {
      const contentType = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
      if (route.body === 'json' && contentType !== 'application/json') fail('unsupported_media_type');
      try {
        parsed = parseJsonStrict(raw.toString('utf8'));
      } catch (error) {
        if (error instanceof JsonSyntaxError) fail('malformed_json');
        throw error;
      }
    }
    if (method !== 'GET') {
      const origin = request.headers.origin;
      if (origin !== config.publicOrigin) fail('origin_mismatch');
    }
    let session: Session | null = null;
    if (route.auth === 'session') {
      session = await sessionFromHeader(
        Array.isArray(request.headers.authorization) ? request.headers.authorization[0] : request.headers.authorization,
      );
      if (!session) fail('unauthenticated');
    }
    const ctx = new Ctx({
      method,
      url,
      headers: request.headers,
      params: match.params,
      raw,
      parsed,
      session,
      request,
    });
    if (route.fields && route.body !== 'raw') ctx.allow(...route.fields);
    if (method === 'POST' && route.auth === 'session') idempotencyKeyOf(ctx);
    if (route.household) ctx.setHousehold(await requireHousehold(ctx));
    if (route.role === 'planning' && ctx.user.role !== 'planning') fail('planning_parent_only');
    if (route.stream) {
      await streamEvents(ctx, response);
      return;
    }
    const handle = route.handler as (ctx: Ctx) => Promise<ApiResponse>;
    const result =
      method === 'POST' && route.auth === 'session' ? await withIdempotency(ctx, () => handle(ctx)) : await handle(ctx);
    if (url.pathname.startsWith('/api/share/')) {
      result.headers = { ...(result.headers ?? {}), 'Cache-Control': 'no-store' };
    }
    sendResponse(response, result, request.method as string);
  } catch (error) {
    if (error instanceof ApiError) {
      if (url.pathname.startsWith('/api/share/')) response.setHeader('Cache-Control', 'no-store');
      sendProblem(response, error);
      return;
    }
    logFault('request', error);
    sendProblem(response, new ApiError('internal_error'));
  }
}
