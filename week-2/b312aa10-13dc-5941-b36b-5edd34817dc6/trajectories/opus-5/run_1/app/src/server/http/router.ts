/**
 * The published route table, and the one error-precedence rule every request
 * follows. A method and path under /api that this table does not list answers
 * 404 not_found and changes nothing.
 */
import type { IncomingMessage } from 'node:http';
import { db } from '../db/pool.js';
import { loadKitchen, personBySession } from '../store/kitchens.js';
import {
  jsonBodyLimit,
  parseCookies,
  readBody,
  uploadRequestLimit,
  type RequestContext,
} from './context.js';
import { isCrossSite, isStateChanging } from './crossSite.js';
import { AppError, errors } from './errors.js';
import { validKeyFormat } from './idempotency.js';
import type { Result } from './respond.js';
import * as bookings from '../routes/bookings.js';
import * as board from '../routes/board.js';
import * as documents from '../routes/documents.js';
import * as inspector from '../routes/inspector.js';
import * as members from '../routes/members.js';
import * as reports from '../routes/reports.js';
import * as sanitation from '../routes/sanitation.js';
import * as session from '../routes/session.js';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type BodyKind = 'none' | 'json' | 'multipart';

type Route = {
  method: Method;
  pattern: string;
  auth: 'required' | 'none';
  body: BodyKind;
  idempotency: boolean;
  run: (context: RequestContext, params: Record<string, string>) => Promise<Result>;
};

function route(
  method: Method,
  pattern: string,
  options: {
    auth?: 'required' | 'none';
    body?: BodyKind;
    idempotency?: boolean;
  },
  run: Route['run'],
): Route {
  return {
    method,
    pattern,
    auth: options.auth ?? 'required',
    body: options.body ?? 'none',
    idempotency: options.idempotency ?? false,
    run,
  };
}

export const routes: Route[] = [
  route('GET', '/api/health', { auth: 'none' }, () => session.health()),
  route('POST', '/api/session', { auth: 'none', body: 'json' }, (context) =>
    session.signIn(context),
  ),
  route('GET', '/api/session', {}, (context) => session.readSession(context)),
  route('DELETE', '/api/session', {}, (context) => session.signOut(context)),
  route('GET', '/api/kitchen', {}, (context) => session.readKitchen(context)),
  route('GET', '/api/service-status', {}, (context) => session.readServiceStatus(context)),

  route('GET', '/api/board', {}, (context) => board.readBoard(context)),
  route('GET', '/api/stations', {}, (context) => board.readStations(context)),
  route('POST', '/api/stations/:stationId/rates', { body: 'json' }, (context, params) =>
    board.createRateVersion(context, params['stationId']!),
  ),
  route('PUT', '/api/kitchen/peak-windows', { body: 'json' }, (context) =>
    board.savePeakWindows(context),
  ),
  route('PUT', '/api/kitchen/document-requirements', { body: 'json' }, (context) =>
    board.saveDocumentRequirements(context),
  ),
  route('POST', '/api/out-of-service', { body: 'json' }, (context) =>
    board.createOutOfService(context),
  ),
  route('DELETE', '/api/out-of-service/:id', {}, (context, params) =>
    board.removeOutOfService(context, params['id']!),
  ),

  route('POST', '/api/bookings', { body: 'json', idempotency: true }, (context) =>
    bookings.holdBlocks(context),
  ),
  route('GET', '/api/bookings', {}, (context) => bookings.listBookings(context)),
  route('GET', '/api/bookings/:id', {}, (context, params) =>
    bookings.getBooking(context, params['id']!),
  ),
  route(
    'POST',
    '/api/bookings/:id/confirm',
    { body: 'json', idempotency: true },
    (context, params) => bookings.confirmBooking(context, params['id']!),
  ),
  route(
    'POST',
    '/api/bookings/:id/cancel',
    { body: 'json', idempotency: true },
    (context, params) => bookings.cancelBooking(context, params['id']!),
  ),
  route('POST', '/api/bookings/:id/check-in', { body: 'json' }, (context, params) =>
    bookings.statusAction(context, params['id']!, 'check_in'),
  ),
  route('POST', '/api/bookings/:id/check-out', { body: 'json' }, (context, params) =>
    bookings.statusAction(context, params['id']!, 'check_out'),
  ),
  route('POST', '/api/bookings/:id/no-show', { body: 'json' }, (context, params) =>
    bookings.statusAction(context, params['id']!, 'no_show'),
  ),
  route('POST', '/api/bookings/:id/move', { body: 'json' }, (context, params) =>
    bookings.moveBooking(context, params['id']!),
  ),
  route('POST', '/api/bookings/:id/release', { body: 'json' }, (context, params) =>
    bookings.releaseBooking(context, params['id']!),
  ),
  route(
    'POST',
    '/api/bookings/:id/waive-penalty',
    { body: 'json', idempotency: true },
    (context, params) => bookings.waivePenalty(context, params['id']!),
  ),

  route('GET', '/api/members', {}, (context) => members.listMembers(context)),
  route('PATCH', '/api/members/me', { body: 'json' }, (context) =>
    members.patchOwnMember(context),
  ),
  route('GET', '/api/members/:memberId', {}, (context, params) =>
    members.readMember(context, params['memberId']!),
  ),
  route('GET', '/api/members/:memberId/hour-bank', {}, (context, params) =>
    members.readHourBank(context, params['memberId']!),
  ),
  route('GET', '/api/members/:memberId/invoices/:month', {}, (context, params) =>
    members.readInvoice(context, params['memberId']!, params['month']!),
  ),

  route('POST', '/api/months/:month/close', { body: 'json' }, (context, params) =>
    reports.closeMonthRoute(context, params['month']!),
  ),
  route('GET', '/api/reports/utilisation', {}, (context) => reports.readUtilisation(context)),
  route('GET', '/api/exports/usage.csv', {}, (context) => reports.exportUsage(context)),

  route('POST', '/api/documents', { body: 'multipart' }, (context) =>
    documents.uploadDocument(context),
  ),
  route('GET', '/api/documents', {}, (context) => documents.listDocumentRows(context)),
  route('GET', '/api/documents/:id', {}, (context, params) =>
    documents.readDocument(context, params['id']!),
  ),
  route('GET', '/api/documents/:id/file', {}, (context, params) =>
    documents.readDocumentFile(context, params['id']!),
  ),
  route('POST', '/api/documents/:id/approve', { body: 'json' }, (context, params) =>
    documents.approve(context, params['id']!),
  ),

  route('POST', '/api/sanitation-entries', { body: 'json' }, (context) =>
    sanitation.logEntry(context),
  ),
  route('GET', '/api/sanitation-entries', {}, (context) => sanitation.listEntries(context)),
  route('POST', '/api/sanitation-reports', { body: 'json' }, (context) =>
    sanitation.generateReport(context),
  ),
  route('GET', '/api/sanitation-reports', {}, (context) =>
    sanitation.listSanitationReports(context),
  ),
  route('GET', '/api/sanitation-reports/:month/file', {}, (context, params) =>
    sanitation.readReportFile(context, params['month']!),
  ),

  route('POST', '/api/inspector-links', { body: 'json' }, (context) =>
    inspector.createInspectorLink(context),
  ),
  route('GET', '/api/inspector-links', {}, (context) =>
    inspector.listInspectorLinks(context),
  ),
  route('POST', '/api/inspector-links/:id/regenerate', { body: 'json' }, (context, params) =>
    inspector.regenerateInspectorLink(context, params['id']!),
  ),
  route('DELETE', '/api/inspector-links/:id', {}, (context, params) =>
    inspector.deleteInspectorLink(context, params['id']!),
  ),

  route('GET', '/api/inspect/:token', { auth: 'none' }, (context, params) =>
    inspector.inspectorView(context, params['token']!),
  ),
  route(
    'GET',
    '/api/inspect/:token/documents/:documentId/file',
    { auth: 'none' },
    (context, params) =>
      inspector.inspectorDocumentFile(context, params['token']!, params['documentId']!),
  ),
  route(
    'GET',
    '/api/inspect/:token/sanitation-reports/:month/file',
    { auth: 'none' },
    (context, params) =>
      inspector.inspectorReportFile(context, params['token']!, params['month']!),
  ),
];

function match(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index]!;
    const actual = pathParts[index]!;
    if (expected.startsWith(':')) {
      if (actual.length === 0) return null;
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) return null;
  }
  return params;
}

export type Dispatch = { result: Result; context: RequestContext };

export async function dispatch(
  request: IncomingMessage,
  path: string,
  query: URLSearchParams,
): Promise<Result> {
  const method = (request.method ?? 'GET').toUpperCase();
  const headers = request.headers;

  if (isCrossSite(method, headers)) throw errors.crossOrigin();

  const inspectorPath = path === '/api/inspect' || path.startsWith('/api/inspect/');
  if (inspectorPath && isStateChanging(method)) throw errors.readOnly();

  let found: { route: Route; params: Record<string, string> } | null = null;
  for (const candidate of routes) {
    if (candidate.method !== method) continue;
    const params = match(candidate.pattern, path);
    if (params) {
      found = { route: candidate, params };
      break;
    }
  }

  const limit = found?.route.body === 'multipart' ? uploadRequestLimit : jsonBodyLimit;
  const body = await readBody(request, limit);

  const contentType = (headers['content-type'] ?? '') as string;
  if (found && body.byteLength > 0) {
    if (found.route.body === 'json' && !/^application\/json(\s*;.*)?$/i.test(contentType.trim())) {
      throw errors.unsupportedMediaType();
    }
    if (found.route.body === 'multipart' && !/^multipart\/form-data/i.test(contentType.trim())) {
      throw errors.unsupportedMediaType();
    }
    if (found.route.body === 'none') throw errors.unsupportedMediaType();
  }

  let parsed: unknown = {};
  if (found?.route.body === 'json' && body.byteLength > 0) {
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      throw errors.badRequest();
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw errors.badRequest();
    }
  }

  const cookies = parseCookies((headers['cookie'] ?? null) as string | null);
  const sessionId = cookies.get('lineboard_session') ?? null;
  const idempotencyKeyHeader = headers['idempotency-key'];
  const idempotencyKey = Array.isArray(idempotencyKeyHeader)
    ? idempotencyKeyHeader[0] ?? null
    : idempotencyKeyHeader ?? null;

  const context: RequestContext = {
    method,
    path,
    query,
    headers,
    origin: `http://${(headers['host'] ?? '') as string}`,
    nowMs: Date.now(),
    body,
    json: parsed,
    idempotencyKey,
    sessionId,
    person: null,
    kitchen: null,
  };

  const needsSession = found === null || found.route.auth === 'required';
  if (needsSession) {
    const person = sessionId === null ? null : await personBySession(sessionId);
    if (!person) throw errors.unauthenticated();
    context.person = person;
    context.kitchen = await loadKitchen(db(), person.kitchenId);
  }

  if (found === null) throw errors.notFound();

  if (found.route.idempotency && !validKeyFormat(idempotencyKey)) {
    throw errors.idempotencyKeyRequired();
  }

  return found.route.run(context, found.params);
}

export { AppError };
