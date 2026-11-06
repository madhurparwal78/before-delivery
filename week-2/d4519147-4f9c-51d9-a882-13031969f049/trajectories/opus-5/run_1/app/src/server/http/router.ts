import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, errors } from './errors';
import { applySecurityHeaders } from './headers';
import {
  clientIp,
  mediaType,
  parseCookies,
  parseJsonBody,
  passesOriginRule,
  readBody,
  type MultipartFile,
} from './request';
import { parseMultipartFile } from './request';
import { resolveSession, touchSession, type ActiveSession } from '../domain/sessions';
import { config } from '../config';

export const JSON_BODY_LIMIT = 1_000_000;
export const MULTIPART_LIMIT = 2_100_000;
export const FILE_PART_LIMIT = 2_000_000;

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  setCookie?: string;
  redirect?: string;
  file?: { bytes: Buffer; contentType: string; fileName: string; sha256?: string | null };
  noReferrer?: boolean;
}

export type Params = Record<string, string>;

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  ip: string;
  cookies: Record<string, string>;
  cookieValue: string | undefined;
  json: unknown;
  file: MultipartFile | null;
}

export interface AuthedCtx extends Ctx {
  session: ActiveSession;
}

type BodyKind = 'none' | 'json' | 'multipart';
type CsrfKind = 'never' | 'session-only' | 'required';

interface CommonRoute {
  method: string;
  pattern: string;
  body?: BodyKind;
  csrf?: CsrfKind;
}

export type Route =
  | (CommonRoute & { auth: false; handler: (ctx: Ctx, params: Params) => Promise<Reply> })
  | (CommonRoute & { auth: true; handler: (ctx: AuthedCtx, params: Params) => Promise<Reply> });

interface MatchedRoute {
  route: Route;
  params: Params;
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function matchPattern(pattern: string, path: string): Params | null {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params: Params = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const expected = patternParts[i] ?? '';
    const actual = pathParts[i] ?? '';
    if (expected.startsWith(':')) {
      if (actual === '') return null;
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

export class ApiRouter {
  private readonly routes: Route[] = [];

  add(...routes: Route[]): void {
    this.routes.push(...routes);
  }

  private find(method: string, path: string): { matched: MatchedRoute | null; pathExists: boolean } {
    let pathExists = false;
    for (const route of this.routes) {
      const params = matchPattern(route.pattern, path);
      if (!params) continue;
      pathExists = true;
      if (route.method === method) return { matched: { route, params }, pathExists };
    }
    return { matched: null, pathExists };
  }

  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const noReferrer = url.pathname.startsWith('/api/invites/');
    try {
      const reply = await this.resolve(req, res, url);
      send(res, { ...reply, noReferrer: reply.noReferrer || noReferrer });
    } catch (error) {
      const httpError =
        error instanceof HttpError
          ? error
          : (() => {
              console.error('request failed', sanitizeError(error));
              return errors.internal();
            })();
      send(res, {
        status: httpError.status,
        body: {
          error: httpError.code,
          message: httpError.message,
          ...(httpError.fields ? { fields: httpError.fields } : {}),
        },
        headers: httpError.headers,
        noReferrer,
      });
    }
  }

  private async resolve(req: IncomingMessage, res: ServerResponse, url: URL): Promise<Reply> {
    const method = req.method ?? 'GET';
    const { matched, pathExists } = this.find(method, url.pathname);
    if (!matched) {
      if (pathExists && url.pathname.endsWith('/audit')) throw errors.methodNotAllowed();
      throw errors.notFound();
    }
    const { route, params } = matched;

    if (STATE_CHANGING.has(method) && !passesOriginRule(req)) throw errors.crossSite();

    const bodyKind: BodyKind = route.body ?? 'none';
    let json: unknown = {};
    let file: MultipartFile | null = null;
    if (bodyKind === 'json') {
      const raw = await readBody(req, JSON_BODY_LIMIT, () => errors.payloadTooLarge());
      if (mediaType(req) !== 'application/json') throw errors.unsupportedMediaType();
      json = parseJsonBody(raw);
    } else if (bodyKind === 'multipart') {
      const raw = await readBody(req, MULTIPART_LIMIT, () => errors.fileTooLarge());
      file = parseMultipartFile(raw, req.headers['content-type'] ?? '', FILE_PART_LIMIT);
    }

    const cookies = parseCookies(req);
    const cookieValue = cookies[cookieNameFromEnvironment()];
    const lookup = await resolveSession(cookieValue);

    const ctx: Ctx = {
      req,
      res,
      url,
      ip: clientIp(req),
      cookies,
      cookieValue,
      json,
      file,
    };

    if (route.auth) {
      if (lookup.state === 'none') throw errors.unauthenticated();
      if (lookup.state === 'expired') throw errors.sessionExpired();
      checkCsrf(req, route.csrf ?? 'required', method, lookup.session);
      if (cookieValue) await touchSession(cookieValue);
      const authed: AuthedCtx = { ...ctx, session: lookup.session };
      return route.handler(authed, params);
    }

    if (lookup.state === 'active') {
      checkCsrf(req, route.csrf ?? 'never', method, lookup.session);
    }
    return route.handler(ctx, params);
  }
}

function checkCsrf(req: IncomingMessage, kind: CsrfKind, method: string, session: ActiveSession): void {
  if (kind === 'never') return;
  if (!STATE_CHANGING.has(method)) return;
  const header = req.headers['x-csrf-token'];
  if (typeof header !== 'string' || header !== session.csrfToken) throw errors.csrfInvalid();
}

function cookieNameFromEnvironment(): string {
  return config.cookieName;
}

export function send(res: ServerResponse, reply: Reply): void {
  if (res.headersSent) return;
  if (reply.file) {
    applySecurityHeaders(res, 'download');
    res.setHeader('Content-Type', reply.file.contentType);
    res.setHeader('Content-Length', String(reply.file.bytes.length));
    for (const [name, value] of Object.entries(reply.headers ?? {})) res.setHeader(name, value);
    res.writeHead(reply.status);
    res.end(reply.file.bytes);
    return;
  }
  applySecurityHeaders(res, 'api', { noReferrer: reply.noReferrer });
  if (reply.redirect) res.setHeader('Location', reply.redirect);
  if (reply.setCookie) res.setHeader('Set-Cookie', reply.setCookie);
  for (const [name, value] of Object.entries(reply.headers ?? {})) res.setHeader(name, value);
  if (reply.body === undefined || reply.status === 204) {
    res.writeHead(reply.status);
    res.end();
    return;
  }
  const payload = Buffer.from(JSON.stringify(reply.body), 'utf8');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(payload.length));
  res.writeHead(reply.status);
  res.end(payload);
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error) return error.name;
  return 'unknown';
}
