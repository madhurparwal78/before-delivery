import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config';
import { httpDate, nowMs } from './clock';
import { ensureSchemaAndSeed, isReady } from './seed';
import { ApiError, auditOutcomeFor } from './http/errors';
import {
  JSON_BODY_LIMIT,
  MULTIPART_REQUEST_LIMIT,
  parseJsonBody,
  parseMultipart,
  readBody,
  type MultipartBody,
} from './http/request';
import { allowHeader, matchRoute } from './http/router';
import { defaultAuditTarget } from './http/audit-target';
import type { HandlerResult, RequestContext, RouteMethod } from './http/context';
import { lookupSession, type LiveSession, type SignedInUser } from './domain/sessions';
import { addressPrefix, appendAuditEvent, clientAddress } from './domain/audit';
import { startWorkers } from './workers';

const PUBLIC_DIR = join(__dirname, '..', 'public');

const APP_ROUTES = new Set([
  '/',
  '/book',
  '/packs',
  '/documents',
  '/truck',
  '/site',
  '/compliance',
  '/trucks',
  '/rates',
  '/reports',
]);

const ASSETS: Record<string, { file: string; type: string }> = {
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
  '/fonts/archivo-wdth.woff2': { file: 'fonts/archivo-wdth.woff2', type: 'font/woff2' },
  '/fonts/plex-sans-400.woff2': { file: 'fonts/plex-sans-400.woff2', type: 'font/woff2' },
  '/fonts/plex-sans-600.woff2': { file: 'fonts/plex-sans-600.woff2', type: 'font/woff2' },
  '/fonts/plex-mono-400.woff2': { file: 'fonts/plex-mono-400.woff2', type: 'font/woff2' },
  '/fonts/plex-mono-500.woff2': { file: 'fonts/plex-mono-500.woff2', type: 'font/woff2' },
};

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
  "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

function baseHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    Date: httpDate(),
  };
}

function send(
  res: ServerResponse,
  status: number,
  body: Buffer,
  contentType: string,
  extra: Record<string, string> = {},
  cookies: string[] = [],
): void {
  const headers: Record<string, string | string[]> = {
    ...baseHeaders(),
    ...extra,
    'Content-Type': contentType,
  };
  if (headers['Content-Length'] === undefined) headers['Content-Length'] = String(body.length);
  if (cookies.length > 0) headers['Set-Cookie'] = cookies;
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(
  res: ServerResponse,
  status: number,
  value: unknown,
  extra: Record<string, string> = {},
  cookies: string[] = [],
): void {
  send(
    res,
    status,
    Buffer.from(JSON.stringify(value), 'utf8'),
    'application/json; charset=utf-8',
    extra,
    cookies,
  );
}

function sendError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.status, error.body(), error.headers);
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (header === undefined) return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

function headerValue(raw: string | string[] | undefined): string | null {
  if (raw === undefined) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendError(res, new ApiError('not_found'));
    return;
  }
  const asset = ASSETS[path];
  if (asset !== undefined) {
    try {
      const bytes = await readFile(join(PUBLIC_DIR, asset.file));
      send(res, 200, bytes, asset.type, { 'Cache-Control': 'public, max-age=3600' });
    } catch {
      sendError(res, new ApiError('not_found'));
    }
    return;
  }
  if (APP_ROUTES.has(path) || /^\/inspect\/[A-Za-z0-9_-]+$/.test(path)) {
    try {
      const html = await readFile(join(PUBLIC_DIR, 'index.html'));
      send(res, 200, html, 'text/html; charset=utf-8', {
        'Content-Security-Policy': CSP,
        'Cache-Control': 'no-store',
      });
    } catch {
      sendError(res, new ApiError('not_found'));
    }
    return;
  }
  sendError(res, new ApiError('not_found'));
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface Resolved {
  method: RouteMethod;
  pattern: string;
  params: Record<string, string>;
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const method = req.method ?? 'GET';
  const path = url.pathname;
  const cookies = parseCookies(req.headers.cookie);
  const presentedSessionValue = cookies.pl_session ?? null;
  const secure = (req.socket as unknown as { encrypted?: boolean }).encrypted === true;
  const host = req.headers.host ?? `127.0.0.1:${config.port}`;
  const ownOrigin = `${secure ? 'https' : 'http'}://${host}`;
  const audit = {
    targetType: null,
    targetId: null,
    tokenTenantId: null,
    tokenSiteId: null,
    subjectUserId: null,
  } as RequestContext['audit'];
  let pattern = `${method} unknown`;
  let user: SignedInUser | null = null;
  let session: LiveSession | null = null;
  let status = 500;
  let code: string | null = 'internal';
  const isWrite = UNSAFE_METHODS.has(method);

  const finish = async (): Promise<void> => {
    if (!isWrite) return;
    await appendAuditEvent({
      actor: user === null ? null : { user_id: user.user_id, name: user.name, role: user.role },
      subjectUserId: audit.subjectUserId ?? (user === null ? null : user.user_id),
      tokenTenantId: audit.tokenTenantId,
      tokenSiteId: audit.tokenSiteId,
      action: pattern,
      targetType: audit.targetType,
      targetId: audit.targetId,
      outcome: auditOutcomeFor(status, code),
      addressPrefix: addressPrefix(req.socket.remoteAddress),
    }).catch(() => undefined);
  };

  const fail = async (error: ApiError): Promise<void> => {
    status = error.status;
    code = error.code;
    sendError(res, error);
    await finish();
  };

  try {
    /* 1. Inspector paths are read-only, whatever the token, headers or body. */
    if ((path === '/api/inspect' || path.startsWith('/api/inspect/')) && method !== 'GET') {
      pattern = `${method} /api/inspect/{token}`;
      audit.targetType = 'inspector_link';
      await fail(new ApiError('read_only', { headers: { Allow: 'GET' } }));
      return;
    }

    /* 2. Transport limits, read before anything looks at the surface. */
    const contentType = (headerValue(req.headers['content-type']) ?? '').toLowerCase();
    const isMultipart = contentType.startsWith('multipart/form-data');
    const rawBody = await readBody(req, isMultipart ? MULTIPART_REQUEST_LIMIT : JSON_BODY_LIMIT);
    let multipart: MultipartBody | null = null;
    if (isMultipart) multipart = parseMultipart(rawBody, contentType);

    const match = matchRoute(path);
    if (match !== null) {
      const routeMethod = match.route.methods.find((candidate) => candidate.method === method);
      if (routeMethod !== undefined) {
        const wantsMultipart = match.route.pattern === '/api/documents' && method === 'POST';
        if (wantsMultipart && !isMultipart) throw new ApiError('unsupported_media_type');
        if (
          !wantsMultipart &&
          rawBody.length > 0 &&
          !contentType.startsWith('application/json')
        ) {
          throw new ApiError('unsupported_media_type');
        }
      }
    }

    const origin = headerValue(req.headers.origin);
    if (isWrite && origin !== null && origin !== ownOrigin) {
      if (match !== null) pattern = `${method} ${match.route.pattern}`;
      throw new ApiError('cross_origin');
    }

    /* 3. Unknown surface. */
    if (match === null) throw new ApiError('not_found');
    pattern = `${method} ${match.route.pattern}`;
    const routeMethod = match.route.methods.find((candidate) => candidate.method === method);
    if (routeMethod === undefined) {
      throw new ApiError('method_not_allowed', { headers: { Allow: allowHeader(match.route) } });
    }
    const resolved: Resolved = {
      method: routeMethod,
      pattern: match.route.pattern,
      params: match.params,
    };
    const fallbackTarget = defaultAuditTarget(resolved.pattern, resolved.params);
    audit.targetType = fallbackTarget.targetType;
    audit.targetId = fallbackTarget.targetId;

    /* 4-5. Sessions. */
    if (presentedSessionValue !== null) {
      const lookup = await lookupSession(presentedSessionValue);
      if (lookup.state === 'live') {
        session = lookup.session;
        user = lookup.session.user;
      } else if (lookup.state === 'expired') {
        audit.subjectUserId = lookup.userId;
      }
      if (resolved.method.roles !== 'public' && lookup.state !== 'live') {
        throw new ApiError(lookup.state === 'expired' ? 'session_expired' : 'session_invalid');
      }
    } else if (resolved.method.roles !== 'public') {
      throw new ApiError('unauthenticated');
    }

    /* 6. CSRF, after the origin and session checks and before the role check. */
    const needsCsrf =
      isWrite && session !== null && !(resolved.pattern === '/api/session' && method === 'POST');
    if (needsCsrf) {
      const token = headerValue(req.headers['x-csrf-token']);
      if (token === null || token !== (session as LiveSession).csrf_value) {
        throw new ApiError('csrf_failed');
      }
    }

    /* 7. Role. */
    if (resolved.method.roles !== 'public') {
      if (user === null || !resolved.method.roles.includes(user.role)) {
        throw new ApiError('forbidden');
      }
    }

    const ctx: RequestContext = {
      method,
      path,
      pattern: resolved.pattern,
      params: resolved.params,
      query: url.searchParams,
      headers: req.headers,
      rawBody,
      json: () => parseJsonBody(rawBody),
      multipart: () => {
        if (multipart === null) throw new ApiError('unsupported_media_type');
        return multipart;
      },
      user,
      session,
      requireUser: () => {
        if (user === null) throw new ApiError('unauthenticated');
        return user;
      },
      origin: ownOrigin,
      clientAddress: clientAddress(req.socket.remoteAddress),
      addressPrefix: addressPrefix(req.socket.remoteAddress),
      presentedSessionValue,
      secure,
      nowMs: nowMs(),
      audit,
      cookies,
    };

    const result: HandlerResult = await resolved.method.handler(ctx);
    user = ctx.user;
    status = result.status;
    code = null;
    if (result.raw !== undefined) {
      send(
        res,
        result.status,
        result.raw,
        result.contentType ?? 'application/octet-stream',
        result.headers ?? {},
        result.setCookies ?? [],
      );
    } else if (result.status === 204) {
      res.writeHead(204, {
        ...baseHeaders(),
        ...(result.headers ?? {}),
        ...(result.setCookies !== undefined && result.setCookies.length > 0
          ? { 'Set-Cookie': result.setCookies }
          : {}),
      });
      res.end();
    } else {
      sendJson(res, result.status, result.body ?? null, result.headers ?? {}, result.setCookies ?? []);
    }
    await finish();
  } catch (error) {
    if (error instanceof ApiError) {
      await fail(error);
      return;
    }
    status = 500;
    code = 'internal';
    sendError(res, new ApiError('internal', { message: 'Something went wrong.' }));
    await finish();
  }
}

const server = createServer((req, res) => {
  const host = req.headers.host ?? `127.0.0.1:${config.port}`;
  let url: URL;
  try {
    url = new URL(req.url ?? '/', `http://${host}`);
  } catch {
    sendError(res, new ApiError('not_found'));
    return;
  }
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    void handleApi(req, res, url);
    return;
  }
  void serveStatic(req, res, url.pathname);
});

async function boot(): Promise<void> {
  server.listen(config.port, '0.0.0.0');
  startWorkers();
  for (;;) {
    try {
      await ensureSchemaAndSeed();
      if (isReady()) return;
    } catch {
      /* the database is not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

void boot();
