import type { IncomingMessage, ServerResponse } from 'node:http';
import { pool } from '../db/pool.js';
import { listCatalogue } from '../routes/programme-routes.js';
import {
  addWork,
  createProgramme,
  listNotices,
  listProgrammes,
  publishFolders,
  readProgramme,
  saveStringCount,
  transitionProgramme,
} from '../routes/programme-routes.js';
import { listFolders, readFolder, readFolderPage } from '../routes/folder-routes.js';
import {
  downloadScan,
  listScans,
  recordMark,
  saveHoldings,
  uploadScan,
} from '../routes/part-routes.js';
import {
  createRentalSet,
  listRentalSets,
  saveCheckIn,
  transitionRentalSet,
} from '../routes/rental-routes.js';
import {
  createSession,
  deleteSession,
  health,
  readSessionUser,
  serviceStatus,
} from '../routes/session-routes.js';
import { createCut, deleteCut, readWork } from '../routes/work-routes.js';
import type { RequestContext } from './context.js';
import { ApiError, crossOrigin, notFound, unauthenticated, unsupportedMediaType, validation } from './errors.js';
import { JSON_BODY_LIMIT, MULTIPART_LIMIT, readRequestBody, sendJson } from './http-io.js';
import { SESSION_COOKIE, personForSession, readCookie } from './session.js';

type Handler = (context: RequestContext) => Promise<void>;

interface Route {
  method: string;
  segments: string[];
  body: 'json' | 'none' | 'multipart';
  open?: boolean;
  handler: Handler;
}

function route(method: string, path: string, body: Route['body'], handler: Handler, open = false): Route {
  return { method, segments: path.split('/').filter((segment) => segment !== ''), body, handler, open };
}

const ROUTES: Route[] = [
  route('GET', '/api/health', 'none', health, true),
  route('POST', '/api/session', 'json', createSession, true),
  route('GET', '/api/session', 'none', readSessionUser),
  route('DELETE', '/api/session', 'none', deleteSession),
  route('GET', '/api/status', 'none', serviceStatus),
  route('GET', '/api/catalogue', 'none', listCatalogue),
  route('GET', '/api/programmes', 'none', listProgrammes),
  route('POST', '/api/programmes', 'json', createProgramme),
  route('GET', '/api/programmes/:id', 'none', readProgramme),
  route('PUT', '/api/programmes/:id/string-count', 'json', saveStringCount),
  route('POST', '/api/programmes/:id/works', 'json', addWork),
  route('POST', '/api/programmes/:id/transition', 'json', transitionProgramme),
  route('POST', '/api/programmes/:id/publish', 'none', publishFolders),
  route('GET', '/api/programmes/:id/notices', 'none', listNotices),
  route('GET', '/api/works/:id', 'none', readWork),
  route('POST', '/api/works/:id/cuts', 'json', createCut),
  route('DELETE', '/api/cuts/:id', 'none', deleteCut),
  route('PUT', '/api/parts/:id/holdings', 'json', saveHoldings),
  route('POST', '/api/parts/:id/marks', 'json', recordMark),
  route('POST', '/api/parts/:id/scans', 'multipart', uploadScan),
  route('GET', '/api/parts/:id/scans', 'none', listScans),
  route('GET', '/api/scans/:id/file', 'none', downloadScan),
  route('GET', '/api/folders', 'none', listFolders),
  route('GET', '/api/folders/:programmeId', 'none', readFolder),
  route('GET', '/api/folders/:programmeId/parts/:partId', 'none', readFolderPage),
  route('GET', '/api/rental-sets', 'none', listRentalSets),
  route('POST', '/api/rental-sets', 'json', createRentalSet),
  route('POST', '/api/rental-sets/:id/transition', 'json', transitionRentalSet),
  route('PUT', '/api/rental-sets/:id/check-in', 'json', saveCheckIn),
];

function matchRoute(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  const parts = path.split('/').filter((segment) => segment !== '');
  for (const candidate of ROUTES) {
    if (candidate.method !== method || candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (const [index, segment] of candidate.segments.entries()) {
      const value = parts[index] ?? '';
      if (segment.startsWith(':')) {
        params[segment.slice(1)] = decodeURIComponent(value);
        continue;
      }
      if (segment !== value) {
        matched = false;
        break;
      }
    }
    if (matched) return { route: candidate, params };
  }
  return null;
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return true;
  const host = request.headers.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function isJsonContentType(request: IncomingMessage): boolean {
  const header = request.headers['content-type'];
  return typeof header === 'string' && header.split(';')[0]?.trim().toLowerCase() === 'application/json';
}

export async function handleApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  query: URLSearchParams,
): Promise<void> {
  try {
    const method = request.method ?? 'GET';
    const stateChanging = method === 'POST' || method === 'PUT' || method === 'DELETE';
    if (stateChanging && !sameOrigin(request)) {
      request.resume();
      throw crossOrigin();
    }

    const matched = matchRoute(method, path);
    if (!matched) {
      request.resume();
      throw notFound();
    }

    let rawBody = Buffer.alloc(0);
    if (matched.route.body === 'multipart') {
      rawBody = await readRequestBody(request, MULTIPART_LIMIT, 'multipart');
    } else {
      rawBody = await readRequestBody(request, JSON_BODY_LIMIT, 'json');
    }

    let jsonBody: unknown = undefined;
    if (matched.route.body === 'json') {
      if (!isJsonContentType(request)) throw unsupportedMediaType();
      try {
        jsonBody = JSON.parse(rawBody.toString('utf8'));
      } catch {
        throw validation({ body: 'Send a JSON object.' });
      }
    }

    const sessionId = readCookie(request.headers.cookie, SESSION_COOKIE);
    const person = sessionId === null ? null : await personForSession(pool, sessionId);
    if (!matched.route.open && person === null) throw unauthenticated();

    const context: RequestContext = {
      request,
      response,
      method,
      path,
      query,
      params: matched.params,
      rawBody,
      jsonBody,
      person,
      nowMs: Date.now(),
    };
    await matched.route.handler(context);
  } catch (error) {
    if (error instanceof ApiError) {
      sendJson(response, error.status, error.body());
      return;
    }
    process.stderr.write(`request failed: ${error instanceof Error ? error.stack : String(error)}\n`);
    sendJson(response, 500, { error: 'server_error', message: 'Something went wrong.' });
  }
}
