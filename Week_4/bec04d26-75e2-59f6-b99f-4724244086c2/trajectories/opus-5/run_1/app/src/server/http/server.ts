import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { accessibleReturnRow } from '../actions/returns';
import { parseCookies, SESSION_COOKIE, userForToken } from '../auth';
import * as auth from '../api/auth';
import * as grading from '../api/grading';
import * as misc from '../api/misc';
import * as practice from '../api/practice';
import * as returns from '../api/returns';
import { readJsonBody } from './body';
import { callerOf, Ctx, sendJson } from './context';
import * as errors from './errors';
import { isAsset, sendAsset, sendPage } from './static';

type Handler = (ctx: Ctx) => Promise<void>;

interface Route {
  method: string;
  segments: readonly string[];
  handler: Handler;
  /** Routes that read a JSON body. */
  json: boolean;
}

function route(method: string, pattern: string, handler: Handler, json = false): Route {
  return { method, segments: pattern.split('/').filter(Boolean), handler, json };
}

const API_ROUTES: readonly Route[] = [
  route('POST', '/api/auth/signup', auth.signUp, true),
  route('POST', '/api/auth/signin', auth.signIn, true),
  route('POST', '/api/auth/signout', auth.signOut, true),
  route('GET', '/api/me', auth.me),
  route('PATCH', '/api/practice', practice.patchPractice, true),
  route('GET', '/api/states', practice.getStates),
  route('PUT', '/api/states/:code/holidays', practice.putHolidays, true),
  route('POST', '/api/states/:code/editions', practice.postEdition, true),
  route('GET', '/api/clients', practice.getClients),
  route('POST', '/api/clients', practice.postClient, true),
  route('POST', '/api/clients/:id/registrations', practice.postRegistration, true),
  route('GET', '/api/returns', returns.listReturns),
  route('GET', '/api/returns/:id', returns.getReturn),
  route('PATCH', '/api/returns/:id', returns.patchReturn, true),
  route('POST', '/api/returns/:id/prepare', returns.prepareReturn, true),
  route('POST', '/api/returns/:id/approve', returns.approveReturn, true),
  route('POST', '/api/returns/:id/send-back', returns.sendBackReturn, true),
  route('POST', '/api/returns/:id/file', returns.fileReturn, true),
  route('POST', '/api/returns/:id/extension', returns.extendReturn, true),
  route('POST', '/api/returns/:id/amend', returns.amendReturn, true),
  route('GET', '/api/returns/:id/reminders', returns.getReminders),
  route('GET', '/api/returns/:id/packet', returns.getPacket),
  route('GET', '/api/year/:year/export.csv', returns.exportCsv),
  route('GET', '/api/events', misc.events),
  route('GET', '/api/health', misc.health),
  route('POST', '/api/grading/fixture', grading.postFixture, true),
  route('POST', '/api/grading/clock', grading.postClock, true),
];

function match(route: Route, method: string, segments: readonly string[]): Record<string, string> | null {
  if (route.method !== method) return null;
  if (route.segments.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < segments.length; index += 1) {
    const pattern = route.segments[index];
    if (pattern.startsWith(':')) params[pattern.slice(1)] = segments[index];
    else if (pattern !== segments[index]) return null;
  }
  return params;
}

const MONTH_PAGE = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR_PAGE = /^\d{4}$/;

const FLAT_PAGES: readonly string[] = [
  '/',
  '/sign-in',
  '/sign-up',
  '/today',
  '/catalogue',
  '/month',
  '/year',
  '/clients',
  '/states',
  '/settings',
  '/home',
];

/** Rejects traversal, encoded traversal and leading dot segments. */
function suspicious(rawPath: string): boolean {
  const decoded = safeDecode(rawPath);
  if (decoded === null) return true;
  return decoded
    .split('/')
    .some((segment) => segment === '..' || (segment.startsWith('.') && segment.length > 1));
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

async function pageStatus(path: string, ctx: Ctx): Promise<number> {
  if (FLAT_PAGES.includes(path)) return 200;
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 2 && segments[0] === 'month' && MONTH_PAGE.test(segments[1])) return 200;
  if (segments.length === 2 && segments[0] === 'year' && YEAR_PAGE.test(segments[1])) return 200;
  if (segments.length === 2 && segments[0] === 'returns') {
    if (!ctx.user) return 404;
    try {
      await accessibleReturnRow(callerOf(ctx.user), segments[1]);
      return 200;
    } catch {
      return 404;
    }
  }
  return 404;
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin === 'null') return true;
  const host = req.headers.host;
  if (typeof host !== 'string') return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function handleError(res: ServerResponse, error: unknown, wantsJson: boolean): void {
  if (error instanceof errors.HttpError) {
    if (!wantsJson && error.status === 404) {
      sendPage(res, 404);
      return;
    }
    sendJson(res, error.status, error.body);
    return;
  }
  console.error('unexpected server error', error);
  sendJson(res, 500, { error: 'server_error' });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const rawPath = (req.url ?? '/').split('?')[0];
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = req.method ?? 'GET';
  const isApi = rawPath === '/api' || rawPath.startsWith('/api/');

  if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) {
    const refused = errors.crossOrigin();
    sendJson(res, refused.status, refused.body);
    return;
  }
  if (suspicious(rawPath)) {
    if (isApi) sendJson(res, 404, { error: 'not_found' });
    else sendPage(res, 404);
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE] ?? null;
  const user = await userForToken(token);
  const ctx: Ctx = { req, res, url, method, params: {}, user, token, body: {} };

  if (isApi) {
    const segments = url.pathname.split('/').filter(Boolean);
    for (const candidate of API_ROUTES) {
      const params = match(candidate, method, segments);
      if (!params) continue;
      ctx.params = params;
      try {
        if (candidate.json) ctx.body = await readJsonBody(req);
        await candidate.handler(ctx);
      } catch (error) {
        handleError(res, error, true);
      }
      return;
    }
    sendJson(res, 404, { error: 'not_found' });
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    sendPage(res, 404);
    return;
  }
  if (isAsset(url.pathname)) {
    sendAsset(res, url.pathname);
    return;
  }
  try {
    sendPage(res, await pageStatus(url.pathname, ctx));
  } catch (error) {
    handleError(res, error, false);
  }
}

export function createAppServer(): Server {
  return createServer((req, res) => {
    void handle(req, res).catch((error) => {
      handleError(res, error, true);
    });
  });
}
