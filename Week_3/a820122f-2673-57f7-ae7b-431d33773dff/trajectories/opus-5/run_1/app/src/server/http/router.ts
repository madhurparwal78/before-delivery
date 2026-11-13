import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, ValidationError, fail } from './errors.js';
import * as store from '../db/store.js';

export const MAX_BODY_BYTES = 1_000_000;
export const SESSION_COOKIE = 'sixbell_session';

export type Session = { personId: string; role: store.Role };

export type RequestContext = {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  rawBody: string;
  session: Session | null;
  nowMs: number;
  json: () => Record<string, unknown>;
};

export type RouteHandler = (context: RequestContext) => Promise<void>;

export type Route = {
  method: string;
  segments: string[];
  auth: 'none' | 'session';
  handler: RouteHandler;
};

export const routes: Route[] = [];

export function route(
  method: string,
  pattern: string,
  auth: 'none' | 'session',
  handler: RouteHandler,
): void {
  routes.push({ method, segments: pattern.split('/').filter((part) => part !== ''), auth, handler });
}

export function matchRoute(
  method: string,
  path: string,
): { route: Route; params: Record<string, string> } | null {
  const parts = path.split('/').filter((part) => part !== '');
  let pathMatched: Route | null = null;
  for (const candidate of routes) {
    if (candidate.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < candidate.segments.length; i += 1) {
      const segment = candidate.segments[i] as string;
      const part = parts[i] as string;
      if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(part);
      else if (segment !== part) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    pathMatched = candidate;
    if (candidate.method === method) return { route: candidate, params };
  }
  if (pathMatched !== null) fail(405, 'method_not_allowed');
  return null;
}

export function readCookie(req: IncomingMessage, name: string): string | null {
  const header = req.headers.cookie;
  if (header === undefined) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(text);
}

export function sendPdf(res: ServerResponse, body: Buffer, filename: string): void {
  res.writeHead(200, {
    'content-type': 'application/pdf',
    'content-length': body.byteLength,
    'cache-control': 'no-store',
    'content-disposition': `attachment; filename="${filename}"`,
  });
  res.end(body);
}

export function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof ValidationError) {
    sendJson(res, 422, { errors: error.errors });
    return;
  }
  if (error instanceof ApiError) {
    sendJson(res, error.status, error.body());
    return;
  }
  process.stderr.write(`request failed: ${String(error)}\n`);
  sendJson(res, 500, { error: 'server_error', message: 'Something went wrong on board.' });
}

export async function readBody(req: IncomingMessage): Promise<string> {
  const declared = req.headers['content-length'];
  if (declared !== undefined && Number(declared) > MAX_BODY_BYTES) fail(413, 'payload_too_large');
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    total += buffer.byteLength;
    if (total > MAX_BODY_BYTES) fail(413, 'payload_too_large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function checkContentType(req: IncomingMessage, rawBody: string): void {
  if (rawBody.length === 0) return;
  const header = req.headers['content-type'];
  if (header === undefined || !header.split(';')[0]?.trim().startsWith('application/json')) {
    fail(415, 'unsupported_media_type');
  }
}

export function checkOrigin(req: IncomingMessage): void {
  const method = req.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD') return;
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'null') return;
  const host = req.headers.host;
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = null;
  }
  if (originHost === null || host === undefined || originHost !== host) fail(403, 'cross_origin');
}

export function parseJsonBody(rawBody: string): Record<string, unknown> {
  if (rawBody.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new ValidationError({ body: 'Send this request as JSON.' });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ValidationError({ body: 'Send this request as a JSON object.' });
  }
  return parsed as Record<string, unknown>;
}

export function requireSession(context: RequestContext): Session {
  if (context.session === null) fail(401, 'not_signed_in');
  return context.session;
}

export function requireOwner(context: RequestContext): string {
  const session = requireSession(context);
  if (session.role !== 'owner_master') fail(403, 'forbidden');
  return session.personId;
}

export function requireCrewSession(context: RequestContext, code = 'forbidden'): string {
  const session = requireSession(context);
  if (session.role !== 'crew') fail(403, code);
  return session.personId;
}

/** Resolves a vessel the signed-in person may see; anything else is unknown to them. */
export async function requireVisibleVessel(context: RequestContext): Promise<store.Vessel> {
  const session = requireSession(context);
  const vessel = await store.findVesselById(context.params['vesselId'] as string);
  if (vessel === null) fail(404, 'not_found');
  if (session.role === 'owner_master') {
    if (vessel.ownerId !== session.personId) fail(404, 'not_found');
    return vessel;
  }
  const crew = await store.findCrewById(session.personId);
  if (crew === null || crew.vesselId !== vessel.id) fail(404, 'not_found');
  return vessel;
}

export async function requireOwnedVessel(context: RequestContext): Promise<store.Vessel> {
  const vessel = await requireVisibleVessel(context);
  requireOwner(context);
  return vessel;
}

/** Resolves a crew member whose record the signed-in person may read. */
export async function requireVisibleCrew(context: RequestContext): Promise<store.Crew> {
  const session = requireSession(context);
  const crew = await store.findCrewById(context.params['crewId'] as string);
  if (crew === null) fail(404, 'not_found');
  if (session.role === 'owner_master') {
    const vessel = await store.findVesselById(crew.vesselId);
    if (vessel === null || vessel.ownerId !== session.personId) fail(404, 'not_found');
    return crew;
  }
  const viewer = await store.findCrewById(session.personId);
  if (viewer === null || viewer.vesselId !== crew.vesselId) fail(404, 'not_found');
  if (viewer.id !== crew.id) fail(403, 'forbidden');
  return crew;
}
