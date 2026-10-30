import type { IncomingMessage } from 'node:http';
import { findAssignmentByNumber } from '../db/assignments.js';
import type { AssignmentRecord, Role, SessionUser } from '../domain/types.js';
import { assignmentView, viewKindFor, type AssignmentView, type ViewKind } from '../domain/views.js';
import {
  JSON_BODY_LIMIT,
  UPLOAD_BODY_LIMIT,
  parseJsonBody,
  parseMultipartBody,
  readBody,
  type MultipartBody,
} from './body.js';
import { fail } from './errors.js';
import { readCookie, SESSION_COOKIE, userForSession } from './session.js';

export interface Reply {
  status: number;
  json?: unknown;
  body?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
}

export interface PublicContext {
  url: URL;
  params: Record<string, string>;
  headers: IncomingMessage['headers'];
  json: Record<string, unknown>;
  sessionToken: string | null;
}

export interface SessionContext extends PublicContext {
  user: SessionUser;
  sessionToken: string;
}

export interface AssignmentContext extends SessionContext {
  assignment: AssignmentRecord;
  viewKind: ViewKind;
  view: () => AssignmentView;
}

export interface SeatContext extends AssignmentContext {
  seat: number;
}

export interface UploadContext extends SeatContext {
  multipart: MultipartBody;
}

type BodyKind = 'none' | 'json';

export type Route =
  | {
      kind: 'public';
      method: string;
      path: string;
      body: BodyKind;
      handler: (ctx: PublicContext) => Promise<Reply>;
    }
  | {
      kind: 'session';
      method: string;
      path: string;
      body: BodyKind;
      roles?: Role[];
      handler: (ctx: SessionContext) => Promise<Reply>;
    }
  | {
      kind: 'assignment';
      method: string;
      path: string;
      body: BodyKind;
      roles?: Role[];
      handler: (ctx: AssignmentContext) => Promise<Reply>;
    }
  | {
      kind: 'seat';
      method: string;
      path: string;
      body: BodyKind;
      roles?: Role[];
      handler: (ctx: SeatContext) => Promise<Reply>;
    }
  | {
      kind: 'upload';
      method: string;
      path: string;
      roles?: Role[];
      handler: (ctx: UploadContext) => Promise<Reply>;
    };

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (const [index, part] of patternParts.entries()) {
    const actual = pathParts[index] ?? '';
    if (part.startsWith(':')) {
      if (actual === '') return null;
      params[part.slice(1)] = decodeURIComponent(actual);
    } else if (part !== actual) {
      return null;
    }
  }
  return params;
}

function isSameOrigin(origin: string, host: string | undefined): boolean {
  if (host === undefined) return false;
  const normalise = (value: string): string =>
    value.replace(/^localhost(?=:|$)/, '127.0.0.1').replace(/^\[::1\](?=:|$)/, '127.0.0.1');
  try {
    return normalise(new URL(origin).host.toLowerCase()) === normalise(host.toLowerCase());
  } catch {
    return false;
  }
}

function requireSeat(assignment: AssignmentRecord, raw: string): number {
  const seat = Number.parseInt(raw, 10);
  if (!/^\d+$/.test(raw) || !assignment.seats.some((candidate) => candidate.seat === seat)) {
    fail('not_found');
  }
  return seat;
}

export async function dispatch(
  routes: readonly Route[],
  request: IncomingMessage,
  url: URL,
): Promise<Reply> {
  const method = request.method ?? 'GET';
  const stateChanging = method === 'POST' || method === 'PATCH' || method === 'DELETE';

  const route = routes.find(
    (candidate) => candidate.method === method && matchPath(candidate.path, url.pathname) !== null,
  );
  if (route === undefined) fail('not_found');
  const params = matchPath(route.path, url.pathname) ?? {};

  const origin = request.headers.origin;
  if (stateChanging && origin !== undefined && origin !== 'null') {
    if (!isSameOrigin(origin, request.headers.host)) fail('cross_origin');
  }

  let json: Record<string, unknown> = {};
  let multipart: MultipartBody = { fields: new Map(), files: new Map() };
  if (route.kind === 'upload') {
    const raw = await readBody(request, UPLOAD_BODY_LIMIT);
    multipart = parseMultipartBody(request, raw);
  } else {
    const raw = await readBody(request, JSON_BODY_LIMIT);
    if (route.body === 'json') json = parseJsonBody(request, raw);
  }

  const sessionToken = readCookie(request, SESSION_COOKIE);
  const publicContext: PublicContext = {
    url,
    params,
    headers: request.headers,
    json,
    sessionToken,
  };

  if (route.kind === 'public') return route.handler(publicContext);

  const user = await userForSession(sessionToken);
  if (user === null || sessionToken === null) fail('unauthenticated');
  const sessionContext: SessionContext = { ...publicContext, user, sessionToken };

  if (route.kind === 'session') {
    if (route.roles !== undefined && !route.roles.includes(user.role)) fail('forbidden');
    return route.handler(sessionContext);
  }

  const number = params['number'] ?? '';
  const assignment = await findAssignmentByNumber(number);
  if (assignment === null) fail('not_found');
  const viewKind = viewKindFor(assignment, user);
  if (viewKind === null) fail('not_found');

  const assignmentContext: AssignmentContext = {
    ...sessionContext,
    assignment,
    viewKind,
    view: () => assignmentView(assignment, viewKind),
  };
  const seatParam = params['seat'];
  const seat = seatParam === undefined ? 0 : requireSeat(assignment, seatParam);

  if (route.roles !== undefined && !route.roles.includes(user.role)) fail('forbidden');

  if (route.kind === 'assignment') return route.handler(assignmentContext);
  if (route.kind === 'seat') return route.handler({ ...assignmentContext, seat });
  return route.handler({ ...assignmentContext, seat, multipart });
}
