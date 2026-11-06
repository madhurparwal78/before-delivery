import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PocketBaseUser, UserRole } from '../services/pocketbase.js';
import { ApiError, crossOrigin, forbidden, notFound, tooLarge, unauthenticated, unsupportedType } from './errors.js';

const JSON_BODY_LIMIT = 64_000;
const UPLOAD_BODY_LIMIT = 5_100_000;

export interface SetCookie {
  name: string;
  value: string;
  maxAgeSeconds?: number;
}

export interface Reply {
  status: number;
  json?: unknown;
  body?: Buffer;
  contentType?: string;
  cookies?: SetCookie[];
  headers?: Record<string, string>;
}

export interface RequestContext {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  cookies: Record<string, string>;
  body: unknown;
  rawBody: Buffer;
  user: PocketBaseUser | null;
  cartId: string | null;
  setCookies: SetCookie[];
}

export type BodyKind = 'json' | 'upload' | 'none';

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  /** Roles allowed to call the endpoint. Omitted means anyone, signed in or not. */
  roles?: readonly UserRole[];
  body?: BodyKind;
  handle: (ctx: RequestContext) => Promise<Reply>;
}

interface CompiledRoute extends Route {
  segments: string[];
}

function compile(route: Route): CompiledRoute {
  return { ...route, segments: route.path.split('/').filter((part) => part !== '') };
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (header === undefined) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The app's own origin is `http://` plus the request's Host header. */
export function originAllowed(req: IncomingMessage): boolean {
  if (!STATE_CHANGING.has(req.method ?? 'GET')) return true;
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'null') return true;
  const host = req.headers.host;
  return host !== undefined && (origin === `http://${host}` || origin === `https://${host}`);
}

function matchRoute(
  routes: readonly CompiledRoute[],
  method: string,
  path: string,
): { route: CompiledRoute; params: Record<string, string> } | null {
  const parts = path.split('/').filter((part) => part !== '');
  for (const route of routes) {
    if (route.method !== method) continue;
    if (route.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (const [index, segment] of route.segments.entries()) {
      const actual = parts[index]!;
      if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(actual);
      else if (segment !== actual) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? '0');
  if (Number.isFinite(declared) && declared > limit) throw tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > limit) throw tooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export interface RouterDependencies {
  loadUser: (token: string) => Promise<PocketBaseUser | null>;
}

export class ApiRouter {
  private readonly routes: CompiledRoute[];

  constructor(
    routes: readonly Route[],
    private readonly deps: RouterDependencies,
  ) {
    this.routes = routes.map(compile);
  }

  handles(method: string, path: string): boolean {
    return matchRoute(this.routes, method, path) !== null;
  }

  /** Applies the published error precedence, then runs the matched handler. */
  async dispatch(req: IncomingMessage, path: string, query: URLSearchParams): Promise<Reply> {
    if (!originAllowed(req)) throw crossOrigin();

    const match = matchRoute(this.routes, req.method ?? 'GET', path);
    if (match === null) throw notFound();
    const { route, params } = match;

    const bodyKind: BodyKind = route.body ?? (route.method === 'GET' ? 'none' : 'json');
    const limit = bodyKind === 'upload' ? UPLOAD_BODY_LIMIT : JSON_BODY_LIMIT;
    const rawBody = await readBody(req, limit);

    const contentType = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (bodyKind === 'json' && rawBody.byteLength > 0 && contentType !== 'application/json') {
      throw unsupportedType();
    }
    if (bodyKind === 'upload' && contentType !== 'multipart/form-data') {
      throw unsupportedType();
    }

    let body: unknown = undefined;
    if (bodyKind === 'json' && rawBody.byteLength > 0) {
      try {
        body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        throw new ApiError(422, 'validation', 'Send a JSON object.', { fields: {} });
      }
    }

    const cookies = parseCookies(req.headers.cookie);
    const sessionToken = cookies.ceibo_session;
    const user =
      sessionToken === undefined ? null : await this.deps.loadUser(sessionToken);

    if (route.roles !== undefined) {
      if (user === null) throw unauthenticated();
      if (!route.roles.includes(user.role)) throw forbidden();
    }

    return route.handle({
      method: req.method ?? 'GET',
      path,
      params,
      query,
      headers: req.headers,
      cookies,
      body,
      rawBody,
      user,
      cartId: cookies.ceibo_cart ?? null,
      setCookies: [],
    });
  }
}

export function sendReply(res: ServerResponse, reply: Reply): void {
  const headers: Record<string, string | string[]> = { ...reply.headers };
  if (reply.cookies !== undefined && reply.cookies.length > 0) {
    headers['Set-Cookie'] = reply.cookies.map(
      (cookie) =>
        `${cookie.name}=${encodeURIComponent(cookie.value)}; Path=/; HttpOnly; SameSite=Lax` +
        (cookie.maxAgeSeconds === undefined ? '' : `; Max-Age=${cookie.maxAgeSeconds}`),
    );
  }
  if (reply.json !== undefined) {
    const payload = Buffer.from(JSON.stringify(reply.json), 'utf8');
    headers['Content-Type'] = 'application/json; charset=utf-8';
    headers['Content-Length'] = String(payload.byteLength);
    res.writeHead(reply.status, headers);
    res.end(payload);
    return;
  }
  if (reply.body !== undefined) {
    headers['Content-Type'] = reply.contentType ?? 'application/octet-stream';
    headers['Content-Length'] = String(reply.body.byteLength);
    res.writeHead(reply.status, headers);
    res.end(reply.body);
    return;
  }
  res.writeHead(reply.status, headers);
  res.end();
}
