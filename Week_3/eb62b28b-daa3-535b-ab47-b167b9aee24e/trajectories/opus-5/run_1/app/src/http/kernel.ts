import { IncomingMessage, ServerResponse } from 'node:http';
import {
  ApiError,
  badRequest,
  forbidden,
  methodNotAllowed,
  notFound,
  notSignedIn,
  sessionEnded,
  tooLarge,
  unsupportedMediaType,
} from './errors';
import { MultipartParser, PartLimit, boundaryOf } from './multipart';
import { Person, Role, SESSION_COOKIE, SessionRecord, cookieValue, readSession } from './sessions';

export interface Reply {
  status: number;
  json?: unknown;
  bytes?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
}

export interface RequestContext {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: Record<string, string | undefined>;
  session: SessionRecord | null;
  bodyBytes: Buffer;
  multipart: MultipartParser | null;
  requestKey: string | null;
  res: ServerResponse;
}

export function person(ctx: RequestContext): Person {
  if (!ctx.session) throw notSignedIn();
  return ctx.session.person;
}

export function jsonBody<T>(ctx: RequestContext): T {
  const contentType = ctx.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().includes('application/json')) throw unsupportedMediaType();
  if (ctx.bodyBytes.length === 0) throw badRequest();
  try {
    const parsed = JSON.parse(ctx.bodyBytes.toString('utf8')) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw badRequest();
    return parsed as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw badRequest();
  }
}

export function multipartParts(ctx: RequestContext): MultipartParser {
  if (!ctx.multipart) throw unsupportedMediaType();
  if (ctx.multipart.malformed) throw badRequest();
  return ctx.multipart;
}

export interface RouteSpec<T> {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  /** `public` needs no session, `any` allows every signed-in person. */
  access: 'public' | 'any' | Role[];
  bodyLimit?: PartLimit;
  partLimits?: Record<string, PartLimit>;
  rateLimit?: (ctx: RequestContext) => Promise<void>;
  resolve?: (ctx: RequestContext) => Promise<T>;
  handler: (ctx: RequestContext, resolved: T) => Promise<Reply>;
}

export interface Route {
  method: string;
  path: string;
  segments: string[];
  bodyLimit: PartLimit;
  partLimits: Record<string, PartLimit>;
  rateLimit: ((ctx: RequestContext) => Promise<void>) | null;
  run: (ctx: RequestContext) => Promise<Reply>;
}

const DEFAULT_BODY_LIMIT: PartLimit = {
  limit: 65536,
  message: 'That request is too large.',
};

export function defineRoute<T>(spec: RouteSpec<T>): Route {
  return {
    method: spec.method,
    path: spec.path,
    segments: spec.path.split('/').filter((segment) => segment !== ''),
    bodyLimit: spec.bodyLimit ?? DEFAULT_BODY_LIMIT,
    partLimits: spec.partLimits ?? {},
    rateLimit: spec.rateLimit ?? null,
    run: async (ctx: RequestContext): Promise<Reply> => {
      if (spec.access !== 'public' && !ctx.session) {
        throw ctx.headers.cookie && cookieValue(ctx.headers.cookie, SESSION_COOKIE)
          ? sessionEnded()
          : notSignedIn();
      }
      const resolved = spec.resolve ? await spec.resolve(ctx) : (undefined as T);
      if (Array.isArray(spec.access)) {
        const role = ctx.session?.person.role;
        if (!role || !spec.access.includes(role)) throw forbidden();
      }
      return spec.handler(ctx, resolved);
    },
  };
}

function matchPath(route: Route, segments: string[]): Record<string, string> | null {
  if (route.segments.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < route.segments.length; index += 1) {
    const expected = route.segments[index] as string;
    const actual = segments[index] as string;
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

async function readBody(
  req: IncomingMessage,
  limit: PartLimit,
  partLimits: Record<string, PartLimit>,
): Promise<{ bytes: Buffer; multipart: MultipartParser | null }> {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > limit.limit) throw tooLarge(limit.message);
  const boundary = boundaryOf(req.headers['content-type']);
  const parser = boundary ? new MultipartParser(boundary, partLimits) : null;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const bytes = chunk as Buffer;
    total += bytes.length;
    if (total > limit.limit) throw tooLarge(limit.message);
    if (parser) parser.push(bytes);
    else chunks.push(bytes);
  }
  if (parser) parser.end();
  return { bytes: parser ? Buffer.alloc(0) : Buffer.concat(chunks), multipart: parser };
}

export async function dispatch(
  routes: Route[],
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<Reply> {
  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  const byPath = routes
    .map((route) => ({ route, params: matchPath(route, segments) }))
    .filter((candidate) => candidate.params !== null);
  if (byPath.length === 0) throw notFound();
  const matched = byPath.find((candidate) => candidate.route.method === req.method);
  if (!matched) {
    throw methodNotAllowed([...new Set(byPath.map((candidate) => candidate.route.method))].sort());
  }
  const route = matched.route;
  const body = await readBody(req, route.bodyLimit, route.partLimits);
  const cookie = cookieValue(req.headers.cookie, SESSION_COOKIE);
  const session = cookie ? await readSession(cookie) : null;
  const ctx: RequestContext = {
    method: req.method ?? 'GET',
    path: url.pathname,
    params: matched.params as Record<string, string>,
    query: url.searchParams,
    headers: req.headers as Record<string, string | undefined>,
    session,
    bodyBytes: body.bytes,
    multipart: body.multipart,
    requestKey: (req.headers['request-key'] as string | undefined) ?? null,
    res,
  };
  if (route.rateLimit && session) await route.rateLimit(ctx);
  return route.run(ctx);
}
